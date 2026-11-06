/**
 * P2.18.5 — JORNADA ÚNICA: o serviço por trás da página /operacao.
 *
 * Persistência (decisão de arquitetura, sem migration):
 *   - os FATOS vivem nas entidades que já existiam (candidato, vitrine,
 *     amostra, publicação assistida, mídia, resultado, missões);
 *   - as DECISÕES e TRANSIÇÕES da jornada vivem no livro de eventos imutável
 *     (DomainEvent, idempotente por chave) com executor, proveniência,
 *     evidência e motivo; o MOTIVO DA ESCOLHA vai para o livro de decisões
 *     (DecisionRecord) — é dele que o aprendizado compara "por que escolhemos"
 *     × "quanto vendeu".
 * A "JornadaOperacional" é o modelo de leitura que junta tudo por produto.
 * Mesmos fatos → mesmo estado: refresh/fechar/voltar retomam a etapa exata.
 *
 * Quem decide a próxima etapa é o motor puro (lib/motor-da-jornada.ts).
 * Este arquivo só carrega fatos, executa a resposta da titular, registra
 * eventos e roda os passos automáticos do Patrono.
 */
import { decidirAgora, EM_PRODUCAO, type DecisaoAgora } from './decisao-agora'
import { aprendizadoCriativoDoWorkspace } from './resultados-videos'
import type { OrientacaoCriativa } from './aprendizado-criativo'
import { TIPO_ESCOLHA_DE_PRODUTO, cancelarPedidosPendentes } from './aprovacoes'
import { avaliacoesDeAmostra as avaliacoesDeAmostraEmLote } from './oportunidade-de-amostra-dados'
import type { AvaliacaoDeAmostra } from './oportunidade-de-amostra'
import { restricoesParaOperacao } from './cotas-da-plataforma'
import { textoDaQuota, type PermissaoDaAcao, type ResultadoDaPermissao } from './permissao-da-acao'
import type { CandidatoDeProduto } from '@prisma/client'
import { prisma } from './prisma'
import { registrarDecisao, registrarEvento, type TipoDeEvento } from './ledger'
import { capacidadesDoWorkspace } from './capacidades-tiktok'
import { analisarMetas, listarMetasAtivas } from './metas-tiktok'
import { statusReal } from './publicacao-assistida'
import { liberacaoExibida } from './arquivo-aprovado'
import { dispensaLegadaAtiva } from './arquivo-aprovado-vinculo'
import { monetizacaoDoWorkspace, type ResumoDeMonetizacao } from './monetizacao'
import {
  chaveDaEtapa,
  HORAS_DE_PRAZO_CRITICO,
  ordenarJornadas,
  resolverProximaEtapa,
  validarResposta,
  type DecisoesDaJornada,
  type EstadoDaJornada,
  type FatosDaJornada,
  type Proveniencia,
} from './motor-da-jornada'
import type { Capacidade, Executor, IdDaCapacidade } from './capacidades-tiktok'
import { CANDIDATO_NAO_EXCLUIDO, encerradaPorProdutoInativo, CADASTRO_NAO_EXCLUIDO } from './produto-canonico'

export const ENTIDADE_DA_JORNADA = 'JornadaOperacional'
/** P2.23: fonte única em lib/aprovacoes.ts (sem importar o ciclo inteiro). */
const TIPO_DA_ESCOLHA = TIPO_ESCOLHA_DE_PRODUTO
const DIA = 24 * 60 * 60 * 1000
/** Publicação concluída há mais que isso e já medida não volta como jornada adotada. */
const JANELA_DE_ADOCAO_DIAS = 30

export class ErroDaJornada extends Error {
  constructor(public readonly status: 400 | 404 | 409, mensagem: string) {
    super(mensagem)
  }
}

// ── Eventos da jornada (imutáveis, idempotentes) ────────────────────────

export interface EventoDaJornada {
  workspaceId: string
  candidatoId: string
  tipo: TipoDeEvento
  /** Sufixo da chave de idempotência (a mesma chave nunca grava duas vezes). */
  chave: string
  executor: Executor
  origem: Proveniencia
  evidencia?: string | null
  motivo?: string | null
  resultado?: string | null
  dados?: Record<string, unknown>
  userId?: string | null
}

/** Idempotente por chave — inclusive com duas requisições ao mesmo tempo (o livro trata a corrida). */
export async function registrarNaJornada(e: EventoDaJornada) {
  return registrarEvento({
    workspaceId: e.workspaceId,
    tipo: e.tipo,
    chaveIdempotencia: `jornada:${e.candidatoId}:${e.chave}`,
    entidadeTipo: ENTIDADE_DA_JORNADA,
    entidadeId: e.candidatoId,
    payload: { executor: e.executor, origem: e.origem, evidencia: e.evidencia ?? null, motivo: e.motivo ?? null, resultado: e.resultado ?? null, userId: e.userId ?? null, ...(e.dados ?? {}) },
  })
}

/** FUNÇÃO PURA. Decisões da jornada a partir dos eventos dela (nada fica só num campo "status"). */
export function decisoesDosEventos(eventos: { tipo: string; payload: unknown; ocorridoEm?: Date }[]): DecisoesDaJornada {
  const d: DecisoesDaJornada = { iniciada: false, recusada: false, vitrine: null, amostraDispensada: false, emMaos: false, falha: null, encerrada: null, entregaPerguntadaEm: null }
  for (const e of eventos) {
    const p = (e.payload ?? {}) as { motivo?: string | null }
    if (e.tipo === 'JOURNEY_STARTED') d.iniciada = true
    if (e.tipo === 'PRODUCT_REJECTED') d.recusada = true
    // Escolha explícita DEPOIS de uma recusa: a titular mudou de ideia (a recusa antiga deixa de valer).
    if (e.tipo === 'PRODUCT_CHOSEN') d.recusada = false
    if (e.tipo === 'SHOWCASE_CONFIRMED') d.vitrine = 'CONFIRMADA'
    if (e.tipo === 'SHOWCASE_UNAVAILABLE' && d.vitrine !== 'CONFIRMADA') d.vitrine = 'INDISPONIVEL'
    if (e.tipo === 'SAMPLE_DECLINED') d.amostraDispensada = true
    if (e.tipo === 'SAMPLE_STATUS_REPORTED' && (e.payload as { resultado?: string } | null)?.resultado === 'AINDA_NAO_CHEGOU' && e.ocorridoEm) d.entregaPerguntadaEm = e.ocorridoEm
    if (e.tipo === 'PRODUCT_IN_HAND') d.emMaos = true
    if (e.tipo === 'JOURNEY_STEP_FAILED') d.falha = p.motivo ?? 'falha do Patrono'
    if (e.tipo === 'JOURNEY_CLOSED' && (e.payload as { manual?: boolean } | null)?.manual) d.encerrada = p.motivo ?? 'encerrada'
  }
  return d
}

