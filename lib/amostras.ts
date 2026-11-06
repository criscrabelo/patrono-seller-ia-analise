/**
 * P2.17.17 — Amostras do TikTok Shop como PIPELINE COMERCIAL:
 *
 *   AMOSTRA → CONTEÚDO → PUBLICAÇÃO → MÉTRICA → VENDA → COMISSÃO → APRENDIZADO
 *
 * Ciclo completo (o que a tela mostra):
 *   SOLICITADA → PENDENTE_APROVACAO → APROVADA → ENVIADA → RECEBIDA →
 *   CONTEUDO_PENDENTE → VIDEO_GERADO → APROVACAO → PUBLICADA →
 *   MEDINDO_RESULTADO → CONCLUIDA      (+ REJEITADA · CANCELADA)
 * Alertas derivados (não são estados): ATRASADA · PRAZO_PROXIMO · OBRIGACAO_DE_CONTEUDO.
 *
 * Uma verdade só: o banco guarda a LOGÍSTICA (decidida por TikTok/vendedor/
 * transportadora e informada pela titular — não há API de escrita de
 * amostras); a PRODUÇÃO é derivada da publicação assistida ligada.
 *
 * Regras permanentes:
 *   - data desconhecida = null (nunca inventada); prazo só "confirmado" quando
 *     visto no app — senão é ESTIMATIVA rotulada;
 *   - pedido ≠ aprovado ≠ missão computada (três fatos separados);
 *   - nada vira "Precisa de você" enquanto só aguardamos vendedor/logística;
 *   - amostra grátis não é, por si, boa oportunidade (a prioridade é econômica);
 *   - nunca autorizar compra/reembolso.
 */
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { avaliarCampanha } from './campanha-sazonal'
import { facilidadeDeVideo } from './motor-de-videos-tiktok'
import { chaveDeProduto, demandaPelaPosicao, sinaisPorChave, type SinaisObservados } from './observacoes-de-mercado'
import { registrarAuditoria } from './audit-log'
import { registrarEvento } from './ledger'
import { candidatoDaAmostra } from './curadoria'

export const ESTADOS_LOGISTICOS = ['SOLICITADA', 'PENDENTE_APROVACAO', 'APROVADA', 'ENVIADA', 'RECEBIDA', 'REJEITADA', 'CANCELADA', 'CONCLUIDA'] as const
export type EstadoLogistico = (typeof ESTADOS_LOGISTICOS)[number]
export const ESTADOS_DO_CICLO = [
  'SOLICITADA', 'PENDENTE_APROVACAO', 'APROVADA', 'ENVIADA', 'RECEBIDA', 'CONTEUDO_PENDENTE', 'VIDEO_GERADO', 'APROVACAO', 'PUBLICADA', 'MEDINDO_RESULTADO', 'CONCLUIDA', 'REJEITADA', 'CANCELADA',
] as const
export type EstadoDoCiclo = (typeof ESTADOS_DO_CICLO)[number]
export type AlertaDaAmostra = 'ATRASADA' | 'PRAZO_PROXIMO' | 'OBRIGACAO_DE_CONTEUDO'
export const PAPEIS = ['PRODUTO_AFILIADO', 'EQUIPAMENTO_OPERACIONAL'] as const
export type Papel = (typeof PAPEIS)[number]

export const ROTULO_DO_ESTADO: Record<EstadoDoCiclo, string> = {
  SOLICITADA: 'Solicitada',
  PENDENTE_APROVACAO: 'Pendente de aprovação do vendedor',
  APROVADA: 'Aprovada — aguardando envio',
  ENVIADA: 'Enviada — a caminho',
  RECEBIDA: 'Recebida',
  CONTEUDO_PENDENTE: 'Recebida — conteúdo pendente',
  VIDEO_GERADO: 'Vídeo gerado — checando',
  APROVACAO: 'Vídeo aguardando a sua aprovação',
  PUBLICADA: 'Publicada',
  MEDINDO_RESULTADO: 'Medindo resultado',
  CONCLUIDA: 'Concluída',
  REJEITADA: 'Rejeitada pelo vendedor',
  CANCELADA: 'Cancelada',
}

