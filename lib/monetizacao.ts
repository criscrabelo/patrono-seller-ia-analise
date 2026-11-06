/**
 * P2.18.7 — MOTOR DE MONETIZAÇÃO (oportunidades com prazo, meta e recompensa).
 *
 * "Oportunidade de monetização" generaliza o que já existia — missões e
 * campanhas (MetaTikTokShop, com `campanha` e `recompensaCampanha`),
 * obrigação de conteúdo de amostra recebida e a comissão por venda normal —
 * sem tabela nova e sem duplicar Missão × Campanha.
 *
 * Regras:
 *   - progresso CONFIRMADO = o que a plataforma contou (quantidadeRealizada);
 *     o que o Patrono gerou/aprovou/publicou é PIPELINE, nunca conclusão;
 *   - dinheiro confirmado, informado, recompensa elegível, recompensa em jogo
 *     e potencial NUNCA se misturam;
 *   - capacidade = ritmo real medido (publicações recentes); sem histórico,
 *     estimativa conservadora rotulada (1/dia) — nunca capacidade inventada;
 *   - campanha ruim não trava a venda normal (a comissão por venda é sempre
 *     uma oportunidade ativa).
 * FUNÇÕES PURAS; o carregamento fica em `monetizacaoDoWorkspace`.
 */
import { aprovadaOuAlem } from './estados-da-publicacao'

export type TipoDeOportunidade = 'MISSAO' | 'CAMPANHA' | 'OBRIGACAO_DE_AMOSTRA' | 'COMISSAO_POR_VENDA'
export type Urgencia = 'NORMAL' | 'ATENCAO' | 'EM_RISCO' | 'CRITICA' | 'EXPIRADA'
export type FonteDaOportunidade = 'TIKTOK_MANUAL' | 'TIKTOK_API' | 'PATRONO_CALCULATED'

export interface OportunidadeDeMonetizacao {
  id: string
  provider: string
  tipo: TipoDeOportunidade
  titulo: string
  /** Tipo de entrega exigida (VIDEOS_QUALIFICADOS, ADICIONAR_PRODUTOS…). */
  requisito: string
  inicio: string | null
  fim: string | null
  recompensaPrevista: number | null
  tipoDeRecompensa: 'DINHEIRO' | 'OUTRA' | 'COMISSAO'
  quantidadeNecessaria: number | null
  /** O que a PLATAFORMA contou (evidência). */
  progressoConfirmado: number
  /** Pipeline do Patrono (não conta como progresso). */
  pipeline: { planejado: number; gerado: number; aprovado: number; publicado: number }
  faltam: number
  diasRestantes: number | null
  /** Planejamento reverso: o mínimo por dia para chegar no prazo. */
  ritmoNecessario: number | null
  urgencia: Urgencia
  fonte: FonteDaOportunidade
  conclusao: string
}

export interface MetaParaMonetizacao {
  id: string
  nome: string
  tipo: string
  inicio: Date
  fim: Date
  recompensaValor: number | null
  campanha: string | null
  recompensaCampanha: number | null
  quantidadeExigida: number
  quantidadeRealizada: number
  origem: string
}

const DIA = 24 * 60 * 60 * 1000

/** FUNÇÃO PURA. Ritmo real: publicações dos últimos 14 dias ÷ 14; sem histórico, 1/dia (conservador, rotulado). */
export function capacidadePorDia(publicacoesRecentes: Date[], agora: Date): { porDia: number; medida: boolean } {
  const n = publicacoesRecentes.filter((d) => agora.getTime() - d.getTime() <= 14 * DIA).length
  return n > 0 ? { porDia: Math.max(n / 14, 0.5), medida: true } : { porDia: 1, medida: false }
}

