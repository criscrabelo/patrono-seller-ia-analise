/**
 * P1.5.4 — o ciclo diário de oportunidades, com ensaio e execução no
 * MESMO caminho.
 *
 * ── POR QUE UM SÓ CAMINHO ───────────────────────────────────────────────
 * Um ensaio que roda código diferente da execução não prova nada: ele
 * mede o ensaio, não a operação. Aqui a única diferença entre `escrever:
 * false` e `escrever: true` é a última linha de cada workspace — a
 * gravação. Leitura, pontuação, plano, formatos e a decisão de criar,
 * manter e cancelar são idênticas nos dois modos.
 *
 * ── O QUE ESTE CICLO NÃO FAZ ────────────────────────────────────────────
 * Não publica, não cria `Publicacao`, não chama adapter de canal, não
 * chama provider pago e não gera conteúdo. Ele lê o catálogo, calcula
 * oportunidade, monta plano e sincroniza a fila. Gerar é trabalho do
 * executor; publicar é outra decisão, com outro portão.
 *
 * ── FAIL-CLOSED NA CAPACIDADE ───────────────────────────────────────────
 * O que não for afirmado como disponível no ambiente não é escolhido. Sem
 * FFmpeg declarado o plano não pede vídeo; o job nasce WAITING em vez de
 * falhar no meio do render.
 */

import { prisma } from './prisma'
import {
  montarFilaDeOportunidades,
  selecionarParaModo,
  type ModoDeAutomacao,
  type SelecaoPorModo,
} from './motor-de-oportunidades'
import { montarPlanoDeAcao, type CapacidadesTecnicas, type PlanoDeAcao } from './plano-de-acao'
import { jobsDeGeracaoDoPlano, jobsDeLacunaDeFormato, TIPO_JOB_GERACAO } from './fabrica-de-conteudo'
import {
  jobsDesejadosDoPlano,
  sincronizar,
  perfilDaDependencia,
  podeExecutarSozinho,
  type JobDesejado,
  type JobExistente,
} from './automation-queue-contrato'
import { sincronizarFilaComPlano, type PortaDaFila } from './automation-queue-repositorio'

/** Quantas oportunidades considerar por workspace. A fila inteira é ruído. */
export const TOPO_DA_FILA = 20

/**
 * Os tipos de job que ESTE ciclo administra.
 *
 * A sincronização cancela o que saiu do plano, e precisa cancelar só o que
 * é dela. Sem esta lista ela apagaria um `RENOVAR_TOKEN` criado pela
 * autorização da conta, só porque ele não nasceu aqui.
 */
export const TIPOS_DESTE_CICLO = [
  TIPO_JOB_GERACAO,
  'SINCRONIZAR_MIDIA_AUTORIZADA',
  'CONECTAR_CANAL',
  'COMPLETAR_DADO_DO_PRODUTO',
  'HABILITAR_CAPACIDADE',
] as const

/**
 * A capacidade da máquina, lida do ambiente.
 *
 * MESMA fonte que o executor consulta. Quando isto divergia — o cron
 * afirmava `FFMPEG: true` fixo e o executor perguntava a
 * `FFMPEG_DISPONIVEL` — o plano escolhia vídeo e o executor recusava por
 * falta de capacidade, e os jobs ficavam parados sem ninguém entender.
 *
 * `PROVEDOR_PAGO_AUTORIZADO` é `false` cravado, não lido: nenhuma variável
 * de ambiente pode autorizar gasto por este caminho.
 */
export function capacidadesDeclaradas(
  env: Record<string, string | undefined> = process.env
): CapacidadesTecnicas {
  return {
    FFMPEG: env.FFMPEG_DISPONIVEL === 'true',
    DIGITAL_TWIN_GPU: env.DIGITAL_TWIN_GPU_DISPONIVEL === 'true',
    PROVEDOR_PAGO_AUTORIZADO: false,
  }
}

// ── Observabilidade ─────────────────────────────────────────────────────

/** Resumo de um candidato no relatório (P2.14.5.12) — sem dado pessoal. */
export interface CandidatoNoRelatorio {
  posicao: number
  produtoId: string
  produtoNome: string
  categoria: string
  score: number
  confianca: string
  nivelDeRisco: string | null
  compradoPelaTitular: boolean
  publicacaoImpedida: boolean
  motivosPositivos: string[]
  riscos: string[]
  desconhecidos: string[]
  motivoDaPosicao: string
  porqueDestaPosicao: string[]
}

