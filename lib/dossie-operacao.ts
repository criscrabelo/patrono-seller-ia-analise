/**
 * Dossiê auditável da operação (P0.2 — Bloco 5).
 *
 * ── O QUE É ─────────────────────────────────────────────────────────────
 * Uma leitura única que responde, para UMA venda, tudo o que o P0.2
 * construiu: de qual produto veio, por qual conteúdo, se aquilo chegou a
 * circular, qual clique foi atribuído, quanto entrou de fato, com que
 * evidência a operação foi comprovada, e se o ML está aprendendo com ela.
 *
 * ── SOMENTE LEITURA, SEM EXCEÇÃO ────────────────────────────────────────
 * Não promove venda, não altera comissão, não atribui clique, não cria
 * snapshot, não preenche evidência e não conserta nada. Um relatório que
 * corrige o que observa deixa de ser relatório.
 *
 * ── LACUNA É RESPOSTA ───────────────────────────────────────────────────
 * Campo ausente aparece como `null` e vira LACUNA nomeada. Nunca é
 * preenchido com valor plausível: "clique: não atribuído" é informação
 * verdadeira; um clique inventado é uma causalidade falsa que depois
 * ninguém consegue desfazer.
 *
 * ── SEM SEGREDO ─────────────────────────────────────────────────────────
 * Do `AuditLog` só saem campos de uma lista explícita. O metadata bruto
 * NUNCA é devolvido: hoje não guardamos credencial nele, mas um dossiê que
 * despeja metadata inteiro passa a vazar no dia em que alguém guardar.
 */

import { prisma } from './prisma'
import {
  DESCRICAO_DA_ORIGEM,
  ehOperacaoReal,
  normalizarOrigemDeRegistro,
  type OrigemDeRegistro,
} from './proveniencia'
import {
  ACAO_AUDIT_EVIDENCIA,
  avaliarVendaParaOperacaoReal,
  type VereditoDeOperacaoReal,
} from './real-operation'
import { ACAO_AUDIT_PROMOCAO } from './promocao-operacao-real'
import { avaliarDistribuicaoReal } from './ml-captura-publicacao'
import { ENTIDADE_DA_AMOSTRA } from './ml-operacao-real'
import { FEATURE_VERSION } from './ml-feature-store'
import { ORIGENS_PRODUCAO } from './ml-readiness-gate'

// ── Lacunas ─────────────────────────────────────────────────────────────

export const CODIGOS_DE_LACUNA = [
  // Elos ausentes da cadeia — normais em muitos casos, nunca inventados.
  'SEM_CONTEUDO',
  'SEM_LINK',
  'CLIQUE_NAO_ATRIBUIDO',
  'SEM_DISTRIBUICAO_COMPROVADA',
  'SEM_VALOR_DA_VENDA',
  'SEM_COMISSAO',
  // Dinheiro reconhecido mas ainda não em caixa.
  'RECEITA_NAO_REALIZADA',
  // Proveniência.
  'ORIGEM_NAO_VERIFICADA',
  'ORIGEM_SINTETICA',
  'SEM_EVIDENCIA_REGISTRADA',
  // Aprendizado.
  'SEM_AMOSTRA_ML',
  'AMOSTRA_SEM_LABEL',
  'AMOSTRA_FORA_DO_READINESS',
  // INCONSISTÊNCIAS: não são ausências, são contradições nos dados.
  'PRODUTO_DE_OUTRO_WORKSPACE',
  'CONTEUDO_DE_OUTRO_WORKSPACE',
  'LINK_DE_OUTRO_WORKSPACE',
  'LINK_DE_OUTRO_PRODUTO',
  'CLIQUE_DE_OUTRO_LINK',
  'COMISSAO_DE_OUTRA_VENDA',
] as const

export type CodigoDeLacuna = (typeof CODIGOS_DE_LACUNA)[number]

export interface Lacuna {
  codigo: CodigoDeLacuna
  /** `INCONSISTENCIA` exige ação; `AUSENCIA` costuma ser estado normal. */
  gravidade: 'AUSENCIA' | 'INCONSISTENCIA'
  explicacao: string
}

