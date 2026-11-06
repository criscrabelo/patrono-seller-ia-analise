/**
 * P2.28 — RECONCILIAÇÃO OPERACIONAL: `reconciliarEstadoOperacional(workspaceId)`.
 *
 * Primeiro DETECTA (sem destruir histórico). Depois corrige SOZINHO só o que é determinístico e seguro; o que
 * envolve ambiguidade, risco de duplicação, ação externa ou decisão de negócio vira "Precisa de você"; o que é
 * só técnico fica para a administração (health check). Nada é republicado, reenviado ou apagado.
 *
 * Não cria sistema paralelo de status: usa os estados que já existem (assistida, Publicacao, Commission +
 * HistoricoDeComissao, DomainEvent, AutomationJob, ConsumoDeCota, ImportacaoCreatorCenter) e registra cada
 * rodada em ExecucaoDoProcessador (tipo RECONCILIACAO) e cada correção na auditoria.
 *
 * Concorrência: uma rodada por workspace de cada vez (advisory lock + rodada aberta). Mesmo assim, toda
 * correção é condicionada ao estado lido (updateMany com o estado no WHERE): duas rodadas não corrigem duas vezes.
 */
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { log } from './observabilidade'
import { registrarAuditoria } from './audit-log'
import { retratoDaComissao } from './financeiro'

const MIN = 60_000
/** Sem confirmação do TikTok e sem referência do envio há mais que isto: incerto. */
export const PUBLICANDO_SEM_REFERENCIA_MIN = 30
/** Com referência do envio (publishId), esperando a confirmação há mais que isto: incerto. */
export const PUBLICANDO_COM_REFERENCIA_MIN = 6 * 60
export const IMPORTACAO_ABANDONADA_MIN = 10
export const EVENTO_PRESO_MIN = 10
export const COTA_RESERVADA_ORFA_MIN = 60
export const TRABALHO_ABANDONADO_MIN = 30
const RODADA_ABERTA_MS = 5 * MIN

export type TipoDeAchado =
  | 'PUBLICACAO_PRESA' | 'PUBLICACAO_INCERTA' | 'PUBLICACAO_NAO_ENVIADA' | 'PUBLICACAO_CONFIRMADA_NAO_FECHADA'
  | 'EVENTO_PRESO' | 'EVENTO_FALHOU' | 'COMISSAO_INCONSISTENTE' | 'JORNADA_ORFA' | 'PRODUTO_ARQUIVADO_ATIVO'
  | 'IMPORTACAO_INCOMPLETA' | 'IMPORTACAO_COM_ALERTAS' | 'AMOSTRA_IMPOSSIVEL' | 'FILA_SEM_ENTIDADE'
  | 'COTA_RESERVADA_ORFA' | 'CONTADOR_DIVERGENTE' | 'TRABALHO_LONGO_ABANDONADO' | 'RENDER_INTERROMPIDO'
  | 'PRODUTO_EXCLUIDO_AINDA_VIVO' | 'REGRA_DO_CATALOGO_ATUALIZADA'

/** CORRIGIDO = o Patrono resolveu sozinho; PRECISA_DE_VOCE = vai para a central; ADMIN = técnico (health check). */
export type Desfecho = 'CORRIGIDO' | 'PRECISA_DE_VOCE' | 'ADMIN'

export interface Achado {
  /** Estável: o mesmo problema tem a mesma chave em rodadas diferentes. */
  chave: string
  tipo: TipoDeAchado
  gravidade: 'ALTA' | 'MEDIA' | 'BAIXA'
  desfecho: Desfecho
  /** Acionável: o que é, há quanto tempo, e o que fazer. */
  texto: string
  entidade: { tipo: string; id: string }
  correcao?: string
  acao?: { rotulo: string; link: string }
}

export interface ResultadoDaReconciliacao {
  execucaoId: string | null
  emAndamento: boolean
  achados: Achado[]
  corrigidos: number
  paraVoce: number
  admin: number
}

const minutos = (desde: Date, agora: Date) => Math.max(0, Math.round((agora.getTime() - desde.getTime()) / MIN))
const haQuanto = (m: number) => (m < 120 ? `há ${m} minuto${m === 1 ? '' : 's'}` : m < 48 * 60 ? `há ${Math.round(m / 60)} horas` : `há ${Math.round(m / 1440)} dias`)

// ── detectores (+ correção segura) ─────────────────────────────────────────────────────────────

