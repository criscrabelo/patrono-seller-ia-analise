/**
 * Automation Queue — contrato e núcleo puro (P1.3).
 *
 * ── O QUE FOI REUSADO ───────────────────────────────────────────────────
 * Vocabulário: `ESTADOS_DO_JOB`, `CLASSES_DE_JOB` e `HUMAN_ACTION_REASONS`
 * vivem em lib/automation.ts, onde o contrato do orquestrador já estava.
 * Nada de vocabulário paralelo.
 *
 * Padrão de fila: reivindicação com `FOR UPDATE SKIP LOCKED`, heartbeat,
 * retomada de job travado e requeue por tentativas — o mesmo de
 * lib/digital-twin-job-queue.ts, que já está provado em produção.
 *
 * ── O QUE PRECISOU SER NOVO, E POR QUÊ ──────────────────────────────────
 * A tabela. `DigitalTwinJob.profileId` é FK OBRIGATÓRIA para
 * `DigitalTwinProfile`; uma pendência de "conectar canal" não tem perfil de
 * Digital Twin. Reaproveitar aquela tabela exigiria afrouxar a FK para um
 * uso sem relação com ela — e cinco módulos dependem dessa garantia.
 *
 * Não são duas filas concorrentes: aquela guarda render com GPU, esta
 * guarda pendência operacional. Elas nunca disputam o mesmo job.
 *
 * ── ESTE ARQUIVO É PURO ─────────────────────────────────────────────────
 * Nenhuma chamada de banco. A decisão de o que criar, atualizar e cancelar
 * é calculada aqui e aplicada pela camada de persistência — que é o que
 * torna a sincronização testável sem Postgres e determinística.
 */

import { createHash } from 'crypto'
import {
  ESTADOS_DO_JOB,
  ESTADOS_ATIVOS,
  ESTADOS_TERMINAIS,
  CLASSES_DE_JOB,
  HUMAN_ACTION_REASONS,
  type EstadoDoJob,
  type ClasseDeJob,
  type HumanActionReason,
} from './automation'
import type { ItemDaFilaDeAutomacao, ProximaAcao } from './plano-de-acao'

export { ESTADOS_DO_JOB, ESTADOS_ATIVOS, ESTADOS_TERMINAIS, CLASSES_DE_JOB }
export type { EstadoDoJob, ClasseDeJob }

// ── Quem executa sozinho, quem espera ───────────────────────────────────

export interface PerfilDaDependencia {
  tipo: ProximaAcao
  classe: ClasseDeJob
  /** Preenchido só quando a classe é EXIGE_HUMANO. */
  motivoHumano: HumanActionReason | null
  /** Tentativas antes de desistir. `0` = nunca tenta sozinho. */
  maxTentativas: number
  explicacao: string
}

/**
 * O que o executor pode fazer sozinho, e o que não pode.
 *
 * A distinção que importa: **conectar um canal exige OAuth da dona**. Isso
 * não é falha do sistema e não melhora tentando de novo — ficar
 * reprocessando seria queimar execução para sempre numa coisa que só uma
 * pessoa destrava. Por isso `maxTentativas: 0` e classe `EXIGE_HUMANO`.
 *
 * Já sincronizar mídia do provider é interno, gratuito e idempotente: dá
 * para tentar, e uma falha de rede merece nova tentativa.
 */