// ── Formato do dossiê ───────────────────────────────────────────────────

export interface DossieDaOperacao {
  workspaceId: string
  saleId: string
  geradoEm: string

  provider: {
    /** Plataforma do programa de afiliado, quando a venda aponta para um. */
    plataforma: string | null
    /** Provider de origem do PRODUTO (catálogo), quando importado. */
    providerDoProduto: string | null
    origemDoRegistroDoProduto: string | null
  }
  produto: { id: string; nome: string; categoria: string; preco: number | null } | null
  conteudo: { id: string; redeSocial: string | null; status: string; dataPublicacao: string | null } | null
  distribuicao: {
    comprovada: boolean
    publicacaoExternaId: string | null
    distribuidoEm: string | null
    explicacao: string
  }
  link: { id: string; slug: string; plataforma: string; ativo: boolean } | null
  clique: {
    atribuido: boolean
    clickEventId: string | null
    attributionMethod: string | null
    ocorridoEm: string | null
  }
  venda: {
    id: string
    status: string
    data: string
    valorBruto: number | null
    source: string
    dataOrigin: OrigemDeRegistro
  }
  comissoes: Array<{
    id: string
    status: string
    expectedAmount: number | null
    confirmedAmount: number | null
    receivedAmount: number | null
    expectedAt: string | null
    confirmedAt: string | null
    receivedAt: string | null
    pertenceAEstaVenda: boolean
  }>
  /** Os cinco números NUNCA se misturam. Ver `montarReceita`. */
  receita: {
    valorBrutoDaVenda: number | null
    comissaoEsperada: number
    comissaoConfirmada: number
    comissaoRecebida: number
    /** Dinheiro EFETIVO. Igual a `comissaoRecebida`, jamais à esperada. */
    receitaRealizada: number
  }
  proveniencia: {
    dataOrigin: OrigemDeRegistro
    descricao: string
    ehOperacaoReal: boolean
  }
  evidencias: Array<{
    tipo: string | null
    referencia: string | null
    verificadorId: string | null
    responsavelUserId: string | null
    motivo: string | null
    registradaEm: string
    workspaceIdVerificado: string | null
    saleIdVerificado: string | null
    commissionIdVerificado: string | null
  }>
  promocoes: Array<{
    estadoAnterior: string | null
    estadoNovo: string | null
    tipoEvidencia: string | null
    responsavelUserId: string | null
    verificadorId: string | null
    promovidaEm: string
  }>
  veredito: VereditoDeOperacaoReal | null
  amostraML: {
    snapshotId: string
    entityType: string
    entityId: string | null
    featureVersion: string
    dataOrigin: string
    capturedAt: string
    labeledAt: string | null
    label: unknown
    contadaPeloReadiness: boolean
  } | null
  /** Resumo do AuditLog. Sem `metadata` bruto — ver cabeçalho. */
  auditoria: Array<{ action: string; entityType: string; entityId: string; userId: string | null; em: string }>
  lacunas: Lacuna[]
}

// ── Peças puras ─────────────────────────────────────────────────────────

function numero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

const iso = (d: Date | null | undefined): string | null =>
  d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : null

/**
 * Os cinco números da receita, separados.
 *
 * `expectedAmount` é previsão e NUNCA entra em `receitaRealizada`. Confirmada
 * só conta em CONFIRMED/RECEIVED; recebida só em RECEIVED — o status manda,
 * não o campo solto.
 */
