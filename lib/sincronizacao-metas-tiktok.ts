/**
 * P2.17.5 — TikTok Mission Sync.
 *
 *   fonte → ler missões → comparar com o que existe → criar / atualizar /
 *   marcar ausente / encerrar → registrar o que mudou → reagir (prioridade)
 *
 * Idempotente: a mesma leitura aplicada duas vezes não muda nada na segunda.
 * A chave de cada missão é `chaveExterna` (id da fonte, ou campanha+tipo+início
 * no fallback por texto). Meta MANUAL sem chave só é "adotada" quando a fonte
 * traz a mesma campanha, tipo e início — nunca duplicada, nunca encerrada sozinha.
 *
 * Sumiu da fonte: não apaga. Na 1ª ausência fica marcada; só depois de
 * AUSENCIAS_PARA_ENCERRAR leituras seguidas sem ela vira ENCERRADA (confirmação).
 */
import { createHash } from 'node:crypto'
import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import { analisarMetas, ROTULO_DO_TIPO, TIPOS_DE_META, validarDadosDaMeta, ErroDeMeta, type TipoDeMeta, type MetaParaAnalise } from './metas-tiktok'
import { melhorFonteAutomatica, type FonteDeMissoes } from './fonte-missoes-tiktok'

export const AUSENCIAS_PARA_ENCERRAR = 2

export interface MissaoDaFonte {
  chave: string
  campanha: string | null
  nome: string
  tipo: TipoDeMeta
  inicio: Date
  fim: Date
  recompensaValor: number | null
  recompensaCampanha: number | null
  recompensaDescricao: string | null
  quantidadeExigida: number
  quantidadeRealizada: number
  requisitos: string | null
}

export interface MetaExistente extends Omit<MissaoDaFonte, 'chave' | 'tipo'> {
  id: string
  tipo: string
  chaveExterna: string | null
  status: string
  ausenciasSeguidas: number
  fonteSincronizacao: string | null
}

export const CAMPOS_SINCRONIZADOS = [
  'campanha', 'nome', 'tipo', 'inicio', 'fim', 'recompensaValor', 'recompensaCampanha', 'recompensaDescricao', 'quantidadeExigida', 'quantidadeRealizada', 'requisitos',
] as const
type Campo = (typeof CAMPOS_SINCRONIZADOS)[number]

export interface Mudanca { campo: Campo; anterior: string | null; novo: string | null }

/** O que a sincronização aplica — ESCOPO_* dizem até onde a ausência vale. */
export type Escopo = { tipo: 'COMPLETA'; fonte: FonteDeMissoes } | { tipo: 'CAMPANHA'; campanha: string }

export type Acao =
  | { tipo: 'CRIAR'; missao: MissaoDaFonte }
  | { tipo: 'ATUALIZAR'; metaId: string; nome: string; missao: MissaoDaFonte; mudancas: Mudanca[]; reapareceu: boolean; adotada: boolean }
  | { tipo: 'INALTERADA'; metaId: string; nome: string; reapareceu: boolean }
  | { tipo: 'ARQUIVADA_PELA_TITULAR'; metaId: string; nome: string }
  | { tipo: 'AUSENTE'; metaId: string; nome: string; ausencias: number }
  | { tipo: 'ENCERRAR'; metaId: string; nome: string; ausencias: number }

// ── Funções puras ───────────────────────────────────────────────────────

const normalizar = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

const dia = (d: Date) => new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10) // data em BRT

/**
 * Chave do fallback por texto: campanha + tipo + dia de início. O nome entra
 * só quando há duas metas do mesmo tipo na mesma campanha (o nome pode ser
 * corrigido na revisão — não deve gerar duplicata).
 */
export function chaveDoTexto(m: { campanha: string | null; tipo: string; inicio: Date; nome: string }, desempatarPorNome: boolean): string {
  const base = [normalizar(m.campanha), m.tipo, dia(m.inicio), desempatarPorNome ? normalizar(m.nome) : ''].join('|')
  return `texto:${createHash('sha256').update(base).digest('hex').slice(0, 32)}`
}

export function chavesDoTexto<T extends { campanha: string | null; tipo: string; inicio: Date; nome: string }>(metas: T[]): string[] {
  const contagem = new Map<string, number>()
  for (const m of metas) contagem.set(m.tipo, (contagem.get(m.tipo) ?? 0) + 1)
  return metas.map((m) => chaveDoTexto(m, (contagem.get(m.tipo) ?? 0) > 1))
}

