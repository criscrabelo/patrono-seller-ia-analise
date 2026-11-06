/**
 * P2.20 (parte 2) — camada com banco do motor de restrições: estado da conta, contador diário de quota,
 * versões das regras (evento PLATFORM_RULE_UPDATED) e recálculo. A DECISÃO é sempre de
 * `avaliarPermissaoDaAcao` (lib/permissao-da-acao.ts); aqui só se lê/grava o que ela precisa.
 *
 * Contador: dia de Brasília; checagem do limite + incremento sob trava da transação (duas ações
 * simultâneas não estouram a quota); o programa em que a ação foi contada fica registrado, mas o limite
 * é comparado com o total do dia; idempotente por ação; liberado se a ação falhar.
 * Recálculo: não altera nenhuma ação já executada (só lê; o resultado fica no evento).
 */
import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { registrarEvento } from '@/lib/ledger'
import { registrarAuditoria } from '@/lib/audit-log'
import { CATALOGO_DE_REGRAS, diaNoBrasil, type RegraDePlataforma } from '@/lib/regras-de-plataforma'
import {
  avaliarPermissaoDaAcao, chaveDoContador, ELEGIBILIDADES, ORIGENS, PARTICIPACOES, REGRAS_POR_ACAO, STATUS_DA_CONTA, tipoDaPublicacao,
  type EstadoDaConta, type PermissaoDaAcao, type TipoDeAcao,
} from '@/lib/permissao-da-acao'

export class ErroDeCota extends Error {
  constructor(public status: number, message: string) { super(message) }
}

// ── Regras efetivas (catálogo + versões) ────────────────────────────────

const hashDaRegra = (r: RegraDePlataforma) => createHash('sha256').update(JSON.stringify(r, Object.keys(r).sort())).digest('hex').slice(0, 16)

/**
 * Regras que valem para o workspace (SÓ LEITURA): o catálogo do código, exceto onde a última versão gravada
 * veio da titular (TITULAR). Versão de origem CATALOGO é só histórico: o código é a fonte, então uma mudança no
 * catálogo vale assim que o deploy sobe, sem precisar gravar nada ao ler (P2.31.1).
 */
export async function regrasEfetivas(workspaceId: string): Promise<RegraDePlataforma[]> {
  const versoes = await prisma.versaoDeRegraDePlataforma.findMany({ where: { workspaceId }, orderBy: { versao: 'desc' } })
  const ultima = new Map<string, RegraDePlataforma>()
  const daTitular = new Set<string>()
  for (const v of versoes) if (!ultima.has(v.regraId)) { ultima.set(v.regraId, v.dados as unknown as RegraDePlataforma); if (v.origem !== 'CATALOGO') daTitular.add(v.regraId) }
  const doCatalogo = CATALOGO_DE_REGRAS.map((r) => (daTitular.has(r.id) ? ultima.get(r.id)! : r))
  const extras = [...ultima.values()].filter((r) => !CATALOGO_DE_REGRAS.some((c) => c.id === r.id))
  return [...doCatalogo, ...extras]
}

/**
 * Grava uma nova versão da regra. Se ela já existia com outro conteúdo, é uma ATUALIZAÇÃO: gera
 * PLATFORM_RULE_UPDATED (antes/depois) e recalcula bloqueios, quotas, avisos, agenda e pendentes.
 */