/** Eventos logísticos aceitos e de onde podem partir (sem pular para trás). */
export const EVENTOS = ['PENDENTE_APROVACAO', 'APROVADA', 'ENVIADA', 'RECEBIDA', 'REJEITADA', 'CANCELADA', 'CONCLUIDA'] as const
export type EventoDaAmostra = (typeof EVENTOS)[number]
const DE_ONDE: Record<EventoDaAmostra, readonly EstadoLogistico[]> = {
  PENDENTE_APROVACAO: ['SOLICITADA'],
  APROVADA: ['SOLICITADA', 'PENDENTE_APROVACAO'],
  // O app às vezes pula etapas na tela: aceitar avanço, nunca recuo.
  ENVIADA: ['SOLICITADA', 'PENDENTE_APROVACAO', 'APROVADA'],
  RECEBIDA: ['SOLICITADA', 'PENDENTE_APROVACAO', 'APROVADA', 'ENVIADA'],
  REJEITADA: ['SOLICITADA', 'PENDENTE_APROVACAO'],
  CANCELADA: ['SOLICITADA', 'PENDENTE_APROVACAO', 'APROVADA', 'ENVIADA'],
  CONCLUIDA: ['RECEBIDA'],
}
const CAMPO_DA_DATA: Partial<Record<EventoDaAmostra, 'aprovadaEm' | 'enviadaEm' | 'recebidaEm' | 'rejeitadaEm'>> = {
  APROVADA: 'aprovadaEm', ENVIADA: 'enviadaEm', RECEBIDA: 'recebidaEm', REJEITADA: 'rejeitadaEm',
}

export class ErroDeAmostra extends Error {
  constructor(public readonly status: 400 | 404 | 409, mensagem: string) {
    super(mensagem)
  }
}

/** FUNÇÃO PURA. Transição permitida? Recuo e salto inválido são recusados (409). */
export function transicionar(atual: string, evento: string): EstadoLogistico {
  if (!(EVENTOS as readonly string[]).includes(evento)) throw new ErroDeAmostra(400, 'Evento inválido.')
  const ev = evento as EventoDaAmostra
  if (!DE_ONDE[ev].includes(atual as EstadoLogistico)) throw new ErroDeAmostra(409, `Não dá para ir de "${atual}" para "${ev}".`)
  return ev
}

// ── Estado efetivo (logística + produção derivada) ──────────────────────

export interface AssistidaDaAmostra { estado: string; videoGerado: boolean; publicadoEm: Date | null }
/** Janela em que a venda ainda pode ser atribuída ao vídeo (regra BR documentada: 14 dias). */
export const JANELA_DE_MEDICAO_DIAS = 14
const DIA = 24 * 60 * 60 * 1000

/** FUNÇÃO PURA. Logística até RECEBIDA; depois, a etapa real da produção. */
export function estadoEfetivo(estado: string, assistida: AssistidaDaAmostra | null, agora: Date): EstadoDoCiclo {
  if (estado !== 'RECEBIDA') return estado as EstadoDoCiclo
  if (!assistida || ['REJEITADO'].includes(assistida.estado)) return 'CONTEUDO_PENDENTE'
  if (assistida.estado === 'PUBLICADO') {
    const desde = assistida.publicadoEm ? agora.getTime() - assistida.publicadoEm.getTime() : 0
    return desde >= JANELA_DE_MEDICAO_DIAS * DIA ? 'CONCLUIDA' : 'MEDINDO_RESULTADO'
  }
  if (['AGUARDANDO_APROVACAO', 'APROVADO', 'PUBLICANDO', 'FALHOU'].includes(assistida.estado)) return assistida.videoGerado ? 'APROVACAO' : 'CONTEUDO_PENDENTE'
  if (assistida.videoGerado) return 'VIDEO_GERADO'
  return 'CONTEUDO_PENDENTE'
}

// ── Prazo (confirmado × estimado) e alertas ─────────────────────────────

export interface PrazoDaAmostra { em: string; confirmado: boolean; fonte: string; aviso: string | null }
/** Regra geral documentada do TikTok Shop BR para amostra: publicar em até 14 dias. NÃO confirmada por amostra. */
export const PRAZO_GERAL_DIAS = 14
export const DIAS_PARA_PRAZO_PROXIMO = 3
/** Recomendação do Patrono (não regra do TikTok): aprovada há 7+ dias sem envio merece conferência. */
export const DIAS_SEM_ENVIO_PARA_ALERTA = 7

/** FUNÇÃO PURA. Confirmado no app vence; sem ele, estimativa ROTULADA a partir do recebimento; sem recebimento, null. */
export function prazoDaAmostra(a: { prazoConteudoEm: Date | null; prazoConteudoFonte: string | null; recebidaEm: Date | null }): PrazoDaAmostra | null {
  if (a.prazoConteudoEm) return { em: a.prazoConteudoEm.toISOString(), confirmado: true, fonte: a.prazoConteudoFonte ?? 'CONFIRMADO_NO_APP', aviso: null }
  if (a.recebidaEm) {
    return {
      em: new Date(a.recebidaEm.getTime() + PRAZO_GERAL_DIAS * DIA).toISOString(),
      confirmado: false,
      fonte: 'ESTIMADO_REGRA_GERAL',
      aviso: `Estimativa: regra geral de ${PRAZO_GERAL_DIAS} dias após receber. Confirme o prazo desta amostra no app.`,
    }
  }
  return null
}

