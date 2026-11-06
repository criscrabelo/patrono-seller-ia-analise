/**
 * Resiliência de conexão com o banco para o worker residente (Rodada 10.2).
 *
 * MOTIVO REAL: em 20/09/2026 o worker morreu com exit code 1 depois de um
 * `ConnectionReset` (Os code 10054) no pooler do Supabase — uma falha de
 * rede de alguns segundos. Ele ficou 8 horas fora do ar. Isso contradiz o
 * propósito do processo: `DIGITAL-TWIN-WORKER.md` descreve um worker que
 * inicia no logon e roda sem a proprietária abrir terminal. Em rede
 * doméstica, um piscar de conexão vai acontecer de novo.
 *
 * O módulo é PURO de propósito (sem Prisma, sem timers reais, sem
 * `Math.random` direto): espera, sorteio e log entram por parâmetro, então
 * uma queda temporária e a recuperação podem ser testadas de verdade, sem
 * derrubar banco nenhum.
 *
 * O que ele explicitamente NÃO faz: reexecutar um job já reivindicado. O
 * claim é um `UPDATE ... FOR UPDATE SKIP LOCKED` atômico — retentar a
 * reivindicação é seguro (ou pega um job, ou devolve nenhum), mas repetir o
 * processamento de um job já claimado duplicaria trabalho. Se a conexão cair
 * no meio de um job, ele fica com heartbeat velho e volta à fila pelo
 * `STALE_TIMEOUT` que já existe — nunca vira FAILED só por falta de
 * processador.
 */

export type ClasseErroBanco = 'TRANSITORIO' | 'FATAL'

export interface DiagnosticoErroBanco {
  classe: ClasseErroBanco
  /** Texto curto para log — nunca inclui credencial nem string de conexão. */
  motivo: string
  codigo: string | null
}

/**
 * Códigos do Prisma que significam "o banco não estava alcançável agora",
 * não "o worker está configurado errado".
 * https://www.prisma.io/docs/orm/reference/error-reference
 */
const CODIGOS_PRISMA_TRANSITORIOS = new Set([
  'P1001', // Can't reach database server
  'P1002', // Database server was reached but timed out
  'P1008', // Operations timed out
  'P1017', // Server has closed the connection
  'P2024', // Timed out fetching a connection from the pool
])

/**
 * Erros de configuração/credencial. Retentar isso é inútil e esconderia o
 * problema real da proprietária — falham na hora, alto.
 */
const CODIGOS_PRISMA_FATAIS = new Set([
  'P1000', // Authentication failed
  'P1003', // Database does not exist
  'P1010', // User denied access
  'P1011', // Error opening a TLS connection
  'P1012', // Schema validation error
  'P1013', // Invalid database string
])

/** Erros de socket do Node que são queda de rede, não configuração. */
const CODIGOS_REDE_TRANSITORIOS = new Set([
  'ECONNRESET', // foi o caso real: conexão derrubada pelo host remoto
  'ETIMEDOUT',
  'ECONNABORTED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EAI_AGAIN', // falha temporária de DNS
  'ECONNREFUSED', // o pooler do Supabase recusa durante restart
])

/**
 * `ENOTFOUND` fica FORA da lista transitória de propósito: host que não
 * resolve é quase sempre endereço errado no ambiente — foi exatamente o
 * sintoma do projeto de produção desativado. Ficar retentando esconderia
 * um `.env` apontando para o lugar errado.
 */

function extrairCodigo(erro: unknown): string | null {
  let atual: unknown = erro
  // Prisma embrulha o erro de socket em `cause`; o código pode estar em
  // qualquer nível da cadeia.
  for (let profundidade = 0; atual && profundidade < 5; profundidade++) {
    const codigo = (atual as { code?: unknown }).code
    if (typeof codigo === 'string' && codigo.length > 0) return codigo
    atual = (atual as { cause?: unknown }).cause
  }
  return null
}

function mensagemDe(erro: unknown): string {
  if (erro instanceof Error) return erro.message
  return String(erro)
}

/**
 * Decide se vale esperar e tentar de novo. O padrão é FATAL: um erro que não
 * sabemos classificar NUNCA é engolido num loop de retry silencioso.
 */
/**
 * A mensagem do Prisma começa com uma linha de cabeçalho que não diz nada
 * sobre a causa ("Invalid `prisma.$queryRaw()` invocation:") — a informação
 * útil ("Can't reach database server at `host:6543`") vem depois. Pegar
 * cegamente a primeira linha produzia log inútil justamente na hora da
 * queda; verificado ao vivo na simulação desta rodada.
 */