export interface RelatorioDoWorkspace {
  workspaceId: string
  /** P2.14.5.12: modo lido do workspace e o que o ciclo fez com ele. */
  modo: ModoDeAutomacao
  pausado: boolean
  acaoDoModo: string
  candidatos: CandidatoNoRelatorio[]
  canaisConectados: string[]
  oportunidadesAvaliadas: number
  prontasParaPublicacao: number
  oportunidadesComerciais: number
  itensDePlano: number
  /** Jobs que o plano deseja, antes de comparar com a fila existente. */
  jobsDesejados: number
  jobsCriados: number
  jobsMantidos: number
  jobsCancelados: number
  /** Dos desejados, quantos nascem WAITING por não serem automatizáveis. */
  nasceriamWaiting: number
  lacunasDeFormato: number
  /** Recusados pela validação de entidade. Só é conhecido ao gravar. */
  recusados: number
  custo: number
  erro: string | null
}

export interface RelatorioDoCiclo {
  /** `false` = ensaio: nada foi gravado. */
  escreveu: boolean
  executadoEm: string
  capacidades: CapacidadesTecnicas
  workspaces: number
  oportunidadesAvaliadas: number
  itensDePlano: number
  jobsDesejados: number
  jobsCriados: number
  jobsMantidos: number
  jobsCancelados: number
  nasceriamWaiting: number
  lacunasDeFormato: number
  recusados: number
  erros: number
  custoTotal: number
  porWorkspace: RelatorioDoWorkspace[]
}

/**
 * Quantos dos jobs desejados nasceriam em WAITING.
 *
 * FUNÇÃO PURA. É a mesma regra do repositório: quem não executa sozinho
 * entra em espera em vez de consumir tentativa. Saber isto ANTES de
 * gravar é o que permite ao ensaio dizer quanto do plano vai ficar parado.
 */
export function contarQueNasceriamWaiting(desejados: JobDesejado[]): number {
  return desejados.filter((d) => !podeExecutarSozinho(perfilDaDependencia(d.tipo))).length
}

// ── O ciclo ─────────────────────────────────────────────────────────────

/**
 * Planeja UM workspace. Só leitura — nada é gravado aqui.
 *
 * Separado de propósito: é esta função que o ensaio e a execução real
 * compartilham por inteiro.
 */
export async function planejarWorkspace(params: {
  workspaceId: string
  agora: Date
  capacidades: CapacidadesTecnicas
  limite?: number
}): Promise<{
  canaisConectados: string[]
  fila: Awaited<ReturnType<typeof montarFilaDeOportunidades>>
  selecao: SelecaoPorModo
  plano: PlanoDeAcao
  desejados: JobDesejado[]
  lacunas: JobDesejado[]
}> {
  // P2.14.5.12: o modo do workspace decide se há tarefa automática.
  const controles = await prisma.workspace.findUnique({
    where: { id: params.workspaceId },
    select: { automationPaused: true, automationMode: true },
  })

  // Canais que conseguem publicar HOJE. Sem integração conectada nada fica
  // PRONTA_PARA_PUBLICACAO — e isso é correto, não é falha.
  const integracoes = await prisma.integracao.findMany({
    where: { workspaceId: params.workspaceId, status: 'conectado' },
    select: { plataforma: true },
  })
  const canaisConectados = integracoes.map((i) => i.plataforma)

  const fila = await montarFilaDeOportunidades({
    workspaceId: params.workspaceId,
    agora: params.agora,
    canaisCapazes: canaisConectados,
    limite: params.limite ?? TOPO_DA_FILA,
  })

  // Workspace sem registro conta como pausado: o seguro é não agir.
  const selecao = selecionarParaModo(fila, {
    automationMode: controles?.automationMode,
    automationPaused: controles?.automationPaused ?? true,
  })

  // Só o AUTOMATIC planeja tarefas, e só para o produto escolhido.
  // Pausado/MANUAL: nada. ASSISTED: só candidatos; nada antes da escolha.
  const automatico = !selecao.pausado && selecao.modo === 'AUTOMATIC'
  const escolhidos = new Set(selecao.candidatos.map((c) => c.produtoId))
  const plano = montarPlanoDeAcao({
    workspaceId: params.workspaceId,
    fila: automatico ? fila.filter((o) => escolhidos.has(o.produtoId)) : [],
    canaisConectados,
    capacidades: params.capacidades,
    agora: params.agora,
  })

  // Três origens, uma tabela, uma sincronização:
  //   dependência que falta        -> jobsDesejadosDoPlano
  //   geração que dá para fazer    -> jobsDeGeracaoDoPlano
  //   formato que a fábrica não faz -> jobsDeLacunaDeFormato
  const lacunas = jobsDeLacunaDeFormato(params.workspaceId, plano.itens)
  const desejados = [
    ...jobsDesejadosDoPlano(params.workspaceId, plano.filaDeAutomacao),
    ...jobsDeGeracaoDoPlano(params.workspaceId, plano.itens),
    ...lacunas,
  ]

  return { canaisConectados, fila, selecao, plano, desejados, lacunas }
}