/** FUNÇÃO PURA. Urgência a partir do que falta, do tempo e da capacidade real. */
export function classificarUrgencia(p: { faltam: number; fim: Date | null; agora: Date; capacidadePorDia: number; dependeDeTerceiro?: boolean }): { urgencia: Urgencia; diasRestantes: number | null; ritmoNecessario: number | null } {
  if (!p.fim) return { urgencia: 'NORMAL', diasRestantes: null, ritmoNecessario: null }
  const restanteMs = p.fim.getTime() - p.agora.getTime()
  const diasRestantes = Math.max(0, restanteMs / DIA)
  if (restanteMs <= 0) return { urgencia: p.faltam > 0 ? 'EXPIRADA' : 'NORMAL', diasRestantes: 0, ritmoNecessario: null }
  if (p.faltam <= 0) return { urgencia: 'NORMAL', diasRestantes, ritmoNecessario: 0 }
  // Dias operacionais: hoje conta como um dia inteiro de trabalho.
  const diasOperacionais = Math.max(1, Math.ceil(diasRestantes))
  const ritmo = p.faltam / diasOperacionais
  const folga = p.dependeDeTerceiro ? 0.8 : 1
  const cap = p.capacidadePorDia * folga
  const urgencia: Urgencia = diasRestantes < 1 || ritmo > cap * 1.5 ? 'CRITICA' : ritmo > cap ? 'EM_RISCO' : ritmo > cap * 0.6 ? 'ATENCAO' : 'NORMAL'
  return { urgencia, diasRestantes, ritmoNecessario: Math.ceil(ritmo * 10) / 10 }
}

const PESO_DA_URGENCIA: Record<Urgencia, number> = { CRITICA: 0, EM_RISCO: 1, ATENCAO: 2, NORMAL: 3, EXPIRADA: 4 }

/**
 * FUNÇÃO PURA. Missões e campanhas → oportunidades. Uma campanha agrupa
 * metas: a recompensa da campanha conta UMA vez (no grupo), não por meta.
 */
export function oportunidadesDasMetas(
  metas: MetaParaMonetizacao[],
  pipeline: (metaId: string) => OportunidadeDeMonetizacao['pipeline'],
  agora: Date,
  capacidade: number
): OportunidadeDeMonetizacao[] {
  const out: OportunidadeDeMonetizacao[] = []
  for (const m of metas) {
    const faltam = Math.max(0, m.quantidadeExigida - m.quantidadeRealizada)
    const ehVideo = /VIDEO/.test(m.tipo)
    const u = classificarUrgencia({ faltam, fim: m.fim, agora, capacidadePorDia: ehVideo ? capacidade : Math.max(capacidade, 3), dependeDeTerceiro: m.tipo === 'SOLICITAR_AMOSTRAS' })
    out.push({
      id: m.id,
      provider: 'tiktok-shop',
      tipo: m.campanha ? 'CAMPANHA' : 'MISSAO',
      titulo: m.campanha ? `${m.campanha}: ${m.nome}` : m.nome,
      requisito: m.tipo,
      inicio: m.inicio.toISOString(),
      fim: m.fim.toISOString(),
      recompensaPrevista: m.recompensaValor,
      tipoDeRecompensa: m.recompensaValor !== null ? 'DINHEIRO' : 'OUTRA',
      quantidadeNecessaria: m.quantidadeExigida,
      progressoConfirmado: m.quantidadeRealizada,
      pipeline: pipeline(m.id),
      faltam,
      diasRestantes: u.diasRestantes,
      ritmoNecessario: u.ritmoNecessario,
      urgencia: u.urgencia,
      fonte: m.origem === 'API_OFICIAL' ? 'TIKTOK_API' : 'TIKTOK_MANUAL',
      conclusao: `Concluída quando o app contar ${m.quantidadeExigida} (hoje: ${m.quantidadeRealizada}). Vídeo gerado ou publicado aqui não conta sozinho.`,
    })
  }
  return out.sort((a, b) => PESO_DA_URGENCIA[a.urgencia] - PESO_DA_URGENCIA[b.urgencia] || (a.fim ?? '').localeCompare(b.fim ?? ''))
}

/** Venda normal: sempre ativa — campanha ruim nunca trava a comissão por venda. */
export const COMISSAO_POR_VENDA: OportunidadeDeMonetizacao = {
  id: 'comissao-por-venda', provider: 'tiktok-shop', tipo: 'COMISSAO_POR_VENDA', titulo: 'Comissão por venda (sempre ativa)', requisito: 'VENDA',
  inicio: null, fim: null, recompensaPrevista: null, tipoDeRecompensa: 'COMISSAO', quantidadeNecessaria: null, progressoConfirmado: 0,
  pipeline: { planejado: 0, gerado: 0, aprovado: 0, publicado: 0 }, faltam: 0, diasRestantes: null, ritmoNecessario: null, urgencia: 'NORMAL', fonte: 'PATRONO_CALCULATED',
  conclusao: 'Contínua: cada venda atribuída gera comissão.',
}