async function publicacoesPresas(ws: string, agora: Date, corrigir: boolean): Promise<Achado[]> {
  const out: Achado[] = []
  const presas = await prisma.publicacaoAssistida.findMany({ where: { workspaceId: ws, demonstracao: false, estado: 'PUBLICANDO', updatedAt: { lt: new Date(agora.getTime() - PUBLICANDO_SEM_REFERENCIA_MIN * MIN) } } })
  for (const a of presas) {
    // Uma publicação com registro ruim não impede as outras de serem conferidas.
    try { out.push(...(await publicacaoPresa(ws, a, agora, corrigir))) } catch (e) {
      log('error', 'reconciliacao.publicacao_falhou', { workspaceId: ws, id: a.id, erro: String(e).slice(0, 300) })
      out.push({ chave: `pub-erro:${a.id}`, tipo: 'PUBLICACAO_PRESA', gravidade: 'MEDIA', desfecho: 'ADMIN', texto: `${a.nomeProduto}: não consegui conferir esta publicação (${String(e).slice(0, 120)}).`, entidade: { tipo: 'PublicacaoAssistida', id: a.id } })
    }
  }
  return out
}

async function publicacaoPresa(ws: string, a: Awaited<ReturnType<typeof prisma.publicacaoAssistida.findMany>>[number], agora: Date, corrigir: boolean): Promise<Achado[]> {
  const out: Achado[] = []
  {
    const m = minutos(a.updatedAt, agora)
    const pub = a.publicacaoId
      ? await prisma.publicacao.findFirst({ where: { id: a.publicacaoId, workspaceId: ws } })
      : await prisma.publicacao.findFirst({ where: { workspaceId: ws, chaveDaTentativa: { startsWith: `assistida:${a.id}:` } }, orderBy: { createdAt: 'desc' } })
    const base = { entidade: { tipo: 'PublicacaoAssistida', id: a.id } }
    // 1) A plataforma confirmou (Publicacao DISTRIBUIDA), mas o estado local não fechou → fecha (determinístico).
    if (pub?.estado === 'DISTRIBUIDA') {
      let correcao: string | undefined
      if (corrigir) {
        const { concluirPublicacaoAssistida } = await import('./publicacao-assistida')
        await concluirPublicacaoAssistida({ workspaceId: ws, id: a.id, postId: pub.publicacaoExternaId, url: null, modo: (a.modoDePublicacao as 'API_DIRETO' | 'API_RASCUNHO' | null) ?? 'API_DIRETO', agora })
        correcao = 'Publicação fechada como PUBLICADA (a plataforma já tinha confirmado).'
      }
      out.push({ ...base, chave: `pub-confirmada:${a.id}`, tipo: 'PUBLICACAO_CONFIRMADA_NAO_FECHADA', gravidade: 'MEDIA', desfecho: corrigir ? 'CORRIGIDO' : 'ADMIN', texto: `${a.nomeProduto}: o TikTok confirmou a publicação, mas o Patrono não tinha fechado o estado (${haQuanto(m)}).`, correcao })
      return out
    }
    // 2) Nada chegou a sair (sem Publicacao, ou ela ainda PREPARADA/FALHOU) → volta para APROVADO e devolve a vaga.
    if (!pub || pub.estado === 'PREPARADA' || pub.estado === 'FALHOU') {
      let correcao: string | undefined
      if (corrigir) {
        const n = await prisma.publicacaoAssistida.updateMany({ where: { id: a.id, workspaceId: ws, estado: 'PUBLICANDO', updatedAt: a.updatedAt }, data: { estado: 'APROVADO', bloqueio: 'O envio anterior foi interrompido antes de chegar ao TikTok. Nada foi publicado; pode tentar de novo.' } })
        if (n.count === 1) {
          const { liberarCota } = await import('./cotas-da-plataforma')
          await liberarCota({ workspaceId: ws, acaoId: `publicacaoAssistida:${a.id}` })
          correcao = 'Voltou para APROVADO (nada tinha sido enviado) e a vaga da quota foi devolvida.'
        }
      }
      out.push({ ...base, chave: `pub-nao-enviada:${a.id}`, tipo: 'PUBLICACAO_NAO_ENVIADA', gravidade: 'MEDIA', desfecho: corrigir ? 'CORRIGIDO' : 'ADMIN', texto: `${a.nomeProduto}: estava "publicando" ${haQuanto(m)}, mas nada chegou ao TikTok.`, correcao })
      return out
    }
    // 3) Envio feito, sem confirmação. Com referência, espera mais (o acompanhamento confirma); sem, é incerto.
    const limite = a.publishId ? PUBLICANDO_COM_REFERENCIA_MIN : PUBLICANDO_SEM_REFERENCIA_MIN
    if (m < limite) {
      out.push({ ...base, chave: `pub-presa:${a.id}`, tipo: 'PUBLICACAO_PRESA', gravidade: 'BAIXA', desfecho: 'ADMIN', texto: `${a.nomeProduto}: enviado ao TikTok ${haQuanto(m)}, aguardando a confirmação (referência ${a.publishId}).` })
      return out
    }
    const texto = `1 publicação está em estado incerto ${haQuanto(m)} (${a.nomeProduto}) — confirme se apareceu no TikTok antes de tentar novamente.`
    if (corrigir) {
      // Nunca republica: marca ENVIO INCERTO (a nova tentativa exige "conferi o perfil", P2.27) e consome a vaga.
      const n = await prisma.publicacaoAssistida.updateMany({ where: { id: a.id, workspaceId: ws, estado: 'PUBLICANDO', updatedAt: a.updatedAt }, data: { estado: 'FALHOU', erro: `ENVIO INCERTO — enviado ao TikTok ${haQuanto(m)} sem confirmação. Confira o seu perfil antes de tentar de novo.` } })
      if (n.count === 1) {
        const { confirmarCota } = await import('./cotas-da-plataforma')
        await confirmarCota({ workspaceId: ws, acaoId: `publicacaoAssistida:${a.id}` })
      }
    }
    out.push({ ...base, chave: `pub-incerta:${a.id}`, tipo: 'PUBLICACAO_INCERTA', gravidade: 'ALTA', desfecho: 'PRECISA_DE_VOCE', texto, acao: { rotulo: 'Conferir no TikTok', link: '/precisa-de-voce' } })
  }
  return out
}