const PUBLICADOS: readonly EstadoDoCiclo[] = ['PUBLICADA', 'MEDINDO_RESULTADO', 'CONCLUIDA']

/** FUNÇÃO PURA. Alertas: obrigação de conteúdo, prazo próximo, atraso (prazo ou logística). */
export function alertasDaAmostra(a: { estado: string; aprovadaEm: Date | null }, efetivo: EstadoDoCiclo, prazo: PrazoDaAmostra | null, agora: Date): { alertas: AlertaDaAmostra[]; detalhe: string[] } {
  const alertas: AlertaDaAmostra[] = []
  const detalhe: string[] = []
  const publicada = PUBLICADOS.includes(efetivo)
  if (a.estado === 'RECEBIDA' && !publicada) {
    alertas.push('OBRIGACAO_DE_CONTEUDO')
    detalhe.push('Amostra recebida: publicar o vídeo com o produto marcado.')
  }
  if (prazo && !publicada && a.estado === 'RECEBIDA') {
    const faltam = (new Date(prazo.em).getTime() - agora.getTime()) / DIA
    if (faltam < 0) {
      alertas.push('ATRASADA')
      detalhe.push(`Prazo ${prazo.confirmado ? 'confirmado' : 'estimado'} vencido há ${Math.ceil(-faltam)} dia(s).`)
    } else if (faltam <= DIAS_PARA_PRAZO_PROXIMO) {
      alertas.push('PRAZO_PROXIMO')
      detalhe.push(`Faltam ${Math.ceil(faltam)} dia(s) para o prazo ${prazo.confirmado ? 'confirmado' : 'estimado'}.`)
    }
  }
  if (a.estado === 'APROVADA' && a.aprovadaEm && agora.getTime() - a.aprovadaEm.getTime() >= DIAS_SEM_ENVIO_PARA_ALERTA * DIA) {
    alertas.push('ATRASADA')
    detalhe.push(`Aprovada há ${Math.floor((agora.getTime() - a.aprovadaEm.getTime()) / DIA)} dias sem envio (recomendação do Patrono: conferir no app; não é regra do TikTok).`)
  }
  return { alertas, detalhe }
}

// ── Prioridade operacional (fila de EXECUÇÃO; não mexe no ranking) ──────

export interface AmostraParaPrioridade {
  id: string
  nomeProduto: string
  estado: string
  efetivo: EstadoDoCiclo
  prazo: PrazoDaAmostra | null
  alertas: AlertaDaAmostra[]
  comissaoObservada: number | null
  sinais: SinaisObservados | null
  missaoAtiva: boolean
  aderenciaNatal: number | null
  facilidade: number
  papeis: string[]
}

/** FUNÇÃO PURA. Valor econômico observável: comissão × demanda (ranking/vendas). Sem os dois, null. */
export function valorEconomico(a: Pick<AmostraParaPrioridade, 'comissaoObservada' | 'sinais'>): number | null {
  const comissao = a.comissaoObservada ?? a.sinais?.comissaoValor ?? null
  const demanda = demandaPelaPosicao(a.sinais?.rankingPosicao ?? null) ?? (a.sinais?.vendas != null ? Math.min(1, Math.log10(1 + a.sinais.vendas) / 4) : null)
  if (comissao === null) return null
  return Math.round(comissao * (demanda ?? 0.25) * 100) / 100
}

/**
 * FUNÇÃO PURA. Ordem: 1) prazo/obrigação mais próxima; 2) risco de perder
 * (atraso/prazo próximo); 3) evidência de venda; 4) oportunidade econômica;
 * 5) missão; 6) sazonalidade; 7) facilidade de conteúdo. Encerradas saem.
 */
