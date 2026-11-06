/**
 * Elegibilidade para `REAL_OPERATION` (P0.2 — Bloco 3).
 *
 * ── AUTORIDADE ÚNICA ────────────────────────────────────────────────────
 * Esta é a ÚNICA função do sistema que pode dizer se uma venda vale como
 * operação real. Nenhum outro módulo — ML, autopilot, relatório, tela —
 * pode ter a sua própria versão da regra: duas respostas diferentes para a
 * mesma venda seria o mesmo que não ter regra.
 *
 * ── FAIL-CLOSED ─────────────────────────────────────────────────────────
 * TODAS as condições obrigatórias precisam ser verdadeiras. Qualquer
 * dúvida, campo ausente, valor ilegível ou relação incoerente resulta em
 * NÃO ELEGÍVEL. O default da função não é "provavelmente sim".
 *
 * ── SEM INFERÊNCIA ──────────────────────────────────────────────────────
 * Não há score, probabilidade, heurística, "quase lá" ou modelo aqui. É uma
 * conjunção de fatos verificáveis. Um modelo de ML jamais pode promover a
 * venda que depois vai treiná-lo — isso seria o sistema se auto-autorizando
 * a aprender com o que ele mesmo inventou.
 *
 * ── DECLARAÇÃO DA USUÁRIA ≠ EVIDÊNCIA ───────────────────────────────────
 * O ponto mais importante desta regra: uma comissão marcada como CONFIRMED
 * pela MESMA tela em que a venda foi digitada NÃO é evidência. É a mesma
 * declaração, feita duas vezes, pela mesma pessoa, sem nenhuma fonte
 * externa no meio. Aceitar isso significaria que qualquer venda de treino
 * vira dado de treino em dois cliques.
 *
 * Por isso a evidência é um REGISTRO PRÓPRIO E EXPLÍCITO
 * (`EvidenciaRegistrada`), nunca derivada de `Commission.status`. E por isso
 * `avaliarElegibilidade()` exige evidência ALÉM de `dataOrigin` já ser
 * `REAL_OPERATION` — as duas coisas juntas, nunca uma pela outra.
 *
 * ── PROMOÇÃO NÃO ACONTECE AQUI ──────────────────────────────────────────
 * Esta função AVALIA; não escreve nada e não promove nada. Não existe
 * promoção automática baseada em status: `USER_REPORTED` só poderá virar
 * `REAL_OPERATION` por um caminho de comprovação explícito e auditado, que
 * ainda não está implementado. Enquanto ele não existir, o veredito real
 * deste sistema é honestamente "nenhuma venda elegível" — e isso é melhor
 * do que um sim baseado em nada.
 */

import {
  EVIDENCIAS_ACEITAS_PARA_OPERACAO_REAL,
  normalizarOrigemDeRegistro,
  type EvidenciaDeOperacaoReal,
  type OrigemDeRegistro,
} from './proveniencia'

/** Status de comissão que representam dinheiro RECONHECIDO, não previsto. */
export const STATUS_DE_COMISSAO_RECONHECIDA = ['CONFIRMED', 'RECEIVED'] as const

export const MOTIVOS_INELEGIBILIDADE = [
  /** `dataOrigin` não é `REAL_OPERATION` (USER_REPORTED, SEED, TEST_FIXTURE, DEMO, SYNTHETIC_TEST, UNVERIFIED). */
  'ORIGEM_NAO_E_OPERACAO_REAL',
  /** A venda não está CONFIRMED (PENDING ainda não aconteceu; CANCELLED desaconteceu). */
  'VENDA_NAO_CONFIRMADA',
  /** Nenhuma comissão desta venda está CONFIRMED ou RECEIVED — EXPECTED é previsão. */
  'SEM_COMISSAO_RECONHECIDA',
  /** Veio comissão que não aponta para esta venda (saleId nulo ou de outra venda). */
  'COMISSAO_SEM_VENDA',
  /** Produto, link, conteúdo ou comissão de outro workspace. */
  'WORKSPACE_INCONSISTENTE',
  /** Falta registro de evidência externa/auditável válido. */
  'SEM_EVIDENCIA_CONFIAVEL',
  /** Campo obrigatório ausente ou ilegível — não dá para decidir, então nega. */
  'DADOS_INSUFICIENTES',
] as const