function valorComoTexto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

export function diferencas(atual: MetaExistente, nova: MissaoDaFonte): Mudanca[] {
  const out: Mudanca[] = []
  for (const campo of CAMPOS_SINCRONIZADOS) {
    const a = valorComoTexto(atual[campo]), n = valorComoTexto(nova[campo])
    if (a !== n) out.push({ campo, anterior: a, novo: n })
  }
  return out
}

/** FUNÇÃO PURA. Decide o que fazer com cada missão — nada é gravado aqui. */
export function planejarSincronizacao(p: { existentes: MetaExistente[]; recebidas: MissaoDaFonte[]; escopo: Escopo; ausenciasParaEncerrar?: number }): Acao[] {
  const limite = p.ausenciasParaEncerrar ?? AUSENCIAS_PARA_ENCERRAR
  // Mesma chave repetida na leitura: vale a última (a fonte é a verdade).
  const recebidas = [...new Map(p.recebidas.map((m) => [m.chave, m])).values()]
  const porChave = new Map(p.existentes.filter((e) => e.chaveExterna).map((e) => [e.chaveExterna as string, e]))
  const adotaveis = p.existentes.filter((e) => !e.chaveExterna && e.status === 'ATIVA')
  const vistas = new Set<string>()
  const acoes: Acao[] = []

  for (const m of recebidas) {
    let atual = porChave.get(m.chave)
    let adotada = false
    if (!atual) {
      const i = adotaveis.findIndex((e) => normalizar(e.campanha) === normalizar(m.campanha) && e.tipo === m.tipo && dia(e.inicio) === dia(m.inicio))
      if (i >= 0) {
        atual = adotaveis.splice(i, 1)[0]
        adotada = true
      }
    }
    if (!atual) {
      acoes.push({ tipo: 'CRIAR', missao: m })
      continue
    }
    vistas.add(atual.id)
    if (atual.status === 'ARQUIVADA') {
      // Decisão da titular vence: não reativa nem altera o que ela arquivou.
      acoes.push({ tipo: 'ARQUIVADA_PELA_TITULAR', metaId: atual.id, nome: atual.nome })
      continue
    }
    const reapareceu = atual.status === 'ENCERRADA' || atual.ausenciasSeguidas > 0
    const mudancas = diferencas(atual, m)
    if (mudancas.length || adotada) acoes.push({ tipo: 'ATUALIZAR', metaId: atual.id, nome: m.nome, missao: m, mudancas, reapareceu, adotada })
    else acoes.push({ tipo: 'INALTERADA', metaId: atual.id, nome: atual.nome, reapareceu })
  }

  for (const e of p.existentes) {
    if (!e.chaveExterna || e.status !== 'ATIVA' || vistas.has(e.id)) continue
    const noEscopo = p.escopo.tipo === 'COMPLETA' ? e.fonteSincronizacao === p.escopo.fonte : normalizar(e.campanha) === normalizar(p.escopo.campanha)
    if (!noEscopo) continue
    const ausencias = e.ausenciasSeguidas + 1
    acoes.push(ausencias >= limite ? { tipo: 'ENCERRAR', metaId: e.id, nome: e.nome, ausencias } : { tipo: 'AUSENTE', metaId: e.id, nome: e.nome, ausencias })
  }
  return acoes
}

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataCurta = (iso: string) => {
  const [, m, d] = dia(new Date(iso)).split('-')
  return `${d}/${m}`
}

/**
 * FUNÇÃO PURA. A reação do consultor depois da sincronização: o que mudou e
 * o que fazer agora (missão mais urgente, risco, quanto fazer hoje).
 */