export function priorizarAmostras(itens: AmostraParaPrioridade[]): (AmostraParaPrioridade & { posicao: number; porque: string })[] {
  const ativas = itens.filter((a) => !['REJEITADA', 'CANCELADA', 'CONCLUIDA'].includes(a.efetivo))
  const t = (a: AmostraParaPrioridade) => (a.prazo && a.estado === 'RECEBIDA' ? new Date(a.prazo.em).getTime() : Number.POSITIVE_INFINITY)
  const risco = (a: AmostraParaPrioridade) => (a.alertas.includes('ATRASADA') ? 2 : a.alertas.includes('PRAZO_PROXIMO') ? 1 : 0)
  const evid = (a: AmostraParaPrioridade) => demandaPelaPosicao(a.sinais?.rankingPosicao ?? null) ?? (a.sinais?.vendas != null ? Math.min(1, Math.log10(1 + a.sinais.vendas) / 4) : -1)
  const ordenadas = [...ativas].sort(
    (a, b) =>
      t(a) - t(b) ||
      risco(b) - risco(a) ||
      evid(b) - evid(a) ||
      (valorEconomico(b) ?? -1) - (valorEconomico(a) ?? -1) ||
      Number(b.missaoAtiva) - Number(a.missaoAtiva) ||
      (b.aderenciaNatal ?? 0) - (a.aderenciaNatal ?? 0) ||
      b.facilidade - a.facilidade
  )
  return ordenadas.map((a, i) => {
    const partes: string[] = []
    if (a.prazo && a.estado === 'RECEBIDA') partes.push(`prazo ${a.prazo.confirmado ? 'confirmado' : 'estimado'} ${new Date(a.prazo.em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`)
    if (risco(a)) partes.push(a.alertas.includes('ATRASADA') ? 'atrasada' : 'prazo próximo')
    if (a.sinais?.rankingPosicao) partes.push(`#${a.sinais.rankingPosicao} em ${a.sinais.rankingCategoria ?? 'ranking'} (snapshot manual)`)
    else if (a.sinais?.vendasTexto || a.sinais?.vendas != null) partes.push(`vendas vistas no app: ${a.sinais?.vendasTexto ?? a.sinais?.vendas}`)
    const comissao = a.comissaoObservada ?? a.sinais?.comissaoValor ?? null
    partes.push(comissao !== null ? `comissão vista R$ ${comissao.toFixed(2).replace('.', ',')}` : 'comissão não vista')
    if (a.missaoAtiva) partes.push('conta para missão ativa')
    if (a.aderenciaNatal) partes.push(`Natal ${a.aderenciaNatal}/100`)
    if (a.papeis.includes('EQUIPAMENTO_OPERACIONAL')) partes.push('também é equipamento de produção (destrava vídeos POV)')
    return { ...a, posicao: i + 1, porque: partes.join(' · ') }
  })
}

// ── Leitura completa (tela, Torre, central, fila comercial) ─────────────

export interface AmostraDaTela {
  id: string
  chave: string
  nomeProduto: string
  marketplace: string
  tipo: string | null
  estado: string
  efetivo: EstadoDoCiclo
  rotulo: string
  papeis: string[]
  comissaoObservada: number | null
  comissaoFonte: string | null
  datas: { solicitadaEm: string | null; aprovadaEm: string | null; enviadaEm: string | null; recebidaEm: string | null; rejeitadaEm: string | null }
  prazo: PrazoDaAmostra | null
  alertas: AlertaDaAmostra[]
  alertasDetalhe: string[]
  missao: { computada: boolean | null; computadaEm: string | null; metaId: string | null }
  sinais: SinaisObservados | null
  candidatoId: string | null
  publicacaoAssistidaId: string | null
  campanha: string | null
  motivo: string | null
  observacao: string | null
  historico: unknown
  aderenciaNatal: number | null
  facilidade: number
  missaoAtiva: boolean
  /** A titular precisa agir AGORA? (só ação humana real) */
  acaoDaTitular: { titulo: string; motivo: string; urgente: boolean } | null
  /** O que o Patrono faz sozinho a seguir. */
  proximoDoPatrono: string
}

const ESTADOS_DA_ASSISTIDA_HUMANOS = ['AGUARDANDO_APROVACAO', 'AGUARDANDO_MIDIA', 'APROVADO', 'FALHOU']