async function comissoesInconsistentes(ws: string, corrigir: boolean): Promise<Achado[]> {
  // Linhas antigas: venda cancelada com a comissão ainda contando como confirmada/prevista (a régua canônica já
  // as trata como revertida/cancelada; aqui o status passa a dizer o mesmo, com o antes/depois no histórico).
  const cs = await prisma.commission.findMany({ where: { workspaceId: ws, status: { in: ['EXPECTED', 'CONFIRMED', 'RECEIVED'] }, sale: { status: 'CANCELLED' } } })
  const out: Achado[] = []
  for (const c of cs) {
    const novo = c.status === 'EXPECTED' ? 'CANCELLED' : 'REVERSED'
    let correcao: string | undefined
    if (corrigir) {
      const feito = await prisma.$transaction(async (tx) => {
        const n = await tx.commission.updateMany({ where: { id: c.id, status: c.status }, data: { status: novo } })
        if (n.count !== 1) return false
        const salvo = await tx.commission.findUniqueOrThrow({ where: { id: c.id } })
        await tx.historicoDeComissao.create({ data: { workspaceId: ws, commissionId: c.id, origem: 'RECONCILIACAO', anterior: retratoDaComissao(c), novo: retratoDaComissao(salvo), motivo: `venda cancelada; comissão ${c.status} → ${novo}` } })
        return true
      })
      if (feito) correcao = `Comissão ${c.status} → ${novo} (venda cancelada), com o antes/depois no histórico.`
    }
    out.push({ chave: `comissao:${c.id}`, tipo: 'COMISSAO_INCONSISTENTE', gravidade: 'MEDIA', desfecho: corrigir ? 'CORRIGIDO' : 'ADMIN', texto: `Comissão ligada a uma venda cancelada ainda constava como ${c.status}.`, entidade: { tipo: 'Commission', id: c.id }, correcao })
  }
  return out
}

async function eventos(ws: string, agora: Date): Promise<Achado[]> {
  const presos = await prisma.domainEvent.findMany({
    where: { workspaceId: ws, OR: [
      { estadoProcessamento: 'PROCESSANDO', processandoAte: { lt: new Date(agora.getTime() - EVENTO_PRESO_MIN * MIN) } },
      { estadoProcessamento: 'RETRY', proximaTentativaEm: { lt: new Date(agora.getTime() - 60 * MIN) } },
      { estadoProcessamento: 'FALHOU' },
    ] },
    select: { id: true, tipo: true, estadoProcessamento: true, ultimaTentativaEm: true, ocorridoEm: true, tentativas: true, erroProcessamento: true },
    take: 50,
  })
  return presos.map((e) => e.estadoProcessamento === 'FALHOU'
    ? { chave: `evento-falhou:${e.id}`, tipo: 'EVENTO_FALHOU' as const, gravidade: 'MEDIA' as const, desfecho: 'ADMIN' as const, texto: `Evento ${e.tipo} falhou ${e.tentativas} vez(es): ${(e.erroProcessamento ?? '').slice(0, 160)} — reprocessar em Administração › Eventos.`, entidade: { tipo: 'DomainEvent', id: e.id }, acao: { rotulo: 'Ver eventos', link: '/admin/eventos' } }
    : { chave: `evento-preso:${e.id}`, tipo: 'EVENTO_PRESO' as const, gravidade: 'BAIXA' as const, desfecho: 'ADMIN' as const, texto: `Evento ${e.tipo} está ${e.estadoProcessamento === 'RETRY' ? 'esperando nova tentativa' : 'em processamento'} ${haQuanto(minutos(e.ultimaTentativaEm ?? e.ocorridoEm, agora))} — o processador agendado está ligado?`, entidade: { tipo: 'DomainEvent', id: e.id }, acao: { rotulo: 'Ver eventos', link: '/admin/eventos' } })
}

