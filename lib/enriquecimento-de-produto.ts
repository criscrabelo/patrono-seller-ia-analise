/**
 * P2.17.6 — Enriquecimento automático dos candidatos.
 *
 *   candidato com link → identificar provider → fonte oficial → normalizar →
 *   comparar com o último dado → histórico (anterior → novo) → atualizar
 *
 * Idempotente: um dado oficial por produto (chave provider:id ou link), nunca
 * duplicado. Sem fonte oficial ativa, grava o MOTIVO e a data da consulta —
 * a tela mostra "O TikTok ainda não forneceu esse dado." em vez de "desconhecido".
 */
import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import {
  alertaDaMudanca, chaveDoDado, identificarProduto, mudancasDeDado, normalizarOferta,
  type DadosNormalizados, type MudancaDeDado, type OfertaBruta, type ProdutoIdentificado,
} from './dados-de-produto'
import { estadoDaFonte, type EstadoDaFonteDeProduto, type FonteOficial, type LeitorOficial } from './fontes-de-dados-de-produto'
import type { estadoDaConexaoTikTokShop } from './tiktok-shop-estado'
import { CANDIDATO_NAO_EXCLUIDO } from './produto-canonico'
import { registrarReducaoDeComissao, atualizarAlertasDeComissao } from './alerta-reducao-comissao'

const ABERTOS = ['NOVO', 'APRESENTADO'] as const

export interface CamposVisiveis {
  preco: number | null
  comissaoPercentual: number | null
  comissaoValor: number | null
  vendas: number | null
  avaliacao: number | null
  estoque: number | null
}

export interface LinhaDoEnriquecimento {
  candidatoId: string
  nome: string
  provider: string | null
  situacao: string
  motivoCurto: string | null
  motivo: string | null
  antes: CamposVisiveis
  depois: CamposVisiveis
  alertas: string[]
}

export interface ResultadoDoEnriquecimento {
  consultados: number
  comDadoOficial: number
  semFonte: number
  naoIdentificados: number
  linhas: LinhaDoEnriquecimento[]
}

const visiveis = (c: CamposVisiveis): CamposVisiveis => ({
  preco: c.preco, comissaoPercentual: c.comissaoPercentual, comissaoValor: c.comissaoValor, vendas: c.vendas, avaliacao: c.avaliacao, estoque: c.estoque,
})