export function reagir(acoes: Acao[], metasAtivasDepois: MetaParaAnalise[], agora: Date): string[] {
  const frases: string[] = []
  const criadas = acoes.filter((a) => a.tipo === 'CRIAR')
  if (criadas.length === 1) frases.push('Hoje apareceu 1 nova meta no TikTok Shop.')
  else if (criadas.length > 1) frases.push(`Hoje apareceram ${criadas.length} novas metas no TikTok Shop.`)

  const campanhasCitadas = new Set<string>()
  for (const a of acoes) {
    if (a.tipo !== 'ATUALIZAR') continue
    for (const m of a.mudancas) {
      const ant = m.anterior !== null ? Number(m.anterior) : null
      const nov = m.novo !== null ? Number(m.novo) : null
      // Recompensa TOTAL da campanha: uma frase por campanha, não uma por meta.
      if (m.campo === 'recompensaCampanha' && a.missao.campanha && ant !== null && nov !== null) {
        if (!campanhasCitadas.has(a.missao.campanha)) frases.push(`A recompensa da campanha "${a.missao.campanha}" ${nov > ant ? 'subiu' : 'caiu'} de ${reais(ant)} para ${reais(nov)}.`)
        campanhasCitadas.add(a.missao.campanha)
      } else if ((m.campo === 'recompensaValor' || m.campo === 'recompensaCampanha') && ant !== null && nov !== null) {
        frases.push(`A recompensa de "${a.nome}" ${nov > ant ? 'subiu' : 'caiu'} de ${reais(ant)} para ${reais(nov)}.`)
      } else if ((m.campo === 'recompensaValor' || m.campo === 'recompensaCampanha') && nov !== null) {
        frases.push(`"${a.nome}" passou a mostrar recompensa de ${reais(nov)}.`)
      } else if (m.campo === 'fim' && m.anterior && m.novo) {
        frases.push(`O prazo de "${a.nome}" mudou de ${dataCurta(m.anterior)} para ${dataCurta(m.novo)}.`)
      } else if (m.campo === 'quantidadeRealizada' && ant !== null && nov !== null) {
        frases.push(`"${a.nome}": progresso foi de ${ant} para ${nov}.`)
      } else if (m.campo === 'quantidadeExigida' && ant !== null && nov !== null) {
        frases.push(`"${a.nome}": a exigência mudou de ${ant} para ${nov}.`)
      } else if (m.campo === 'requisitos') {
        frases.push(`"${a.nome}": as regras da missão mudaram — confira os requisitos.`)
      }
    }
    if (a.reapareceu) frases.push(`"${a.nome}" voltou a aparecer no TikTok Shop.`)
  }
  for (const a of acoes) {
    if (a.tipo === 'AUSENTE') frases.push(`"${a.nome}" não veio nesta leitura. Não apaguei: espero a próxima para confirmar.`)
    if (a.tipo === 'ENCERRAR') frases.push(`"${a.nome}" não aparece há ${a.ausencias} leituras seguidas: marquei como encerrada (o histórico fica guardado).`)
  }

  const analises = analisarMetas(metasAtivasDepois, agora).filter((x) => x.situacao === 'EM_ANDAMENTO' || x.situacao === 'NAO_INICIADA')
  const urgente = [...analises].sort((x, y) => y.pressao - x.pressao || x.diasRestantes - y.diasRestantes)[0]
  if (urgente) {
    const r = ROTULO_DO_TIPO[urgente.tipo]
    const prazo = urgente.diasRestantes === 1 ? 'resta 1 dia' : `restam ${urgente.diasRestantes} dias`
    frases.push(`Mais urgente: "${urgente.nome}" — faltam ${urgente.faltam} ${r.unidade} e ${prazo}.${urgente.hojeRecomendado ? ` Hoje: ${r.acao} ${urgente.hojeRecomendado}.` : ''}`)
    if (urgente.risco === 'ALTO') frases.push('Risco alto de perder a recompensa nesse ritmo.')
  }
  if (!acoes.some((a) => a.tipo !== 'INALTERADA') && acoes.length) frases.unshift('Nada mudou desde a última leitura.')
  return frases
}

// ── Banco ───────────────────────────────────────────────────────────────

export interface ResultadoDaSincronizacao {
  id: string
  status: 'OK' | 'SEM_FONTE' | 'EXIGE_TITULAR' | 'ERRO'
  fonte: FonteDeMissoes | 'NENHUMA'
  criadas: number
  atualizadas: number
  inalteradas: number
  ausentes: number
  encerradas: number
  mensagem: string | null
  reacao: string[]
}

const SELECAO = {
  id: true, chaveExterna: true, status: true, ausenciasSeguidas: true, fonteSincronizacao: true, campanha: true, nome: true, tipo: true, inicio: true, fim: true,
  recompensaValor: true, recompensaCampanha: true, recompensaDescricao: true, quantidadeExigida: true, quantidadeRealizada: true, requisitos: true,
} as const