async function importacoes(ws: string, agora: Date): Promise<Achado[]> {
  const out: Achado[] = []
  const abertas = await prisma.importacaoCreatorCenter.findMany({ where: { workspaceId: ws, concluida: false, importadoEm: { lt: new Date(agora.getTime() - IMPORTACAO_ABANDONADA_MIN * MIN) } }, select: { id: true, nomeArquivo: true, importadoEm: true, linhasTotal: true } })
  for (const i of abertas) {
    const gravadas = await prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId: ws, OR: [{ primeiraImportacaoId: i.id }, { ultimaImportacaoId: i.id }] } })
    out.push({ chave: `importacao-incompleta:${i.id}`, tipo: 'IMPORTACAO_INCOMPLETA', gravidade: 'ALTA', desfecho: 'PRECISA_DE_VOCE', texto: `A importação de "${i.nomeArquivo}" começou ${haQuanto(minutos(i.importadoEm, agora))} e não terminou (${gravadas} de ${i.linhasTotal} linhas gravadas) — envie o mesmo arquivo de novo: nada duplica.`, entidade: { tipo: 'ImportacaoCreatorCenter', id: i.id }, acao: { rotulo: 'Importar de novo', link: '/vendas-comissoes' } })
  }
  const { situacaoDaImportacao } = await import('./creator-center-importacao')
  const recentes = await prisma.importacaoCreatorCenter.findMany({ where: { workspaceId: ws, concluida: true }, orderBy: { importadoEm: 'desc' }, take: 3, select: { id: true } })
  for (const r of recentes) {
    const s = await situacaoDaImportacao(ws, r.id)
    if (!s || s.situacao !== 'IMPORTADO_COM_ALERTAS') continue
    out.push({ chave: `importacao-alertas:${r.id}`, tipo: 'IMPORTACAO_COM_ALERTAS', gravidade: 'MEDIA', desfecho: 'PRECISA_DE_VOCE', texto: `Importação de "${s.nomeArquivo}" terminou com alertas: ${s.alertas.join('; ')} — ${s.proximaAcao}`, entidade: { tipo: 'ImportacaoCreatorCenter', id: r.id }, acao: { rotulo: 'Revisar', link: '/vendas-comissoes' } })
  }
  return out
}

/**
 * P2.29.1 — produto descartado/excluído: a REGRA CANÔNICA (`encerrarProdutoDescartado`, via
 * `reconciliarEstadoDoWorkspace`) — a mesma da exclusão, do NÃO QUERO e da curadoria. Corrige: arquiva o candidato de
 * cadastro excluído e encerra o que é CERTO que não saiu (com histórico e evento STATE_RECONCILED). O que pode já
 * estar no TikTok fica de pé e aparece em PRODUTO_ARQUIVADO_ATIVO (Precisa de você). Conferir = só conta.
 */
async function produtosExcluidos(ws: string, agora: Date, corrigir: boolean): Promise<Achado[]> {
  const { reconciliarEstadoDoWorkspace } = await import('./produto-canonico')
  const v = await reconciliarEstadoDoWorkspace(ws, { aplicar: false, agora })
  const derivados = v.publicacoesDeProdutoInativo + v.amostrasDeProdutoInativo + v.pedidosDeProdutoInativo
  if (!v.candidatosDeProdutoExcluido && !derivados) return []
  if (corrigir) await reconciliarEstadoDoWorkspace(ws, { aplicar: true, agora })
  const texto = `${v.candidatosDeProdutoExcluido} produto(s) excluído(s) ainda apareciam na operação e ${derivados} item(ns) em andamento de produto descartado ou excluído (${v.publicacoesDeProdutoInativo} publicação(ões) que com certeza não saíram, ${v.amostrasDeProdutoInativo} amostra(s), ${v.pedidosDeProdutoInativo} pedido(s)).`
  return [{ chave: `produtos-excluidos:${ws}`, tipo: 'PRODUTO_EXCLUIDO_AINDA_VIVO', gravidade: 'MEDIA', desfecho: corrigir ? 'CORRIGIDO' : 'ADMIN', entidade: { tipo: 'Workspace', id: ws }, texto,
    correcao: corrigir ? 'Regra canônica: arquivados e encerrados com o estado anterior no histórico (evento STATE_RECONCILED). Publicado, resultados, vendas, pedidos, comissões e aprendizado intocados.' : undefined }]
}

