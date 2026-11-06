/**
 * P2.18.5 — MOTOR DA JORNADA (orquestrador central, FUNÇÕES PURAS).
 *
 *   fatos (entidades existentes + eventos) + capacidades + regras = próxima etapa
 *
 * A página /operacao NÃO decide nada: ela só mostra o que este motor
 * determinou. Regras de estado (pode publicar? recebeu? amostra aprovada?
 * concluiu?) são DETERMINÍSTICAS e auditáveis — nenhum modelo de ML entra
 * aqui (a IA só ranqueia/recomenda, antes, na escolha do produto).
 *
 * AÇÃO ≠ EXECUTOR: cada ação aponta para uma capacidade do registro central
 * (lib/capacidades-tiktok.ts). Se a capacidade é AUTOMATIC, o executor é a
 * API e a titular não vê nada; se é ASSISTED/UNAVAILABLE, a MESMA ação vira
 * ação humana. Liberar uma API muda só a capacidade, não a jornada.
 *
 * Não é um fluxo fixo A→B→C: cada regra olha os fatos e pula o que não se
 * aplica (produto em mãos pula amostra; produto fora do TikTok Shop pula
 * vitrine; falha automática cai para a contingência assistida).
 */
import { resumoDaAvaliacao, type AvaliacaoDeAmostra } from './oportunidade-de-amostra'
import type { Capacidade, Executor, IdDaCapacidade } from './capacidades-tiktok'

// ── Vocabulário ─────────────────────────────────────────────────────────

/** Quem a jornada está esperando. A titular só recebe ação em AGUARDANDO_CRISTIANE. */
export type Espera =
  | 'AGUARDANDO_CRISTIANE'
  | 'AGUARDANDO_PATRONO'
  | 'AGUARDANDO_TIKTOK'
  | 'AGUARDANDO_LOJISTA'
  | 'AGUARDANDO_ENTREGA'
  | 'CONCLUIDA'
  | 'ENCERRADA'

export type EtapaDaJornada =
  | 'APROVAR_PRODUTO'
  | 'VITRINE'
  | 'AMOSTRA'
  | 'AGUARDANDO_AMOSTRA'
  | 'RECEBIMENTO'
  | 'CONTEUDO'
  | 'MIDIA'
  | 'GERANDO_VIDEO'
  | 'APROVAR_VIDEO'
  | 'PUBLICAR'
  | 'MARCAR_PRODUTO'
  | 'MEDINDO'
  | 'RESULTADO'
  | 'CONCLUIDA'
  | 'ENCERRADA'

export type TipoDeAcao =
  | 'APROVAR_PRODUTO'
  | 'ADICIONAR_VITRINE'
  | 'PEDIR_AMOSTRA'
  | 'CONFIRMAR_RECEBIMENTO'
  | 'FORNECER_MIDIA_REAL'
  | 'APROVAR_VIDEO'
  | 'PUBLICAR_VIDEO'
  | 'MARCAR_PRODUTO'
  | 'COLAR_LINK_PUBLICADO'
  | 'CONFIRMAR_RESULTADO_MANUAL'
  | 'AUTORIZAR_ACAO_SENSIVEL'

/** Evidência mínima que a resposta precisa trazer. "JÁ FIZ" não vale para tudo. */
export type Evidencia = 'CONFIRMACAO' | 'URL' | 'UPLOAD' | 'NUMEROS' | 'APROVACAO_DO_ARQUIVO' | 'STATUS_OFICIAL' | 'DADO_API'

/** Proveniência de todo fato registrado. Informado pela titular NUNCA vira TIKTOK_API. */
export type Proveniencia = 'TIKTOK_API' | 'TIKTOK_MANUAL' | 'USER_CONFIRMED' | 'PATRONO_CALCULATED' | 'IMPORTED'

export interface RespostaPossivel {
  id: string
  rotulo: string
  principal?: boolean
  /** Evidência que ESTA resposta exige (sobrepõe a da ação). */
  evidencia?: Evidencia
}

export interface DefinicaoDaAcao {
  rotulo: string
  capacidade: IdDaCapacidade | null
  evidencia: Evidencia
  tempoEstimado: string
  respostas: RespostaPossivel[]
}

const NAO_QUERO: RespostaPossivel = { id: 'NAO_QUERO', rotulo: 'NÃO QUERO ESTE PRODUTO' }
const TENHO_EM_MAOS: RespostaPossivel = { id: 'TENHO_EM_MAOS', rotulo: 'JÁ TENHO ESTE PRODUTO' }