export const PERFIS_DE_DEPENDENCIA: Record<string, PerfilDaDependencia> = {
  CONECTAR_CANAL: {
    tipo: 'CONECTAR_CANAL',
    classe: 'EXIGE_HUMANO',
    motivoHumano: 'OAUTH_AUTHORIZATION_REQUIRED',
    maxTentativas: 0,
    explicacao:
      'Conectar a conta exige OAuth da proprietária. O sistema observa e avisa; tentar sozinho não destrava.',
  },
  /**
   * P1.5.1: renovar token e o oposto de CONECTAR_CANAL.
   *
   * Conectar exige a proprietaria porque so ela concede consentimento.
   * Renovar nao: o refresh token JA e o consentimento dela, guardado. Pedir
   * de novo a cada 60 dias seria trabalho manual recorrente — exatamente o
   * que a regra de Automation First proibe.
   */
  RENOVAR_TOKEN: {
    tipo: 'RENOVAR_TOKEN',
    classe: 'AUTOMATIZAVEL',
    motivoHumano: null,
    maxTentativas: 3,
    explicacao:
      'Renovacao pelo refresh token ja guardado: gratuita, idempotente e sem novo consentimento.',
  },
  /**
   * Automatizável NO PAPEL, sem executor NA PRÁTICA.
   *
   * Nenhuma ação está registrada para este tipo em `acoesDoExecutor`. Como
   * AUTOMATIZAVEL com 3 tentativas, o claim entregava o job ao worker, que
   * não achava ação, devolvia a WAITING com "sem ação registrada" — e
   * repetia isso a cada execução da fila. Churn sem trabalho.
   *
   * AGUARDA_CONDICAO com zero tentativas descreve a verdade: a condição que
   * falta é a implementação da sincronização com o catálogo do provider.
   * O job fica visível no painel de exceções sem consumir retry.
   *
   * QUANDO IMPLEMENTAR: escreva a ação, registre-a em `acoesDoExecutor` e
   * só então volte a classe para AUTOMATIZAVEL com maxTentativas 3. Mudar
   * a classe antes da ação recria exatamente este churn.
   */
  SINCRONIZAR_MIDIA_AUTORIZADA: {
    tipo: 'SINCRONIZAR_MIDIA_AUTORIZADA',
    classe: 'AGUARDA_CONDICAO',
    motivoHumano: null,
    maxTentativas: 0,
    explicacao:
      'Sincronização com o catálogo oficial do provider ainda não tem executor. O sistema observa a condição; não há o que tentar.',
  },
  COMPLETAR_DADO_DO_PRODUTO: {
    tipo: 'COMPLETAR_DADO_DO_PRODUTO',
    classe: 'AGUARDA_CONDICAO',
    motivoHumano: null,
    maxTentativas: 3,
    explicacao:
      'O dado pode chegar do provider numa sincronização futura. Se não chegar, vira pedido à proprietária — não fica tentando para sempre.',
  },
  /**
   * P1.4: a geracao vira job operacional proprio.
   *
   * No P1.2 `GERAR_CONTEUDO` era EXECUCAO, e por isso `jobsDesejadosDoPlano`
   * o filtra — ele nao e uma dependencia que falta. O que mudou e que agora
   * ele tem caminho proprio: `jobsDeGeracaoDoPlano`, em
   * lib/fabrica-de-conteudo.ts. As duas rotas usam a MESMA tabela e a mesma
   * porta de escrita; nao ha fila concorrente.
   */
  GERAR_CONTEUDO: {
    tipo: 'GERAR_CONTEUDO',
    classe: 'AUTOMATIZAVEL',
    motivoHumano: null,
    maxTentativas: 3,
    explicacao: 'Geracao local e gratuita: copy deterministica, voz Chatterbox e render FFmpeg.',
  },
  /**
   * P1.5: distribuir é automatizável, mas quase nunca por falta de tentativa.
   *
   * O que costuma faltar é escopo, adapter ligado ou aprovação da
   * plataforma — e nada disso melhora repetindo. Por isso o orquestrador
   * devolve `aguardar` nesses casos, que NÃO consome tentativa. As três
   * tentativas existem para o que de fato é transitório: rede e 5xx.
   */
  DISTRIBUIR_CONTEUDO: {
    tipo: 'DISTRIBUIR_CONTEUDO',
    classe: 'AUTOMATIZAVEL',
    motivoHumano: null,
    maxTentativas: 3,
    explicacao:
      'Distribuição pelo caminho que a decisão permitir: publicação, rascunho, ou espera explicando o que falta.',
  },
  HABILITAR_CAPACIDADE: {
    tipo: 'HABILITAR_CAPACIDADE',
    classe: 'AGUARDA_CONDICAO',
    motivoHumano: null,
    maxTentativas: 0,
    explicacao:
      'Depende de infraestrutura (worker com GPU pareado). O sistema observa a condição; não há o que tentar.',
  },
}