async function produtosEJornadas(ws: string): Promise<Achado[]> {
  const out: Achado[] = []
  const { ENTIDADE_DA_JORNADA } = await import('./jornada')
  const ids = (await prisma.domainEvent.findMany({ where: { workspaceId: ws, entidadeTipo: ENTIDADE_DA_JORNADA }, distinct: ['entidadeId'], select: { entidadeId: true }, take: 500 })).map((x) => x.entidadeId).filter((x): x is string => !!x)
  if (ids.length) {
    const existem = new Set((await prisma.candidatoDeProduto.findMany({ where: { workspaceId: ws, id: { in: ids } }, select: { id: true } })).map((c) => c.id))
    for (const id of ids.filter((x) => !existem.has(x))) out.push({ chave: `jornada-orfa:${id}`, tipo: 'JORNADA_ORFA', gravidade: 'BAIXA', desfecho: 'ADMIN', texto: `Há eventos de jornada para um produto que não existe mais (${id}); a Operação já o ignora.`, entidade: { tipo: 'CandidatoDeProduto', id } })
  }
  // P2.29.1: só o que PODE já ter saído (o resto a regra canônica encerra sozinha).
  const { publicacoesParaConferirDeProdutoInativo, ORIENTACAO_PODE_TER_SAIDO } = await import('./produto-canonico')
  for (const p of await publicacoesParaConferirDeProdutoInativo(ws)) out.push({ chave: `produto-arquivado:${p.id}`, tipo: 'PRODUTO_ARQUIVADO_ATIVO', gravidade: 'ALTA', desfecho: 'PRECISA_DE_VOCE', texto: `${p.nomeProduto} foi descartado, mas a publicação pode já estar no TikTok. ${ORIENTACAO_PODE_TER_SAIDO}`, entidade: { tipo: 'PublicacaoAssistida', id: p.id }, acao: { rotulo: 'Conferir e decidir', link: '/publicacoes-assistidas' } })
  return out
}

async function amostras(ws: string): Promise<Achado[]> {
  const as = await prisma.amostraTikTokShop.findMany({ where: { workspaceId: ws, OR: [{ estado: 'RECEBIDA', recebidaEm: null }, { estado: { in: ['ENVIADA', 'RECEBIDA', 'CONCLUIDA'] }, solicitadaEm: null }, { estado: 'REJEITADA', rejeitadaEm: null }] }, select: { id: true, nomeProduto: true, estado: true }, take: 50 })
  return as.map((a) => ({ chave: `amostra:${a.id}`, tipo: 'AMOSTRA_IMPOSSIVEL' as const, gravidade: 'BAIXA' as const, desfecho: 'ADMIN' as const, texto: `Amostra de ${a.nomeProduto} está ${a.estado} sem a data do passo correspondente (registro incompleto; não dá para inferir a data).`, entidade: { tipo: 'AmostraTikTokShop', id: a.id } }))
}

async function fila(ws: string, agora: Date, corrigir: boolean): Promise<Achado[]> {
  const out: Achado[] = []
  const { validarEntidadeDaAutomacao } = await import('./automation-queue-entidades')
  const { cancelarJobSemEntidade } = await import('./automation-queue-prisma')
  const jobs = await prisma.automationJob.findMany({ where: { workspaceId: ws, estado: { in: ['PENDING', 'WAITING', 'FAILED_RETRYABLE'] }, NOT: { tipo: { startsWith: 'LONGO_' } } }, select: { id: true, tipo: true, estado: true, entityType: true, entityId: true }, take: 200 })
  for (const j of jobs) {
    const v = await validarEntidadeDaAutomacao({ workspaceId: ws, entityType: j.entityType, entityId: j.entityId }).catch(() => null)
    if (!v || v.ok) continue
    let correcao: string | undefined
    if (corrigir && (await cancelarJobSemEntidade(j.id, j.estado, `Entidade inválida: ${v.explicacao}`))) correcao = 'Item da fila cancelado (não há mais o que executar).'
    out.push({ chave: `fila:${j.id}`, tipo: 'FILA_SEM_ENTIDADE', gravidade: 'BAIXA', desfecho: corrigir ? 'CORRIGIDO' : 'ADMIN', texto: `Tarefa ${j.tipo} aponta para ${j.entityType} que não existe mais: ${v.explicacao}`, entidade: { tipo: 'AutomationJob', id: j.id }, correcao })
  }
  const longos = await prisma.automationJob.findMany({ where: { workspaceId: ws, tipo: { startsWith: 'LONGO_' }, OR: [
    { estado: 'RUNNING', heartbeatAt: { lt: new Date(agora.getTime() - TRABALHO_ABANDONADO_MIN * MIN) } },
    { estado: 'PENDING', updatedAt: { lt: new Date(agora.getTime() - TRABALHO_ABANDONADO_MIN * MIN) } },
    { estado: 'WAITING', motivoHumano: 'PROVIDER_OUTCOME_UNCONFIRMED' },
  ] }, select: { id: true, tipo: true, estado: true, updatedAt: true }, take: 50 })
  for (const l of longos) {
    const incerto = l.estado === 'WAITING'
    out.push({ chave: `longo:${l.id}`, tipo: 'TRABALHO_LONGO_ABANDONADO', gravidade: incerto ? 'ALTA' : 'BAIXA', desfecho: incerto ? 'PRECISA_DE_VOCE' : 'ADMIN',
      texto: incerto ? `${l.tipo === 'LONGO_PUBLICAR_INSTAGRAM' ? 'Publicação no Instagram' : l.tipo === 'LONGO_ENVIO_WHATSAPP' ? 'Envio de WhatsApp' : 'Tarefa'} sem confirmação ${haQuanto(minutos(l.updatedAt, agora))} — confira se aconteceu antes de pedir de novo.` : `Trabalho ${l.tipo} parado (${l.estado}) ${haQuanto(minutos(l.updatedAt, agora))}; é retomado na próxima consulta.`,
      entidade: { tipo: 'AutomationJob', id: l.id }, ...(incerto ? { acao: { rotulo: 'Conferir', link: '/precisa-de-voce' } } : {}) })
  }
  return out
}