/** Catálogo das ações: o que cada uma exige, independentemente de quem executa. */
export const ACOES: Record<TipoDeAcao, DefinicaoDaAcao> = {
  APROVAR_PRODUTO: { rotulo: 'Aprovar o produto escolhido', capacidade: null, evidencia: 'CONFIRMACAO', tempoEstimado: '~10 segundos', respostas: [{ id: 'APROVAR', rotulo: 'APROVAR', principal: true }, TENHO_EM_MAOS, NAO_QUERO] },
  ADICIONAR_VITRINE: { rotulo: 'Adicionar o produto à vitrine', capacidade: 'TIKTOK_SHOWCASE_WRITE', evidencia: 'CONFIRMACAO', tempoEstimado: '~30 segundos', respostas: [{ id: 'FEITO', rotulo: 'JÁ ADICIONEI', principal: true }, { id: 'INDISPONIVEL', rotulo: 'O APP NÃO DEIXA ADICIONAR' }, NAO_QUERO] },
  PEDIR_AMOSTRA: { rotulo: 'Pedir a amostra', capacidade: 'TIKTOK_SAMPLE_REQUEST', evidencia: 'CONFIRMACAO', tempoEstimado: '~1 minuto', respostas: [{ id: 'PEDIDO_FEITO', rotulo: 'PEDIDO FEITO', principal: true }, TENHO_EM_MAOS, { id: 'NAO_PEDIR', rotulo: 'NÃO PEDIR' }] },
  CONFIRMAR_RECEBIMENTO: { rotulo: 'Confirmar que o produto chegou', capacidade: 'TIKTOK_SAMPLE_STATUS', evidencia: 'CONFIRMACAO', tempoEstimado: '~5 segundos', respostas: [{ id: 'RECEBI', rotulo: 'CHEGOU', principal: true }, { id: 'AINDA_NAO', rotulo: 'AINDA NÃO CHEGOU' }] },
  FORNECER_MIDIA_REAL: { rotulo: 'Gravar e enviar as fotos/vídeos', capacidade: null, evidencia: 'UPLOAD', tempoEstimado: '~5 minutos', respostas: [] },
  APROVAR_VIDEO: { rotulo: 'Aprovar o vídeo', capacidade: null, evidencia: 'APROVACAO_DO_ARQUIVO', tempoEstimado: '~1 minuto', respostas: [] },
  PUBLICAR_VIDEO: { rotulo: 'Publicar no TikTok', capacidade: 'TIKTOK_PUBLISH', evidencia: 'URL', tempoEstimado: '~2 minutos', respostas: [{ id: 'PUBLIQUEI', rotulo: 'JÁ PUBLIQUEI', principal: true, evidencia: 'URL' }] },
  MARCAR_PRODUTO: { rotulo: 'Finalizar no app marcando o produto', capacidade: 'TIKTOK_PRODUCT_TAG', evidencia: 'URL', tempoEstimado: '~1 minuto', respostas: [{ id: 'PUBLIQUEI', rotulo: 'JÁ PUBLIQUEI', principal: true, evidencia: 'URL' }] },
  COLAR_LINK_PUBLICADO: { rotulo: 'Colar o link do vídeo publicado', capacidade: 'TIKTOK_PUBLISH', evidencia: 'URL', tempoEstimado: '~15 segundos', respostas: [{ id: 'PUBLIQUEI', rotulo: 'SALVAR LINK', principal: true, evidencia: 'URL' }] },
  CONFIRMAR_RESULTADO_MANUAL: { rotulo: 'Informar o resultado do vídeo', capacidade: 'TIKTOK_METRICS', evidencia: 'NUMEROS', tempoEstimado: '~1 minuto', respostas: [{ id: 'INFORMAR', rotulo: 'SALVAR', principal: true, evidencia: 'NUMEROS' }] },
  AUTORIZAR_ACAO_SENSIVEL: { rotulo: 'Autorizar', capacidade: null, evidencia: 'CONFIRMACAO', tempoEstimado: '~10 segundos', respostas: [{ id: 'AUTORIZAR', rotulo: 'AUTORIZAR', principal: true }, { id: 'RECUSAR', rotulo: 'RECUSAR' }] },
}

/** Atualizações opcionais quando a jornada espera um terceiro e não há leitura oficial do status. */
export const ATUALIZACOES_DA_AMOSTRA: Record<string, RespostaPossivel[]> = {
  SOLICITADA: [{ id: 'AMOSTRA_APROVADA', rotulo: 'Aprovada' }, { id: 'AMOSTRA_ENVIADA', rotulo: 'Enviada' }, { id: 'AMOSTRA_RECEBIDA', rotulo: 'Chegou' }, { id: 'AMOSTRA_REJEITADA', rotulo: 'Rejeitada' }],
  PENDENTE_APROVACAO: [{ id: 'AMOSTRA_APROVADA', rotulo: 'Aprovada' }, { id: 'AMOSTRA_ENVIADA', rotulo: 'Enviada' }, { id: 'AMOSTRA_RECEBIDA', rotulo: 'Chegou' }, { id: 'AMOSTRA_REJEITADA', rotulo: 'Rejeitada' }],
  APROVADA: [{ id: 'AMOSTRA_ENVIADA', rotulo: 'Enviada' }, { id: 'AMOSTRA_RECEBIDA', rotulo: 'Chegou' }, { id: 'AMOSTRA_CANCELADA', rotulo: 'Cancelada' }],
  ENVIADA: [{ id: 'AMOSTRA_RECEBIDA', rotulo: 'Chegou' }, { id: 'AMOSTRA_CANCELADA', rotulo: 'Cancelada' }],
}

/** Link externo: só URL pública e confiável. Nunca URL privada inventada. */
export const URL_PUBLICAR_NO_TIKTOK = 'https://www.tiktok.com/upload'
export const URL_TIKTOK = 'https://www.tiktok.com/'
const LINK_DE_PRODUTO_CONFIAVEL = /^https:\/\/(www\.|shop\.|vt\.)?tiktok\.com\//i

// ── Fatos ───────────────────────────────────────────────────────────────

export interface DecisoesDaJornada {
  /** JOURNEY_STARTED: a titular aprovou (ou a jornada foi adotada de algo que ela já tinha feito). */
  iniciada: boolean
  recusada: boolean
  /** Vitrine confirmada pela titular (USER_CONFIRMED) ou indisponível no app. */
  vitrine: 'CONFIRMADA' | 'INDISPONIVEL' | null
  amostraDispensada: boolean
  /** A titular declarou ter o produto (USER_CONFIRMED). */
  emMaos: boolean
  /** Falha do Patrono que encerra a jornada (ex.: nenhum roteiro passou na checagem). */
  falha: string | null
  encerrada: string | null
  /** Última vez que a titular disse "ainda não chegou" (não perguntar de novo por alguns dias). */
  entregaPerguntadaEm: Date | null
}