export async function atualizarRegraDePlataforma(p: { workspaceId: string; regra: RegraDePlataforma; origem: 'CATALOGO' | 'TITULAR'; userId?: string | null; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const hash = hashDaRegra(p.regra)
  const anterior = await prisma.versaoDeRegraDePlataforma.findFirst({ where: { workspaceId: p.workspaceId, regraId: p.regra.id }, orderBy: { versao: 'desc' } })
  if (anterior?.hash === hash) return { mudou: false as const, versao: anterior.versao }
  const versao = (anterior?.versao ?? 0) + 1
  try {
    await prisma.versaoDeRegraDePlataforma.create({ data: { workspaceId: p.workspaceId, regraId: p.regra.id, versao, dados: p.regra as unknown as Prisma.InputJsonValue, hash, origem: p.origem } })
  } catch (e) {
    // Duas sincronizações ao mesmo tempo: a outra gravou esta versão.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { mudou: false as const, versao }
    throw e
  }
  if (!anterior) return { mudou: false as const, versao, registrada: true }
  const recalculo = await recalcularRestricoes(p.workspaceId, agora)
  await registrarEvento({
    workspaceId: p.workspaceId, tipo: 'PLATFORM_RULE_UPDATED', chaveIdempotencia: `regra-plataforma:${p.regra.id}:v${versao}`,
    entidadeTipo: 'RegraDePlataforma', entidadeId: p.regra.id,
    payload: { versao, origem: p.origem, antes: anterior.dados, depois: p.regra, recalculo } as unknown as Record<string, unknown>,
  })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId ?? null, action: 'plataforma.regra_atualizada', entityType: 'RegraDePlataforma', entityId: p.regra.id, metadata: { versao, origem: p.origem } })
  return { mudou: true as const, versao, recalculo }
}

/** SÓ LEITURA: regras do catálogo do código ainda não registradas (`nova`) ou diferentes da última versão de catálogo gravada (`mudou`). */
export async function regrasDoCatalogoPendentes(workspaceId: string): Promise<{ id: string; nova: boolean }[]> {
  const ultimasDoCatalogo = await prisma.versaoDeRegraDePlataforma.findMany({ where: { workspaceId, origem: 'CATALOGO' }, orderBy: { versao: 'desc' }, select: { regraId: true, hash: true } })
  const hashPor = new Map<string, string>()
  for (const v of ultimasDoCatalogo) if (!hashPor.has(v.regraId)) hashPor.set(v.regraId, v.hash)
  return CATALOGO_DE_REGRAS.filter((r) => hashPor.get(r.id) !== hashDaRegra(r)).map((r) => ({ id: r.id, nova: !hashPor.has(r.id) }))
}

/**
 * ESCRITA EXPLÍCITA: registra no histórico o catálogo do código (o que mudou vira versão nova + evento e
 * recálculo). Idempotente. Chamada só por rotina (reconciliação) ou ação da administradora — nunca ao montar
 * uma tela (P2.31.1: leitura não grava).
 */
export async function sincronizarRegrasDoCatalogo(workspaceId: string, agora = new Date()) {
  const mudaram: string[] = []
  const registradas: string[] = []
  for (const { id } of await regrasDoCatalogoPendentes(workspaceId)) {
    const r = CATALOGO_DE_REGRAS.find((x) => x.id === id)!
    const x = await atualizarRegraDePlataforma({ workspaceId, regra: r, origem: 'CATALOGO', agora })
    if (x.mudou) mudaram.push(r.id)
    else if ('registrada' in x && x.registrada) registradas.push(r.id)
  }
  return { mudaram, registradas }
}

// ── Estado da conta ─────────────────────────────────────────────────────

type LinhaDoEstado = Awaited<ReturnType<typeof prisma.estadoDaContaNaPlataforma.findMany>>[number]
const iso = (d: Date | null) => (d ? d.toISOString() : null)

function paraEstado(l: LinhaDoEstado): EstadoDaConta {
  return {
    plataforma: l.plataforma as EstadoDaConta['plataforma'], conta: l.conta, programa: l.programa, participacao: l.participacao as EstadoDaConta['participacao'],
    regiao: l.regiao as EstadoDaConta['regiao'], statusDaConta: l.statusDaConta as EstadoDaConta['statusDaConta'], elegibilidade: l.elegibilidade as EstadoDaConta['elegibilidade'],
    regraDaQuota: l.regraDaQuota, quotaDiaria: l.quotaDiaria, origem: l.origem as EstadoDaConta['origem'], dataDaFonte: iso(l.dataDaFonte), verificadaEm: iso(l.verificadaEm),
    confianca: l.confianca as EstadoDaConta['confianca'], observacoes: l.observacoes, revisarEm: iso(l.revisarEm), expiraEm: iso(l.expiraEm), atualizadoEm: iso(l.updatedAt),
  }
}

