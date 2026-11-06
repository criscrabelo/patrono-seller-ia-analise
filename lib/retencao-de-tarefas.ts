/**
 * P2.9 — Retenção e expurgo dos registros de tarefas em segundo plano.
 *
 * ── O QUE FICAVA SEM PRAZO ──────────────────────────────────────────────
 * Os trabalhos longos (lib/trabalho-longo.ts) guardam, em
 * `AutomationJob.contexto`:
 *   - WhatsApp: os NÚMEROS de terceiros, a MENSAGEM, a imagem e o
 *     resultado POR NÚMERO (inclusive na `resposta` que a tela recebe);
 *   - legenda: o texto da legenda (SRT), URLs do vídeo e do fal.ai;
 *   - publicação: ids de conteúdo, container e mídia — nenhum dado pessoal.
 *
 * ── A POLÍTICA ──────────────────────────────────────────────────────────
 *   ativo (PENDING/RUNNING)                  → nunca mexe
 *   publicação (qualquer estado)             → mantém: não tem dado pessoal
 *     e a linha é a trava que impede republicar a mesma tentativa
 *   WhatsApp/legenda terminal, sem atividade
 *     há `prazoDeAnonimizacaoDias`           → ANONIMIZA: o contexto vira só
 *     contagens; a linha, a chave e o estado ficam (o mesmo pedido continua
 *     reencontrando o trabalho e não reenvia)
 *   anonimizado há mais de
 *     `prazoDeExclusaoDias - prazoDeAnonimizacaoDias` → EXCLUI a linha
 *
 * Nada aqui toca o banco: decide e transforma. Quem escreve é o adaptador
 * (lib/automation-queue-prisma.ts → `portaDosTrabalhosLongos`).
 */
export const PRAZO_PADRAO_DE_ANONIMIZACAO_DIAS = 30
export const PRAZO_PADRAO_DE_EXCLUSAO_DIAS = 180

const DIA_MS = 24 * 60 * 60 * 1000
const ESTADOS_ATIVOS = ['PENDING', 'RUNNING']
const TIPOS_COM_DADO_PESSOAL = ['LONGO_ENVIO_WHATSAPP', 'LONGO_LEGENDA_VIDEO']

export interface PrazosDeRetencao {
  anonimizacaoDias: number
  exclusaoDias: number
}

/**
 * Prazos da configuração, com limites: anonimizar nunca antes de 1 dia (a
 * chave do WhatsApp inclui o dia — é a janela anti-duplicidade) e excluir
 * nunca antes de anonimizar. Valor inválido cai no padrão.
 */
export function lerPrazos(env: Record<string, string | undefined> = process.env): PrazosDeRetencao {
  const ler = (v: string | undefined, padrao: number, min: number, max: number) => {
    const n = Number((v ?? '').trim())
    return Number.isInteger(n) && n >= min && n <= max ? n : padrao
  }
  const anonimizacaoDias = ler(env.RETENCAO_TAREFAS_ANONIMIZAR_DIAS, PRAZO_PADRAO_DE_ANONIMIZACAO_DIAS, 1, 3650)
  const exclusaoDias = Math.max(ler(env.RETENCAO_TAREFAS_EXCLUIR_DIAS, PRAZO_PADRAO_DE_EXCLUSAO_DIAS, 1, 3650), anonimizacaoDias)
  return { anonimizacaoDias, exclusaoDias }
}

export interface TarefaParaRetencao {
  id: string
  workspaceId: string
  tipo: string
  estado: string
  updatedAt: Date
  contexto: Record<string, unknown> | null
}

export type AcaoDeRetencao = 'manter' | 'anonimizar' | 'excluir'

export interface DecisaoDeRetencao {
  acao: AcaoDeRetencao
  motivo: string
}

export function anonimizadoEm(contexto: Record<string, unknown> | null): Date | null {
  const v = contexto?.anonimizadoEm
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}

/** FUNÇÃO PURA. O que fazer com uma tarefa, hoje. */
export function decidirRetencao(t: TarefaParaRetencao, agora: Date, prazos: PrazosDeRetencao): DecisaoDeRetencao {
  if (!t.tipo.startsWith('LONGO_')) return { acao: 'manter', motivo: 'não é tarefa em segundo plano' }
  if (ESTADOS_ATIVOS.includes(t.estado)) return { acao: 'manter', motivo: 'tarefa ativa' }
  if (!TIPOS_COM_DADO_PESSOAL.includes(t.tipo)) {
    return { acao: 'manter', motivo: 'sem dado pessoal; a linha impede repetir a mesma tentativa' }
  }

  const anon = anonimizadoEm(t.contexto)
  if (anon) {
    const limite = agora.getTime() - (prazos.exclusaoDias - prazos.anonimizacaoDias) * DIA_MS
    return anon.getTime() <= limite
      ? { acao: 'excluir', motivo: `anonimizada há mais de ${prazos.exclusaoDias - prazos.anonimizacaoDias} dias` }
      : { acao: 'manter', motivo: 'já anonimizada, dentro do prazo de exclusão' }
  }

  return t.updatedAt.getTime() <= agora.getTime() - prazos.anonimizacaoDias * DIA_MS
    ? { acao: 'anonimizar', motivo: `concluída e sem atividade há mais de ${prazos.anonimizacaoDias} dias` }
    : { acao: 'manter', motivo: 'dentro do prazo de conferência' }
}