export interface FatosDaJornada {
  candidato: {
    id: string
    nome: string
    imagem: string | null
    linkProduto: string | null
    providerId: string | null
    externalId: string | null
    status: string
    score: number
    baseDeEvidencia: number
    comissaoPercentual: number | null
    comissaoValor: number | null
    vendas: number | null
    preco: number | null
    compradoPelaTitular: boolean
    usadoPelaTitular: boolean
    complianceBloqueante: boolean
    motivos: string[]
  }
  decisoes: DecisoesDaJornada
  /** Registro oficial da vitrine (só o fluxo automático grava aqui). */
  vitrineOficial: { estado: string } | null
  amostra: { id: string; estado: string; tipo: string | null; enviadaEm: Date | null; recebidaEm: Date | null } | null
  assistida: {
    id: string
    estado: string
    versao: number
    videoGerado: boolean
    geracaoFalhou: boolean
    bloqueio: string | null
    erro: string | null
    modoDePublicacao: string | null
    publicadoEm: Date | null
    /** P2.50: os TRÊS controles + campanha. Ausente = dado antigo (tratado como retido pelo servidor ao publicar). */
    liberacao?: { liberado: boolean; motivos: string[] }
  } | null
  /** Outra publicação em produção que impede começar este vídeo agora (uma por vez no estúdio). */
  outraProducao: { nomeProduto: string } | null
  resultado: { id: string; views: number | null; vendas: number | null; comissao: number | null; publicadoEm: Date } | null
  midiaAutorizada: boolean
  tipoDeAmostraObservado: string | null
  missoes: { nome: string; tipo: string; fim: Date; faltam: number }[]
  /** P2.22 — SampleOpportunityScore (decisão explicada). Ausente = não avaliado (fluxo anterior). */
  oportunidadeDeAmostra?: AvaliacaoDeAmostra | null
}

// ── Saída ───────────────────────────────────────────────────────────────

export const PASSOS_DO_PROGRESSO = ['Produto', 'Vitrine', 'Amostra', 'Recebimento', 'Conteúdo', 'Aprovação', 'Publicação', 'Resultado'] as const
export type SituacaoDoPasso = 'CONCLUIDO' | 'ATUAL' | 'FUTURO' | 'PULADO' | 'BLOQUEADO_EXTERNAMENTE'
export interface PassoDoProgresso { passo: (typeof PASSOS_DO_PROGRESSO)[number]; situacao: SituacaoDoPasso }

export interface AcaoHumana {
  tipo: TipoDeAcao
  rotulo: string
  /** Uma linha: o que fazer. */
  instrucao: string
  porQueNaoAutomatico: string
  tempoEstimado: string
  evidencia: Evidencia
  respostas: RespostaPossivel[]
  linkExterno: { rotulo: string; url: string } | null
}

export interface EstadoDaJornada {
  candidatoId: string
  produto: { nome: string; imagem: string | null; link: string | null }
  etapa: EtapaDaJornada
  espera: Espera
  executor: Executor
  /** O que está acontecendo, em uma linha. */
  titulo: string
  acao: AcaoHumana | null
  /** Quando espera um terceiro sem leitura oficial: "mudou no app?" (opcional, nunca obrigatório). */
  atualizacoes: RespostaPossivel[]
  patronoJaFez: string[]
  porqueEsteProduto: string[]
  depois: string
  aguardando: string | null
  proximoMarco: string
  missao: string | null
  prazo: string | null
  progresso: PassoDoProgresso[]
  terminal: boolean
  /** Para prioridade: quanto mais perto do dinheiro, maior. */
  pertoDoDinheiro: number
}

// ── Regras ──────────────────────────────────────────────────────────────

const HORA = 60 * 60 * 1000
const DIA = 24 * HORA
/** Depois de publicado, quanto esperar antes de pedir os números (sem API de métricas). */
export const ESPERA_PARA_MEDIR_H = 48
/** Depois de "enviada", quantos dias até perguntar se chegou. */
export const DIAS_ATE_PERGUNTAR_ENTREGA = 7
/** Depois de "ainda não chegou", quantos dias até perguntar de novo. */
export const DIAS_ENTRE_PERGUNTAS_DE_ENTREGA = 3

const dataBR = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })

export function ehProdutoDoTikTokShop(c: Pick<FatosDaJornada['candidato'], 'providerId' | 'externalId' | 'linkProduto'>): boolean {
  return (c.providerId === 'tiktok-shop' && !!c.externalId) || (!!c.linkProduto && LINK_DE_PRODUTO_CONFIAVEL.test(c.linkProduto))
}

/** A titular tem o produto (declarou, comprou/usou, já há mídia dela ou a amostra chegou). */
export function temOProduto(f: FatosDaJornada): boolean {
  return f.decisoes.emMaos || f.candidato.compradoPelaTitular || f.candidato.usadoPelaTitular || f.midiaAutorizada || ['RECEBIDA', 'CONCLUIDA'].includes(f.amostra?.estado ?? '')
}

/** A amostra foi pulada porque a titular já tinha o produto (não porque chegou). */
function amostraPulada(f: FatosDaJornada): boolean {
  return temOProduto(f) && !f.amostra
}

function linkDoProduto(f: FatosDaJornada): { rotulo: string; url: string } {
  const l = f.candidato.linkProduto
  return l && LINK_DE_PRODUTO_CONFIAVEL.test(l) ? { rotulo: 'ABRIR NO TIKTOK', url: l } : { rotulo: 'ABRIR NO TIKTOK', url: URL_TIKTOK }
}

function missaoDaAcao(f: FatosDaJornada, tipo: TipoDeAcao | null, agora: Date): { texto: string; prazo: string } | null {
  if (!tipo) return null
  const tiposDaMissao: Partial<Record<TipoDeAcao, string[]>> = {
    ADICIONAR_VITRINE: ['ADICIONAR_PRODUTOS'],
    PEDIR_AMOSTRA: ['SOLICITAR_AMOSTRAS'],
    FORNECER_MIDIA_REAL: ['VIDEOS_QUALIFICADOS', 'VIDEOS_COM_PRODUTO'],
    APROVAR_VIDEO: ['VIDEOS_QUALIFICADOS', 'VIDEOS_COM_PRODUTO'],
    PUBLICAR_VIDEO: ['VIDEOS_QUALIFICADOS', 'VIDEOS_COM_PRODUTO'],
    MARCAR_PRODUTO: ['VIDEOS_COM_PRODUTO'],
  }
  const m = f.missoes.filter((x) => (tiposDaMissao[tipo] ?? []).includes(x.tipo) && x.faltam > 0 && x.fim.getTime() > agora.getTime()).sort((a, b) => a.fim.getTime() - b.fim.getTime())[0]
  return m ? { texto: `Esta ação também ajuda na missão "${m.nome}" (faltam ${m.faltam}, até ${dataBR(m.fim)}).`, prazo: m.fim.toISOString() } : null
}