export async function lerEstadosDaConta(workspaceId: string): Promise<EstadoDaConta[]> {
  return (await prisma.estadoDaContaNaPlataforma.findMany({ where: { workspaceId }, orderBy: { programa: 'asc' } })).map(paraEstado)
}

export interface NovoEstadoDaConta {
  plataforma: string; programa: string; conta?: string; participacao?: string; regiao?: string; statusDaConta?: string; elegibilidade?: string
  regraDaQuota?: string | null; quotaDiaria?: number | null; origem?: string; dataDaFonte?: string | null; confianca?: string; observacoes?: string | null
  revisarEm?: string | null; expiraEm?: string | null
}

const umDe = <T extends string>(v: string | undefined, lista: readonly T[], campo: string): T => {
  const x = (v ?? 'UNKNOWN') as T
  if (!lista.includes(x)) throw new ErroDeCota(400, `${campo} inválido: "${v}". Use ${lista.join(', ')}.`)
  return x
}
const data = (v: string | null | undefined, campo: string) => {
  if (!v) return null
  const d = new Date(v.length === 10 ? `${v}T12:00:00-03:00` : v)
  if (Number.isNaN(d.getTime())) throw new ErroDeCota(400, `${campo} inválida.`)
  return d
}

/**
 * A titular registra o que viu (ex.: no app). Não inventa: o que não foi informado fica UNKNOWN/null.
 * Quota só vale com origem conhecida e participação PARTICIPA. Cada mudança vai para o histórico,
 * gera PLATFORM_ACCOUNT_STATE_UPDATED e recalcula.
 */
export async function salvarEstadoDaConta(p: { workspaceId: string; userId: string | null; dados: NovoEstadoDaConta; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const d = p.dados
  if (!['TIKTOK', 'TIKTOK_SHOP'].includes(d.plataforma)) throw new ErroDeCota(400, 'Plataforma inválida (TIKTOK ou TIKTOK_SHOP).')
  if (!d.programa || !/^[A-Z0-9_]{2,60}$/.test(d.programa)) throw new ErroDeCota(400, 'Programa inválido (código em MAIÚSCULAS, ex.: PROGRAMA_PILOTO_VIDEOS_COMPRAVEIS).')
  const origem = umDe(d.origem, ORIGENS, 'Origem')
  const quota = d.quotaDiaria == null ? null : Number(d.quotaDiaria)
  if (quota != null && (!Number.isInteger(quota) || quota < 1 || quota > 1000)) throw new ErroDeCota(400, 'Quota diária: número inteiro de 1 a 1000 (deixe vazio se não souber — vazio é UNKNOWN, não 0).')
  if (quota != null && origem === 'UNKNOWN') throw new ErroDeCota(400, 'Diga de onde veio a quota (tela do app, fonte oficial ou suporte): sem origem ela não pode valer.')
  if (quota != null && !d.regraDaQuota) throw new ErroDeCota(400, 'Diga a que regra a quota se refere (ex.: VIDEOS_COMPRAVEIS_POR_DIA).')
  const valores = {
    conta: d.conta?.trim() || 'UNKNOWN',
    participacao: umDe(d.participacao, PARTICIPACOES, 'Participação'),
    regiao: umDe(d.regiao, ['BR', 'GLOBAL', 'UNKNOWN'] as const, 'Região'),
    statusDaConta: umDe(d.statusDaConta, STATUS_DA_CONTA, 'Status da conta'),
    elegibilidade: umDe(d.elegibilidade, ELEGIBILIDADES, 'Elegibilidade'),
    regraDaQuota: d.regraDaQuota || null, quotaDiaria: quota, origem,
    dataDaFonte: data(d.dataDaFonte, 'Data da fonte'),
    verificadaEm: origem === 'UNKNOWN' ? null : agora,
    confianca: umDe(d.confianca ?? (origem === 'UNKNOWN' ? 'BAIXA' : 'ALTA'), ['ALTA', 'MEDIA', 'BAIXA'] as const, 'Confiança'),
    observacoes: d.observacoes?.trim() || null,
    revisarEm: data(d.revisarEm, 'Revisar em'), expiraEm: data(d.expiraEm, 'Expira em'),
  }
  const onde = { workspaceId_plataforma_programa: { workspaceId: p.workspaceId, plataforma: d.plataforma, programa: d.programa } }
  const antes = await prisma.estadoDaContaNaPlataforma.findUnique({ where: onde })
  const historico = [...((antes?.historico as unknown as unknown[]) ?? []), { em: agora.toISOString(), por: p.userId, antes: antes ? paraEstado(antes) : null }]
  const salvo = await prisma.estadoDaContaNaPlataforma.upsert({
    where: onde,
    create: { workspaceId: p.workspaceId, plataforma: d.plataforma, programa: d.programa, ...valores, historico: historico as unknown as Prisma.InputJsonValue },
    update: { ...valores, historico: historico as unknown as Prisma.InputJsonValue },
  })
  const recalculo = await recalcularRestricoes(p.workspaceId, agora)
  await registrarEvento({
    workspaceId: p.workspaceId, tipo: 'PLATFORM_ACCOUNT_STATE_UPDATED', chaveIdempotencia: `estado-conta:${salvo.id}:${agora.getTime()}`,
    entidadeTipo: 'EstadoDaContaNaPlataforma', entidadeId: salvo.id,
    payload: { programa: d.programa, antes: antes ? paraEstado(antes) : null, depois: paraEstado(salvo), recalculo } as unknown as Record<string, unknown>,
  })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId, action: 'plataforma.estado_da_conta', entityType: 'EstadoDaContaNaPlataforma', entityId: salvo.id, metadata: { programa: d.programa, participacao: valores.participacao, quotaDiaria: quota, origem } })
  return { estado: paraEstado(salvo), recalculo }
}