export function perfilDaDependencia(tipo: string): PerfilDaDependencia {
  return (
    PERFIS_DE_DEPENDENCIA[tipo] ?? {
      tipo: tipo as ProximaAcao,
      // Fail-closed: dependência desconhecida NUNCA é tratada como
      // automatizável. Na dúvida, uma pessoa decide.
      classe: 'EXIGE_HUMANO',
      motivoHumano: 'AMBIGUOUS_RULE',
      maxTentativas: 0,
      explicacao: `Dependência "${tipo}" não tem perfil declarado — tratada como decisão humana até que alguém a classifique.`,
    }
  )
}

/** `true` quando o executor desta rodada pode tocar este job. */
export function podeExecutarSozinho(perfil: PerfilDaDependencia): boolean {
  return perfil.classe === 'AUTOMATIZAVEL' && perfil.maxTentativas > 0
}

// ── Idempotência ────────────────────────────────────────────────────────

/**
 * FUNÇÃO PURA. A chave determinística de um job.
 *
 *   workspace + tipo + entidade + hash do contexto relevante
 *
 * O hash do contexto é o que separa "mesma situação" de "mudança material".
 * Dois crons seguidos com o mesmo quadro produzem a MESMA chave e reencontram
 * a mesma linha — a unique do banco garante isso mesmo sob concorrência.
 *
 * Quando o contexto muda de verdade — o produto passou a ter outro bloqueio,
 * o canal mudou —, a chave muda, e é uma pendência nova. O job antigo não é
 * sobrescrito: ele é CANCELADO, com registro. Reescrever perderia a história
 * de que aquela situação existiu.
 */
export function chaveDoJob(p: {
  workspaceId: string
  tipo: string
  entityType: string
  entityId: string
  contexto?: Record<string, unknown> | null
}): string {
  const contextoNormalizado = normalizarContexto(p.contexto)
  const material = [p.workspaceId, p.tipo, p.entityType, p.entityId, contextoNormalizado].join('|')
  const hash = createHash('sha256').update(material).digest('hex').slice(0, 16)
  return `${p.tipo}:${p.entityType}:${p.entityId}:${hash}`
}

/**
 * FUNÇÃO PURA. Serializa o contexto com as CHAVES ORDENADAS.
 *
 * Sem a ordenação, `{a:1,b:2}` e `{b:2,a:1}` — o mesmo contexto — gerariam
 * hashes diferentes, e cada execução do cron criaria um job novo. Foi por
 * isso que a ordenação virou parte do contrato, e não detalhe.
 */
export function normalizarContexto(contexto: Record<string, unknown> | null | undefined): string {
  if (!contexto || typeof contexto !== 'object') return ''
  const chaves = Object.keys(contexto).sort()
  return chaves.map((k) => `${k}=${String(contexto[k])}`).join(';')
}

// ── Sincronização ───────────────────────────────────────────────────────

export interface JobExistente {
  id: string
  chave: string
  estado: EstadoDoJob
  /** Necessário para o sincronizador saber se o job é dele. */
  tipo?: string
}

export interface JobDesejado {
  chave: string
  tipo: string
  entityType: string
  entityId: string
  classe: ClasseDeJob
  motivoHumano: HumanActionReason | null
  contexto: Record<string, unknown>
  explicacao: string
}

export interface PlanoDeSincronizacao {
  criar: JobDesejado[]
  /** Já existem e continuam válidos — nada a fazer. */
  manter: string[]
  /** Deixaram de existir no plano: a pendência foi resolvida ou sumiu. */
  cancelar: { id: string; chave: string; motivo: string }[]
}

/**
 * FUNÇÃO PURA. O que criar, manter e cancelar.
 *
 * É o coração do "Automation First" desta rodada: o cron não pede que
 * ninguém leia uma lista e crie tarefas. Ele calcula a diferença entre o que
 * o plano pede e o que a fila já tem, e aplica.
 *
 * DETERMINÍSTICA: a mesma dupla (desejados, existentes) produz sempre o
 * mesmo resultado, na mesma ordem.
 */