function dadosDaMissao(m: MissaoDaFonte) {
  return {
    campanha: m.campanha, nome: m.nome.trim(), tipo: m.tipo, inicio: m.inicio, fim: m.fim, recompensaValor: m.recompensaValor, recompensaCampanha: m.recompensaCampanha,
    recompensaDescricao: m.recompensaDescricao, quantidadeExigida: m.quantidadeExigida, quantidadeRealizada: m.quantidadeRealizada, requisitos: m.requisitos,
  }
}

/**
 * Aplica uma leitura (de qualquer fonte) — numa transação, com trava por
 * workspace (duas sincronizações ao mesmo tempo não duplicam nada).
 */
export async function aplicarLeitura(p: {
  workspaceId: string
  userId: string | null
  gatilho: 'MANUAL' | 'AGENDADA'
  fonte: FonteDeMissoes
  missoes: MissaoDaFonte[]
  escopo: Escopo
  agora?: Date
}): Promise<ResultadoDaSincronizacao> {
  const agora = p.agora ?? new Date()
  if (!p.missoes.length) throw new ErroDeMeta(400, 'A leitura não trouxe nenhuma missão.')
  if (p.missoes.length > 50) throw new ErroDeMeta(400, 'Muitas missões de uma vez (máximo 50).')
  for (const [i, m] of p.missoes.entries()) {
    if (!(TIPOS_DE_META as readonly string[]).includes(m.tipo)) throw new ErroDeMeta(400, `Missão ${i + 1}: tipo inválido.`)
    const erro = validarDadosDaMeta(m)
    if (erro) throw new ErroDeMeta(400, `Missão ${i + 1} ("${m.nome}"): ${erro}`)
  }
  const origemDaCriacao = p.fonte === 'TEXTO_REVISADO' ? 'IMPORTADA_REVISADA' : p.fonte

  const { sincronizacao, acoes } = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'metas-tiktok:' + p.workspaceId}))`
      const existentes = (await tx.metaTikTokShop.findMany({ where: { workspaceId: p.workspaceId }, select: SELECAO })) as MetaExistente[]
      const acoes = planejarSincronizacao({ existentes, recebidas: p.missoes, escopo: p.escopo })
      const s = await tx.sincronizacaoMetasTikTok.create({
        data: { workspaceId: p.workspaceId, fonte: p.fonte, gatilho: p.gatilho, status: 'OK', userId: p.userId, iniciadaEm: agora },
        select: { id: true },
      })
      const historico: { metaId: string; campo: string; valorAnterior: string | null; valorNovo: string | null }[] = []
      const marcaDeSync = { fonteSincronizacao: p.fonte, ultimaSincronizacaoEm: agora, ausenteDesde: null, ausenciasSeguidas: 0 }
      for (const a of acoes) {
        if (a.tipo === 'CRIAR') {
          const nova = await tx.metaTikTokShop.create({
            data: { ...dadosDaMissao(a.missao), workspaceId: p.workspaceId, criadoPorUserId: p.userId, origem: origemDaCriacao, chaveExterna: a.missao.chave, ...marcaDeSync },
            select: { id: true },
          })
          historico.push({ metaId: nova.id, campo: 'CRIADA', valorAnterior: null, valorNovo: a.missao.nome })
        } else if (a.tipo === 'ATUALIZAR') {
          await tx.metaTikTokShop.update({ where: { id: a.metaId }, data: { ...dadosDaMissao(a.missao), chaveExterna: a.missao.chave, status: 'ATIVA', ...marcaDeSync } })
          for (const m of a.mudancas) historico.push({ metaId: a.metaId, campo: m.campo, valorAnterior: m.anterior, valorNovo: m.novo })
          if (a.adotada) historico.push({ metaId: a.metaId, campo: 'VINCULADA_A_FONTE', valorAnterior: null, valorNovo: p.fonte })
          if (a.reapareceu) historico.push({ metaId: a.metaId, campo: 'REAPARECEU', valorAnterior: null, valorNovo: null })
        } else if (a.tipo === 'INALTERADA') {
          await tx.metaTikTokShop.update({ where: { id: a.metaId }, data: { status: 'ATIVA', ...marcaDeSync } })
          if (a.reapareceu) historico.push({ metaId: a.metaId, campo: 'REAPARECEU', valorAnterior: null, valorNovo: null })
        } else if (a.tipo === 'AUSENTE') {
          await tx.metaTikTokShop.update({ where: { id: a.metaId }, data: { ausenciasSeguidas: a.ausencias, ausenteDesde: a.ausencias === 1 ? agora : undefined } })
          historico.push({ metaId: a.metaId, campo: 'AUSENTE', valorAnterior: String(a.ausencias - 1), valorNovo: String(a.ausencias) })
        } else if (a.tipo === 'ENCERRAR') {
          await tx.metaTikTokShop.update({ where: { id: a.metaId }, data: { ausenciasSeguidas: a.ausencias, status: 'ENCERRADA' } })
          historico.push({ metaId: a.metaId, campo: 'ENCERRADA', valorAnterior: 'ATIVA', valorNovo: 'ENCERRADA' })
        }
      }
      if (historico.length) {
        await tx.alteracaoMetaTikTok.createMany({ data: historico.map((h) => ({ ...h, workspaceId: p.workspaceId, sincronizacaoId: s.id, origem: p.fonte })) })
      }
      return { sincronizacao: s, acoes }
    },
    { timeout: 30_000, maxWait: 10_000 }
  )

  const ativas = await prisma.metaTikTokShop.findMany({ where: { workspaceId: p.workspaceId, status: 'ATIVA' } })
  const reacao = reagir(acoes, ativas, agora)
  const conta = (t: Acao['tipo']) => acoes.filter((a) => a.tipo === t).length
  const resultado = {
    criadas: conta('CRIAR'), atualizadas: conta('ATUALIZAR'), inalteradas: conta('INALTERADA') + conta('ARQUIVADA_PELA_TITULAR'), ausentes: conta('AUSENTE'), encerradas: conta('ENCERRAR'),
  }
  await prisma.sincronizacaoMetasTikTok.update({ where: { id: sincronizacao.id }, data: { ...resultado, reacao, concluidaEm: new Date() } })
  await registrarAuditoria({
    workspaceId: p.workspaceId, userId: p.userId ?? undefined, action: 'tiktok.metas_sincronizadas', entityType: 'SincronizacaoMetasTikTok', entityId: sincronizacao.id,
    metadata: { fonte: p.fonte, gatilho: p.gatilho, ...resultado },
  })
  return { id: sincronizacao.id, status: 'OK', fonte: p.fonte, ...resultado, mensagem: null, reacao }
}

/**
 * "Sincronizar metas agora" (e a rotina diária): tenta a melhor fonte
 * AUTOMÁTICA. Sem fonte disponível, registra a tentativa e diz por quê —
 * nunca finge sucesso, nunca inventa missão.
 */
export async function sincronizarAgora(p: { workspaceId: string; userId: string | null; gatilho: 'MANUAL' | 'AGENDADA' }): Promise<ResultadoDaSincronizacao> {
  const estado = melhorFonteAutomatica()
  if (!estado.disponivel) {
    const status = estado.status === 'EXIGE_TITULAR' ? 'EXIGE_TITULAR' : 'SEM_FONTE'
    const s = await prisma.sincronizacaoMetasTikTok.create({
      data: { workspaceId: p.workspaceId, fonte: 'NENHUMA', gatilho: p.gatilho, status, mensagem: estado.motivo, userId: p.userId, concluidaEm: new Date() },
      select: { id: true },
    })
    return { id: s.id, status, fonte: 'NENHUMA', criadas: 0, atualizadas: 0, inalteradas: 0, ausentes: 0, encerradas: 0, mensagem: estado.motivo, reacao: [] }
  }
  // Leitor da fonte automática: entra aqui quando existir (ver fonte-missoes-tiktok.ts).
  throw new Error('Fonte automática marcada como disponível sem leitor implementado.')
}

export async function estadoDaSincronizacao(workspaceId: string) {
  const [ultima, ultimaComDados, alteracoes] = await Promise.all([
    prisma.sincronizacaoMetasTikTok.findFirst({ where: { workspaceId }, orderBy: { iniciadaEm: 'desc' } }),
    prisma.sincronizacaoMetasTikTok.findFirst({ where: { workspaceId, status: 'OK' }, orderBy: { iniciadaEm: 'desc' } }),
    prisma.alteracaoMetaTikTok.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 15 }),
  ])
  const ids = [...new Set(alteracoes.map((a) => a.metaId))]
  const nomes = new Map(
    (await prisma.metaTikTokShop.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, nome: true } })).map((m) => [m.id, m.nome])
  )
  return { ultima, ultimaComDados, alteracoes: alteracoes.map((a) => ({ ...a, nomeDaMeta: nomes.get(a.metaId) ?? null })) }
}