export interface ReceitaSeparada {
  /** Comissão confirmada/recebida pela plataforma (fonte oficial ou conciliação). */
  confirmada: number
  /** Comissão que a titular informou ao registrar resultados (não é pagamento confirmado). */
  informada: number
  /** Recompensas de metas já cumpridas (app contou tudo) e ainda não pagas. */
  recompensaElegivel: number
  /** Recompensas de metas ativas ainda não cumpridas. */
  recompensaEmJogo: number
}

/** FUNÇÃO PURA. Nunca soma potencial com dinheiro ganho. Recompensa de campanha conta uma vez por campanha. */
export function separarReceita(p: { metas: MetaParaMonetizacao[]; comissoesConfirmadas: number; comissoesInformadas: number; agora: Date }): ReceitaSeparada {
  let elegivel = 0
  let emJogo = 0
  const campanhasContadas = new Set<string>()
  for (const m of p.metas) {
    const cumprida = m.quantidadeRealizada >= m.quantidadeExigida
    const valor = m.campanha ? (campanhasContadas.has(m.campanha) ? 0 : m.recompensaCampanha ?? 0) : m.recompensaValor ?? 0
    if (m.campanha && valor) campanhasContadas.add(m.campanha)
    if (cumprida) elegivel += valor
    else if (m.fim.getTime() > p.agora.getTime()) emJogo += valor
  }
  return { confirmada: p.comissoesConfirmadas, informada: p.comissoesInformadas, recompensaElegivel: elegivel, recompensaEmJogo: emJogo }
}

export interface DiaDaAgenda { dia: string; itens: { oportunidade: string; videos: number }[]; total: number }

/**
 * FUNÇÃO PURA. Agenda automática: distribui os vídeos que faltam, prazo mais
 * próximo primeiro, respeitando a capacidade real por dia. O que não cabe
 * antes do prazo fica marcado (a campanha vira crítica — não se inventa capacidade).
 */
export function agendaDeMonetizacao(ops: OportunidadeDeMonetizacao[], agora: Date, capacidade: number, dias = 7): { agenda: DiaDaAgenda[]; naoCabe: { oportunidade: string; videos: number }[] } {
  const porDia = Math.max(1, Math.floor(capacidade))
  const agenda: DiaDaAgenda[] = Array.from({ length: dias }, (_, i) => ({ dia: new Date(agora.getTime() + i * DIA).toISOString().slice(0, 10), itens: [], total: 0 }))
  const naoCabe: { oportunidade: string; videos: number }[] = []
  const videos = ops.filter((o) => /VIDEO/.test(o.requisito) && o.faltam > 0 && o.urgencia !== 'EXPIRADA' && o.fim).sort((a, b) => a.fim!.localeCompare(b.fim!))
  for (const o of videos) {
    let resta = o.faltam
    for (const d of agenda) {
      if (resta <= 0) break
      if (d.dia > o.fim!.slice(0, 10)) break
      const livre = porDia - d.total
      if (livre <= 0) continue
      const n = Math.min(livre, resta)
      d.itens.push({ oportunidade: o.titulo, videos: n })
      d.total += n
      resta -= n
    }
    if (resta > 0) naoCabe.push({ oportunidade: o.titulo, videos: resta })
  }
  return { agenda, naoCabe }
}

/** Resumo "HOJE" da Operação. */
export interface ResumoDeMonetizacao {
  oportunidades: OportunidadeDeMonetizacao[]
  ativas: number
  prazoMaisProximo: { titulo: string; fim: string; urgencia: Urgencia } | null
  videosNecessariosHoje: number
  receita: ReceitaSeparada
  capacidade: { porDia: number; medida: boolean }
  agenda: DiaDaAgenda[]
  naoCabe: { oportunidade: string; videos: number }[]
  /** Vídeos que faltam em metas EM_RISCO/CRÍTICAS (o Patrono cria jornadas para cobrir). */
  videosEmRisco: number
}