// ── Carregar os fatos (uma ida por tabela, para TODAS as jornadas) ──────

type Candidato = Pick<CandidatoDeProduto, 'id' | 'nome' | 'imagem' | 'imagemAutorizada' | 'linkProduto' | 'providerId' | 'externalId' | 'status' | 'score' | 'baseDeEvidencia' | 'comissaoPercentual' | 'comissaoValor' | 'vendas' | 'preco' | 'compradoPelaTitular' | 'usadoPelaTitular' | 'complianceBloqueante' | 'motivosPositivos' | 'porqueDestaPosicao' | 'validoAte' | 'categoria'>
const CAMPOS_DO_CANDIDATO = {
  id: true, nome: true, imagem: true, imagemAutorizada: true, linkProduto: true, providerId: true, externalId: true, status: true, score: true, baseDeEvidencia: true,
  comissaoPercentual: true, comissaoValor: true, vendas: true, preco: true, compradoPelaTitular: true, usadoPelaTitular: true, complianceBloqueante: true,
  motivosPositivos: true, porqueDestaPosicao: true, validoAte: true, categoria: true,
} as const

export interface JornadaCarregada {
  fatos: FatosDaJornada
  estado: EstadoDaJornada
  proposta: boolean
  eventos: { tipo: string; payload: unknown; ocorridoEm: Date; chaveIdempotencia: string }[]
  assistida: Awaited<ReturnType<typeof prisma.publicacaoAssistida.findMany>>[number] | null
  amostra: Awaited<ReturnType<typeof prisma.amostraTikTokShop.findMany>>[number] | null
  resultado: Awaited<ReturnType<typeof prisma.videoTikTokResultado.findMany>>[number] | null
}

export interface ContextoDaOperacao {
  agora: Date
  capacidades: Record<IdDaCapacidade, Capacidade>
  jornadas: JornadaCarregada[]
  monetizacao: ResumoDeMonetizacao
  /** P2.20 — permissão de publicar vídeo promocional agora (motor único). */
  restricoes?: PermissaoDaAcao | null
  /** P2.21 — o que o aprendizado criativo vai aplicar no próximo vídeo (só PADRAO_PROVAVEL+). */
  orientacao?: OrientacaoCriativa | null
}