/** FUNÇÃO PURA. Ação humana real (ou null) + o que o Patrono faz sozinho. */
export function acaoEProximo(a: { estado: string; efetivo: EstadoDoCiclo; alertas: AlertaDaAmostra[]; assistidaEstado: string | null; papeis: string[] }): Pick<AmostraDaTela, 'acaoDaTitular' | 'proximoDoPatrono'> {
  const urgente = a.alertas.includes('PRAZO_PROXIMO') || a.alertas.includes('ATRASADA')
  switch (a.efetivo) {
    case 'SOLICITADA':
    case 'PENDENTE_APROVACAO':
      return { acaoDaTitular: null, proximoDoPatrono: 'Aguardando o vendedor aprovar. Roteiros e cenas já preparados; quando aprovar, nada muda para você.' }
    case 'APROVADA':
      return { acaoDaTitular: null, proximoDoPatrono: 'Aguardando o envio. Quando estiver a caminho, o Patrono já deixa o calendário reservado.' }
    case 'ENVIADA':
      return { acaoDaTitular: null, proximoDoPatrono: 'A caminho. Quando chegar, marque "Recebida": o Patrono abre a produção na hora.' }
    case 'CONTEUDO_PENDENTE':
    case 'RECEBIDA': {
      // Já existe pendência da publicação assistida (mídia/aprovação): não duplicar.
      if (a.assistidaEstado && ESTADOS_DA_ASSISTIDA_HUMANOS.includes(a.assistidaEstado)) {
        return { acaoDaTitular: null, proximoDoPatrono: 'Produção aberta: a pendência está no cartão da publicação assistida.' }
      }
      return {
        acaoDaTitular: { titulo: 'Gravar as cenas', motivo: a.papeis.includes('EQUIPAMENTO_OPERACIONAL') ? 'Amostra recebida: grave as cenas do kit (o suporte também serve para gravar os próximos vídeos POV).' : 'Amostra recebida: grave as cenas do kit para o Patrono montar o vídeo.', urgente },
        proximoDoPatrono: 'Com a mídia autorizada, gera o vídeo, checa o arquivo e te mostra para aprovar.',
      }
    }
    case 'VIDEO_GERADO':
      return { acaoDaTitular: null, proximoDoPatrono: 'Checando o arquivo (Quality Gate) antes de te mostrar.' }
    case 'APROVACAO':
      return { acaoDaTitular: null, proximoDoPatrono: 'A aprovação está no cartão da publicação assistida.' }
    case 'PUBLICADA':
    case 'MEDINDO_RESULTADO':
      return { acaoDaTitular: null, proximoDoPatrono: `Medindo views, cliques, vendas e comissão (janela de ${JANELA_DE_MEDICAO_DIAS} dias) para aprender.` }
    default:
      return { acaoDaTitular: null, proximoDoPatrono: 'Encerrada: entra no aprendizado de quais amostras valem a pena.' }
  }
}

export async function listarAmostras(workspaceId: string, agora: Date = new Date()): Promise<AmostraDaTela[]> {
  const amostras = await prisma.amostraTikTokShop.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } })
  if (!amostras.length) return []
  const assistidaIds = amostras.map((a) => a.publicacaoAssistidaId).filter((x): x is string => !!x)
  const [assistidas, sinais, metas] = await Promise.all([
    assistidaIds.length ? prisma.publicacaoAssistida.findMany({ where: { workspaceId, id: { in: assistidaIds } }, select: { id: true, estado: true, apresentacao: true, publicadoEm: true } }) : [],
    sinaisPorChave(workspaceId, amostras.map((a) => a.chave), agora),
    prisma.metaTikTokShop.findMany({ where: { workspaceId, status: 'ATIVA', fim: { gte: agora } }, select: { tipo: true } }),
  ])
  const porId = new Map(assistidas.map((x) => [x.id, x]))
  const missaoAtiva = metas.some((m) => ['SOLICITAR_AMOSTRAS', 'VIDEOS_COM_PRODUTO', 'VIDEOS_QUALIFICADOS'].includes(m.tipo))
  return amostras.map((a) => {
    const ass = a.publicacaoAssistidaId ? porId.get(a.publicacaoAssistidaId) ?? null : null
    // "Vídeo gerado" só com o ARQUIVO (mesma regra de statusReal): nunca pelo rótulo.
    const videoGerado = !!ass && !!(ass.apresentacao as { video?: { arquivo?: string | null } } | null)?.video?.arquivo
    const efetivo = estadoEfetivo(a.estado, ass ? { estado: ass.estado, videoGerado, publicadoEm: ass.publicadoEm } : null, agora)
    const prazo = prazoDaAmostra(a)
    const { alertas, detalhe } = alertasDaAmostra(a, efetivo, prazo, agora)
    const natal = avaliarCampanha({ categoria: null, nome: a.nomeProduto, preco: null }, agora)
    const ap = acaoEProximo({ estado: a.estado, efetivo, alertas, assistidaEstado: ass?.estado ?? null, papeis: a.papeis })
    return {
      id: a.id, chave: a.chave, nomeProduto: a.nomeProduto, marketplace: a.marketplace, tipo: a.tipo, estado: a.estado, efetivo, rotulo: ROTULO_DO_ESTADO[efetivo] ?? efetivo,
      papeis: a.papeis, comissaoObservada: a.comissaoObservada, comissaoFonte: a.comissaoFonte,
      datas: { solicitadaEm: a.solicitadaEm?.toISOString() ?? null, aprovadaEm: a.aprovadaEm?.toISOString() ?? null, enviadaEm: a.enviadaEm?.toISOString() ?? null, recebidaEm: a.recebidaEm?.toISOString() ?? null, rejeitadaEm: a.rejeitadaEm?.toISOString() ?? null },
      prazo, alertas, alertasDetalhe: detalhe,
      missao: { computada: a.missaoComputada, computadaEm: a.missaoComputadaEm?.toISOString() ?? null, metaId: a.metaId },
      sinais: sinais.get(a.chave) ?? null,
      candidatoId: a.candidatoId, publicacaoAssistidaId: a.publicacaoAssistidaId, campanha: a.campanha, motivo: a.motivo, observacao: a.observacao, historico: a.historico,
      aderenciaNatal: natal?.aderencia ?? null,
      facilidade: facilidadeDeVideo({ categoria: null, nome: a.nomeProduto, preco: null }),
      missaoAtiva,
      ...ap,
    }
  })
}