/** Ordem das etapas na barra (índice no PASSOS_DO_PROGRESSO). */
const PASSO_DA_ETAPA: Record<EtapaDaJornada, number> = {
  APROVAR_PRODUTO: 0, VITRINE: 1, AMOSTRA: 2, AGUARDANDO_AMOSTRA: 2, RECEBIMENTO: 3, CONTEUDO: 4, MIDIA: 4, GERANDO_VIDEO: 4,
  APROVAR_VIDEO: 5, PUBLICAR: 6, MARCAR_PRODUTO: 6, MEDINDO: 7, RESULTADO: 7, CONCLUIDA: 8, ENCERRADA: -1,
}

function progresso(f: FatosDaJornada, etapa: EtapaDaJornada, espera: Espera): PassoDoProgresso[] {
  const atual = PASSO_DA_ETAPA[etapa]
  const pulados = new Set<number>()
  const vitrineFeita = f.decisoes.vitrine === 'CONFIRMADA' || f.vitrineOficial?.estado === 'CONFIRMADO_NA_VITRINE'
  if (!ehProdutoDoTikTokShop(f.candidato) || f.decisoes.vitrine === 'INDISPONIVEL' || (temOProduto(f) && !vitrineFeita)) pulados.add(1)
  if (amostraPulada(f)) { pulados.add(2); pulados.add(3) }
  const externo = espera === 'AGUARDANDO_TIKTOK' || espera === 'AGUARDANDO_LOJISTA' || espera === 'AGUARDANDO_ENTREGA'
  return PASSOS_DO_PROGRESSO.map((passo, i) => ({
    passo,
    situacao: pulados.has(i) ? 'PULADO' : etapa === 'ENCERRADA' ? 'FUTURO' : i < atual ? 'CONCLUIDO' : i === atual ? (externo ? 'BLOQUEADO_EXTERNAMENTE' : 'ATUAL') : 'FUTURO',
  }))
}

interface Parcial {
  etapa: EtapaDaJornada
  espera: Espera
  executor: Executor
  titulo: string
  acao?: { tipo: TipoDeAcao; instrucao: string; porQueNaoAutomatico: string; respostas?: RespostaPossivel[]; linkExterno?: { rotulo: string; url: string } | null }
  atualizacoes?: RespostaPossivel[]
  depois: string
  aguardando?: string | null
  proximoMarco: string
  feito?: string[]
}

/**
 * FUNÇÃO PURA — o coração do orquestrador.
 * Mesmos fatos → mesmo estado (por isso o refresh volta exatamente à etapa).
 */
export function resolverProximaEtapa(f: FatosDaJornada, caps: Record<IdDaCapacidade, Capacidade>, agora: Date): EstadoDaJornada {
  const p = decidir(f, caps, agora)
  const def = p.acao ? ACOES[p.acao.tipo] : null
  const missao = missaoDaAcao(f, p.acao?.tipo ?? null, agora)
  const feito = [
    'Encontrou e analisou o produto',
    `Ranqueou (nota ${f.candidato.score})`,
    ...(f.decisoes.iniciada ? ['Escolheu e você aprovou'] : ['Escolheu']),
    ...(p.feito ?? []),
  ]
  return {
    candidatoId: f.candidato.id,
    produto: { nome: f.candidato.nome, imagem: f.candidato.imagem, link: f.candidato.linkProduto },
    etapa: p.etapa,
    espera: p.espera,
    executor: p.executor,
    titulo: p.titulo,
    acao: p.acao && def
      ? {
          tipo: p.acao.tipo,
          rotulo: def.rotulo,
          instrucao: p.acao.instrucao,
          porQueNaoAutomatico: p.acao.porQueNaoAutomatico,
          tempoEstimado: def.tempoEstimado,
          evidencia: def.evidencia,
          respostas: p.acao.respostas ?? def.respostas,
          linkExterno: p.acao.linkExterno ?? null,
        }
      : null,
    atualizacoes: p.atualizacoes ?? [],
    patronoJaFez: feito,
    porqueEsteProduto: f.candidato.motivos.slice(0, 5),
    depois: p.depois,
    aguardando: p.aguardando ?? null,
    proximoMarco: p.proximoMarco,
    missao: missao?.texto ?? null,
    prazo: missao?.prazo ?? null,
    progresso: progresso(f, p.etapa, p.espera),
    terminal: p.espera === 'CONCLUIDA' || p.espera === 'ENCERRADA',
    pertoDoDinheiro: p.etapa === 'ENCERRADA' ? -1 : PASSO_DA_ETAPA[p.etapa],
  }
}

function encerrada(motivo: string): Parcial {
  return { etapa: 'ENCERRADA', espera: 'ENCERRADA', executor: 'PATRONO', titulo: `Jornada encerrada: ${motivo}`, depois: 'O Patrono já traz o próximo produto.', proximoMarco: 'Próximo produto' }
}