export async function carregarOperacao(workspaceId: string, agora: Date = new Date(), env: Record<string, string | undefined> = process.env): Promise<ContextoDaOperacao> {
  const [capacidades, eventos, assistidas, amostras, vitrines, metas, midias, monetizacao] = await Promise.all([
    capacidadesDoWorkspace(workspaceId, env, agora),
    prisma.domainEvent.findMany({ where: { workspaceId, entidadeTipo: ENTIDADE_DA_JORNADA }, orderBy: { ocorridoEm: 'asc' }, take: 5000, select: { tipo: true, payload: true, ocorridoEm: true, chaveIdempotencia: true, entidadeId: true } }),
    prisma.publicacaoAssistida.findMany({ where: { workspaceId, demonstracao: false, candidatoId: { not: null } }, orderBy: { createdAt: 'asc' } }),
    prisma.amostraTikTokShop.findMany({ where: { workspaceId, candidatoId: { not: null } }, orderBy: { createdAt: 'asc' } }),
    prisma.vitrineTikTokShop.findMany({ where: { workspaceId }, select: { candidatoId: true, productId: true, estado: true } }),
    listarMetasAtivas(workspaceId),
    prisma.midiaDoProduto.findMany({ where: { workspaceId, status: 'AUTORIZADA', candidatoId: { not: null }, NOT: { origem: 'GERADO_PELO_PATRONO' } }, select: { candidatoId: true } }),
    monetizacaoDoWorkspace(workspaceId, agora),
  ])
  const eventosPor = new Map<string, typeof eventos>()
  for (const e of eventos) if (e.entidadeId) eventosPor.set(e.entidadeId, [...(eventosPor.get(e.entidadeId) ?? []), e])
  const ultimaAssistida = new Map<string, (typeof assistidas)[number]>()
  // Encerrada porque o produto saiu (excluído/recomeço) não é decisão da titular: restaurado, a jornada continua.
  for (const a of assistidas) if (!encerradaPorProdutoInativo(a)) ultimaAssistida.set(a.candidatoId!, a)
  const ultimaAmostra = new Map<string, (typeof amostras)[number]>()
  for (const a of amostras) ultimaAmostra.set(a.candidatoId!, a)
  const comMidia = new Set(midias.map((m) => m.candidatoId!))

  // Adoção: tudo que já está em andamento vira jornada (nada se perde, nenhum dado é duplicado).
  const adotados = new Set<string>()
  for (const [id, a] of ultimaAssistida) {
    const recente = !a.publicadoEm || agora.getTime() - a.publicadoEm.getTime() < JANELA_DE_ADOCAO_DIAS * DIA
    if (a.estado !== 'REJEITADO' && recente) adotados.add(id)
  }
  for (const [id, a] of ultimaAmostra) if (!['CANCELADA', 'CONCLUIDA'].includes(a.estado)) adotados.add(id)
  const naJornada = new Set<string>([...eventosPor.keys(), ...adotados])

  // Pool de propostas: o que o Patrono pode trazer como PRÓXIMO produto (produto em mãos primeiro).
  const [doPoolBruto, daJornada, escolhasPendentes] = await Promise.all([
    prisma.candidatoDeProduto.findMany({
      where: {
        workspaceId, complianceBloqueante: false, id: { notIn: [...naJornada] },
        status: { in: ['NOVO', 'APRESENTADO', 'ESCOLHIDO', 'CADASTRADO'] }, AND: [CANDIDATO_NAO_EXCLUIDO],
        OR: [{ validoAte: { gte: agora } }, { compradoPelaTitular: true }, { usadoPelaTitular: true }],
      },
      orderBy: [{ compradoPelaTitular: 'desc' }, { usadoPelaTitular: 'desc' }, { baseDeEvidencia: 'desc' }, { score: 'desc' }],
      take: 8,
      select: CAMPOS_DO_CANDIDATO,
    }),
    // Cadastro excluído = fora da operação (a reconciliação depois marca o candidato como DESCARTADO).
    naJornada.size ? prisma.candidatoDeProduto.findMany({ where: { workspaceId, id: { in: [...naJornada] }, ...CADASTRO_NAO_EXCLUIDO }, select: CAMPOS_DO_CANDIDATO }) : Promise.resolve([] as Candidato[]),
    prisma.approvalRequest.findMany({ where: { workspaceId, status: 'PENDENTE', tipo: TIPO_DA_ESCOLHA }, select: { acaoProposta: true } }),
  ])
  // Produto em mãos primeiro (receita mais rápida); depois o que o supervisor já escolheu; depois evidência → nota.
  const doSupervisor = new Set(escolhasPendentes.map((r) => (r.acaoProposta as { candidatoId?: string } | null)?.candidatoId).filter((x): x is string => !!x))
  const peso = (c: Candidato) => (c.compradoPelaTitular || c.usadoPelaTitular ? 2 : 0) + (doSupervisor.has(c.id) ? 1 : 0)
  const doPool = [...doPoolBruto].sort((a, b) => peso(b) - peso(a))
  const todosOsIds = [...daJornada, ...doPool].map((c) => c.id)
  const [resultados, observacoes] = await Promise.all([
    prisma.videoTikTokResultado.findMany({ where: { workspaceId, publicacaoAssistidaId: { in: [...ultimaAssistida.values()].map((a) => a.id) } } }),
    todosOsIds.length ? prisma.observacaoDeMercado.findMany({ where: { workspaceId, candidatoId: { in: todosOsIds }, tipoDeAmostra: { not: null } }, orderBy: { observadoEm: 'asc' }, select: { candidatoId: true, tipoDeAmostra: true } }) : Promise.resolve([]),
  ])
  const tipoDeAmostra = new Map(observacoes.map((o) => [o.candidatoId!, o.tipoDeAmostra]))
  const analises = analisarMetas(metas, agora)
  const missoes = analises
    .filter((m) => m.situacao === 'EM_ANDAMENTO' || m.situacao === 'NAO_INICIADA')
    .map((m) => ({ nome: m.nome, tipo: m.tipo, fim: metas.find((x) => x.id === m.id)!.fim, faltam: m.faltam }))
  const producaoAtual = assistidas.filter((a) => EM_PRODUCAO.includes(a.estado)).at(-1) ?? null

  // P2.22: SampleOpportunityScore em lote para quem ainda não tem o produto nem amostra (decisão explicada, sem chute).
  const precisamDeAmostra = [...daJornada, ...doPool].filter((c) => !c.compradoPelaTitular && !c.usadoPelaTitular && !ultimaAmostra.has(c.id) && !decisoesDosEventos(eventosPor.get(c.id) ?? []).emMaos)
  const avaliacoesDeAmostra = await avaliacoesDeAmostraEmLote({ workspaceId, candidatos: precisamDeAmostra, metas: missoes, agora }).catch(() => new Map<string, AvaliacaoDeAmostra>())

  const montar = (c: Candidato, proposta: boolean): JornadaCarregada => {
    const evs = eventosPor.get(c.id) ?? []
    const decisoes = decisoesDosEventos(evs)
    const a = ultimaAssistida.get(c.id) ?? null
    const am = ultimaAmostra.get(c.id) ?? null
    // Adotada (já havia amostra/publicação) = a titular já tinha decidido este produto.
    if (!proposta && (a || am)) decisoes.iniciada = true
    const st = a ? statusReal(a) : null
    const r = a ? resultados.find((x) => x.publicacaoAssistidaId === a.id) ?? null : null
    const vit = vitrines.find((v) => v.candidatoId === c.id || (c.providerId === 'tiktok-shop' && c.externalId && v.productId === c.externalId)) ?? null
    const fatos: FatosDaJornada = {
      candidato: {
        id: c.id, nome: c.nome, imagem: c.imagemAutorizada ? c.imagem : null, linkProduto: c.linkProduto, providerId: c.providerId, externalId: c.externalId, status: c.status,
        score: c.score, baseDeEvidencia: c.baseDeEvidencia, comissaoPercentual: c.comissaoPercentual, comissaoValor: c.comissaoValor, vendas: c.vendas, preco: c.preco,
        compradoPelaTitular: c.compradoPelaTitular, usadoPelaTitular: c.usadoPelaTitular, complianceBloqueante: c.complianceBloqueante,
        motivos: [...c.porqueDestaPosicao, ...c.motivosPositivos],
      },
      decisoes,
      vitrineOficial: vit ? { estado: vit.estado } : null,
      amostra: am ? { id: am.id, estado: am.estado, tipo: am.tipo, enviadaEm: am.enviadaEm, recebidaEm: am.recebidaEm } : null,
      assistida: a ? {
        id: a.id, estado: a.estado, versao: a.versao, videoGerado: !!st?.videoGerado, geracaoFalhou: !!st?.etapas.includes('GERAÇÃO DO VÍDEO FALHOU'),
        bloqueio: a.bloqueio, erro: a.erro, modoDePublicacao: a.modoDePublicacao, publicadoEm: a.publicadoEm,
        // Dispensa SÓ dos testes legados do fluxo anterior (nunca em Production) — a mesma de publicarAprovada.
        liberacao: dispensaLegadaAtiva() ? undefined : liberacaoExibida(a),
      } : null,
      outraProducao: !a && producaoAtual && producaoAtual.candidatoId !== c.id ? { nomeProduto: producaoAtual.nomeProduto } : null,
      resultado: r ? { id: r.id, views: r.views, vendas: r.vendas, comissao: r.comissao, publicadoEm: r.publicadoEm } : null,
      midiaAutorizada: comMidia.has(c.id),
      tipoDeAmostraObservado: tipoDeAmostra.get(c.id) ?? null,
      missoes,
      oportunidadeDeAmostra: avaliacoesDeAmostra.get(c.id) ?? null,
    }
    return { fatos, estado: resolverProximaEtapa(fatos, capacidades, agora), proposta, eventos: evs, assistida: a, amostra: am, resultado: r }
  }

  const jornadas = daJornada.map((c) => montar(c, false))
  // O Patrono traz o próximo produto quando nenhuma jornada ativa precisa da titular (a operação nunca fica parada).
  const ativasComAcao = jornadas.filter((j) => !j.estado.terminal && j.estado.espera === 'AGUARDANDO_CRISTIANE').length
  // P2.18.7: campanha em risco GERA jornada — se faltam mais vídeos do que há jornadas de conteúdo, o Patrono traz mais um produto.
  const emConteudo = jornadas.filter((j) => !j.estado.terminal && ['CONTEUDO', 'MIDIA', 'GERANDO_VIDEO', 'APROVAR_VIDEO', 'PUBLICAR', 'MARCAR_PRODUTO'].includes(j.estado.etapa)).length
  const campanhaPedeMais = monetizacao.videosEmRisco > emConteudo
  if ((!ativasComAcao || campanhaPedeMais) && doPool[0]) jornadas.push(montar(doPool[0], true))
  // P2.20: quota da plataforma (decidida só pelo motor; falha de leitura não derruba a Operação).
  const restricoes = await restricoesParaOperacao(workspaceId, agora).catch(() => null)
  const orientacao = await aprendizadoCriativoDoWorkspace(workspaceId, agora).then((r) => r.orientacao).catch(() => null)
  return { agora, capacidades, jornadas, monetizacao, restricoes, orientacao }
}