export function resumirMonetizacao(p: { metas: MetaParaMonetizacao[]; pipeline: (metaId: string) => OportunidadeDeMonetizacao['pipeline']; publicacoesRecentes: Date[]; comissoesConfirmadas: number; comissoesInformadas: number; agora: Date }): ResumoDeMonetizacao {
  const capacidade = capacidadePorDia(p.publicacoesRecentes, p.agora)
  const ops = oportunidadesDasMetas(p.metas, p.pipeline, p.agora, capacidade.porDia)
  const ativas = ops.filter((o) => o.urgencia !== 'EXPIRADA' && o.faltam > 0)
  const proxima = ativas.filter((o) => o.fim).sort((a, b) => a.fim!.localeCompare(b.fim!))[0] ?? null
  const { agenda, naoCabe } = agendaDeMonetizacao(ops, p.agora, capacidade.porDia)
  return {
    oportunidades: [...ops, COMISSAO_POR_VENDA],
    ativas: ativas.length,
    prazoMaisProximo: proxima ? { titulo: proxima.titulo, fim: proxima.fim!, urgencia: proxima.urgencia } : null,
    videosNecessariosHoje: agenda[0]?.total ?? 0,
    receita: separarReceita({ metas: p.metas, comissoesConfirmadas: p.comissoesConfirmadas, comissoesInformadas: p.comissoesInformadas, agora: p.agora }),
    capacidade,
    agenda,
    naoCabe,
    videosEmRisco: ativas.filter((o) => /VIDEO/.test(o.requisito) && (o.urgencia === 'EM_RISCO' || o.urgencia === 'CRITICA')).reduce((s, o) => s + o.faltam, 0),
  }
}

/** Carrega do banco (missões/campanhas ativas, publicações, comissões) e resume. */
export async function monetizacaoDoWorkspace(workspaceId: string, agora: Date = new Date()): Promise<ResumoDeMonetizacao> {
  const { prisma } = await import('./prisma')
  const [metas, assistidas, comissoes, resultados] = await Promise.all([
    prisma.metaTikTokShop.findMany({ where: { workspaceId, status: 'ATIVA' }, orderBy: { fim: 'asc' } }),
    prisma.publicacaoAssistida.findMany({ where: { workspaceId, demonstracao: false }, select: { estado: true, metasIds: true, publicadoEm: true, apresentacao: true } }),
    import('./financeiro').then((f) => f.resumoFinanceiro(workspaceId)),
    prisma.videoTikTokResultado.findMany({ where: { workspaceId }, select: { id: true, comissao: true } }),
  ])
  // P2.25: o vídeo que já tem pedido importado (Creator Center) está na comissão canônica — a comissão
  // digitada nele não entra de novo em "informada" (a mesma venda nunca conta duas vezes).
  const comPedido = new Set((await prisma.pedidoAfiliadoTikTok.findMany({ where: { workspaceId, videoResultadoId: { in: resultados.map((r) => r.id) } }, select: { videoResultadoId: true } })).map((p) => p.videoResultadoId))
  const pipeline = (metaId: string) => {
    const doMeta = assistidas.filter((a) => a.metasIds.includes(metaId) && a.estado !== 'REJEITADO')
    const gerado = (a: (typeof assistidas)[number]) => !!(a.apresentacao as { video?: { arquivo?: string | null } } | null)?.video?.arquivo
    return {
      planejado: doMeta.length,
      gerado: doMeta.filter(gerado).length,
      aprovado: doMeta.filter((a) => aprovadaOuAlem(a.estado)).length,
      publicado: doMeta.filter((a) => a.estado === 'PUBLICADO').length,
    }
  }
  return resumirMonetizacao({
    metas,
    pipeline,
    publicacoesRecentes: assistidas.map((a) => a.publicadoEm).filter((d): d is Date => !!d),
    comissoesConfirmadas: comissoes.confirmada,
    comissoesInformadas: resultados.filter((r) => !comPedido.has(r.id)).reduce((s, r) => s + (r.comissao ?? 0), 0),
    agora,
  })
}