/** As 5 perguntas da operação, respondidas com o que existe (nada inventado). */
export function respostasDaOperacao(amostras: AmostraDaTela[]) {
  const fila = priorizarAmostras(amostras)
  const recebidas = amostras.filter((a) => a.estado === 'RECEBIDA')
  const produzir = recebidas.filter((a) => !['PUBLICADA', 'MEDINDO_RESULTADO', 'CONCLUIDA'].includes(a.efetivo))
  const comPrazo = produzir.filter((a) => a.prazo).sort((x, y) => x.prazo!.em.localeCompare(y.prazo!.em))
  const porValor = [...amostras].filter((a) => !['REJEITADA', 'CANCELADA'].includes(a.efetivo) && valorEconomico(a) !== null).sort((x, y) => (valorEconomico(y) ?? 0) - (valorEconomico(x) ?? 0))
  return {
    oQueChegou: recebidas.length ? recebidas.map((a) => a.nomeProduto) : [],
    oQueProduzir: produzir.map((a) => a.nomeProduto),
    qualVencePrimeiro: comPrazo[0] ? { nome: comPrazo[0].nomeProduto, prazo: comPrazo[0].prazo } : null,
    qualValeMais: porValor[0] ? { nome: porValor[0].nomeProduto, base: 'comissão vista × demanda vista no app (snapshot manual)' } : null,
    qualConteudoPrimeiro: fila.find((a) => a.estado === 'RECEBIDA')?.nomeProduto ?? null,
    fila,
  }
}

// ── Escrita ─────────────────────────────────────────────────────────────

export interface DadosDaAmostra {
  nomeProduto: string
  productIdExterno?: string | null
  candidatoId?: string | null
  produtoId?: string | null
  categoria?: string | null
  tipo?: string | null
  estado?: 'SOLICITADA' | 'PENDENTE_APROVACAO'
  papeis?: string[]
  comissaoObservada?: number | null
  comissaoFonte?: string | null
  solicitadaEm?: string | Date | null
  campanha?: string | null
  motivo?: string | null
  observacao?: string | null
}

export function validarDadosDaAmostra(d: DadosDaAmostra): string | null {
  if (!d.nomeProduto?.trim()) return 'Informe o produto.'
  if (d.tipo && !['GRATIS', 'REEMBOLSAVEL'].includes(d.tipo)) return 'Tipo de amostra inválido.'
  if (d.estado && !['SOLICITADA', 'PENDENTE_APROVACAO'].includes(d.estado)) return 'Uma amostra nasce SOLICITADA ou PENDENTE_APROVACAO.'
  if (d.papeis && (!d.papeis.length || d.papeis.some((p) => !(PAPEIS as readonly string[]).includes(p)))) return 'Papel inválido.'
  if (d.comissaoObservada !== null && d.comissaoObservada !== undefined && (!Number.isFinite(d.comissaoObservada) || d.comissaoObservada < 0)) return 'Comissão inválida.'
  if (d.comissaoObservada != null && d.comissaoFonte === 'OFICIAL_API') return 'Comissão vista no app não é API oficial.'
  return null
}