/**
 * FUNÇÃO PURA. O contexto que sobra depois de anonimizar: só contagens e o
 * estado do que a tela mostraria — nenhum número, mensagem, texto, URL ou
 * identificador externo.
 */
export function contextoAnonimizado(tipo: string, contexto: Record<string, unknown> | null, agora: Date): Record<string, unknown> {
  const base = { anonimizadoEm: agora.toISOString() }
  const status = Number((contexto?.resposta as { status?: unknown } | undefined)?.status) || 200

  if (tipo === 'LONGO_ENVIO_WHATSAPP') {
    const pedido = (contexto?.pedido ?? {}) as { numeros?: unknown[] }
    const resultados = Object.values((contexto?.resultados ?? {}) as Record<string, { ok?: boolean; incerto?: boolean }>)
    const resumo = {
      total: Array.isArray(pedido.numeros) ? pedido.numeros.length : resultados.length,
      enviados: resultados.filter((r) => r?.ok).length,
      erros: resultados.filter((r) => r && !r.ok && !r.incerto).length,
      incertos: resultados.filter((r) => r?.incerto).length,
    }
    return {
      ...base,
      resumo,
      resposta: {
        status,
        corpo: {
          ok: status < 400,
          ...resumo,
          resultados: [],
          anonimizado: true,
          mensagem: 'Os detalhes deste envio (números e mensagem) foram removidos pela política de retenção.',
        },
      },
    }
  }

  return {
    ...base,
    resposta: {
      status,
      corpo: {
        ok: status < 400,
        anonimizado: true,
        mensagem: 'Os detalhes desta tarefa foram removidos pela política de retenção.',
      },
    },
  }
}

// ── Relatório e execução ────────────────────────────────────────────────

export interface RelatorioDoWorkspace {
  workspaceId: string
  analisadas: number
  anonimizar: number
  excluir: number
  manter: number
  porTipo: Record<string, { anonimizar: number; excluir: number }>
  aplicadas: number
  ignoradasPorConcorrencia: number
}

export interface PortaDeRetencao {
  /** Só leitura: tarefas candidatas de UM workspace (mais antigas primeiro). */
  listar(workspaceId: string, limite: number): Promise<TarefaParaRetencao[]>
  workspaces(): Promise<string[]>
  /** Escreve só se a linha ainda estiver como foi lida (estado + updatedAt). */
  anonimizar(t: TarefaParaRetencao, contexto: Record<string, unknown>): Promise<boolean>
  excluir(t: TarefaParaRetencao): Promise<boolean>
}

/**
 * Executa (ou ENSAIA) a retenção. Ensaio é o padrão: lê, decide e relata,
 * sem escrever nada. Cada workspace é tratado separadamente — um
 * `workspaceId` restringe a um só. Repetir é inofensivo: o anonimizado
 * não é anonimizado de novo, e a escrita é condicionada ao estado lido.
 */
export async function executarRetencao(params: {
  porta: PortaDeRetencao
  agora: Date
  prazos: PrazosDeRetencao
  modo: 'ensaio' | 'execucao'
  workspaceId?: string
  limitePorWorkspace?: number
}): Promise<{ modo: 'ensaio' | 'execucao'; prazos: PrazosDeRetencao; workspaces: RelatorioDoWorkspace[] }> {
  const limite = params.limitePorWorkspace ?? 500
  const alvos = params.workspaceId ? [params.workspaceId] : await params.porta.workspaces()
  const relatorios: RelatorioDoWorkspace[] = []

  for (const workspaceId of alvos) {
    const r: RelatorioDoWorkspace = { workspaceId, analisadas: 0, anonimizar: 0, excluir: 0, manter: 0, porTipo: {}, aplicadas: 0, ignoradasPorConcorrencia: 0 }
    for (const t of await params.porta.listar(workspaceId, limite)) {
      // Proteção por workspace: nunca age fora do workspace em processamento.
      if (t.workspaceId !== workspaceId) continue
      r.analisadas++
      const d = decidirRetencao(t, params.agora, params.prazos)
      r[d.acao]++
      if (d.acao === 'manter') continue
      const pt = (r.porTipo[t.tipo] ??= { anonimizar: 0, excluir: 0 })
      pt[d.acao]++
      if (params.modo !== 'execucao') continue
      const ok =
        d.acao === 'anonimizar'
          ? await params.porta.anonimizar(t, contextoAnonimizado(t.tipo, t.contexto, params.agora))
          : await params.porta.excluir(t)
      if (ok) r.aplicadas++
      else r.ignoradasPorConcorrencia++
    }
    if (r.analisadas) relatorios.push(r)
  }
  return { modo: params.modo, prazos: params.prazos, workspaces: relatorios }
}