export type MotivoInelegibilidade = (typeof MOTIVOS_INELEGIBILIDADE)[number]

export interface ComissaoParaElegibilidade {
  id: string
  /** `null` = comissão órfã. Nunca torna venda nenhuma elegível. */
  saleId: string | null
  workspaceId: string
  /** EXPECTED | CONFIRMED | RECEIVED */
  status: string
}

/**
 * Registro de EVIDÊNCIA de que a operação comercial aconteteu de fato.
 *
 * É gravado explicitamente (hoje, como `AuditLog` com ação dedicada) e
 * NUNCA derivado do estado de outra entidade. Derivar de `Commission.status`
 * transformaria a segunda declaração da usuária em prova.
 */
export interface EvidenciaRegistrada {
  tipo: string
  registradaEm: Date
  /**
   * Identificador da fonte: id do evento de webhook, número do extrato, id
   * do repasse. É o que permite alguém conferir depois — evidência sem
   * referência conferível não é evidência, é afirmação.
   */
  referencia?: string | null
  /** Obrigatório em `CORRECAO_MANUAL_AUDITADA`: quem assinou a correção. */
  responsavelUserId?: string | null
  /** Obrigatório em `CORRECAO_MANUAL_AUDITADA`: por que foi necessária. */
  motivo?: string | null
}

export interface VendaParaElegibilidade {
  id: string
  workspaceId: string
  dataOrigin: string
  /** PENDING | CONFIRMED | CANCELLED */
  status: string
  /** Workspaces das entidades relacionadas. `null`/`undefined` = relação ausente. */
  productWorkspaceId?: string | null
  linkWorkspaceId?: string | null
  contentWorkspaceId?: string | null
  commissions: ComissaoParaElegibilidade[]
  evidencias: EvidenciaRegistrada[]
}

export interface VereditoDeOperacaoReal {
  elegivel: boolean
  /** TODOS os motivos, não só o primeiro — diagnosticar exige o quadro inteiro. */
  motivos: MotivoInelegibilidade[]
  saleId: string
  workspaceId: string
  dataOrigin: OrigemDeRegistro
  statusDaVenda: string
  /** Status das comissões LIGADAS a esta venda, na ordem recebida. */
  statusDasComissoes: string[]
  /** A evidência que sustentou o veredito. `null` quando não houve. */
  evidenciaUtilizada: EvidenciaDeOperacaoReal | null
  explicacao: string
}