// ── Contador diário ─────────────────────────────────────────────────────

/** Uso por `${regra}|${programa}` no dia de Brasília (só ações RESERVADAS/CONFIRMADAS; liberadas não contam). */
export async function usoDoDia(workspaceId: string, dia: string): Promise<Record<string, number>> {
  const linhas = await prisma.contadorDeCotaDiaria.findMany({ where: { workspaceId, dia }, select: { regra: true, programa: true, usado: true } })
  return Object.fromEntries(linhas.map((l) => [chaveDoContador(l.regra, l.programa), l.usado]))
}

export async function contextoDasRestricoes(workspaceId: string, agora: Date) {
  const [regras, estados, usadoHoje] = await Promise.all([regrasEfetivas(workspaceId), lerEstadosDaConta(workspaceId), usoDoDia(workspaceId, diaNoBrasil(agora))])
  return { regras, estados, usadoHoje }
}

/** Permissão AGORA (leitura; não reserva). */
export async function permissaoDaAcao(workspaceId: string, acao: TipoDeAcao, agora = new Date()): Promise<PermissaoDaAcao> {
  return avaliarPermissaoDaAcao({ acao, agora, ...(await contextoDasRestricoes(workspaceId, agora)) })
}

/**
 * Reserva a quota de uma ação ANTES de executá-la. BLOQUEADA → não reserva (e quem chamou não executa).
 * Atômico: o incremento só acontece se `usado < limite` (com limite confirmado); sem limite confirmado,
 * só conta. Idempotente por `acaoId` (repetir não conta duas vezes).
 * `jaExecutada` (ex.: a titular publicou no app): registra o fato mesmo acima do limite — não bloqueia o passado.
 */