// ── Leitura para a página ───────────────────────────────────────────────

const TEXTO_DO_EVENTO: Record<string, string> = {
  JOURNEY_STARTED: 'Você aprovou o produto',
  PRODUCT_CHOSEN: 'Você escolheu trabalhar este produto',
  PRODUCT_REJECTED: 'Você recusou o produto',
  PRODUCT_IN_HAND: 'Você informou que já tem o produto (amostra pulada)',
  SHOWCASE_CONFIRMED: 'Você confirmou: adicionado à vitrine',
  SHOWCASE_UNAVAILABLE: 'O app não deixou adicionar à vitrine',
  SAMPLE_REQUESTED: 'Você pediu a amostra',
  SAMPLE_DECLINED: 'Você preferiu não pedir amostra',
  SAMPLE_STATUS_REPORTED: 'Você informou o status da amostra',
  RESULT_REPORTED: 'Você informou o resultado',
  JOURNEY_STEP_FAILED: 'O Patrono não conseguiu preparar o conteúdo',
  JOURNEY_CLOSED: 'Jornada encerrada',
}

export function historicoDaJornada(j: JornadaCarregada): { em: string; texto: string }[] {
  const itens: { em: string; texto: string }[] = []
  for (const e of j.eventos) {
    const p = (e.payload ?? {}) as { titulo?: string; motivo?: string | null }
    const texto = e.tipo === 'JOURNEY_STEP_CHANGED' ? `Etapa: ${p.titulo ?? ''}` : `${TEXTO_DO_EVENTO[e.tipo] ?? e.tipo}${p.motivo && e.tipo !== 'JOURNEY_STARTED' ? ` (${p.motivo})` : ''}`
    itens.push({ em: e.ocorridoEm.toISOString(), texto })
  }
  for (const h of ((j.assistida?.historico as { em?: string; acao?: string }[] | undefined) ?? [])) if (h.em && h.acao) itens.push({ em: h.em, texto: `Vídeo: ${h.acao.toLowerCase().replace(/_/g, ' ')}` })
  for (const h of ((j.amostra?.historico as { em?: string; acao?: string }[] | undefined) ?? [])) if (h.em && h.acao) itens.push({ em: h.em, texto: `Amostra: ${h.acao.toLowerCase().replace(/_/g, ' ')}` })
  return itens.sort((a, b) => a.em.localeCompare(b.em)).slice(-30)
}

export interface VisaoDaOperacao {
  geradoEm: string
  prioritaria: (EstadoDaJornada & {
    proposta: boolean
    historico: { em: string; texto: string }[]
    assistida: { id: string; versao: number; apresentacao: unknown; qualityGate: unknown; objetivoDoTeste: string; vezesQueOProdutoApareceu: number; status: ReturnType<typeof statusReal>; imagem: string | null; versaoFinal: unknown; liberacao: { liberado: boolean; motivos: string[] } } | null
    resultadoId: string | null
  }) | null
  outras: { candidatoId: string; nome: string; titulo: string; espera: string }[]
  /** Nenhuma ação da titular em nenhuma jornada: o Patrono está trabalhando. */
  nenhumaAcaoSua: boolean
  /** P2.24 — o que fazer agora e POR QUÊ (sinais, alternativas e por que não). */
  agora: DecisaoAgora['agora']
  /** P2.18.7 — bloco HOJE (campanhas e dinheiro, compacto; potencial nunca soma com confirmado). */
  hoje: {
    campanhasAtivas: number
    prazoMaisProximo: ResumoDeMonetizacao['prazoMaisProximo']
    videosNecessariosHoje: number
    acoesPendentes: number
    receita: ResumoDeMonetizacao['receita']
    capacidade: ResumoDeMonetizacao['capacidade']
    campanhas: { titulo: string; progresso: string; faltam: number; prazo: string | null; urgencia: string; ritmo: number | null; pipeline: string }[]
    agenda: ResumoDeMonetizacao['agenda']
    naoCabe: ResumoDeMonetizacao['naoCabe']
    /** P2.20 — "Publicações promocionais hoje: 3/5" / "Limite não confirmado — não bloqueante" / "Ação indisponível: quota oficial atingida". */
    quota: { texto: string; resultado: ResultadoDaPermissao; motivo: string; fonte: string | null; limite: number | null; usado: number; restante: number | null; avisos: string[] } | null
  }
  capacidades: { id: string; nome: string; modo: string; executor: string }[]
}

/** Quando a titular escolheu este produto pela última vez ("ESCOLHER OUTRO PRODUTO"), ou 0. */
function escolhidaEm(j: JornadaCarregada): number {
  return Math.max(0, ...j.eventos.filter((e) => e.tipo === 'PRODUCT_CHOSEN').map((e) => e.ocorridoEm.getTime()))
}