async function rendersInterrompidos(ws: string, agora: Date, corrigir: boolean): Promise<Achado[]> {
  const gerando = await prisma.publicacaoAssistida.findMany({ where: { workspaceId: ws, estado: 'GERANDO_VIDEO', updatedAt: { lt: new Date(agora.getTime() - 5 * MIN) } } })
  const out: Achado[] = []
  for (const a of gerando) {
    if (!corrigir) { out.push({ chave: `render:${a.id}`, tipo: 'RENDER_INTERROMPIDO', gravidade: 'MEDIA', desfecho: 'ADMIN', texto: `${a.nomeProduto}: vídeo em geração ${haQuanto(minutos(a.updatedAt, agora))}.`, entidade: { tipo: 'PublicacaoAssistida', id: a.id } }); continue }
    const { recuperarRenderInterrompido } = await import('./publicacao-assistida')
    const depois = await recuperarRenderInterrompido(a, agora)
    if (depois.estado !== 'GERANDO_VIDEO') out.push({ chave: `render:${a.id}`, tipo: 'RENDER_INTERROMPIDO', gravidade: 'MEDIA', desfecho: 'CORRIGIDO', texto: `${a.nomeProduto}: a geração do vídeo tinha parado ${haQuanto(minutos(a.updatedAt, agora))}.`, entidade: { tipo: 'PublicacaoAssistida', id: a.id }, correcao: depois.estado === 'VIDEO_NA_FILA' ? 'Voltou para a fila (o Patrono gera de novo sozinho).' : 'Depois das tentativas, o Patrono segue para outra opção.' })
  }
  return out
}