const LINHAS_SEM_INFORMACAO = [
  /^Invalid `.*` invocation/i,
  /^Please make sure/i,
  /^\s*at\s/, // quadro de stack
]

function resumirMensagem(mensagem: string): string {
  const linhas = mensagem
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const util = linhas.find((l) => !LINHAS_SEM_INFORMACAO.some((re) => re.test(l)))
  return util ?? linhas[0] ?? 'erro sem mensagem'
}

export function classificarErroDeBanco(erro: unknown): DiagnosticoErroBanco {
  const codigo = extrairCodigo(erro)
  const mensagem = mensagemDe(erro)
  const resumo = resumirMensagem(mensagem)

  if (codigo && CODIGOS_PRISMA_FATAIS.has(codigo)) {
    return { classe: 'FATAL', motivo: `${codigo}: configuração/credencial inválida — ${resumo}`, codigo }
  }
  if (codigo && CODIGOS_PRISMA_TRANSITORIOS.has(codigo)) {
    return { classe: 'TRANSITORIO', motivo: `${codigo}: banco inalcançável no momento — ${resumo}`, codigo }
  }
  if (codigo && CODIGOS_REDE_TRANSITORIOS.has(codigo)) {
    return { classe: 'TRANSITORIO', motivo: `${codigo}: falha de rede — ${resumo}`, codigo }
  }
  return { classe: 'FATAL', motivo: codigo ? `${codigo}: ${resumo}` : resumo, codigo }
}

export interface OpcoesBackoff {
  /** Espera da 1ª retentativa, em ms. */
  baseMs: number
  /** Teto da espera — o backoff cresce até aqui e para de crescer. */
  maxMs: number
  /** Fração de aleatoriedade (0 a 1) subtraída da espera. Padrão 0.2. */
  jitter?: number
  /** Injetável para teste determinístico. Padrão `Math.random`. */
  aleatorio?: () => number
}

/**
 * Espera exponencial com teto e jitter. O jitter SUBTRAI (nunca soma) até
 * `jitter` da espera: duas instâncias que caírem juntas não voltam no mesmo
 * milissegundo, e a espera nunca ultrapassa `maxMs`.
 *
 * `tentativa` começa em 1.
 */
export function calcularEsperaBackoff(tentativa: number, opcoes: OpcoesBackoff): number {
  const jitter = opcoes.jitter ?? 0.2
  const aleatorio = opcoes.aleatorio ?? Math.random
  const expoente = Math.max(0, tentativa - 1)
  const semJitter = Math.min(opcoes.baseMs * 2 ** expoente, opcoes.maxMs)
  const reducao = semJitter * jitter * aleatorio()
  return Math.max(0, Math.round(semJitter - reducao))
}

export interface TentativaReconexao {
  tentativa: number
  motivo: string
  proximaEsperaMs: number
}

export interface DepsReconexao extends OpcoesBackoff {
  /**
   * Máximo de tentativas. `0` = sem limite — usado no loop residente, onde
   * desistir reproduziria exatamente o defeito que esta rodada corrige.
   */
  maxTentativas: number
  esperar: (ms: number) => Promise<void>
  /** Chamado a CADA falha transitória: tentativa, motivo e próxima espera. */
  aoRetentar: (tentativa: TentativaReconexao) => void
  /** Chamado quando volta a funcionar depois de ter falhado. */
  aoRecuperar?: (tentativasGastas: number) => void
}

/**
 * Executa `operacao`, retentando enquanto o erro for transitório.
 *
 * Erro FATAL é relançado na hora, sem espera — não engolimos problema
 * permanente. Esgotar `maxTentativas` também relança o último erro: o
 * processo morre alto, e não em silêncio.
 */
export async function comReconexao<T>(operacao: () => Promise<T>, deps: DepsReconexao): Promise<T> {
  let tentativa = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const resultado = await operacao()
      if (tentativa > 0) deps.aoRecuperar?.(tentativa)
      return resultado
    } catch (erro) {
      const diagnostico = classificarErroDeBanco(erro)
      if (diagnostico.classe === 'FATAL') throw erro

      tentativa++
      if (deps.maxTentativas > 0 && tentativa > deps.maxTentativas) throw erro

      const proximaEsperaMs = calcularEsperaBackoff(tentativa, deps)
      deps.aoRetentar({ tentativa, motivo: diagnostico.motivo, proximaEsperaMs })
      await deps.esperar(proximaEsperaMs)
    }
  }
}
