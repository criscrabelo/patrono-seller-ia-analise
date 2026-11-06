/**
 * P2.17.3 — Painel "TikTok Shop — Metas e Recompensas": monta a visão
 * (missões analisadas + produtos recomendados + consultoria + vídeos) e lê a
 * entrada do formulário. Só leitura do banco, exceto criar/atualizar missão.
 */
import { ehProdutoTikTokShop } from './tiktok-shop-link'
import { z } from 'zod'
import { NextResponse } from 'next/server'
import { prisma } from './prisma'
import { analisarMetas, ErroDeMeta, listarMetasAtivas, missoesQueOVideoAjuda, priorizarProdutosTikTok, recompensaEmJogo, TIPOS_DE_META, type DadosDaMeta } from './metas-tiktok'
import { consultar } from './consultor-afiliados'
import { planejarVideos } from './motor-de-videos-tiktok'
import { avaliarVideo } from './quality-gate-video-tiktok'
import { campanhaDoCandidato } from './curadoria-http'
import { estadoDaSincronizacao } from './sincronizacao-metas-tiktok'
import { VERIFICACAO_DAS_FONTES } from './fonte-missoes-tiktok'
import { CANDIDATO_NAO_EXCLUIDO } from './produto-canonico'

const esquemaDaMeta = z.object({
  nome: z.string().trim().min(1).max(200),
  tipo: z.enum(TIPOS_DE_META),
  inicio: z.coerce.date(),
  fim: z.coerce.date(),
  recompensaValor: z.number().finite().nonnegative().max(1_000_000).nullable().optional(),
  recompensaDescricao: z.string().trim().max(300).nullable().optional(),
  quantidadeExigida: z.number().int().min(1).max(100_000),
  quantidadeRealizada: z.number().int().min(0).max(100_000).optional(),
  requisitos: z.string().trim().max(1000).nullable().optional(),
  campanha: z.string().trim().max(200).nullable().optional(),
  recompensaCampanha: z.number().finite().nonnegative().max(1_000_000).nullable().optional(),
})

const MENSAGEM_DO_CAMPO: Record<string, string> = {
  nome: 'Dê um nome à missão.',
  tipo: 'Escolha o tipo da missão.',
  inicio: 'Data de início inválida.',
  fim: 'Data de fim inválida.',
  recompensaValor: 'Recompensa inválida: use só números, por exemplo 50.',
  quantidadeExigida: 'Quantidade exigida inválida (número inteiro maior que zero).',
  quantidadeRealizada: 'Quantidade realizada inválida.',
}

export function lerMeta(corpo: unknown): { ok: true; dados: DadosDaMeta } | { ok: false; mensagem: string } {
  const r = esquemaDaMeta.safeParse(corpo)
  if (!r.success) {
    const campo = String(r.error.issues[0]?.path[0] ?? '')
    return { ok: false, mensagem: MENSAGEM_DO_CAMPO[campo] ?? 'Dados da missão inválidos.' }
  }
  const d = r.data
  return {
    ok: true,
    dados: {
      nome: d.nome,
      tipo: d.tipo,
      inicio: d.inicio,
      fim: d.fim,
      recompensaValor: d.recompensaValor ?? null,
      recompensaDescricao: d.recompensaDescricao || null,
      quantidadeExigida: d.quantidadeExigida,
      quantidadeRealizada: d.quantidadeRealizada ?? 0,
      requisitos: d.requisitos || null,
      campanha: d.campanha || null,
      recompensaCampanha: d.recompensaCampanha ?? null,
    },
  }
}

export function respostaDeErroDeMeta(e: unknown) {
  if (e instanceof ErroDeMeta) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error('Erro nas metas do TikTok:', e)
  return NextResponse.json({ error: 'Erro do nosso lado ao processar a missão. Tente de novo em instantes.' }, { status: 500 })
}