export function sincronizar(
  desejados: JobDesejado[],
  existentes: JobExistente[],
  /**
   * Tipos que ESTE sincronizador manda. Ausente = manda em todos.
   *
   * Sem isto, um sincronizador que cuida de geração cancelaria os jobs de
   * autorização que outro criou, só porque eles não estão na SUA lista de
   * desejados. A fila é uma só e tem vários donos; cada um responde pelo
   * que criou.
   */
  tiposGerenciados?: readonly string[]
): PlanoDeSincronizacao {
  const ativos = existentes
    .filter((j) => (ESTADOS_ATIVOS as string[]).includes(j.estado))
    .filter((j) => !tiposGerenciados || !j.tipo || tiposGerenciados.includes(j.tipo))
  const porChave = new Map(ativos.map((j) => [j.chave, j]))
  const chavesDesejadas = new Set(desejados.map((d) => d.chave))

  const criar: JobDesejado[] = []
  const manter: string[] = []
  for (const d of desejados) {
    const existente = porChave.get(d.chave)
    if (existente) manter.push(existente.id)
    else criar.push(d)
  }

  // Pendência que saiu do plano: ou foi resolvida, ou a situação mudou de
  // forma material (e aí já existe um job novo com chave nova).
  const cancelar = ativos
    .filter((j) => !chavesDesejadas.has(j.chave))
    .map((j) => ({
      id: j.id,
      chave: j.chave,
      motivo: 'A dependência saiu do plano — resolvida, ou a situação mudou de forma material.',
    }))

  return { criar, manter, cancelar }
}

/**
 * FUNÇÃO PURA. Converte os itens do plano do P1.2 em jobs desejados.
 *
 * `GERAR_CONTEUDO` NUNCA vira job aqui: é a execução, não uma dependência.
 * O P1.2 já não o enfileira; este filtro é a segunda tranca, para o dia em
 * que alguém mudar aquele lado sem lembrar deste.
 */
export function jobsDesejadosDoPlano(
  workspaceId: string,
  itens: ItemDaFilaDeAutomacao[],
  contextoExtra: (item: ItemDaFilaDeAutomacao) => Record<string, unknown> = () => ({})
): JobDesejado[] {
  const saida: JobDesejado[] = []
  for (const item of itens) {
    // Execução não é dependência: as duas têm caminho próprio
    // (`jobsDeGeracaoDoPlano`, `jobDeDistribuicao`), na mesma tabela.
    if (
      item.dependencia === 'GERAR_CONTEUDO' ||
      item.dependencia === 'DISTRIBUIR_CONTEUDO' ||
      item.dependencia === 'NENHUMA'
    )
      continue
    const perfil = perfilDaDependencia(item.dependencia)
    // P1.9.2: o contexto do item (ex.: mídia que a DONA fornece) entra na
    // chave — é outra pendência, não a mesma com outro texto.
    const contexto = { dependencia: item.dependencia, ...(item.contexto ?? {}), ...contextoExtra(item) }
    const humano = item.motivoHumano ?? null
    // `PRODUTO` em maiuscula: e o vocabulario de TIPOS_DE_ENTIDADE, e a
    // chave PRECISA bater com a que o repositorio recalcula depois de
    // resolver a entidade. Com 'Produto' aqui e 'PRODUTO' la, cada execucao
    // do cron gerava chave diferente e criava job novo para sempre — foi o
    // teste de restart que pegou isso.
    saida.push({
      chave: chaveDoJob({
        workspaceId,
        tipo: item.dependencia,
        entityType: 'PRODUTO',
        entityId: item.produtoId,
        contexto,
      }),
      tipo: item.dependencia,
      entityType: 'PRODUTO',
      entityId: item.produtoId,
      classe: humano ? 'EXIGE_HUMANO' : perfil.classe,
      motivoHumano: humano ?? perfil.motivoHumano,
      contexto,
      explicacao: item.explicacao || perfil.explicacao,
    })
  }
  return saida
}

// ── Retry e backoff ─────────────────────────────────────────────────────

/** Espera entre tentativas. Dobra a cada falha, com teto. */
export const BACKOFF_BASE_MS = 60_000
export const BACKOFF_MAXIMO_MS = 6 * 60 * 60 * 1000

/**
 * FUNÇÃO PURA. Quando tentar de novo, e se vale tentar.
 *
 * Distingue as duas coisas que estavam coladas em `FAILED`:
 *
 *   FAILED_RETRYABLE  ainda há tentativa e o erro é transitório
 *   FAILED_FINAL      acabaram as tentativas, ou o erro é definitivo
 *
 * Perfil com `maxTentativas: 0` vai direto para `WAITING`: não é falha, é
 * dependência que não depende de nós.
 */