function textoUtil(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function dataValida(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

/**
 * Uma evidência só vale se for de um tipo aceito, tiver data legível e
 * referência conferível.
 *
 * `CORRECAO_MANUAL_AUDITADA` exige ainda responsável e motivo: uma correção
 * manual sem quem assinou e sem por quê é indistinguível de alguém tendo
 * digitado "é real" — exatamente o que esta regra existe para impedir.
 */
export function evidenciaEhValida(e: EvidenciaRegistrada): boolean {
  if (!(EVIDENCIAS_ACEITAS_PARA_OPERACAO_REAL as readonly string[]).includes(e?.tipo)) return false
  if (!dataValida(e.registradaEm)) return false
  if (!textoUtil(e.referencia)) return false
  if (e.tipo === 'CORRECAO_MANUAL_AUDITADA') {
    if (!textoUtil(e.responsavelUserId)) return false
    if (!textoUtil(e.motivo)) return false
  }
  return true
}

/**
 * FUNÇÃO PURA. Não toca banco, não olha relógio, não lê ambiente.
 * Recebe o retrato completo da venda e devolve o veredito.
 */
export function avaliarElegibilidadeParaOperacaoReal(
  venda: VendaParaElegibilidade
): VereditoDeOperacaoReal {
  const motivos: MotivoInelegibilidade[] = []
  const dataOrigin = normalizarOrigemDeRegistro(venda?.dataOrigin)
  const comissoes = Array.isArray(venda?.commissions) ? venda.commissions : []
  const evidencias = Array.isArray(venda?.evidencias) ? venda.evidencias : []

  // 0) Retrato incompleto não é avaliável — e não avaliável é negado.
  if (!textoUtil(venda?.id) || !textoUtil(venda?.workspaceId)) {
    motivos.push('DADOS_INSUFICIENTES')
  }

  // 1) Origem. USER_REPORTED, UNVERIFIED, SEED, TEST_FIXTURE, DEMO e
  //    SYNTHETIC_TEST param aqui, sempre.
  if (dataOrigin !== 'REAL_OPERATION') {
    motivos.push('ORIGEM_NAO_E_OPERACAO_REAL')
  }

  // 2) A venda precisa ter acontecido. PENDING é promessa; CANCELLED é
  //    desfeita — e uma venda cancelada nunca pode ensinar que converteu.
  if (venda?.status !== 'CONFIRMED') {
    motivos.push('VENDA_NAO_CONFIRMADA')
  }

  // 3) Comissão. Só contam as que apontam para ESTA venda.
  const orfas = comissoes.filter((c) => !textoUtil(c?.saleId) || c.saleId !== venda?.id)
  if (orfas.length > 0) {
    motivos.push('COMISSAO_SEM_VENDA')
  }
  const desta = comissoes.filter((c) => textoUtil(c?.saleId) && c.saleId === venda?.id)
  const reconhecidas = desta.filter((c) =>
    (STATUS_DE_COMISSAO_RECONHECIDA as readonly string[]).includes(c?.status)
  )
  if (reconhecidas.length === 0) {
    // EXPECTED sozinho é previsão de comissão, não comissão.
    motivos.push('SEM_COMISSAO_RECONHECIDA')
  }

  // 4) Isolamento. Qualquer relação apontando para outro workspace invalida
  //    a venda inteira: um registro que cruza negócios não é confiável para
  //    nada, muito menos para treinar modelo.
  const relacionados = [venda?.productWorkspaceId, venda?.linkWorkspaceId, venda?.contentWorkspaceId]
  const cruzaWorkspace =
    relacionados.some((w) => w != null && w !== venda?.workspaceId) ||
    comissoes.some((c) => c?.workspaceId !== venda?.workspaceId)
  if (cruzaWorkspace) {
    motivos.push('WORKSPACE_INCONSISTENTE')
  }

  // 5) Evidência. Exigida SEMPRE, inclusive quando a origem já é
  //    REAL_OPERATION — as duas condições se somam, nunca se substituem.
  const valida = evidencias.find((e) => evidenciaEhValida(e))
  if (!valida) {
    motivos.push('SEM_EVIDENCIA_CONFIAVEL')
  }

  const elegivel = motivos.length === 0

  return {
    elegivel,
    motivos,
    saleId: textoUtil(venda?.id) ? venda.id : '',
    workspaceId: textoUtil(venda?.workspaceId) ? venda.workspaceId : '',
    dataOrigin,
    statusDaVenda: typeof venda?.status === 'string' ? venda.status : '',
    statusDasComissoes: desta.map((c) => (typeof c?.status === 'string' ? c.status : '')),
    evidenciaUtilizada: elegivel && valida ? (valida.tipo as EvidenciaDeOperacaoReal) : null,
    explicacao: elegivel
      ? `Venda elegível como operação real: origem REAL_OPERATION, venda CONFIRMED, comissão reconhecida e evidência ${valida!.tipo} (ref. ${valida!.referencia}).`
      : `Venda NÃO elegível como operação real. Motivos: ${motivos.join(', ')}.`,
  }
}

/** Atalho para quem só precisa do sim/não. A razão continua disponível acima. */
export function vendaEhOperacaoReal(venda: VendaParaElegibilidade): boolean {
  return avaliarElegibilidadeParaOperacaoReal(venda).elegivel
}

// ── Leitura do banco ────────────────────────────────────────────────────

/**
 * Ação de `AuditLog` que carrega uma evidência de operação real.
 *
 * A evidência mora no `AuditLog` que já existe — sem coluna nova, sem
 * migration — porque auditoria é exatamente onde um fato comprobatório
 * deve viver: com autor, data e metadados, e sem poder ser editado no
 * lugar como se fosse um campo da venda.
 *
 * ATENÇÃO (estado honesto de hoje): NENHUM código grava esta ação ainda.
 * O caminho de comprovação — webhook oficial, conciliação, ou correção
 * manual auditada — é a peça que falta. Enquanto ela não existir, toda
 * venda é corretamente inelegível.
 */
export const ACAO_AUDIT_EVIDENCIA = 'venda.evidencia_de_operacao_real'

/** Converte o metadata do AuditLog em evidência. Formato inválido = ignorado. */
export function lerEvidenciaDeMetadata(metadata: unknown, registradaEm: Date): EvidenciaRegistrada | null {
  if (!metadata || typeof metadata !== 'object') return null
  const m = metadata as Record<string, unknown>
  const evidencia: EvidenciaRegistrada = {
    tipo: typeof m.tipo === 'string' ? m.tipo : '',
    registradaEm,
    referencia: typeof m.referencia === 'string' ? m.referencia : null,
    responsavelUserId: typeof m.responsavelUserId === 'string' ? m.responsavelUserId : null,
    motivo: typeof m.motivo === 'string' ? m.motivo : null,
  }
  return evidenciaEhValida(evidencia) ? evidencia : null
}

/**
 * Monta o retrato da venda a partir do banco e aplica a regra pura.
 *
 * `null` quando a venda não existe NESTE workspace — nunca busca por id
 * solto: o workspace é a fronteira, e procurar sem ele já seria vazamento.
 *
 * Falha de leitura NÃO vira "elegível": propaga o erro para quem chamou
 * decidir, e quem chamou trata como não elegível.
 */
export async function avaliarVendaParaOperacaoReal(
  workspaceId: string,
  saleId: string
): Promise<VereditoDeOperacaoReal | null> {
  const { prisma } = await import('./prisma')

  const venda = await prisma.sale.findFirst({
    where: { id: saleId, workspaceId },
    select: {
      id: true,
      workspaceId: true,
      dataOrigin: true,
      status: true,
      product: { select: { workspaceId: true } },
      link: { select: { workspaceId: true } },
      content: { select: { workspaceId: true } },
      commissions: { select: { id: true, saleId: true, workspaceId: true, status: true } },
    },
  })
  if (!venda) return null

  const registros = await prisma.auditLog.findMany({
    where: {
      workspaceId,
      action: ACAO_AUDIT_EVIDENCIA,
      entityType: 'Sale',
      entityId: saleId,
    },
    select: { metadata: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  const evidencias = registros
    .map((r) => lerEvidenciaDeMetadata(r.metadata, r.createdAt))
    .filter((e): e is EvidenciaRegistrada => e !== null)

  return avaliarElegibilidadeParaOperacaoReal({
    id: venda.id,
    workspaceId: venda.workspaceId,
    dataOrigin: venda.dataOrigin,
    status: venda.status,
    productWorkspaceId: venda.product?.workspaceId ?? null,
    linkWorkspaceId: venda.link?.workspaceId ?? null,
    contentWorkspaceId: venda.content?.workspaceId ?? null,
    commissions: venda.commissions,
    evidencias,
  })
}