function decidir(f: FatosDaJornada, caps: Record<IdDaCapacidade, Capacidade>, agora: Date): Parcial {
  const d = f.decisoes
  const c = f.candidato
  if (d.encerrada) return encerrada(d.encerrada)
  if (d.recusada || c.status === 'DESCARTADO') return encerrada('você não quis este produto')
  if (c.complianceBloqueante) return encerrada('o produto tem bloqueio de compliance')
  if (d.falha) return encerrada(d.falha)

  const a = f.assistida
  // ── Depois de publicado: medir e aprender ──
  if (a?.estado === 'PUBLICADO' || f.resultado) {
    const r = f.resultado
    if (r && r.views !== null) {
      return { etapa: 'CONCLUIDA', espera: 'CONCLUIDA', executor: 'PATRONO', titulo: 'Aprendizado registrado', depois: 'O Patrono usa este resultado para escolher o próximo produto e o formato.', proximoMarco: 'Próxima jornada', feito: ['Gerou o vídeo', 'Mediu o resultado', 'Registrou o aprendizado'] }
    }
    const publicadoEm = r?.publicadoEm ?? a?.publicadoEm ?? agora
    const horas = (agora.getTime() - publicadoEm.getTime()) / HORA
    if (caps.TIKTOK_METRICS.modo === 'AUTOMATIC') {
      return { etapa: 'MEDINDO', espera: 'AGUARDANDO_PATRONO', executor: 'API_EXTERNA', titulo: 'Medindo pela API oficial', aguardando: 'O coletor de métricas', depois: 'Com os números, o Patrono registra o aprendizado.', proximoMarco: 'Resultado', feito: ['Publicou', 'Está coletando as métricas'] }
    }
    if (horas < ESPERA_PARA_MEDIR_H) {
      return { etapa: 'MEDINDO', espera: 'AGUARDANDO_PATRONO', executor: 'PATRONO', titulo: 'Medindo: o vídeo precisa de tempo no ar', aguardando: `${ESPERA_PARA_MEDIR_H} h depois da publicação (${Math.max(0, Math.ceil(ESPERA_PARA_MEDIR_H - horas))} h restantes)`, depois: `Em ${dataBR(new Date(publicadoEm.getTime() + ESPERA_PARA_MEDIR_H * HORA))}, o Patrono pede só os números que o app mostra.`, proximoMarco: 'Resultado', feito: ['Publicou', 'Marcou o início da medição'] }
    }
    return {
      etapa: 'RESULTADO', espera: 'AGUARDANDO_CRISTIANE', executor: 'HUMANO', titulo: 'Informar o resultado do vídeo',
      acao: { tipo: 'CONFIRMAR_RESULTADO_MANUAL', instrucao: 'Abra o vídeo no app e copie views, vendas e comissão (o resto o Patrono calcula).', porQueNaoAutomatico: caps.TIKTOK_METRICS.motivo, linkExterno: { rotulo: 'ABRIR NO TIKTOK', url: URL_TIKTOK } },
      depois: 'O Patrono registra o aprendizado e já traz o próximo produto. Comissão informada fica como "informada", nunca "paga confirmada".',
      proximoMarco: 'Aprendizado', feito: ['Publicou', 'Esperou 48 h no ar'],
    }
  }

  if (a && a.estado !== 'REJEITADO') {
    const mp4 = ['Preparou roteiro, cenas e legenda', 'Gerou o vídeo', 'Rodou o Quality Gate']
    if (a.estado === 'PUBLICANDO') {
      if (/caixa de entrada/i.test(a.bloqueio ?? '') || a.modoDePublicacao === 'API_RASCUNHO') {
        return {
          etapa: 'MARCAR_PRODUTO', espera: 'AGUARDANDO_CRISTIANE', executor: 'HUMANO', titulo: 'Finalizar no app',
          acao: { tipo: 'MARCAR_PRODUTO', instrucao: 'O rascunho está na sua caixa de entrada do TikTok: marque o produto, publique e cole o link aqui.', porQueNaoAutomatico: caps.TIKTOK_PRODUCT_TAG.motivo, linkExterno: { rotulo: 'ABRIR NO TIKTOK', url: URL_TIKTOK } },
          depois: 'Com o link, o Patrono começa a medir.', proximoMarco: 'Medição', feito: [...mp4, 'Você aprovou', 'Enviou o rascunho'],
        }
      }
      return { etapa: 'PUBLICAR', espera: 'AGUARDANDO_TIKTOK', executor: 'API_EXTERNA', titulo: 'Enviado ao TikTok: aguardando a confirmação', aguardando: 'O TikTok processar o envio', depois: 'Confirmado, o Patrono começa a medir.', proximoMarco: 'Medição', feito: [...mp4, 'Você aprovou', 'Enviou ao TikTok'] }
    }
    // Fallback: a publicação automática falhou → contingência assistida, sem travar a jornada.
    const falhouPublicar = a.estado === 'FALHOU'
    if (a.estado === 'APROVADO' || falhouPublicar) {
      if (!a.videoGerado) {
        return { etapa: 'MIDIA', espera: 'AGUARDANDO_CRISTIANE', executor: 'HUMANO', titulo: 'Falta o arquivo de vídeo', acao: { tipo: 'FORNECER_MIDIA_REAL', instrucao: 'Envie de 3 a 10 fotos ou vídeos seus do produto: o Patrono monta o vídeo.', porQueNaoAutomatico: 'Mídia real é sua por regra (direito de uso).' }, depois: 'O Patrono gera o vídeo e roda a checagem.', proximoMarco: 'Vídeo pronto' }
      }
      // P2.50 (A1): aprovado mas RETIDO pelos três controles/campanha → nenhuma ação de publicar (nem API, nem assistida).
      if (a.liberacao && !a.liberacao.liberado) {
        return { etapa: 'PUBLICAR', espera: 'AGUARDANDO_CRISTIANE', executor: 'HUMANO', titulo: 'Publicação retida', aguardando: `Resolver: ${a.liberacao.motivos.join(' ')}`, depois: 'Resolvidas as pendências, o Patrono libera o pacote de publicação aqui mesmo.', proximoMarco: 'Publicação', feito: [...mp4, 'Você aprovou'] }
      }
      if (caps.TIKTOK_PUBLISH.modo === 'AUTOMATIC' && !falhouPublicar) {
        return { etapa: 'PUBLICAR', espera: 'AGUARDANDO_PATRONO', executor: 'API_EXTERNA', titulo: 'Publicando pela API oficial', aguardando: 'O envio ao TikTok', depois: 'Se o envio falhar, a publicação assistida aparece aqui mesmo.', proximoMarco: 'Medição', feito: [...mp4, 'Você aprovou'] }
      }
      const incerto = (a.erro ?? '').startsWith('ENVIO INCERTO')
      return {
        etapa: 'PUBLICAR', espera: 'AGUARDANDO_CRISTIANE', executor: 'HUMANO', titulo: 'Publicar no TikTok',
        acao: {
          tipo: 'PUBLICAR_VIDEO',
          instrucao: incerto
            ? 'O envio automático pode ter chegado: confira o seu perfil. Se o vídeo já está lá, só cole o link; se não, publique o vídeo abaixo marcando o produto.'
            : 'No app: envie o vídeo abaixo, cole a legenda, marque o produto (se o app pedir, adicione à vitrine) e publique. Depois cole o link aqui.',
          porQueNaoAutomatico: falhouPublicar ? `A publicação automática falhou; seguimos pela contingência assistida. ${caps.TIKTOK_PUBLISH.motivo}` : caps.TIKTOK_PUBLISH.motivo,
          linkExterno: { rotulo: 'ABRIR NO TIKTOK', url: URL_PUBLICAR_NO_TIKTOK },
        },
        depois: 'Com o link, o Patrono começa a medir e prepara o próximo produto.', proximoMarco: 'Medição', feito: [...mp4, 'Você aprovou', 'Montou o pacote de publicação'],
      }
    }
    if (a.estado === 'AGUARDANDO_APROVACAO' && a.videoGerado) {
      return { etapa: 'APROVAR_VIDEO', espera: 'AGUARDANDO_CRISTIANE', executor: 'HUMANO', titulo: 'Aprovar o vídeo', acao: { tipo: 'APROVAR_VIDEO', instrucao: 'Assista e aprove, peça ajuste ou rejeite.', porQueNaoAutomatico: 'Aprovar é papel seu por regra nas 10 primeiras publicações (depois: semiautomático → automático).' }, depois: 'Aprovado, o Patrono monta o pacote de publicação.', proximoMarco: 'Publicação', feito: mp4 }
    }
    if (a.estado === 'AGUARDANDO_MIDIA' || a.geracaoFalhou) {
      return {
        etapa: 'MIDIA', espera: 'AGUARDANDO_CRISTIANE', executor: 'HUMANO', titulo: a.geracaoFalhou ? 'A geração do vídeo falhou: envie outra mídia' : 'Gravar e enviar a mídia',
        acao: { tipo: 'FORNECER_MIDIA_REAL', instrucao: 'Grave as cenas da lista "O que gravar" e envie de 3 a 10 fotos ou vídeos de uma vez.', porQueNaoAutomatico: 'Mídia real do produto é sua por regra (direito de uso); o Patrono não usa foto do vendedor.' },
        depois: 'O Patrono gera UM vídeo com o lote todo e roda a checagem.', proximoMarco: 'Vídeo pronto', feito: ['Preparou roteiro, cenas e legenda', 'Montou a lista "O que gravar"'],
      }
    }
    // GERANDO / PRONTO / VIDEO_NA_FILA / GERANDO_VIDEO / AJUSTE_PEDIDO / AGUARDANDO_APROVACAO sem MP4
    return { etapa: 'GERANDO_VIDEO', espera: 'AGUARDANDO_PATRONO', executor: 'PATRONO', titulo: a.estado === 'AJUSTE_PEDIDO' ? 'Refazendo o vídeo com o seu ajuste' : 'Gerando o vídeo', aguardando: 'O render e o Quality Gate do arquivo', depois: 'Pronto, o vídeo aparece aqui para você aprovar.', proximoMarco: 'Aprovação do vídeo', feito: ['Preparou roteiro, cenas e legenda', 'Recebeu a sua mídia'] }
  }
  if (a?.estado === 'REJEITADO') return encerrada('você rejeitou a publicação')

  // ── Antes do conteúdo ──
  if (!d.iniciada) {
    return {
      etapa: 'APROVAR_PRODUTO', espera: 'AGUARDANDO_CRISTIANE', executor: 'HUMANO', titulo: 'Aprovar o produto escolhido',
      acao: { tipo: 'APROVAR_PRODUTO', instrucao: `O Patrono escolheu "${c.nome}". Aprove, diga que já tem o produto ou recuse.`, porQueNaoAutomatico: 'Aprovar o produto é papel seu por regra (o Patrono escolhe; você aprova).', linkExterno: c.linkProduto && LINK_DE_PRODUTO_CONFIAVEL.test(c.linkProduto) ? { rotulo: 'VER NO TIKTOK', url: c.linkProduto } : null },
      depois: temOProduto(f) ? 'Como você já tem o produto, vitrine e amostra saem da frente: o Patrono vai direto ao "O que gravar".' : 'Aprovado, o Patrono decide vitrine e amostra e prepara o conteúdo.',
      proximoMarco: temOProduto(f) ? 'O que gravar' : 'Vitrine',
    }
  }

  const tiktokShop = ehProdutoDoTikTokShop(c)
  const vitrineOk = d.vitrine === 'CONFIRMADA' || f.vitrineOficial?.estado === 'CONFIRMADO_NA_VITRINE'
  // Produto em mãos: a vitrine não trava o caminho mais curto até a venda — ela entra na publicação
  // (ao marcar o produto no app). Sem o produto, a vitrine vem antes da amostra.
  if (tiktokShop && d.vitrine === null && !vitrineOk && !temOProduto(f)) {
    if (f.vitrineOficial?.estado === 'AGUARDANDO_APROVACAO') {
      return { etapa: 'VITRINE', espera: 'AGUARDANDO_LOJISTA', executor: 'TERCEIRO', titulo: 'Vitrine: aguardando o vendedor aprovar', aguardando: 'A aprovação do vendedor', depois: 'Aprovado, o Patrono segue para amostra/conteúdo.', proximoMarco: 'Amostra' }
    }
    const falhouApi = ['FALHOU', 'NAO_ENCONTRADO_NA_VITRINE'].includes(f.vitrineOficial?.estado ?? '')
    if (caps.TIKTOK_SHOWCASE_WRITE.modo === 'AUTOMATIC' && !falhouApi) {
      return { etapa: 'VITRINE', espera: 'AGUARDANDO_PATRONO', executor: 'API_EXTERNA', titulo: 'Adicionando à vitrine pela API oficial', aguardando: 'A confirmação na vitrine', depois: 'Confirmado, o Patrono decide a amostra.', proximoMarco: 'Amostra' }
    }
    return {
      etapa: 'VITRINE', espera: 'AGUARDANDO_CRISTIANE', executor: 'HUMANO', titulo: 'Adicionar o produto à vitrine',
      acao: { tipo: 'ADICIONAR_VITRINE', instrucao: 'Abra o produto no TikTok e toque em "Adicionar à vitrine".', porQueNaoAutomatico: falhouApi ? `A inclusão automática falhou; seguimos pela contingência. ${caps.TIKTOK_SHOWCASE_WRITE.motivo}` : caps.TIKTOK_SHOWCASE_WRITE.motivo, linkExterno: linkDoProduto(f) },
      depois: temOProduto(f) ? 'O Patrono vai direto ao conteúdo (você já tem o produto).' : 'O Patrono decide se vale pedir amostra.',
      proximoMarco: temOProduto(f) ? 'Conteúdo' : 'Amostra',
    }
  }
  if (d.vitrine === 'INDISPONIVEL' && !vitrineOk) return encerrada('o app não deixou adicionar o produto à vitrine (sem comissão de afiliada)')

  if (!temOProduto(f)) {
    const am = f.amostra
    if (!am) {
      if (d.amostraDispensada) return encerrada('sem amostra e sem o produto em mãos não há vídeo')
      if (f.tipoDeAmostraObservado === 'NENHUMA') return encerrada('o produto não oferece amostra e você não tem o produto')
      const tipo = f.tipoDeAmostraObservado === 'GRATIS' ? 'grátis' : f.tipoDeAmostraObservado === 'REEMBOLSAVEL' ? 'reembolsável' : 'tipo a conferir no app'
      // P2.22: a decisão vem do SampleOpportunityScore (fatores, pesos, ausentes e motivo); nunca "vale pedir" sem conta.
      const op = f.oportunidadeDeAmostra
      if (op?.decisao === 'NAO_PEDIR') return encerrada(`não vale pedir amostra — ${op.motivoFinal}`)
      if (op?.decisao === 'NAO_PRIORITARIO') {
        return {
          etapa: 'AMOSTRA', espera: 'AGUARDANDO_PATRONO', executor: 'PATRONO', titulo: 'Amostra: não prioritária agora', aguardando: op.motivoFinal,
          depois: 'Registre no app o que mudou (comissão, vendas, tipo de amostra) e o Patrono reavalia na hora; enquanto isso, traz produtos com decisão melhor.', proximoMarco: 'Amostra', feito: vitrineOk ? ['Vitrine confirmada'] : [],
        }
      }
      const instrucao = op ? `${resumoDaAvaliacao(op)} Abra o produto no TikTok e toque em "Solicitar amostra" (${tipo}).` : `Vale pedir a amostra (${tipo}): abra o produto no TikTok e toque em "Solicitar amostra".`
      return {
        etapa: 'AMOSTRA', espera: 'AGUARDANDO_CRISTIANE', executor: caps.TIKTOK_SAMPLE_REQUEST.modo === 'AUTOMATIC' ? 'API_EXTERNA' : 'HUMANO', titulo: op?.decisao === 'PEDIR_SE_PRIORIDADE' ? 'Pedir a amostra (se for prioridade)' : 'Pedir a amostra',
        acao: { tipo: 'PEDIR_AMOSTRA', instrucao, porQueNaoAutomatico: caps.TIKTOK_SAMPLE_REQUEST.motivo, linkExterno: linkDoProduto(f) },
        depois: 'O Patrono acompanha o pedido; você só avisa se o app mudar.', proximoMarco: 'Amostra aprovada', feito: vitrineOk ? ['Vitrine confirmada'] : [],
      }
    }
    const atualizacoes = ATUALIZACOES_DA_AMOSTRA[am.estado] ?? []
    if (['REJEITADA', 'CANCELADA'].includes(am.estado)) return encerrada(am.estado === 'REJEITADA' ? 'o vendedor rejeitou a amostra e você não tem o produto' : 'a amostra foi cancelada e você não tem o produto')
    if (am.estado === 'SOLICITADA' || am.estado === 'PENDENTE_APROVACAO') {
      return { etapa: 'AGUARDANDO_AMOSTRA', espera: 'AGUARDANDO_LOJISTA', executor: 'TERCEIRO', titulo: 'Amostra pedida: aguardando o vendedor', aguardando: 'A aprovação do vendedor. Nenhuma ação sua agora.', atualizacoes, depois: 'Aprovada, o Patrono acompanha o envio.', proximoMarco: 'Amostra aprovada', feito: ['Registrou o pedido'] }
    }
    if (am.estado === 'APROVADA') {
      return { etapa: 'AGUARDANDO_AMOSTRA', espera: 'AGUARDANDO_LOJISTA', executor: 'TERCEIRO', titulo: 'Amostra aprovada: aguardando o envio', aguardando: 'O vendedor despachar. Nenhuma ação sua agora.', atualizacoes, depois: 'Quando chegar, o Patrono abre o conteúdo na hora.', proximoMarco: 'Recebimento', feito: ['Registrou a aprovação'] }
    }
    if (am.estado === 'ENVIADA') {
      const dias = am.enviadaEm ? (agora.getTime() - am.enviadaEm.getTime()) / DIA : 0
      const perguntadaHa = f.decisoes.entregaPerguntadaEm ? (agora.getTime() - f.decisoes.entregaPerguntadaEm.getTime()) / DIA : Infinity
      if (dias >= DIAS_ATE_PERGUNTAR_ENTREGA && perguntadaHa >= DIAS_ENTRE_PERGUNTAS_DE_ENTREGA) {
        return { etapa: 'RECEBIMENTO', espera: 'AGUARDANDO_CRISTIANE', executor: 'HUMANO', titulo: 'O produto já chegou?', acao: { tipo: 'CONFIRMAR_RECEBIMENTO', instrucao: `Enviada há ${Math.floor(dias)} dias: confirme se o produto chegou.`, porQueNaoAutomatico: caps.TIKTOK_SAMPLE_STATUS.motivo }, depois: 'Chegou: o Patrono mostra "O que gravar" aqui mesmo.', proximoMarco: 'Conteúdo' }
      }
      return { etapa: 'RECEBIMENTO', espera: 'AGUARDANDO_ENTREGA', executor: 'TERCEIRO', titulo: 'Amostra a caminho', aguardando: 'A entrega. Nenhuma ação sua agora.', atualizacoes, depois: 'Quando chegar, toque em "Chegou": o Patrono mostra "O que gravar".', proximoMarco: 'Recebimento' }
    }
  }

  // ── Conteúdo (a titular tem o produto) ──
  if (f.outraProducao) {
    return { etapa: 'CONTEUDO', espera: 'AGUARDANDO_PATRONO', executor: 'PATRONO', titulo: 'Na fila do estúdio', aguardando: `O vídeo de "${f.outraProducao.nomeProduto}" terminar (um vídeo por vez)`, depois: 'Na vez deste produto, o Patrono prepara roteiro e "O que gravar".', proximoMarco: 'Conteúdo' }
  }
  return { etapa: 'CONTEUDO', espera: 'AGUARDANDO_PATRONO', executor: 'PATRONO', titulo: 'Preparando roteiro e "O que gravar"', aguardando: 'O Patrono montar o roteiro e as cenas', depois: 'Pronto, aparece aqui a lista do que gravar.', proximoMarco: 'Mídia' }
}