export async function reservarCota(p: { workspaceId: string; acao: TipoDeAcao; acaoId: string; agora?: Date; jaExecutada?: boolean }): Promise<PermissaoDaAcao & { reservou: boolean }> {
  const agora = p.agora ?? new Date()
  const permissao = await permissaoDaAcao(p.workspaceId, p.acao, agora)
  const exigidas = REGRAS_POR_ACAO[p.acao]
  if (!exigidas.length) return { ...permissao, reservou: false }
  if (permissao.resultado === 'BLOQUEADA' && !p.jaExecutada) {
    await registrarBloqueio(p.workspaceId, p.acaoId, permissao)
    return { ...permissao, reservou: false }
  }
  const dia = diaNoBrasil(agora)
  for (const { plataforma, regra } of exigidas) {
    const programa = permissao.regra === regra ? permissao.programaDoContador : 'PLATAFORMA'
    const limite = p.jaExecutada || permissao.regra !== regra ? null : permissao.limite
    const ok = await prisma.$transaction(async (tx) => {
      const existente = await tx.consumoDeCota.findUnique({ where: { workspaceId_regra_acaoId: { workspaceId: p.workspaceId, regra, acaoId: p.acaoId } } })
      if (existente && existente.estado !== 'LIBERADA') return true
      // Trava por (workspace, regra, dia) até o fim da transação: a checagem do limite e o incremento são uma coisa só.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`quota:${p.workspaceId}:${regra}:${dia}`}))::text AS ok`
      // O limite é comparado com o TOTAL do dia (os mesmos vídeos, qualquer que seja o programa em que foram contados).
      const [{ total }] = await tx.$queryRaw<{ total: number }[]>`SELECT COALESCE(SUM("usado"), 0)::int AS total FROM "ContadorDeCotaDiaria"
        WHERE "workspaceId" = ${p.workspaceId} AND "plataforma" = ${plataforma} AND "regra" = ${regra} AND "dia" = ${dia}`
      if (limite != null && total >= limite) return false
      await tx.$executeRaw`INSERT INTO "ContadorDeCotaDiaria" ("id", "workspaceId", "plataforma", "regra", "programa", "dia", "usado", "updatedAt")
        VALUES (${randomUUID()}, ${p.workspaceId}, ${plataforma}, ${regra}, ${programa}, ${dia}, 1, now())
        ON CONFLICT ("workspaceId", "plataforma", "regra", "programa", "dia") DO UPDATE SET "usado" = "ContadorDeCotaDiaria"."usado" + 1, "updatedAt" = now()`
      if (existente) await tx.consumoDeCota.update({ where: { id: existente.id }, data: { estado: p.jaExecutada ? 'CONFIRMADA' : 'RESERVADA', dia, programa, limiteNaHora: permissao.limite } })
      else await tx.consumoDeCota.create({ data: { workspaceId: p.workspaceId, plataforma, regra, programa, dia, acaoId: p.acaoId, estado: p.jaExecutada ? 'CONFIRMADA' : 'RESERVADA', limiteNaHora: permissao.limite } })
      return true
    })
    if (!ok) {
      // Outra ação levou a última vaga no mesmo instante.
      const depois = await permissaoDaAcao(p.workspaceId, p.acao, agora)
      const bloqueada = depois.resultado === 'BLOQUEADA' ? depois : { ...depois, resultado: 'BLOQUEADA' as const, motivo: `Ação indisponível: quota oficial atingida (${permissao.limite}/${permissao.limite} hoje — ${permissao.fonte}).` }
      await registrarBloqueio(p.workspaceId, p.acaoId, bloqueada)
      return { ...bloqueada, reservou: false }
    }
  }
  const atual = await permissaoDaAcao(p.workspaceId, p.acao, agora)
  return { ...permissao, usadoHoje: atual.usadoHoje, quotaRestante: permissao.limite != null ? Math.max(0, permissao.limite - atual.usadoHoje) : null, reservou: true }
}

async function registrarBloqueio(workspaceId: string, acaoId: string, p: PermissaoDaAcao) {
  await registrarEvento({ workspaceId, tipo: 'PLATFORM_QUOTA_BLOCKED', chaveIdempotencia: `quota-bloqueada:${acaoId}:${p.dia}`, entidadeTipo: 'Acao', entidadeId: acaoId, payload: { motivo: p.motivo, regra: p.regra, limite: p.limite, usado: p.usadoHoje, fonte: p.fonte } })
}

/** A ação não aconteceu (falhou antes de chegar à plataforma): devolve a vaga. Idempotente. */
export async function liberarCota(p: { workspaceId: string; acaoId: string }) {
  const consumos = await prisma.consumoDeCota.findMany({ where: { workspaceId: p.workspaceId, acaoId: p.acaoId, estado: 'RESERVADA' } })
  for (const c of consumos) {
    await prisma.$transaction(async (tx) => {
      const n = await tx.consumoDeCota.updateMany({ where: { id: c.id, estado: 'RESERVADA' }, data: { estado: 'LIBERADA' } })
      if (n.count !== 1) return
      await tx.$executeRaw`UPDATE "ContadorDeCotaDiaria" SET "usado" = GREATEST("usado" - 1, 0), "updatedAt" = now()
        WHERE "workspaceId" = ${p.workspaceId} AND "plataforma" = ${c.plataforma} AND "regra" = ${c.regra} AND "programa" = ${c.programa} AND "dia" = ${c.dia}`
    })
  }
}