/** Registra (idempotente pela chave do produto): a mesma amostra nunca duplica. */
export async function registrarAmostra(p: { workspaceId: string; userId: string | null; dados: DadosDaAmostra; agora?: Date }) {
  const erro = validarDadosDaAmostra(p.dados)
  if (erro) throw new ErroDeAmostra(400, erro)
  const agora = p.agora ?? new Date()
  const d = p.dados
  const chave = chaveDeProduto({ productIdExterno: d.productIdExterno, nome: d.nomeProduto })
  const existente = await prisma.amostraTikTokShop.findUnique({ where: { workspaceId_chave: { workspaceId: p.workspaceId, chave } } })
  if (existente) return { amostra: existente, criada: false }
  const estado = d.estado ?? 'SOLICITADA'
  // A amostra entra no MESMO motor de Oportunidades (candidato), sem inventar link nem mercado.
  const candidatoId = d.candidatoId ?? (await candidatoDaAmostra({ workspaceId: p.workspaceId, nome: d.nomeProduto, categoria: d.categoria ?? null, productIdExterno: d.productIdExterno ?? null, chaveDoProduto: chave, agora })).id
  try {
    const amostra = await prisma.amostraTikTokShop.create({
      data: {
        workspaceId: p.workspaceId, chave, nomeProduto: d.nomeProduto.trim(), productIdExterno: d.productIdExterno ?? null,
        candidatoId, produtoId: d.produtoId ?? null, tipo: d.tipo ?? null, estado,
        papeis: d.papeis ?? ['PRODUTO_AFILIADO'],
        comissaoObservada: d.comissaoObservada ?? null, comissaoFonte: d.comissaoObservada != null ? d.comissaoFonte ?? 'TIKTOK_APP_MANUAL' : null,
        solicitadaEm: d.solicitadaEm ? new Date(d.solicitadaEm) : null,
        campanha: d.campanha ?? null, motivo: d.motivo ?? null, observacao: d.observacao ?? null,
        historico: [{ em: agora.toISOString(), acao: 'REGISTRADA', estado, detalhe: d.solicitadaEm ? null : 'data da solicitação não informada (fica desconhecida)' }] as unknown as Prisma.InputJsonValue,
      },
    })
    await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId ?? undefined, action: 'amostra.registrada', entityType: 'AmostraTikTokShop', entityId: amostra.id, metadata: { estado, tipo: d.tipo ?? null } })
    return { amostra, criada: true }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const a = await prisma.amostraTikTokShop.findUniqueOrThrow({ where: { workspaceId_chave: { workspaceId: p.workspaceId, chave } } })
      return { amostra: a, criada: false }
    }
    throw e
  }
}

/** Aplica um evento logístico informado (o app não tem API de escrita de amostras). */
export async function aplicarEventoNaAmostra(p: { workspaceId: string; userId: string | null; id: string; evento: string; em?: string | null; prazoConteudoEm?: string | null; motivo?: string | null; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const a = await prisma.amostraTikTokShop.findFirst({ where: { id: p.id, workspaceId: p.workspaceId } })
  if (!a) throw new ErroDeAmostra(404, 'Amostra não encontrada.')
  const novo = transicionar(a.estado, p.evento)
  const quando = p.em ? new Date(p.em) : agora
  if (Number.isNaN(quando.getTime()) || quando.getTime() > agora.getTime() + 60_000) throw new ErroDeAmostra(400, 'Data inválida.')
  const campo = CAMPO_DA_DATA[novo as EventoDaAmostra]
  const historico = [...((a.historico as unknown[]) ?? []), { em: agora.toISOString(), acao: novo, de: a.estado, quando: quando.toISOString(), detalhe: p.motivo ?? null }]
  const data: Prisma.AmostraTikTokShopUpdateInput = { estado: novo, historico: historico as unknown as Prisma.InputJsonValue }
  if (campo) (data as Record<string, unknown>)[campo] = quando
  if (p.prazoConteudoEm) {
    const prazo = new Date(p.prazoConteudoEm)
    if (Number.isNaN(prazo.getTime())) throw new ErroDeAmostra(400, 'Prazo inválido.')
    data.prazoConteudoEm = prazo
    data.prazoConteudoFonte = 'CONFIRMADO_NO_APP'
  }
  const r = await prisma.amostraTikTokShop.update({ where: { id: a.id }, data })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId ?? undefined, action: 'amostra.evento', entityType: 'AmostraTikTokShop', entityId: a.id, metadata: { de: a.estado, para: novo } })
  // P2.22: só o RECEBIMENTO confirmado é SAMPLE_DELIVERED (ENVIADA não é). Uma vez por amostra.
  if (novo === 'RECEBIDA' && a.estado !== 'RECEBIDA') await emitirAmostraEntregue(p.workspaceId, r)
  return r
}