// ── Prioridade entre jornadas (atenção da titular, não limite do backend) ──

export const HORAS_DE_PRAZO_CRITICO = 72

/**
 * FUNÇÃO PURA. Ordem: prazo crítico → ação humana pendente → missão →
 * mais perto do dinheiro (conteúdo pronto/amostra recebida…) → potencial.
 * Terminais vão para o fim. O backend trabalha N jornadas em paralelo; esta
 * ordem só decide qual UMA aparece em foco.
 */
export function ordenarJornadas(estados: (EstadoDaJornada & { score?: number })[], agora: Date): (EstadoDaJornada & { score?: number })[] {
  const critico = (e: EstadoDaJornada) => e.espera === 'AGUARDANDO_CRISTIANE' && !!e.prazo && new Date(e.prazo).getTime() - agora.getTime() <= HORAS_DE_PRAZO_CRITICO * HORA
  return [...estados].sort(
    (a, b) =>
      Number(a.terminal) - Number(b.terminal) ||
      Number(critico(b)) - Number(critico(a)) ||
      (critico(a) && critico(b) ? new Date(a.prazo!).getTime() - new Date(b.prazo!).getTime() : 0) ||
      Number(b.espera === 'AGUARDANDO_CRISTIANE') - Number(a.espera === 'AGUARDANDO_CRISTIANE') ||
      Number(!!b.missao) - Number(!!a.missao) ||
      b.pertoDoDinheiro - a.pertoDoDinheiro ||
      (b.score ?? 0) - (a.score ?? 0)
  )
}