async function cotas(ws: string, agora: Date, corrigir: boolean): Promise<Achado[]> {
  const out: Achado[] = []
  const reservadas = await prisma.consumoDeCota.findMany({ where: { workspaceId: ws, estado: 'RESERVADA', updatedAt: { lt: new Date(agora.getTime() - COTA_RESERVADA_ORFA_MIN * MIN) } } })
  const { liberarCota, confirmarCota } = await import('./cotas-da-plataforma')
  for (const r of reservadas) {
    const id = r.acaoId.startsWith('publicacaoAssistida:') ? r.acaoId.slice('publicacaoAssistida:'.length) : null
    const a = id ? await prisma.publicacaoAssistida.findFirst({ where: { id, workspaceId: ws }, select: { estado: true, erro: true, publicacaoId: true } }) : null
    const pubs = id ? await prisma.publicacao.findMany({ where: { workspaceId: ws, chaveDaTentativa: { startsWith: `assistida:${id}:` } }, select: { estado: true } }) : []
    const saiu = a?.estado === 'PUBLICADO' || pubs.some((p) => p.estado === 'DISTRIBUINDO' || p.estado === 'DISTRIBUIDA')
    const naoSaiu = !!a && ['APROVADO', 'REJEITADO', 'AGUARDANDO_APROVACAO'].includes(a.estado) && !pubs.some((p) => p.estado === 'DISTRIBUINDO' || p.estado === 'DISTRIBUIDA')
    if (!saiu && !naoSaiu) { out.push({ chave: `cota:${r.id}`, tipo: 'COTA_RESERVADA_ORFA', gravidade: 'BAIXA', desfecho: 'ADMIN', texto: `Vaga da quota reservada ${haQuanto(minutos(r.updatedAt, agora))} para ${r.acaoId} sem desfecho claro; fica reservada até a publicação se resolver.`, entidade: { tipo: 'ConsumoDeCota', id: r.id } }); continue }
    if (corrigir) await (saiu ? confirmarCota : liberarCota)({ workspaceId: ws, acaoId: r.acaoId })
    out.push({ chave: `cota:${r.id}`, tipo: 'COTA_RESERVADA_ORFA', gravidade: 'BAIXA', desfecho: corrigir ? 'CORRIGIDO' : 'ADMIN', texto: `Vaga da quota ficou reservada ${haQuanto(minutos(r.updatedAt, agora))} (${r.acaoId}).`, entidade: { tipo: 'ConsumoDeCota', id: r.id }, correcao: saiu ? 'Confirmada (a publicação saiu).' : 'Devolvida (a publicação não saiu).' })
  }
  // Contador do dia ≠ consumos válidos (reservados + confirmados) → recalcula sob a mesma trava da reserva.
  const divergentes = await prisma.$queryRaw<{ id: string; plataforma: string; regra: string; programa: string; dia: string; usado: number; real: number }[]>`
    SELECT c."id", c."plataforma", c."regra", c."programa", c."dia", c."usado", COALESCE(x.n, 0)::int AS real FROM "ContadorDeCotaDiaria" c
    LEFT JOIN (SELECT "plataforma", "regra", "programa", "dia", count(*) n FROM "ConsumoDeCota" WHERE "workspaceId" = ${ws} AND "estado" IN ('RESERVADA', 'CONFIRMADA') GROUP BY 1, 2, 3, 4) x
      ON x."plataforma" = c."plataforma" AND x."regra" = c."regra" AND x."programa" = c."programa" AND x."dia" = c."dia"
    WHERE c."workspaceId" = ${ws} AND c."usado" <> COALESCE(x.n, 0)`
  for (const d of divergentes) {
    let correcao: string | undefined
    if (corrigir) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`quota:${ws}:${d.regra}:${d.dia}`}))::text AS ok`
        const [{ n }] = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM "ConsumoDeCota" WHERE "workspaceId" = ${ws} AND "plataforma" = ${d.plataforma} AND "regra" = ${d.regra} AND "programa" = ${d.programa} AND "dia" = ${d.dia} AND "estado" IN ('RESERVADA', 'CONFIRMADA')`
        await tx.$executeRaw`UPDATE "ContadorDeCotaDiaria" SET "usado" = ${n}, "updatedAt" = now() WHERE "id" = ${d.id}`
      })
      correcao = `Contador recalculado pelos consumos registrados (${d.usado} → ${d.real}).`
    }
    out.push({ chave: `contador:${d.id}`, tipo: 'CONTADOR_DIVERGENTE', gravidade: 'BAIXA', desfecho: corrigir ? 'CORRIGIDO' : 'ADMIN', texto: `Contador da quota ${d.regra} em ${d.dia} marcava ${d.usado}, mas há ${d.real} consumo(s) registrado(s).`, entidade: { tipo: 'ContadorDeCotaDiaria', id: d.id }, correcao })
  }
  return out
}

/**
 * P2.31.1 — o catálogo de regras de plataforma (código) é registrado no histórico AQUI, numa rotina explícita,
 * e não mais ao montar a Operação (leitura não grava). 1º registro = só bootstrap (não é achado); regra que
 * mudou no código = versão nova + PLATFORM_RULE_UPDATED + recálculo. A leitura já usa o catálogo do código.
 */
async function regrasDoCatalogo(ws: string, agora: Date, corrigir: boolean): Promise<Achado[]> {
  const { regrasDoCatalogoPendentes, sincronizarRegrasDoCatalogo } = await import('./cotas-da-plataforma')
  const pendentes = await regrasDoCatalogoPendentes(ws)
  if (!pendentes.length) return []
  const mudaram = corrigir ? (await sincronizarRegrasDoCatalogo(ws, agora)).mudaram : pendentes.filter((p) => !p.nova).map((p) => p.id)
  return mudaram.map((id) => ({
    chave: `regra-catalogo:${id}`, tipo: 'REGRA_DO_CATALOGO_ATUALIZADA' as const, gravidade: 'BAIXA' as const, desfecho: corrigir ? 'CORRIGIDO' as const : 'ADMIN' as const,
    texto: `A regra de plataforma ${id} mudou no código do Patrono${corrigir ? ' e foi registrada no histórico' : ' e ainda não está no histórico'}.`,
    entidade: { tipo: 'RegraDePlataforma', id }, correcao: corrigir ? 'Versão nova registrada (antes/depois) e restrições recalculadas.' : undefined,
  }))
}