function resumirCandidato(c: SelecaoPorModo['candidatos'][number]): CandidatoNoRelatorio {
  return {
    posicao: c.posicao,
    produtoId: c.produtoId,
    produtoNome: c.produtoNome,
    categoria: c.categoria,
    score: c.score,
    confianca: c.confianca,
    nivelDeRisco: c.nivelDeRisco ?? null,
    compradoPelaTitular: c.compradoPelaTitular ?? false,
    publicacaoImpedida: c.publicacaoImpedida ?? false,
    motivosPositivos: c.motivosPositivos ?? [],
    riscos: c.riscos ?? [],
    desconhecidos: c.desconhecidos ?? [],
    motivoDaPosicao: c.motivoDaPosicao,
    porqueDestaPosicao: c.porqueDestaPosicao,
  }
}

/**
 * Roda o ciclo em todos os workspaces.
 *
 * `escrever: false` é o ensaio de produção: percorre exatamente o mesmo
 * caminho e devolve o mesmo relatório, sem gravar uma linha. O número de
 * `jobsCriados` no ensaio é o que a execução real criaria.
 *
 * Um workspace que falha não derruba os outros: o erro entra no relatório
 * daquele workspace e o laço segue. Um catálogo quebrado num negócio não
 * pode parar a operação dos demais.
 */