export function visaoDaOperacao(ctx: ContextoDaOperacao): VisaoDaOperacao {
  const ativas = ctx.jornadas.filter((j) => !j.estado.terminal)
  // P2.24: UMA decisão, explicada — prazo crítico → publicação pronta → escolhida → em mãos → nota (lib/decisao-agora.ts).
  const decisao = decidirAgora({ jornadas: ativas.map((j) => ({ estado: j.estado, fatos: j.fatos, escolhidaEm: escolhidaEm(j) })), agora: ctx.agora, restricoes: ctx.restricoes ?? null, orientacao: ctx.orientacao ?? null })
  const porId = new Map(ativas.map((j) => [j.estado.candidatoId, j]))
  const ordem = decisao.ordem.map((i) => porId.get(i.candidatoId)!.estado)
  const top = ordem[0] ? ativas.find((j) => j.estado.candidatoId === ordem[0].candidatoId)! : null
  const a = top?.assistida ?? null
  return {
    geradoEm: ctx.agora.toISOString(),
    prioritaria: top
      ? {
          ...top.estado,
          proposta: top.proposta,
          historico: historicoDaJornada(top),
          assistida: a ? { id: a.id, versao: a.versao, apresentacao: a.apresentacao, qualityGate: a.qualityGate, objetivoDoTeste: a.objetivoDoTeste, vezesQueOProdutoApareceu: a.vezesQueOProdutoApareceu, status: statusReal(a), imagem: top.estado.produto.imagem, versaoFinal: a.versaoFinal, liberacao: liberacaoExibida(a) } : null,
          resultadoId: top.resultado?.id ?? null,
        }
      : null,
    outras: ordem.slice(1).map((e) => ({ candidatoId: e.candidatoId, nome: e.produto.nome, titulo: e.titulo, espera: e.espera })),
    agora: decisao.agora,
    nenhumaAcaoSua: !ativas.some((j) => j.estado.espera === 'AGUARDANDO_CRISTIANE'),
    hoje: {
      campanhasAtivas: ctx.monetizacao.ativas,
      prazoMaisProximo: ctx.monetizacao.prazoMaisProximo,
      videosNecessariosHoje: ctx.monetizacao.videosNecessariosHoje,
      acoesPendentes: ativas.filter((j) => j.estado.espera === 'AGUARDANDO_CRISTIANE').length,
      receita: ctx.monetizacao.receita,
      capacidade: ctx.monetizacao.capacidade,
      campanhas: ctx.monetizacao.oportunidades.filter((o) => o.tipo !== 'COMISSAO_POR_VENDA' && o.urgencia !== 'EXPIRADA' && o.faltam > 0).map((o) => ({
        titulo: o.titulo, progresso: `${o.progressoConfirmado}/${o.quantidadeNecessaria}`, faltam: o.faltam, prazo: o.fim, urgencia: o.urgencia, ritmo: o.ritmoNecessario,
        pipeline: `planejado ${o.pipeline.planejado} · gerado ${o.pipeline.gerado} · aprovado ${o.pipeline.aprovado} · publicado ${o.pipeline.publicado}`,
      })),
      agenda: ctx.monetizacao.agenda.filter((d) => d.total > 0).slice(0, 3),
      naoCabe: ctx.monetizacao.naoCabe,
      quota: ctx.restricoes ? { texto: textoDaQuota(ctx.restricoes), resultado: ctx.restricoes.resultado, motivo: ctx.restricoes.motivo, fonte: ctx.restricoes.fonte, limite: ctx.restricoes.limite, usado: ctx.restricoes.usadoHoje, restante: ctx.restricoes.quotaRestante, avisos: ctx.restricoes.avisos } : null,
    },
    capacidades: Object.values(ctx.capacidades).map((c) => ({ id: c.id, nome: c.nome, modo: c.modo, executor: c.executor })),
  }
}

// ── Passos automáticos do Patrono + registro das transições ─────────────

/**
 * Roda o que é do Patrono (preparar o conteúdo de quem já tem o produto) e
 * registra cada mudança de etapa como evento (uma vez por etapa). Idempotente:
 * chamar duas vezes seguidas não grava nada a mais.
 */
export async function sincronizarOperacao(p: { workspaceId: string; userId: string | null; agora?: Date; env?: Record<string, string | undefined> }): Promise<ContextoDaOperacao> {
  const agora = p.agora ?? new Date()
  let ctx = await carregarOperacao(p.workspaceId, agora, p.env)
  const preparar = ctx.jornadas.find((j) => !j.proposta && j.estado.etapa === 'CONTEUDO' && j.estado.espera === 'AGUARDANDO_PATRONO' && !j.fatos.outraProducao && !j.assistida)
  if (preparar) {
    const { prepararProximaPublicacao } = await import('./publicacao-assistida')
    try {
      await prepararProximaPublicacao({ workspaceId: p.workspaceId, userId: p.userId, agora, candidatoEmMaos: preparar.fatos.candidato.id, origem: 'jornada' })
    } catch (e) {
      // Falha do Patrono não trava a operação: a jornada encerra com o motivo e o próximo produto vem.
      await registrarNaJornada({ workspaceId: p.workspaceId, candidatoId: preparar.fatos.candidato.id, tipo: 'JOURNEY_STEP_FAILED', chave: 'conteudo-falhou', executor: 'PATRONO', origem: 'PATRONO_CALCULATED', motivo: e instanceof Error ? e.message.slice(0, 200) : 'falha ao preparar o conteúdo' })
    }
    ctx = await carregarOperacao(p.workspaceId, agora, p.env)
  }
  // Reativo: vídeo esperando aprovação/publicação tem os dados comerciais revalidados (preço não confirmado não vai ao ar).
  const paraRevisar = ctx.jornadas.filter((j) => !j.proposta && j.assistida && ['AGUARDANDO_APROVACAO', 'APROVADO', 'FALHOU'].includes(j.assistida.estado))
  if (paraRevisar.length) {
    const { revisarComercialDaAssistida } = await import('./publicacao-assistida')
    const r = await Promise.all(paraRevisar.map((j) => revisarComercialDaAssistida({ workspaceId: p.workspaceId, id: j.assistida!.id, agora }).catch(() => null)))
    if (r.some((x) => x?.regerou || x?.legendaCorrigida)) ctx = await carregarOperacao(p.workspaceId, agora, p.env)
  }
  for (const j of ctx.jornadas) {
    if (j.proposta) continue
    const chave = `etapa:${chaveDaEtapa(j.fatos, j.estado)}`
    if (j.eventos.some((e) => e.chaveIdempotencia === `jornada:${j.fatos.candidato.id}:${chave}`)) continue
    await registrarNaJornada({ workspaceId: p.workspaceId, candidatoId: j.fatos.candidato.id, tipo: 'JOURNEY_STEP_CHANGED', chave, executor: j.estado.executor, origem: 'PATRONO_CALCULATED', resultado: j.estado.espera, dados: { etapa: j.estado.etapa, espera: j.estado.espera, titulo: j.estado.titulo } })
  }
  return ctx
}