// ── a rotina ────────────────────────────────────────────────────────────────────────────────────

export async function reconciliarEstadoOperacional(workspaceId: string, opcoes: { agora?: Date; corrigir?: boolean; origem?: string } = {}): Promise<ResultadoDaReconciliacao> {
  const agora = opcoes.agora ?? new Date()
  const corrigir = opcoes.corrigir !== false
  const worker = `${opcoes.origem ?? 'reconciliacao'}:${randomUUID()}`
  // Uma rodada por workspace de cada vez: a segunda vê a primeira aberta e não roda.
  const execucao = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`reconciliacao:${workspaceId}`}))::text AS ok`
    const aberta = await tx.execucaoDoProcessador.findFirst({ where: { workspaceId, tipo: 'RECONCILIACAO', terminadoEm: null, iniciadoEm: { gt: new Date(Date.now() - RODADA_ABERTA_MS) } } })
    if (aberta) return null
    return tx.execucaoDoProcessador.create({ data: { workspaceId, tipo: 'RECONCILIACAO', worker, iniciadoEm: new Date() } })
  })
  if (!execucao) return { execucaoId: null, emAndamento: true, achados: [], corrigidos: 0, paraVoce: 0, admin: 0 }
  const achados: Achado[] = []
  const passos: [string, () => Promise<Achado[]>][] = [
    ['publicacoes', () => publicacoesPresas(workspaceId, agora, corrigir)],
    ['renders', () => rendersInterrompidos(workspaceId, agora, corrigir)],
    ['comissoes', () => comissoesInconsistentes(workspaceId, corrigir)],
    ['produtosExcluidos', () => produtosExcluidos(workspaceId, agora, corrigir)],
    ['eventos', () => eventos(workspaceId, agora)],
    ['importacoes', () => importacoes(workspaceId, agora)],
    ['produtos', () => produtosEJornadas(workspaceId)],
    ['amostras', () => amostras(workspaceId)],
    ['fila', () => fila(workspaceId, agora, corrigir)],
    ['cotas', () => cotas(workspaceId, agora, corrigir)],
    ['regrasDoCatalogo', () => regrasDoCatalogo(workspaceId, agora, corrigir)],
    // P2.31.1: o status gravado dos alertas de redução de comissão avança aqui (a tela só calcula, não grava).
    ['alertasDeComissao', async () => { if (corrigir) await (await import('./alerta-reducao-comissao')).atualizarAlertasDeComissao(workspaceId, agora); return [] }],
  ]
  const falhas: string[] = []
  for (const [nome, passo] of passos) {
    // Um detector que falha não impede os outros (e fica registrado).
    try { achados.push(...(await passo())) } catch (e) { falhas.push(`${nome}: ${String(e).slice(0, 200)}`); log('error', 'reconciliacao.passo_falhou', { workspaceId, passo: nome, erro: String(e).slice(0, 300) }) }
  }
  const corrigidos = achados.filter((a) => a.desfecho === 'CORRIGIDO')
  const resumo = { achados, falhas, corrigir }
  await prisma.execucaoDoProcessador.update({ where: { id: execucao.id }, data: { terminadoEm: new Date(), processados: corrigidos.length, falhas: falhas.length, ignorados: achados.length - corrigidos.length, detalhe: resumo as unknown as Prisma.InputJsonValue } })
  if (corrigidos.length) await registrarAuditoria({ workspaceId, userId: null, action: 'reconciliacao.corrigiu', entityType: 'ExecucaoDoProcessador', entityId: execucao.id, metadata: { corrigidos: corrigidos.map((c) => ({ tipo: c.tipo, entidade: c.entidade, correcao: c.correcao })) } })
  return { execucaoId: execucao.id, emAndamento: false, achados, corrigidos: corrigidos.length, paraVoce: achados.filter((a) => a.desfecho === 'PRECISA_DE_VOCE').length, admin: achados.filter((a) => a.desfecho === 'ADMIN').length }
}

/** Última rodada concluída (a central e o health check leem daqui — sem recalcular). */
export async function ultimaReconciliacao(workspaceId: string) {
  const r = await prisma.execucaoDoProcessador.findFirst({ where: { workspaceId, tipo: 'RECONCILIACAO', terminadoEm: { not: null } }, orderBy: { iniciadoEm: 'desc' } })
  if (!r) return null
  const d = (r.detalhe ?? {}) as { achados?: Achado[]; falhas?: string[] }
  const e = d as { corrigir?: boolean }
  return { em: r.iniciadoEm, terminadoEm: r.terminadoEm, achados: d.achados ?? [], falhas: d.falhas ?? [], corrigiu: e.corrigir !== false }
}