export function montarReceita(
  valorBrutoDaVenda: number | null,
  comissoes: Array<{ status: string; expectedAmount: number | null; confirmedAmount: number | null; receivedAmount: number | null; pertenceAEstaVenda: boolean }>
): DossieDaOperacao['receita'] {
  let comissaoEsperada = 0
  let comissaoConfirmada = 0
  let comissaoRecebida = 0
  for (const c of comissoes ?? []) {
    if (!c?.pertenceAEstaVenda) continue
    comissaoEsperada += numero(c.expectedAmount)
    if (c.status === 'CONFIRMED' || c.status === 'RECEIVED') comissaoConfirmada += numero(c.confirmedAmount)
    if (c.status === 'RECEIVED') comissaoRecebida += numero(c.receivedAmount)
  }
  return {
    valorBrutoDaVenda: typeof valorBrutoDaVenda === 'number' && Number.isFinite(valorBrutoDaVenda) ? valorBrutoDaVenda : null,
    comissaoEsperada,
    comissaoConfirmada,
    comissaoRecebida,
    receitaRealizada: comissaoRecebida,
  }
}

/**
 * FUNÇÃO PURA. Lê o dossiê montado e nomeia o que falta ou não fecha.
 *
 * Separada de propósito: é a parte que pode dizer "aqui há um problema", e
 * isso precisa ser testável com os dados exatos de cada cenário.
 */
export function detectarLacunas(
  d: Omit<DossieDaOperacao, 'lacunas'> & {
    _relacoes?: {
      produtoWorkspaceId?: string | null
      conteudoWorkspaceId?: string | null
      linkWorkspaceId?: string | null
      linkProdutoId?: string | null
      cliqueLinkId?: string | null
    }
  }
): Lacuna[] {
  const lacunas: Lacuna[] = []
  const add = (codigo: CodigoDeLacuna, gravidade: Lacuna['gravidade'], explicacao: string) =>
    lacunas.push({ codigo, gravidade, explicacao })

  // ── Elos ausentes ────────────────────────────────────────────────────
  if (!d.conteudo) {
    add('SEM_CONTEUDO', 'AUSENCIA', 'A venda não aponta para nenhum conteúdo — não há criativo a que atribuir aprendizado.')
  } else if (!d.distribuicao.comprovada) {
    add('SEM_DISTRIBUICAO_COMPROVADA', 'AUSENCIA', d.distribuicao.explicacao)
  }
  if (!d.link) {
    add('SEM_LINK', 'AUSENCIA', 'A venda não aponta para nenhum link dinâmico.')
  }
  if (!d.clique.atribuido) {
    add(
      'CLIQUE_NAO_ATRIBUIDO',
      'AUSENCIA',
      `Nenhum clique foi atribuído a esta venda (método: ${d.clique.attributionMethod ?? 'não registrado'}). A cadeia é lida sem esse elo — nenhuma causalidade é presumida.`
    )
  }
  if (d.receita.valorBrutoDaVenda === null) {
    add('SEM_VALOR_DA_VENDA', 'AUSENCIA', 'A venda foi registrada sem valor bruto.')
  }
  const desta = d.comissoes.filter((c) => c.pertenceAEstaVenda)
  if (desta.length === 0) {
    add('SEM_COMISSAO', 'AUSENCIA', 'Nenhuma comissão está ligada a esta venda.')
  } else if (d.receita.comissaoRecebida === 0 && d.receita.comissaoConfirmada > 0) {
    add(
      'RECEITA_NAO_REALIZADA',
      'AUSENCIA',
      `Há R$ ${d.receita.comissaoConfirmada.toFixed(2)} de comissão confirmada, mas nada recebido ainda. Confirmada não é caixa.`
    )
  }

  // ── Proveniência ─────────────────────────────────────────────────────
  if (d.proveniencia.dataOrigin === 'UNVERIFIED') {
    add('ORIGEM_NAO_VERIFICADA', 'AUSENCIA', 'A origem deste registro nunca foi estabelecida.')
  }
  if (['SEED', 'TEST_FIXTURE', 'DEMO', 'SYNTHETIC_TEST'].includes(d.proveniencia.dataOrigin)) {
    add('ORIGEM_SINTETICA', 'AUSENCIA', `Dado ${d.proveniencia.dataOrigin}: existe para validar o sistema, nunca para ensiná-lo.`)
  }
  if (d.evidencias.length === 0) {
    add('SEM_EVIDENCIA_REGISTRADA', 'AUSENCIA', 'Nenhuma evidência de operação real foi registrada para esta venda.')
  }

  // ── Aprendizado ──────────────────────────────────────────────────────
  if (!d.amostraML) {
    add('SEM_AMOSTRA_ML', 'AUSENCIA', 'Não há amostra de ML para o conteúdo desta venda.')
  } else {
    if (!d.amostraML.labeledAt) {
      add('AMOSTRA_SEM_LABEL', 'AUSENCIA', 'A amostra foi capturada mas ainda não tem rótulo — o resultado ainda não está resolvido.')
    }
    if (!d.amostraML.contadaPeloReadiness) {
      add(
        'AMOSTRA_FORA_DO_READINESS',
        'AUSENCIA',
        `A amostra existe (origem ${d.amostraML.dataOrigin}) mas não conta para a prontidão de produção.`
      )
    }
  }

  // ── Contradições ─────────────────────────────────────────────────────
  const r = d._relacoes ?? {}
  if (r.produtoWorkspaceId && r.produtoWorkspaceId !== d.workspaceId) {
    add('PRODUTO_DE_OUTRO_WORKSPACE', 'INCONSISTENCIA', 'O produto desta venda pertence a outro workspace.')
  }
  if (r.conteudoWorkspaceId && r.conteudoWorkspaceId !== d.workspaceId) {
    add('CONTEUDO_DE_OUTRO_WORKSPACE', 'INCONSISTENCIA', 'O conteúdo desta venda pertence a outro workspace.')
  }
  if (r.linkWorkspaceId && r.linkWorkspaceId !== d.workspaceId) {
    add('LINK_DE_OUTRO_WORKSPACE', 'INCONSISTENCIA', 'O link desta venda pertence a outro workspace.')
  }
  if (r.linkProdutoId && d.produto && r.linkProdutoId !== d.produto.id) {
    add('LINK_DE_OUTRO_PRODUTO', 'INCONSISTENCIA', 'O link desta venda aponta para outro produto.')
  }
  if (r.cliqueLinkId && d.link && r.cliqueLinkId !== d.link.id) {
    add('CLIQUE_DE_OUTRO_LINK', 'INCONSISTENCIA', 'O clique atribuído pertence a outro link.')
  }
  if (d.comissoes.some((c) => !c.pertenceAEstaVenda)) {
    add('COMISSAO_DE_OUTRA_VENDA', 'INCONSISTENCIA', 'Há comissão listada que não aponta para esta venda.')
  }

  return lacunas
}