// ── A resposta da titular ───────────────────────────────────────────────

export interface RespostaDaTitular {
  workspaceId: string
  userId: string
  candidatoId: string
  resposta: string
  url?: string | null
  /** P2.32: som usado no app (opcional). */
  som?: string | null
  numeros?: { views?: number | null; vendas?: number | null; comissao?: number | null } | null
  agora?: Date
  env?: Record<string, string | undefined>
}

/**
 * Executa a resposta da titular na etapa ATUAL da jornada (regra
 * determinística: não dá para confirmar uma etapa que não é a atual) e
 * devolve a operação já recalculada — a próxima etapa aparece na mesma tela.
 */
export async function responderNaJornada(p: RespostaDaTitular): Promise<ContextoDaOperacao> {
  const agora = p.agora ?? new Date()
  const ctx = await carregarOperacao(p.workspaceId, agora, p.env)
  let j = ctx.jornadas.find((x) => x.fatos.candidato.id === p.candidatoId)
  if (!j) {
    // Produto fora das jornadas (ex.: a titular abriu a operação com outro produto em mente): só pode ser aprovado/recusado.
    const c = await prisma.candidatoDeProduto.findFirst({ where: { id: p.candidatoId, workspaceId: p.workspaceId }, select: { id: true } })
    if (!c) throw new ErroDaJornada(404, 'Produto não encontrado.')
    throw new ErroDaJornada(409, 'Este produto não está na operação agora.')
  }
  const erro = validarResposta(j.estado, p.resposta, { url: p.url, numeros: p.numeros ?? null })
  if (erro) throw new ErroDaJornada(j.estado.acao || j.estado.atualizacoes.length ? 400 : 409, erro)
  const base = { workspaceId: p.workspaceId, candidatoId: p.candidatoId, userId: p.userId }
  const c = j.fatos.candidato
  const tipo = j.estado.acao?.tipo

  switch (`${tipo ?? 'ATUALIZACAO'}:${p.resposta}`) {
    case 'APROVAR_PRODUTO:APROVAR':
    case 'APROVAR_PRODUTO:TENHO_EM_MAOS': {
      await iniciarJornada(j, p.workspaceId, p.userId)
      if (p.resposta === 'TENHO_EM_MAOS') await registrarNaJornada({ ...base, tipo: 'PRODUCT_IN_HAND', chave: 'em-maos', executor: 'HUMANO', origem: 'USER_CONFIRMED', evidencia: 'CONFIRMACAO' })
      break
    }
    case 'APROVAR_PRODUTO:NAO_QUERO':
    case 'ADICIONAR_VITRINE:NAO_QUERO': {
      // P2.29.1: NÃO QUERO = decisão de não continuar → regra canônica (encerra o que é certo, guarda o incerto).
      if (['NOVO', 'APRESENTADO'].includes(c.status)) {
        const { descartarCandidato } = await import('./curadoria')
        await descartarCandidato({ workspaceId: p.workspaceId, userId: p.userId, candidatoId: c.id, agora: p.agora }).catch(() => undefined)
      } else {
        const { encerrarPorRecusaDaTitular } = await import('./produto-canonico')
        await encerrarPorRecusaDaTitular({ workspaceId: p.workspaceId, candidatoId: c.id, agora: p.agora })
      }
      await registrarNaJornada({ ...base, tipo: 'PRODUCT_REJECTED', chave: 'recusado', executor: 'HUMANO', origem: 'USER_CONFIRMED', evidencia: 'CONFIRMACAO', motivo: 'A titular não quis este produto.' })
      await registrarDecisao({ workspaceId: p.workspaceId, tipo: 'JORNADA_PRODUTO_RECUSADO', ator: 'TITULAR', atorUserId: p.userId, decisao: 'RECUSADO', entidadeTipo: ENTIDADE_DA_JORNADA, entidadeId: c.id, explicacao: ['A titular recusou o produto escolhido pelo Patrono.'], chaveIdempotencia: `jornada:${c.id}:decisao:recusado` })
      break
    }
    case 'ADICIONAR_VITRINE:FEITO':
      // Confirmado pela TITULAR — nunca vira "confirmado pela API" (a tabela oficial da vitrine não é tocada).
      await registrarNaJornada({ ...base, tipo: 'SHOWCASE_CONFIRMED', chave: 'vitrine', executor: 'HUMANO', origem: 'USER_CONFIRMED', evidencia: 'CONFIRMACAO' })
      break
    case 'ADICIONAR_VITRINE:INDISPONIVEL':
      await registrarNaJornada({ ...base, tipo: 'SHOWCASE_UNAVAILABLE', chave: 'vitrine-indisponivel', executor: 'HUMANO', origem: 'TIKTOK_MANUAL', evidencia: 'CONFIRMACAO', motivo: 'O app não ofereceu "Adicionar à vitrine".' })
      break
    case 'PEDIR_AMOSTRA:PEDIDO_FEITO': {
      const { registrarAmostra } = await import('./amostras')
      await registrarAmostra({
        workspaceId: p.workspaceId, userId: p.userId, agora,
        dados: {
          nomeProduto: c.nome, candidatoId: c.id, productIdExterno: c.providerId === 'tiktok-shop' ? c.externalId : null, estado: 'PENDENTE_APROVACAO', solicitadaEm: agora,
          tipo: ['GRATIS', 'REEMBOLSAVEL'].includes(j.fatos.tipoDeAmostraObservado ?? '') ? j.fatos.tipoDeAmostraObservado : null,
          motivo: 'Pedida pela jornada: o Patrono decidiu que vale (produto escolhido e na vitrine).',
        },
      })
      await registrarNaJornada({ ...base, tipo: 'SAMPLE_REQUESTED', chave: 'amostra-pedida', executor: 'HUMANO', origem: 'USER_CONFIRMED', evidencia: 'CONFIRMACAO' })
      break
    }
    case 'PEDIR_AMOSTRA:TENHO_EM_MAOS':
      await registrarNaJornada({ ...base, tipo: 'PRODUCT_IN_HAND', chave: 'em-maos', executor: 'HUMANO', origem: 'USER_CONFIRMED', evidencia: 'CONFIRMACAO' })
      break
    case 'PEDIR_AMOSTRA:NAO_PEDIR':
      await registrarNaJornada({ ...base, tipo: 'SAMPLE_DECLINED', chave: 'amostra-dispensada', executor: 'HUMANO', origem: 'USER_CONFIRMED', evidencia: 'CONFIRMACAO' })
      break
    case 'CONFIRMAR_RECEBIMENTO:RECEBI':
      await eventoDaAmostra(j, 'RECEBIDA', p, agora)
      break
    case 'CONFIRMAR_RECEBIMENTO:AINDA_NAO':
      // Nada muda no fato; a pergunta volta em alguns dias (registrada para não insistir no mesmo dia).
      await registrarNaJornada({ ...base, tipo: 'SAMPLE_STATUS_REPORTED', chave: `ainda-nao:${agora.toISOString().slice(0, 10)}`, executor: 'HUMANO', origem: 'TIKTOK_MANUAL', resultado: 'AINDA_NAO_CHEGOU' })
      break
    case 'PUBLICAR_VIDEO:PUBLIQUEI':
    case 'MARCAR_PRODUTO:PUBLIQUEI':
    case 'COLAR_LINK_PUBLICADO:PUBLIQUEI': {
      const { registrarPublicacaoManual } = await import('./publicacao-assistida')
      await registrarPublicacaoManual({ workspaceId: p.workspaceId, userId: p.userId, id: j.assistida!.id, url: p.url!.trim(), agora, som: p.som ?? null })
      break
    }
    case 'CONFIRMAR_RESULTADO_MANUAL:INFORMAR': {
      if (!j.resultado) throw new ErroDaJornada(409, 'Ainda não há resultado aberto para este vídeo.')
      const { atualizarMetricas } = await import('./resultados-videos')
      const n = p.numeros ?? {}
      // Só o que a titular informou; comissão informada ≠ comissão paga confirmada.
      await atualizarMetricas({ workspaceId: p.workspaceId, userId: p.userId, id: j.resultado.id, origem: 'MANUAL', metricas: { views: n.views ?? null, ...(n.vendas !== undefined ? { vendas: n.vendas } : {}), ...(n.comissao !== undefined ? { comissao: n.comissao } : {}) } })
      await registrarNaJornada({ ...base, tipo: 'RESULT_REPORTED', chave: `resultado:${j.resultado.id}`, executor: 'HUMANO', origem: 'TIKTOK_MANUAL', evidencia: 'NUMEROS', dados: { views: n.views ?? null, vendas: n.vendas ?? null, comissaoInformada: n.comissao ?? null } })
      break
    }
    default: {
      // Atualizações opcionais da amostra ("mudou no app?").
      const evento = { AMOSTRA_APROVADA: 'APROVADA', AMOSTRA_ENVIADA: 'ENVIADA', AMOSTRA_RECEBIDA: 'RECEBIDA', AMOSTRA_REJEITADA: 'REJEITADA', AMOSTRA_CANCELADA: 'CANCELADA' }[p.resposta]
      if (!evento) throw new ErroDaJornada(400, 'Resposta não reconhecida.')
      await eventoDaAmostra(j, evento, p, agora)
    }
  }
  const depois = await sincronizarOperacao({ workspaceId: p.workspaceId, userId: p.userId, agora, env: p.env })
  j = depois.jornadas.find((x) => x.fatos.candidato.id === p.candidatoId)
  if (j?.estado.terminal) {
    await registrarNaJornada({ ...base, tipo: 'JOURNEY_CLOSED', chave: 'encerrada', executor: 'PATRONO', origem: 'PATRONO_CALCULATED', motivo: j.estado.titulo, resultado: j.estado.espera })
  }
  return depois
}