/** A visão do painel. */
export async function painelDeMetas(workspaceId: string, agora: Date = new Date()) {
  const [metas, candidatos] = await Promise.all([
    listarMetasAtivas(workspaceId),
    prisma.candidatoDeProduto.findMany({
      where: { workspaceId, status: { in: ['NOVO', 'APRESENTADO'] }, complianceBloqueante: false, validoAte: { gte: agora }, AND: [CANDIDATO_NAO_EXCLUIDO] },
      orderBy: [{ baseDeEvidencia: 'desc' }, { score: 'desc' }],
      take: 30,
    }),
  ])
  const analises = analisarMetas(metas, agora)
  const priorizados = priorizarProdutosTikTok(
    candidatos.map((c) => ({
      id: c.id,
      nome: c.nome,
      categoria: c.categoria,
      preco: c.preco,
      providerId: c.providerId,
      linkProduto: c.linkProduto,
      baseDeEvidencia: c.baseDeEvidencia,
      vendas: c.vendas,
      comissaoValor: c.comissaoValor,
      comissaoPercentual: c.comissaoPercentual,
      aderenciaNatal: campanhaDoCandidato(c, agora)?.aderencia ?? null,
    })),
    analises
  ).slice(0, 5)
  const porId = new Map(candidatos.map((c) => [c.id, c]))
  const produtos = priorizados.map((p, i) => {
    const c = porId.get(p.id)!
    const tiktokShop = ehProdutoTikTokShop(c.providerId, c.linkProduto)
    const consultoria = consultar(
      {
        nome: c.nome,
        categoria: c.categoria,
        preco: c.preco,
        providerId: c.providerId,
        linkProduto: c.linkProduto,
        comissaoPercentual: c.comissaoPercentual,
        comissaoValor: c.comissaoValor,
        vendas: c.vendas,
        baseDeEvidencia: c.baseDeEvidencia,
        confianca: c.confianca,
        nivelDeRisco: c.nivelDeRisco,
        riscos: c.riscos,
        complianceBloqueante: c.complianceBloqueante,
        publicacaoImpedida: c.publicacaoImpedida,
        campanha: campanhaDoCandidato(c, agora),
      },
      agora,
      analises
    )
    // Produtos prioritários (top 3): pacote completo de vídeos.
    const plano = i < 3 ? planejarVideos({ nome: c.nome, categoria: c.categoria, preco: c.preco, vendas: c.vendas, tiktokShop, temImagem: !!c.imagem }, agora) : null
    const missoes = missoesQueOVideoAjuda(analises, { tiktokShop })
    const videos = plano
      ? {
          potencial: plano.potencial,
          teste: plano.testeInicial,
          missoes: missoes,
          ganchos: plano.variantes
            .filter((v) => plano.testeInicial.variantes.includes(v.id))
            .map((v, k) => ({
              letra: String.fromCharCode(65 + k),
              estrutura: v.estrutura,
              gancho: v.gancho,
              exigeExperienciaReal: v.exigeExperienciaReal,
              // P2.17.4: ajudar a missão vira o objetivo principal (receita certa da recompensa).
              objetivo: missoes.length > 0 && tiktokShop ? 'MISSAO' : v.objetivo,
              produtoMarcado: v.produtoMarcado,
              curta: v.versaoCurta,
              media: v.versaoMedia,
              ctaA: v.cta,
              ctaB: v.ctaB,
              legendaA: v.legenda,
              legendaB: v.legendaB,
              disclosure: v.disclosure,
              hashtags: v.hashtags,
              qualidade: avaliarVideo(v, { tiktokShop, temVendasReais: typeof c.vendas === 'number' && c.vendas > 0 }),
            })),
        }
      : null
    const comissaoPorVenda = c.comissaoValor !== null ? c.comissaoValor : null
    return { id: p.id, nome: p.nome, posicao: i + 1, ajudaMissao: p.ajudaMissao, tiktokShop, facilidade: p.facilidade, porque: p.porque, consultoria, comissaoPorVenda, videos }
  })
  const abertas = analises.filter((a) => a.situacao === 'EM_ANDAMENTO' || a.situacao === 'NAO_INICIADA')
  const recompensa = recompensaEmJogo(metas, analises)
  // Um vídeo com produto marcado também pode contar como "qualificado": não soma em dobro.
  const videosHoje = Math.max(0, ...analises.filter((a) => a.situacao === 'EM_ANDAMENTO' && a.usaProdutoNoVideo).map((a) => a.hojeRecomendado))
  const maisApertada = [...abertas].sort((a, b) => b.pressao - a.pressao || a.diasRestantes - b.diasRestantes)[0] ?? null
  const campanhas = [...new Set(metas.map((m) => m.campanha).filter((x): x is string => !!x))].map((nome) => {
    const doGrupo = metas.filter((m) => m.campanha === nome)
    return { nome, recompensaTotal: doGrupo.find((m) => m.recompensaCampanha)?.recompensaCampanha ?? null, metas: doGrupo.length, faltamTotal: analises.filter((a) => a.campanha === nome).reduce((s, a) => s + a.faltam, 0) }
  })
  // Metas que só contam com produto do TikTok Shop (marcado no vídeo, na vitrine
  // ou com amostra). Sem nenhum candidato de lá, o painel diz isso com todas as letras.
  const TIPOS_QUE_EXIGEM_TIKTOK_SHOP = new Set(['VIDEOS_COM_PRODUTO', 'ADICIONAR_PRODUTOS', 'SOLICITAR_AMOSTRAS'])
  const temProdutoTikTokShop = produtos.some((p) => p.tiktokShop)
  const exigemTikTokShop = abertas.filter((a) => TIPOS_QUE_EXIGEM_TIKTOK_SHOP.has(a.tipo))
  const alerta =
    exigemTikTokShop.length > 0 && !temProdutoTikTokShop
      ? `Atenção: nenhum produto recomendado agora é do TikTok Shop. As metas ${exigemTikTokShop.map((a) => `"${a.nome}"`).join(', ')} só contam com produtos do TikTok Shop (marcados no vídeo, na vitrine ou com amostra). Informe produtos da sua vitrine em Oportunidades → Informar produto (link com /product/…) para eu recomendar os certos.`
      : null
  const primeiro = produtos[0]
  const reaisFmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const receita =
    abertas.length === 0
      ? null
      : `Receita potencial = recompensa em jogo (${reaisFmt(recompensa)}${campanhas.length ? `, contada uma vez por campanha` : ''}) + comissão por venda dos produtos${
          primeiro?.comissaoPorVenda != null ? ` (1º recomendado: ${reaisFmt(primeiro.comissaoPorVenda)} por venda)` : ' (comissão dos recomendados ainda não informada)'
        }. Não projeto quantas vendas os vídeos vão gerar: isso só com dado real.`
  // P2.17.5: por que o 1º produto foi priorizado (missão + comissão), em uma frase.
  const top = priorizados[0]
  const prioridade = top
    ? top.ajudaMissao && primeiro?.comissaoPorVenda != null
      ? `Priorizei "${top.nome}" porque ajuda na missão e na comissão ao mesmo tempo (${reaisFmt(primeiro.comissaoPorVenda)} por venda).`
      : top.ajudaMissao
        ? `Priorizei "${top.nome}" porque ajuda na missão (comissão ainda não informada).`
        : null
    : null
  const sync = await estadoDaSincronizacao(workspaceId)
  const sincronizacao = {
    principal: 'automatica' as const,
    fonteDisponivel: false,
    verificadoEm: VERIFICACAO_DAS_FONTES.data,
    ultima: sync.ultima
      ? { em: sync.ultima.iniciadaEm.toISOString(), fonte: sync.ultima.fonte, status: sync.ultima.status, mensagem: sync.ultima.mensagem, gatilho: sync.ultima.gatilho }
      : null,
    ultimaComDados: sync.ultimaComDados
      ? {
          em: sync.ultimaComDados.iniciadaEm.toISOString(),
          fonte: sync.ultimaComDados.fonte,
          criadas: sync.ultimaComDados.criadas,
          atualizadas: sync.ultimaComDados.atualizadas,
          encerradas: sync.ultimaComDados.encerradas,
          reacao: Array.isArray(sync.ultimaComDados.reacao) ? (sync.ultimaComDados.reacao as string[]) : [],
        }
      : null,
    alteracoes: sync.alteracoes.map((h) => ({ em: h.createdAt.toISOString(), metaId: h.metaId, meta: h.nomeDaMeta, campo: h.campo, anterior: h.valorAnterior, novo: h.valorNovo, origem: h.origem })),
  }
  return {
    sincronizacao,
    metas: analises.map((a) => {
      const m = metas.find((x) => x.id === a.id)!
      const precisaDeTikTokShop = alerta !== null && TIPOS_QUE_EXIGEM_TIKTOK_SHOP.has(a.tipo) && (a.situacao === 'EM_ANDAMENTO' || a.situacao === 'NAO_INICIADA')
      return {
        ...a,
        proximaAcao: precisaDeTikTokShop
          ? `${a.proximaAcao.replace(/ dos (produtos )?recomendados| com os produtos recomendados/, '')} — com produtos do TikTok Shop (hoje nenhum recomendado é de lá; busque na Central de afiliados do app).`
          : a.proximaAcao,
        inicio: m.inicio.toISOString(),
        fim: m.fim.toISOString(),
        quantidadeExigida: m.quantidadeExigida,
        quantidadeRealizada: m.quantidadeRealizada,
        requisitos: m.requisitos,
        recompensaValor: m.recompensaValor,
        recompensaCampanha: m.recompensaCampanha,
      }
    }),
    campanhas,
    produtos,
    resumo: {
      recompensaEmJogo: recompensa,
      videosHoje,
      emRisco: analises.filter((a) => a.risco === 'ALTO').length,
      maisApertada: maisApertada
        ? { id: maisApertada.id, nome: maisApertada.nome, frase: `A meta mais apertada é "${maisApertada.nome}": ${maisApertada.faltam} faltando em ${maisApertada.diasRestantes} dia(s) (risco ${maisApertada.risco.toLowerCase()}).` }
        : null,
      receita,
      alerta,
      prioridade,
      frase:
        analises.length === 0
          ? 'Nenhuma missão registrada. Cadastre as missões que aparecem na sua conta do TikTok Shop para eu acompanhar prazo e recompensa.'
          : videosHoje > 0
            ? alerta
              ? `Hoje recomendo ${videosHoje} vídeo(s). Para contarem nas metas de produto, eles precisam de um produto do TikTok Shop marcado (veja o aviso abaixo).`
              : abertas.filter((a) => a.usaProdutoNoVideo).length > 1
                ? `Hoje recomendo ${videosHoje} vídeo(s) com produto do TikTok Shop marcado — eles podem contar para mais de uma meta ao mesmo tempo.`
                : `Hoje recomendo ${videosHoje} vídeo(s) com produto do TikTok Shop marcado.`
            : 'Nenhum vídeo obrigatório hoje para as missões ativas.',
    },
  }
}