// ── Montagem ────────────────────────────────────────────────────────────

/** Campos do metadata de evidência que o dossiê pode expor. Lista fechada. */
const CAMPOS_DE_EVIDENCIA = [
  'tipo',
  'referencia',
  'verificadorId',
  'responsavelUserId',
  'motivo',
  'workspaceIdVerificado',
  'saleIdVerificado',
  'commissionIdVerificado',
] as const

function texto(meta: Record<string, unknown> | null, chave: string): string | null {
  const v = meta?.[chave]
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/**
 * Monta o dossiê de UMA venda.
 *
 * `null` quando a venda não existe NESTE workspace — nunca busca por id
 * solto. Venda de outro negócio tem de parecer inexistente, não "existe mas
 * você não pode ver": a segunda resposta já confirma que ela existe.
 */
export async function obterDossieDaOperacao(
  workspaceId: string,
  saleId: string
): Promise<DossieDaOperacao | null> {
  if (!workspaceId?.trim() || !saleId?.trim()) return null

  const venda = await prisma.sale.findFirst({
    where: { id: saleId, workspaceId },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      date: true,
      amount: true,
      source: true,
      dataOrigin: true,
      clickEventId: true,
      attributionMethod: true,
      product: { select: { id: true, nome: true, categoria: true, preco: true, workspaceId: true, providerId: true, origemDados: true } },
      content: { select: { id: true, workspaceId: true, redeSocial: true, status: true, dataPublicacao: true, publicacaoExternaId: true } },
      link: { select: { id: true, workspaceId: true, slug: true, plataforma: true, ativo: true, produtoId: true } },
      affiliateProgram: { select: { platform: true } },
      clickEvent: { select: { id: true, linkId: true, createdAt: true } },
      commissions: {
        select: {
          id: true,
          saleId: true,
          status: true,
          expectedAmount: true,
          confirmedAmount: true,
          receivedAmount: true,
          expectedAt: true,
          confirmedAt: true,
          receivedAt: true,
        },
      },
    },
  })
  if (!venda) return null

  // Auditoria desta venda — e só dela, e só deste workspace.
  const logs = await prisma.auditLog.findMany({
    where: { workspaceId, entityType: 'Sale', entityId: saleId },
    select: { action: true, entityType: true, entityId: true, userId: true, createdAt: true, metadata: true },
    orderBy: { createdAt: 'asc' },
  })
  const idsDeComissao = venda.commissions.map((c) => c.id)
  const logsDeComissao = idsDeComissao.length
    ? await prisma.auditLog.findMany({
        where: { workspaceId, entityType: 'Commission', entityId: { in: idsDeComissao } },
        select: { action: true, entityType: true, entityId: true, userId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    : []

  const distribuicao = avaliarDistribuicaoReal(venda.content ?? {})

  const amostra = venda.content
    ? await prisma.mLFeatureSnapshot.findFirst({
        where: {
          workspaceId,
          entityType: ENTIDADE_DA_AMOSTRA,
          entityId: venda.content.id,
          featureVersion: FEATURE_VERSION,
        },
        select: {
          id: true,
          entityType: true,
          entityId: true,
          featureVersion: true,
          dataOrigin: true,
          capturedAt: true,
          labeledAt: true,
          label: true,
        },
      })
    : null

  const veredito = await avaliarVendaParaOperacaoReal(workspaceId, saleId)

  const comissoes = venda.commissions.map((c) => ({
    id: c.id,
    status: c.status,
    expectedAmount: c.expectedAmount,
    confirmedAmount: c.confirmedAmount,
    receivedAmount: c.receivedAmount,
    expectedAt: iso(c.expectedAt),
    confirmedAt: iso(c.confirmedAt),
    receivedAt: iso(c.receivedAt),
    pertenceAEstaVenda: c.saleId === venda.id,
  }))

  const origem = normalizarOrigemDeRegistro(venda.dataOrigin)

  const evidencias = logs
    .filter((l) => l.action === ACAO_AUDIT_EVIDENCIA)
    .map((l) => {
      const m = (l.metadata ?? null) as Record<string, unknown> | null
      const campos = Object.fromEntries(CAMPOS_DE_EVIDENCIA.map((k) => [k, texto(m, k)]))
      return { ...(campos as Record<(typeof CAMPOS_DE_EVIDENCIA)[number], string | null>), registradaEm: l.createdAt.toISOString() }
    })

  const promocoes = logs
    .filter((l) => l.action === ACAO_AUDIT_PROMOCAO)
    .map((l) => {
      const m = (l.metadata ?? null) as Record<string, unknown> | null
      return {
        estadoAnterior: texto(m, 'estadoAnterior'),
        estadoNovo: texto(m, 'estadoNovo'),
        tipoEvidencia: texto(m, 'tipoEvidencia'),
        responsavelUserId: texto(m, 'responsavelUserId'),
        verificadorId: texto(m, 'verificadorId'),
        promovidaEm: l.createdAt.toISOString(),
      }
    })

  const parcial: Omit<DossieDaOperacao, 'lacunas'> & { _relacoes: Record<string, string | null | undefined> } = {
    workspaceId,
    saleId: venda.id,
    geradoEm: new Date().toISOString(),

    provider: {
      plataforma: venda.affiliateProgram?.platform ?? null,
      providerDoProduto: venda.product?.providerId ?? null,
      origemDoRegistroDoProduto: venda.product?.origemDados ?? null,
    },
    produto: venda.product
      ? { id: venda.product.id, nome: venda.product.nome, categoria: venda.product.categoria, preco: venda.product.preco }
      : null,
    conteudo: venda.content
      ? {
          id: venda.content.id,
          redeSocial: venda.content.redeSocial,
          status: venda.content.status,
          dataPublicacao: iso(venda.content.dataPublicacao),
        }
      : null,
    distribuicao: {
      comprovada: distribuicao.distribuida,
      publicacaoExternaId: distribuicao.identificadorExterno,
      distribuidoEm: iso(distribuicao.distribuidoEm),
      explicacao: distribuicao.explicacao,
    },
    link: venda.link
      ? { id: venda.link.id, slug: venda.link.slug, plataforma: venda.link.plataforma, ativo: venda.link.ativo }
      : null,
    clique: {
      atribuido: !!venda.clickEvent,
      clickEventId: venda.clickEventId,
      attributionMethod: venda.attributionMethod,
      ocorridoEm: iso(venda.clickEvent?.createdAt),
    },
    venda: {
      id: venda.id,
      status: venda.status,
      data: venda.date.toISOString(),
      valorBruto: venda.amount,
      source: venda.source,
      dataOrigin: origem,
    },
    comissoes,
    receita: montarReceita(venda.amount, comissoes),
    proveniencia: {
      dataOrigin: origem,
      descricao: DESCRICAO_DA_ORIGEM[origem],
      ehOperacaoReal: ehOperacaoReal(origem),
    },
    evidencias,
    promocoes,
    veredito,
    amostraML: amostra
      ? {
          snapshotId: amostra.id,
          entityType: amostra.entityType,
          entityId: amostra.entityId,
          featureVersion: amostra.featureVersion,
          dataOrigin: amostra.dataOrigin,
          capturedAt: amostra.capturedAt.toISOString(),
          labeledAt: iso(amostra.labeledAt),
          label: amostra.label,
          // Mesma regra do `contarAmostrasRotuladas`: rotulada E de produção.
          contadaPeloReadiness:
            !!amostra.labeledAt && (ORIGENS_PRODUCAO as readonly string[]).includes(amostra.dataOrigin),
        }
      : null,
    auditoria: [...logs, ...logsDeComissao]
      .map((l) => ({
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        userId: l.userId,
        em: l.createdAt.toISOString(),
      }))
      .sort((a, b) => a.em.localeCompare(b.em)),

    _relacoes: {
      produtoWorkspaceId: venda.product?.workspaceId,
      conteudoWorkspaceId: venda.content?.workspaceId,
      linkWorkspaceId: venda.link?.workspaceId,
      linkProdutoId: venda.link?.produtoId,
      cliqueLinkId: venda.clickEvent?.linkId,
    },
  }

  const lacunas = detectarLacunas(parcial as never)
  const { _relacoes, ...dossie } = parcial
  void _relacoes
  return { ...dossie, lacunas }
}

/**
 * Cadeia de causalidade em texto, para relatório e tela.
 *
 * Elo inexistente aparece como lacuna nomeada — nunca é pulado nem
 * preenchido, porque a cadeia sem buracos é justamente a mentira que este
 * módulo existe para evitar.
 */
export function descreverCadeia(d: DossieDaOperacao): string[] {
  return [
    `produto: ${d.produto ? d.produto.nome : '— ausente'}`,
    `conteúdo: ${d.conteudo ? d.conteudo.id : '— ausente'}`,
    `distribuição: ${d.distribuicao.comprovada ? `confirmada (${d.distribuicao.publicacaoExternaId})` : '— não comprovada'}`,
    `link: ${d.link ? d.link.slug : '— ausente'}`,
    `clique: ${d.clique.atribuido ? d.clique.clickEventId : 'não atribuído'}`,
    `venda: ${d.venda.id} (${d.venda.status})`,
    `comissão: ${d.comissoes.filter((c) => c.pertenceAEstaVenda).map((c) => c.status).join(', ') || '— ausente'}`,
    `receita realizada: R$ ${d.receita.receitaRealizada.toFixed(2)}`,
    `aprendizado: ${d.amostraML ? (d.amostraML.contadaPeloReadiness ? 'amostra contando no readiness' : 'amostra fora do readiness') : '— sem amostra'}`,
  ]
}