async function eventoDaAmostra(j: JornadaCarregada, evento: string, p: RespostaDaTitular, agora: Date) {
  if (!j.amostra) throw new ErroDaJornada(409, 'Não há amostra registrada nesta jornada.')
  const { aplicarEventoNaAmostra } = await import('./amostras')
  await aplicarEventoNaAmostra({ workspaceId: p.workspaceId, userId: p.userId, id: j.amostra.id, evento, agora, motivo: 'Informado na jornada (visto no app).' })
  await registrarNaJornada({ workspaceId: p.workspaceId, candidatoId: p.candidatoId, userId: p.userId, tipo: 'SAMPLE_STATUS_REPORTED', chave: `amostra:${j.amostra.id}:${evento}`, executor: 'HUMANO', origem: 'TIKTOK_MANUAL', evidencia: 'CONFIRMACAO', resultado: evento })
}

/** Aprovação do produto: abre a jornada e PERSISTE o motivo da escolha (para o aprendizado). */
async function iniciarJornada(j: JornadaCarregada, workspaceId: string, userId: string) {
  const c = j.fatos.candidato
  const fatores = [
    c.vendas !== null ? `vendas ${c.vendas}` : null,
    c.comissaoPercentual !== null ? `comissão ${c.comissaoPercentual}%` : null,
    c.compradoPelaTitular || c.usadoPelaTitular ? 'produto em mãos' : null,
    j.fatos.missoes.length ? `missão ativa (${j.fatos.missoes[0].nome})` : null,
    `nota ${c.score}`,
    `evidência ${c.baseDeEvidencia}`,
  ].filter((x): x is string => !!x)
  await registrarDecisao({
    workspaceId,
    tipo: 'JORNADA_PRODUTO_ESCOLHIDO', ator: 'PATRONO', decisao: 'ESCOLHIDO_E_APROVADO', entidadeTipo: ENTIDADE_DA_JORNADA, entidadeId: c.id,
    entradas: { score: c.score, baseDeEvidencia: c.baseDeEvidencia, vendas: c.vendas, comissaoPercentual: c.comissaoPercentual, comissaoValor: c.comissaoValor, preco: c.preco, emMaos: c.compradoPelaTitular || c.usadoPelaTitular, missoes: j.fatos.missoes.map((m) => m.nome), fatores },
    explicacao: c.motivos.slice(0, 8), regra: 'motor-da-jornada: maior evidência → nota; produto em mãos primeiro', chaveIdempotencia: `jornada:${c.id}:decisao:escolhido`,
  })
  // O pedido antigo de escolha deste produto (supervisor) fica resolvido pela jornada — uma porta só.
  const pedidos = await prisma.approvalRequest.findMany({ where: { workspaceId, status: 'PENDENTE', tipo: TIPO_DA_ESCOLHA }, select: { id: true, acaoProposta: true } })
  const doProduto = pedidos.filter((r) => (r.acaoProposta as { candidatoId?: string } | null)?.candidatoId === c.id).map((r) => r.id)
  if (doProduto.length) await cancelarPedidosPendentes({ workspaceId, filtro: { id: { in: doProduto } }, motivo: 'Decidido na Operação (jornada única).' })
  await registrarNaJornada({ workspaceId, candidatoId: c.id, userId, tipo: 'JOURNEY_STARTED', chave: 'iniciada', executor: 'HUMANO', origem: 'USER_CONFIRMED', evidencia: 'CONFIRMACAO', motivo: fatores.join(' · ') })
}