async function emitirAmostraEntregue(workspaceId: string, a: { id: string; candidatoId: string | null; nomeProduto: string; recebidaEm: Date | null; prazoConteudoEm: Date | null }) {
  await registrarEvento({
    workspaceId, tipo: 'SAMPLE_DELIVERED', chaveIdempotencia: `amostra:${a.id}:recebida`, entidadeTipo: 'AmostraTikTokShop', entidadeId: a.id,
    payload: { candidatoId: a.candidatoId, produto: a.nomeProduto, recebidaEm: a.recebidaEm?.toISOString() ?? null, prazoConteudoEm: a.prazoConteudoEm?.toISOString() ?? null },
  })
}

/** Prazo de conteúdo VISTO no app (vira "confirmado"). */
export async function confirmarPrazo(p: { workspaceId: string; userId: string | null; id: string; prazoConteudoEm: string }) {
  const a = await prisma.amostraTikTokShop.findFirst({ where: { id: p.id, workspaceId: p.workspaceId } })
  if (!a) throw new ErroDeAmostra(404, 'Amostra não encontrada.')
  const prazo = new Date(p.prazoConteudoEm)
  if (Number.isNaN(prazo.getTime())) throw new ErroDeAmostra(400, 'Prazo inválido.')
  return prisma.amostraTikTokShop.update({ where: { id: a.id }, data: { prazoConteudoEm: prazo, prazoConteudoFonte: 'CONFIRMADO_NO_APP' } })
}

/**
 * O app CONTOU esta solicitação na missão de amostras (a titular viu o
 * contador subir). Idempotente. A meta manual passa a valer o MÁXIMO entre o
 * que já tinha e o total de amostras computadas — nunca soma em dobro com a
 * sincronização por print.
 */
export async function marcarMissaoComputada(p: { workspaceId: string; userId: string | null; id: string; agora?: Date }) {
  const agora = p.agora ?? new Date()
  return prisma.$transaction(async (tx) => {
    const a = await tx.amostraTikTokShop.findFirst({ where: { id: p.id, workspaceId: p.workspaceId } })
    if (!a) throw new ErroDeAmostra(404, 'Amostra não encontrada.')
    if (a.missaoComputada === true) return { amostra: a, meta: null, mudou: false }
    const meta = await tx.metaTikTokShop.findFirst({ where: { workspaceId: p.workspaceId, tipo: 'SOLICITAR_AMOSTRAS', status: 'ATIVA' }, orderBy: { fim: 'asc' } })
    const amostra = await tx.amostraTikTokShop.update({ where: { id: a.id }, data: { missaoComputada: true, missaoComputadaEm: agora, metaId: meta?.id ?? a.metaId } })
    if (!meta) return { amostra, meta: null, mudou: true }
    const computadas = await tx.amostraTikTokShop.count({ where: { workspaceId: p.workspaceId, missaoComputada: true } })
    const novo = Math.min(meta.quantidadeExigida, Math.max(meta.quantidadeRealizada, computadas))
    if (novo === meta.quantidadeRealizada) return { amostra, meta, mudou: true }
    const m = await tx.metaTikTokShop.update({ where: { id: meta.id }, data: { quantidadeRealizada: novo } })
    await tx.alteracaoMetaTikTok.create({ data: { workspaceId: p.workspaceId, metaId: meta.id, campo: 'quantidadeRealizada', valorAnterior: String(meta.quantidadeRealizada), valorNovo: String(novo), origem: 'AMOSTRA_COMPUTADA_CONFIRMADA_PELA_TITULAR' } })
    return { amostra, meta: m, mudou: true }
  })
}

/** Liga a amostra à publicação assistida aberta para o produto (quando a produção começa). */
export async function ligarPublicacaoNaAmostra(workspaceId: string, candidatoId: string, publicacaoAssistidaId: string) {
  await prisma.amostraTikTokShop.updateMany({ where: { workspaceId, candidatoId, estado: 'RECEBIDA', publicacaoAssistidaId: null }, data: { publicacaoAssistidaId } })
}

/** Candidatos com amostra RECEBIDA e produção ainda não aberta — vão na frente da próxima publicação. */
export async function candidatosComAmostraRecebida(workspaceId: string): Promise<{ candidatoId: string; recebidaEm: Date | null; prazoConteudoEm: Date | null }[]> {
  const r = await prisma.amostraTikTokShop.findMany({ where: { workspaceId, estado: 'RECEBIDA', publicacaoAssistidaId: null, candidatoId: { not: null } }, select: { candidatoId: true, recebidaEm: true, prazoConteudoEm: true } })
  return r.map((x) => ({ candidatoId: x.candidatoId!, recebidaEm: x.recebidaEm, prazoConteudoEm: x.prazoConteudoEm }))
}