/** FUNÇÃO PURA. A resposta é válida para o estado ATUAL e traz a evidência mínima? */
export function validarResposta(e: EstadoDaJornada, resposta: string, dados: { url?: string | null; numeros?: Record<string, number | null> | null } = {}): string | null {
  const opcoes = [...(e.acao?.respostas ?? []), ...e.atualizacoes]
  const r = opcoes.find((x) => x.id === resposta)
  if (!r) return e.acao ? `"${resposta}" não é uma resposta válida para a etapa atual (${e.acao.rotulo}).` : 'Nenhuma ação sua agora nesta jornada.'
  const evidencia = r.evidencia ?? (e.acao && e.acao.respostas.includes(r) ? e.acao.evidencia : 'CONFIRMACAO')
  if (evidencia === 'URL' && !/^https:\/\/(www\.|vm\.|vt\.)?tiktok\.com\/.+/i.test((dados.url ?? '').trim())) return 'Cole o link do vídeo no TikTok (https://www.tiktok.com/@…/video/…).'
  if (evidencia === 'NUMEROS') {
    const n = dados.numeros ?? {}
    const valores = Object.values(n).filter((v) => v !== null && v !== undefined)
    if (!valores.length) return 'Informe ao menos as views do vídeo.'
    if (valores.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return 'Números inválidos.'
    if (n.views === null || n.views === undefined) return 'Informe ao menos as views do vídeo.'
  }
  return null
}

/** Identidade estável de uma etapa (para registrar a transição UMA vez). */
export function chaveDaEtapa(f: Pick<FatosDaJornada, 'assistida' | 'amostra'>, e: Pick<EstadoDaJornada, 'etapa' | 'espera'>): string {
  return [e.etapa, e.espera, f.assistida ? `${f.assistida.id}.v${f.assistida.versao}` : '-', f.amostra ? `${f.amostra.id}.${f.amostra.estado}` : '-'].join(':')
}