// ── "ESCOLHER OUTRO PRODUTO": a titular escolhe direto, sem recusar os outros ──

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export interface ProdutoParaEscolher {
  candidatoId: string
  nome: string
  imagem: string | null
  emMaos: boolean
}

/**
 * Busca por nome (sem diferenciar acento nem maiúscula) entre os produtos que
 * o Patrono já conhece (catálogo, vitrine, informados). Produto em mãos
 * primeiro. Ficam fora: bloqueio de compliance e descartados. Só leitura.
 */
export async function buscarProdutosParaEscolher(workspaceId: string, termo: string, limite = 15): Promise<ProdutoParaEscolher[]> {
  const palavras = semAcento(termo.trim()).split(/\s+/).filter(Boolean).slice(0, 6)
  const todos = await prisma.candidatoDeProduto.findMany({
    where: { workspaceId, complianceBloqueante: false, AND: [CANDIDATO_NAO_EXCLUIDO] },
    orderBy: [{ compradoPelaTitular: 'desc' }, { usadoPelaTitular: 'desc' }, { score: 'desc' }],
    take: 2000,
    select: { id: true, nome: true, imagem: true, imagemAutorizada: true, compradoPelaTitular: true, usadoPelaTitular: true },
  })
  return todos
    .filter((c) => palavras.every((p) => semAcento(c.nome).includes(p)))
    .slice(0, limite)
    .map((c) => ({ candidatoId: c.id, nome: c.nome, imagem: c.imagemAutorizada ? c.imagem : null, emMaos: c.compradoPelaTitular || c.usadoPelaTitular }))
}

/**
 * A titular escolhe um produto: ele vira a jornada prioritária na hora.
 * Não recusa nem desprioriza os outros (continuam onde estavam).
 * Idempotente: escolher de novo o que já é a escolha atual não grava nada;
 * aprovação e "em mãos" usam as mesmas chaves de sempre (uma jornada só).
 */
export async function escolherProduto(p: { workspaceId: string; userId: string; candidatoId: string; emMaos: boolean; agora?: Date; env?: Record<string, string | undefined> }): Promise<ContextoDaOperacao> {
  const agora = p.agora ?? new Date()
  const c = await prisma.candidatoDeProduto.findFirst({ where: { id: p.candidatoId, workspaceId: p.workspaceId }, select: { id: true, status: true, complianceBloqueante: true } })
  if (!c) throw new ErroDaJornada(404, 'Produto não encontrado.')
  if (c.complianceBloqueante) throw new ErroDaJornada(409, 'Este produto tem bloqueio de compliance e não pode ser trabalhado.')
  if (c.status === 'DESCARTADO') throw new ErroDaJornada(409, 'Este produto foi descartado.')
  const base = { workspaceId: p.workspaceId, candidatoId: c.id, userId: p.userId }

  let ctx = await carregarOperacao(p.workspaceId, agora, p.env)
  const jaEscolhida = visaoDaOperacao(ctx).prioritaria?.candidatoId === c.id && ctx.jornadas.some((j) => j.fatos.candidato.id === c.id && escolhidaEm(j) > 0)
  if (!jaEscolhida) {
    // Uma escolha por minuto e produto: duplo clique não grava duas; escolher de novo mais tarde volta a priorizar.
    await registrarNaJornada({ ...base, tipo: 'PRODUCT_CHOSEN', chave: `escolhido:${agora.toISOString().slice(0, 16)}`, executor: 'HUMANO', origem: 'USER_CONFIRMED', evidencia: 'CONFIRMACAO', motivo: 'Escolha direta da titular na Operação.' })
    ctx = await carregarOperacao(p.workspaceId, agora, p.env)
  }
  const j = ctx.jornadas.find((x) => x.fatos.candidato.id === c.id)
  if (!j) throw new ErroDaJornada(409, 'Não consegui abrir a jornada deste produto.')
  if (!j.fatos.decisoes.iniciada) await iniciarJornada(j, p.workspaceId, p.userId)
  if (p.emMaos && !j.fatos.decisoes.emMaos) await registrarNaJornada({ ...base, tipo: 'PRODUCT_IN_HAND', chave: 'em-maos', executor: 'HUMANO', origem: 'USER_CONFIRMED', evidencia: 'CONFIRMACAO' })
  return sincronizarOperacao({ workspaceId: p.workspaceId, userId: p.userId, agora, env: p.env })
}

/** Resumo de uma linha para a Torre ("CONTINUAR OPERAÇÃO"). Só leitura. */
export async function resumoDaOperacao(workspaceId: string, agora: Date = new Date()) {
  const v = visaoDaOperacao(await carregarOperacao(workspaceId, agora))
  return {
    acaoEsperando: !!v.prioritaria && v.prioritaria.espera === 'AGUARDANDO_CRISTIANE',
    titulo: v.prioritaria?.titulo ?? null,
    produto: v.prioritaria?.produto.nome ?? null,
    jornadas: (v.prioritaria ? 1 : 0) + v.outras.length,
  }
}