export async function enriquecerCandidatos(p: {
  workspaceId: string
  userId: string | null
  agora?: Date
  /** Só testes: leitores FIXTURE e estado da conexão. Produção usa LEITORES_ATIVOS. */
  leitores?: Partial<Record<FonteOficial, LeitorOficial>>
  env?: Record<string, string | undefined>
  cacheTikTok?: Map<string, Awaited<ReturnType<typeof estadoDaConexaoTikTokShop>>>
}): Promise<ResultadoDoEnriquecimento> {
  const agora = p.agora ?? new Date()
  const candidatos = await prisma.candidatoDeProduto.findMany({
    where: { workspaceId: p.workspaceId, status: { in: [...ABERTOS] }, AND: [CANDIDATO_NAO_EXCLUIDO] },
    orderBy: [{ posicao: 'asc' }, { baseDeEvidencia: 'desc' }],
    take: 100,
  })

  // 1) Identificar e agrupar por produto (o mesmo produto em dois candidatos = uma consulta).
  const cacheTikTok = p.cacheTikTok ?? new Map()
  const porChave = new Map<string, { link: string | null; id: ProdutoIdentificado; estado: EstadoDaFonteDeProduto; candidatos: typeof candidatos }>()
  const semChave: typeof candidatos = []
  for (const c of candidatos) {
    const id = identificarProduto(c.linkProduto)
    const chave = chaveDoDado(c.linkProduto, id)
    if (!chave) {
      semChave.push(c)
      continue
    }
    const g = porChave.get(chave)
    if (g) g.candidatos.push(c)
    else porChave.set(chave, { link: c.linkProduto, id, estado: await estadoDaFonte({ workspaceId: p.workspaceId, link: c.linkProduto, id }, { leitores: p.leitores, env: p.env, cacheTikTok }), candidatos: [c] })
  }

  // 2) Uma chamada por fonte oficial disponível, com todos os ids.
  const ofertas = new Map<string, OfertaBruta>()
  const erros = new Map<string, string>()
  const porFonte = new Map<FonteOficial, { leitor: LeitorOficial; chaves: string[] }>()
  for (const [chave, g] of porChave) {
    if (!g.estado.disponivel || !g.id.externalId) continue
    const f = porFonte.get(g.estado.fonte) ?? { leitor: g.estado.leitor, chaves: [] }
    f.chaves.push(chave)
    porFonte.set(g.estado.fonte, f)
  }
  for (const [fonte, f] of porFonte) {
    try {
      const ids = f.chaves.map((k) => porChave.get(k)!.id.externalId!)
      const r = await f.leitor(ids)
      for (const k of f.chaves) {
        const o = r.get(porChave.get(k)!.id.externalId!)
        if (o) ofertas.set(k, o)
      }
    } catch (e) {
      for (const k of f.chaves) erros.set(k, `Falha ao consultar ${fonte}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 3) Comparar com o último dado e montar a gravação (atômica).
  const anteriores = new Map(
    (await prisma.dadoOficialDeProduto.findMany({ where: { workspaceId: p.workspaceId, chave: { in: [...porChave.keys()] } } })).map((d) => [d.chave, d])
  )
  const linhas: LinhaDoEnriquecimento[] = []
  const historico: { chave: string; m: MudancaDeDado; fonte: string }[] = []
  const operacoes = []
  for (const [chave, g] of porChave) {
    const anterior = anteriores.get(chave) ?? null
    const oferta = ofertas.get(chave)
    const fonte = g.estado.fonte
    let normalizado: DadosNormalizados | null = null
    let situacao: string, motivoCurto: string | null, motivo: string | null
    if (oferta) {
      normalizado = normalizarOferta(oferta)
      situacao = 'OK'
      motivoCurto = null
      motivo = normalizado.avisos.length ? normalizado.avisos.join(' ') : null
      for (const m of mudancasDeDado(anterior, normalizado)) historico.push({ chave, m, fonte })
    } else if (erros.has(chave)) {
      situacao = 'ERRO'
      motivoCurto = 'A consulta oficial falhou agora; tento de novo na próxima atualização.'
      motivo = erros.get(chave)!
    } else if (g.estado.disponivel) {
      situacao = 'INDISPONIVEL'
      motivoCurto = 'A fonte oficial não devolveu este produto.'
      motivo = 'Consulta feita; o produto não veio na resposta oficial (pode estar fora do programa de afiliados).'
    } else {
      situacao = g.estado.situacao
      motivoCurto = g.estado.motivoCurto
      motivo = g.estado.motivo
    }
    const valores = normalizado
      ? {
          preco: normalizado.preco, precoAnterior: normalizado.precoAnterior, descontoPercentual: normalizado.descontoPercentual, moeda: normalizado.moeda,
          comissaoPercentual: normalizado.comissaoPercentual, comissaoValor: normalizado.comissaoValor, unidadeDaComissao: normalizado.unidadeDaComissao,
          vendas: normalizado.vendas, avaliacao: normalizado.avaliacao, numeroDeAvaliacoes: normalizado.numeroDeAvaliacoes, estoque: normalizado.estoque,
          disponivel: normalizado.disponivel, categoria: normalizado.categoria, imagem: normalizado.imagem, loja: normalizado.loja,
          menorPrecoObservado: normalizado.preco !== null ? Math.min(normalizado.preco, anterior?.menorPrecoObservado ?? normalizado.preco) : anterior?.menorPrecoObservado ?? null,
          atualizadoEm: agora,
        }
      : {}
    const base = { provider: g.id.provider, externalId: g.id.externalId, linkProduto: g.link, fonte, situacao, motivoCurto, motivo, consultadoEm: agora }
    operacoes.push(
      prisma.dadoOficialDeProduto.upsert({
        where: { workspaceId_chave: { workspaceId: p.workspaceId, chave } },
        create: { workspaceId: p.workspaceId, chave, ...base, ...valores },
        update: { ...base, ...valores },
      })
    )
    for (const c of g.candidatos) {
      const antes = visiveis(c)
      const depois = normalizado
        ? {
            preco: normalizado.preco ?? c.preco,
            comissaoPercentual: normalizado.comissaoPercentual ?? c.comissaoPercentual,
            comissaoValor: normalizado.comissaoValor ?? c.comissaoValor,
            vendas: normalizado.vendas ?? c.vendas,
            avaliacao: normalizado.avaliacao ?? c.avaliacao,
            estoque: normalizado.estoque ?? c.estoque,
          }
        : antes
      // TikTok Shop reconhecido no link (ex.: /pdp/) num informado sem provider: grava a identidade oficial.
      const identidade = g.id.provider === 'tiktok-shop' && !c.providerId && c.fonte === 'USER_PROVIDED' ? { providerId: 'tiktok-shop', externalId: g.id.externalId } : {}
      if (normalizado || Object.keys(identidade).length) {
        operacoes.push(
          prisma.candidatoDeProduto.update({
            where: { id: c.id },
            data: { ...identidade, ...(normalizado ? { ...depois, numeroDeAvaliacoes: normalizado.numeroDeAvaliacoes ?? c.numeroDeAvaliacoes } : {}) },
          })
        )
      }
      linhas.push({
        candidatoId: c.id, nome: c.nome, provider: g.id.provider, situacao, motivoCurto, motivo, antes, depois,
        alertas: historico.filter((h) => h.chave === chave).map((h) => alertaDaMudanca(h.m)).filter((x): x is string => !!x),
      })
    }
  }
  for (const c of semChave) {
    linhas.push({ candidatoId: c.id, nome: c.nome, provider: null, situacao: 'NAO_IDENTIFICADO', motivoCurto: 'Sem link do produto: não há onde consultar.', motivo: null, antes: visiveis(c), depois: visiveis(c), alertas: [] })
  }
  if (historico.length) {
    operacoes.push(
      prisma.historicoDadoDeProduto.createMany({
        data: historico.map((h) => ({ workspaceId: p.workspaceId, chave: h.chave, campo: h.m.campo, valorAnterior: h.m.anterior, valorNovo: h.m.novo, fonte: h.fonte, createdAt: agora })),
      })
    )
  }
  if (operacoes.length) await prisma.$transaction(operacoes)
  // P2.19 — comissão caiu na fonte: alerta da janela de 30 dias (regra oficial). Nunca derruba o enriquecimento.
  try {
    for (const h of historico) {
      if (h.m.campo !== 'comissaoPercentual' || h.m.anterior == null || h.m.novo == null) continue
      const antes = Number(h.m.anterior), depois = Number(h.m.novo)
      const c = porChave.get(h.chave)?.candidatos[0]
      if (!(depois < antes) || !c) continue
      await registrarReducaoDeComissao({ workspaceId: p.workspaceId, userId: p.userId ?? null, candidatoId: c.id, chaveProduto: h.chave, nomeProduto: c.nome, taxaAtual: antes, taxaNova: depois, dataDoAnuncio: agora, fonteDoAnuncio: 'OBSERVADA_PELO_PATRONO', agora })
    }
    await atualizarAlertasDeComissao(p.workspaceId, agora)
  } catch (e) {
    console.error('[alerta-reducao-comissao] falhou (o enriquecimento segue):', (e as Error).message)
  }

  const resultado: ResultadoDoEnriquecimento = {
    consultados: porChave.size,
    comDadoOficial: ofertas.size,
    semFonte: [...porChave.values()].filter((g) => !g.estado.disponivel && g.estado.situacao === 'INDISPONIVEL').length,
    naoIdentificados: [...porChave.values()].filter((g) => !g.estado.disponivel && g.estado.situacao === 'NAO_IDENTIFICADO').length + semChave.length,
    linhas,
  }
  await registrarAuditoria({
    workspaceId: p.workspaceId, userId: p.userId ?? undefined, action: 'curadoria.produtos_enriquecidos', entityType: 'DadoOficialDeProduto', entityId: p.workspaceId,
    metadata: { consultados: resultado.consultados, comDadoOficial: resultado.comDadoOficial, semFonte: resultado.semFonte, naoIdentificados: resultado.naoIdentificados, mudancas: historico.length },
  })
  return resultado
}

/** Dados oficiais + últimos alertas de mudança, por chave — para a tela e as visões. */
export async function dadosOficiaisPorChave(workspaceId: string, chaves: string[]) {
  if (!chaves.length) return new Map<string, { dado: Awaited<ReturnType<typeof prisma.dadoOficialDeProduto.findFirst>>; alertas: string[] }>()
  const [dados, historico] = await Promise.all([
    prisma.dadoOficialDeProduto.findMany({ where: { workspaceId, chave: { in: chaves } } }),
    prisma.historicoDadoDeProduto.findMany({ where: { workspaceId, chave: { in: chaves } }, orderBy: { createdAt: 'desc' }, take: 300 }),
  ])
  const out = new Map<string, { dado: (typeof dados)[number] | null; alertas: string[] }>()
  for (const d of dados) out.set(d.chave, { dado: d, alertas: [] })
  for (const h of historico) {
    const a = alertaDaMudanca({ campo: h.campo, anterior: h.valorAnterior, novo: h.valorNovo })
    const alvo = out.get(h.chave)
    if (a && alvo && alvo.alertas.length < 3 && !alvo.alertas.includes(a)) alvo.alertas.push(a)
  }
  return out
}