export function decidirAposFalha(p: {
  perfil: PerfilDaDependencia
  tentativasAtuais: number
  erroFatal?: boolean
  agora: Date
}): { estado: EstadoDoJob; proximaTentativaEm: Date | null; explicacao: string } {
  if (p.perfil.maxTentativas === 0) {
    return {
      estado: 'WAITING',
      proximaTentativaEm: null,
      explicacao: `${p.perfil.explicacao} Fica aguardando a condição, sem consumir tentativa.`,
    }
  }
  if (p.erroFatal) {
    return {
      estado: 'FAILED_FINAL',
      proximaTentativaEm: null,
      explicacao: 'Erro definitivo — tentar de novo só geraria loop.',
    }
  }
  const proximas = p.tentativasAtuais + 1
  if (proximas >= p.perfil.maxTentativas) {
    return {
      estado: 'FAILED_FINAL',
      proximaTentativaEm: null,
      explicacao: `Esgotadas as ${p.perfil.maxTentativas} tentativas.`,
    }
  }
  const espera = Math.min(BACKOFF_BASE_MS * 2 ** p.tentativasAtuais, BACKOFF_MAXIMO_MS)
  return {
    estado: 'FAILED_RETRYABLE',
    proximaTentativaEm: new Date(p.agora.getTime() + espera),
    explicacao: `Falha transitória — nova tentativa em ${Math.round(espera / 1000)}s.`,
  }
}

// ── Leitura para o Painel de Exceções ───────────────────────────────────

export interface ResumoOperacional {
  resolveuSozinho: number
  estaTentando: number
  aguardandoCondicao: number
  precisaDeDecisaoHumana: number
}

/**
 * FUNÇÃO PURA. As quatro perguntas que o futuro CEO Autônomo precisa
 * responder sem ninguém abrir log.
 *
 * Só `precisaDeDecisaoHumana` vira "preciso de você". As outras três são o
 * sistema trabalhando — e mostrá-las como pendência transformaria a dona em
 * operadora do que o robô já está fazendo.
 */
export function resumirParaPainel(
  jobs: { estado: EstadoDoJob; classe: ClasseDeJob }[]
): ResumoOperacional {
  const resumo: ResumoOperacional = {
    resolveuSozinho: 0,
    estaTentando: 0,
    aguardandoCondicao: 0,
    precisaDeDecisaoHumana: 0,
  }
  for (const j of jobs) {
    if (j.estado === 'SUCCEEDED') resumo.resolveuSozinho++
    else if (j.estado === 'FAILED_RETRYABLE' || j.estado === 'RUNNING' || j.estado === 'PENDING') {
      if (j.classe === 'EXIGE_HUMANO') resumo.precisaDeDecisaoHumana++
      else resumo.estaTentando++
    } else if (j.estado === 'WAITING') {
      if (j.classe === 'EXIGE_HUMANO') resumo.precisaDeDecisaoHumana++
      else resumo.aguardandoCondicao++
    } else if (j.estado === 'FAILED_FINAL') {
      // Falha definitiva é decisão humana: o sistema já tentou o que sabia.
      resumo.precisaDeDecisaoHumana++
    }
  }
  return resumo
}

/**
 * O que o executor desta rodada NÃO pode fazer.
 *
 * GERAR_CONTEUDO fica de fora de propósito: a arquitetura já aceita receber
 * `PRONTO_PARA_GERAR_CONTEUDO` — o perfil entraria em
 * `PERFIS_DE_DEPENDENCIA` como AUTOMATIZAVEL e o executor o pegaria sem
 * mudança estrutural. Ligar isso é a próxima rodada, não esta.
 */
export const EXECUTOR_NAO_FAZ = {
  chave: 'automation-queue:executor',
  proibido: ['PUBLICAR', 'PROVIDER_PAGO', 'CONSENTIMENTO_HUMANO', 'GERAR_CONTEUDO'],
  porque:
    'O executor desta rodada só toca ação interna, gratuita, idempotente e sem consentimento externo. Todo o resto fica WAITING com motivo.',
  proximaRodada: 'CREATIVE_FACTORY_GRATUITA',
} as const

export const MOTIVOS_HUMANOS_ACEITOS = HUMAN_ACTION_REASONS