/** A ação foi executada: a reserva vira consumo confirmado (não é mais liberável). */
export async function confirmarCota(p: { workspaceId: string; acaoId: string }) {
  await prisma.consumoDeCota.updateMany({ where: { workspaceId: p.workspaceId, acaoId: p.acaoId, estado: 'RESERVADA' }, data: { estado: 'CONFIRMADA' } })
}

// ── Recálculo (depois de mudança de regra ou de estado da conta) ────────

const PENDENTES = ['GERANDO', 'PRONTO', 'AGUARDANDO_MIDIA', 'VIDEO_NA_FILA', 'GERANDO_VIDEO', 'AGUARDANDO_APROVACAO', 'APROVADO', 'AJUSTE_PEDIDO', 'FALHOU']

/**
 * Recalcula bloqueios, quotas, avisos, agenda futura e ações pendentes afetadas. Só LÊ: nenhuma ação já
 * executada (PUBLICANDO/PUBLICADO) é tocada, e nenhuma pendente é alterada — elas consultam o motor na hora de agir.
 */
export async function recalcularRestricoes(workspaceId: string, agora = new Date()) {
  const ctx = await contextoDasRestricoes(workspaceId, agora)
  const hoje = avaliarPermissaoDaAcao({ acao: 'PUBLICAR_VIDEO_PROMOCIONAL', agora, ...ctx })
  const pendentes = await prisma.publicacaoAssistida.findMany({
    where: { workspaceId, demonstracao: false, estado: { in: PENDENTES } },
    select: { id: true, estado: true, candidatoId: true, produtoId: true, horarioPlanejado: true, nomeProduto: true },
  })
  const afetadas = pendentes.filter((a) => tipoDaPublicacao(a) === 'PUBLICAR_VIDEO_PROMOCIONAL')
    .map((a) => {
      const quando = a.horarioPlanejado && a.horarioPlanejado > agora ? a.horarioPlanejado : agora
      const naHora = diaNoBrasil(quando) === hoje.dia ? hoje : avaliarPermissaoDaAcao({ acao: 'PUBLICAR_VIDEO_PROMOCIONAL', agora: quando, ...ctx, usadoHoje: {} })
      return { id: a.id, produto: a.nomeProduto, estado: a.estado, dia: diaNoBrasil(quando), resultado: naHora.resultado, motivo: naHora.motivo }
    })
  // Agenda futura: quantas promocionais planejadas por dia × limite confirmado daquele dia.
  const porDia = new Map<string, number>()
  for (const a of afetadas) if (a.dia > hoje.dia) porDia.set(a.dia, (porDia.get(a.dia) ?? 0) + 1)
  const agenda = [...porDia.entries()].sort().map(([dia, planejadas]) => {
    const p = avaliarPermissaoDaAcao({ acao: 'PUBLICAR_VIDEO_PROMOCIONAL', agora: new Date(`${dia}T12:00:00-03:00`), ...ctx, usadoHoje: {} })
    return { dia, planejadas, limite: p.limite, excede: p.limite != null && planejadas > p.limite }
  })
  return {
    em: agora.toISOString(),
    hoje: { resultado: hoje.resultado, motivo: hoje.motivo, limite: hoje.limite, usado: hoje.usadoHoje, restante: hoje.quotaRestante },
    pendentes: afetadas, agenda, avisos: hoje.avisos,
  }
}

/** Para a Operação: a permissão de publicar promocional agora. SÓ LEITURA (o catálogo é registrado pela reconciliação). */
export async function restricoesParaOperacao(workspaceId: string, agora = new Date()) {
  return permissaoDaAcao(workspaceId, 'PUBLICAR_VIDEO_PROMOCIONAL', agora)
}