export async function rodarCicloDeOportunidades(params: {
  porta: PortaDaFila
  agora: Date
  escrever: boolean
  capacidades?: CapacidadesTecnicas
  env?: Record<string, string | undefined>
  limite?: number
  /** Restringe a estes workspaces. Ausente = todos. */
  workspaceIds?: string[]
}): Promise<RelatorioDoCiclo> {
  const capacidades = params.capacidades ?? capacidadesDeclaradas(params.env)
  const alvos =
    params.workspaceIds ??
    (await prisma.workspace.findMany({ select: { id: true } })).map((w) => w.id)

  const porWorkspace: RelatorioDoWorkspace[] = []

  for (const workspaceId of alvos) {
    const linha: RelatorioDoWorkspace = {
      workspaceId,
      modo: 'MANUAL',
      pausado: true,
      acaoDoModo: '',
      candidatos: [],
      canaisConectados: [],
      oportunidadesAvaliadas: 0,
      prontasParaPublicacao: 0,
      oportunidadesComerciais: 0,
      itensDePlano: 0,
      jobsDesejados: 0,
      jobsCriados: 0,
      jobsMantidos: 0,
      jobsCancelados: 0,
      nasceriamWaiting: 0,
      lacunasDeFormato: 0,
      recusados: 0,
      // O ciclo inteiro é gratuito. Se algum dia deixar de ser, é aqui que
      // aparece — e o teste que exige zero quebra.
      custo: 0,
      erro: null,
    }

    try {
      const r = await planejarWorkspace({ workspaceId, agora: params.agora, capacidades, limite: params.limite })
      linha.modo = r.selecao.modo
      linha.pausado = r.selecao.pausado
      linha.acaoDoModo = r.selecao.explicacao
      linha.candidatos = r.selecao.candidatos.map(resumirCandidato)
      linha.canaisConectados = r.canaisConectados
      linha.oportunidadesAvaliadas = r.fila.length
      linha.prontasParaPublicacao = r.fila.filter((o) => o.classificacao === 'PRONTA_PARA_PUBLICACAO').length
      linha.oportunidadesComerciais = r.fila.filter((o) => o.classificacao === 'OPORTUNIDADE_COMERCIAL').length
      linha.itensDePlano = r.plano.itens.length
      linha.jobsDesejados = r.desejados.length
      linha.lacunasDeFormato = r.lacunas.length
      linha.nasceriamWaiting = contarQueNasceriamWaiting(r.desejados)

      const automatico = !r.selecao.pausado && r.selecao.modo === 'AUTOMATIC'
      if (!automatico) {
        // Nenhuma tarefa automática: não cria e também não cancela as que
        // já existem (pausar não apaga trabalho já enfileirado).
        linha.jobsCriados = 0
        linha.jobsMantidos = 0
        linha.jobsCancelados = 0
        linha.recusados = 0
      } else if (params.escrever) {
        const sinc = await sincronizarFilaComPlano({
          porta: params.porta,
          workspaceId,
          desejados: r.desejados,
          agora: params.agora,
          tiposGerenciados: TIPOS_DESTE_CICLO,
        })
        linha.jobsCriados = sinc.criados
        linha.jobsMantidos = sinc.mantidos
        linha.jobsCancelados = sinc.cancelados
        linha.recusados = sinc.recusados.length
      } else {
        // ENSAIO: a MESMA decisão, calculada e não aplicada. `sincronizar`
        // é função pura; o que falta é só a gravação.
        const existentes = await params.porta.listarPorWorkspace(workspaceId)
        const plano = sincronizar(
          r.desejados,
          existentes.map<JobExistente>((j) => ({ id: j.id, chave: j.chave, estado: j.estado, tipo: j.tipo })),
          TIPOS_DESTE_CICLO
        )
        linha.jobsCriados = plano.criar.length
        linha.jobsMantidos = plano.manter.length
        linha.jobsCancelados = plano.cancelar.length
        // Recusa por entidade inexistente só se conhece ao gravar: a
        // validação acontece dentro da porta de escrita, de propósito.
        linha.recusados = 0
      }
    } catch (e) {
      // Sem segredo no log: só a mensagem, e ela não carrega credencial
      // porque nada aqui manipula token.
      linha.erro = e instanceof Error ? e.message.slice(0, 300) : 'falha desconhecida'
      console.error(`[ciclo-oportunidades] workspace ${workspaceId}:`, linha.erro)
    }

    porWorkspace.push(linha)
  }

  const soma = (k: keyof RelatorioDoWorkspace) =>
    porWorkspace.reduce((t, w) => t + (typeof w[k] === 'number' ? (w[k] as number) : 0), 0)

  return {
    escreveu: params.escrever,
    executadoEm: params.agora.toISOString(),
    capacidades,
    workspaces: porWorkspace.length,
    oportunidadesAvaliadas: soma('oportunidadesAvaliadas'),
    itensDePlano: soma('itensDePlano'),
    jobsDesejados: soma('jobsDesejados'),
    jobsCriados: soma('jobsCriados'),
    jobsMantidos: soma('jobsMantidos'),
    jobsCancelados: soma('jobsCancelados'),
    nasceriamWaiting: soma('nasceriamWaiting'),
    lacunasDeFormato: soma('lacunasDeFormato'),
    recusados: soma('recusados'),
    erros: porWorkspace.filter((w) => w.erro !== null).length,
    custoTotal: 0,
    porWorkspace,
  }
}

/**
 * REGRA PERMANENTE desta rodada.
 *
 * O ciclo diário planeja e enfileira. Ele não publica, não gera e não
 * gasta. Cada uma dessas três coisas tem portão próprio, e nenhum deles
 * fica aqui.
 */
export const CICLO_NAO_PUBLICA_NEM_GERA = {
  chave: 'ciclo-oportunidades:escopo',
  faz: ['ler catálogo', 'pontuar oportunidade', 'montar plano', 'sincronizar a fila'],
  naoFaz: [
    'publicar',
    'criar Publicacao',
    'chamar adapter de canal',
    'chamar provider pago',
    'gerar conteúdo',
  ],
  ondeMoraCadaPortao: {
    gerar: 'executor da fila + avaliarCapacidade',
    publicar: 'preflight + ADAPTADORES_LIGADOS',
    gastar: 'CostSafetyGate',
  },
} as const
