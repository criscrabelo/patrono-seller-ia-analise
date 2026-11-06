/**
 * P2.12 — Limpeza dos uploads diretos órfãos do Digital Twin.
 *
 * Órfão = objeto que o navegador enviou ao bucket privado (passo ② da P2.11)
 * e que nunca foi confirmado (passo ③): não existe `DigitalTwinAsset` com
 * aquele `storagePath`. Fica no bucket sem registro e sem uso.
 *
 * O QUE NUNCA É APAGADO:
 *   - objeto com `DigitalTwinAsset` em QUALQUER workspace (confirmado);
 *   - objeto fora do padrão exato do upload direto
 *     (`<workspace>/<perfil>/<tipo>-<epoch ms>-<12 hex>`) — prévias do worker
 *     (`previews/...`), evidência de consentimento, qualquer outro;
 *   - objeto recente: só é elegível depois de `prazoHoras` contados do MAIS
 *     NOVO entre o carimbo do caminho e as datas do storage;
 *   - objeto sem data no storage ou com carimbo no futuro.
 *
 * Confirmação em andamento: a confirmação só é aceita até
 * VALIDADE_DA_INTENCAO_MS (10 min) depois do passo ①, e o token de envio do
 * Supabase vale 2 h. O prazo mínimo aceito (3 h) é maior que os dois — um
 * objeto elegível já não pode mais ser confirmado. Mesmo assim, o registro é
 * consultado de novo imediatamente antes de apagar.
 *
 * ENSAIO por padrão. Este módulo é puro: banco e storage entram pela porta
 * (lib/limpeza-uploads-orfaos-porta.ts). O relatório só tem contagens por
 * workspace — nunca nome de arquivo.
 */
import { LIMITES_DO_UPLOAD_DIRETO, VALIDADE_DA_INTENCAO_MS } from './digital-twin-upload-direto'

type Env = Record<string, string | undefined>

const HORA = 60 * 60_000

/** Validade do token de envio do Supabase (createSignedUploadUrl), fixa. */
export const VALIDADE_DO_TOKEN_DE_ENVIO_MS = 2 * HORA

export const PRAZO_PADRAO_HORAS = 24
/** Acima do token de envio (2 h) e da intenção (10 min), com folga. */
export const PRAZO_MINIMO_HORAS = 3
export const PRAZO_MAXIMO_HORAS = 720

/** Teto de exclusões por execução: o resto fica para a próxima (idempotente). */
export const MAXIMO_DE_EXCLUSOES_POR_EXECUCAO = 500

export function lerPrazoHoras(env: Env = process.env): number {
  const n = Number((env.UPLOADS_ORFAOS_PRAZO_HORAS ?? '').trim())
  return Number.isInteger(n) && n >= PRAZO_MINIMO_HORAS && n <= PRAZO_MAXIMO_HORAS ? n : PRAZO_PADRAO_HORAS
}

/** Interruptor da execução real. Ausente ou diferente de `true` = ensaio. */
export function limpezaAtiva(env: Env = process.env): boolean {
  return env.LIMPEZA_UPLOADS_ORFAOS_ATIVA === 'true'
}

/** Execução real exige as duas coisas: `?modo=execucao` E o interruptor. Qualquer outra combinação é ensaio. */
export function decidirModo(pedido: string | null, env: Env = process.env): { modo: 'ensaio' | 'execucao'; motivo: string } {
  const pediu = (pedido ?? '').trim().toLowerCase() === 'execucao'
  if (pediu && limpezaAtiva(env)) return { modo: 'execucao', motivo: 'Execução real: pedida e habilitada (LIMPEZA_UPLOADS_ORFAOS_ATIVA=true).' }
  return {
    modo: 'ensaio',
    motivo: pediu
      ? 'ENSAIO — execução pedida, mas LIMPEZA_UPLOADS_ORFAOS_ATIVA não está ligada. Nada foi apagado.'
      : 'ENSAIO — nada foi apagado. Use ?modo=execucao com LIMPEZA_UPLOADS_ORFAOS_ATIVA=true para aplicar.',
  }
}

// ── Decisão por objeto ───────────────────────────────────────────────────

export interface ObjetoDoBucket {
  /** Caminho completo no bucket. Nunca sai no relatório. */
  nome: string
  criadoEm: Date | null
  atualizadoEm: Date | null
  tamanho: number | null
}

export type Classificacao = 'confirmado' | 'fora-do-padrao' | 'recente' | 'elegivel'

const TIPOS_NO_CAMINHO = Object.keys(LIMITES_DO_UPLOAD_DIRETO).map((t) => t.toLowerCase())

/** Carimbo (epoch ms) do caminho gerado pelo passo ① — ou null se não é desse padrão, desse workspace e desse perfil. */
export function carimboDoCaminho(nome: string, workspaceId: string, profileId: string): number | null {
  const prefixo = `${workspaceId}/${profileId}/`
  if (!workspaceId || !profileId || !nome.startsWith(prefixo)) return null
  const m = /^([a-z_]+)-(\d{13})-([0-9a-f]{12})$/.exec(nome.slice(prefixo.length))
  if (!m || !TIPOS_NO_CAMINHO.includes(m[1])) return null
  return Number(m[2])
}

export function classificarObjeto(
  obj: ObjetoDoBucket,
  ctx: { workspaceId: string; profileId: string; registrados: Set<string>; agora: Date; prazoHoras: number }
): Classificacao {
  if (ctx.registrados.has(obj.nome)) return 'confirmado'
  const carimbo = carimboDoCaminho(obj.nome, ctx.workspaceId, ctx.profileId)
  if (carimbo === null) return 'fora-do-padrao'
  const agora = ctx.agora.getTime()
  if (!obj.criadoEm || carimbo > agora) return 'recente' // sem data ou relógio estranho: não arrisca
  const maisNovo = Math.max(carimbo, obj.criadoEm.getTime(), obj.atualizadoEm?.getTime() ?? 0)
  const prazo = Math.max(ctx.prazoHoras, PRAZO_MINIMO_HORAS) * HORA
  // Garantia explícita: nada dentro da janela em que a confirmação ainda é possível.
  if (agora - carimbo <= VALIDADE_DA_INTENCAO_MS + VALIDADE_DO_TOKEN_DE_ENVIO_MS) return 'recente'
  return agora - maisNovo >= prazo ? 'elegivel' : 'recente'
}

// ── Execução ─────────────────────────────────────────────────────────────

export interface PortaDaLimpeza {
  /** Perfis do Digital Twin (um por workspace), opcionalmente de um só workspace. */
  listarPerfis(workspaceId?: string): Promise<{ workspaceId: string; profileId: string }[]>
  /** Objetos sob `<workspace>/<perfil>/`. Lança em erro — nunca devolve lista parcial. */
  listarObjetos(workspaceId: string, profileId: string): Promise<ObjetoDoBucket[]>
  /** Quais destes caminhos têm `DigitalTwinAsset`, em qualquer workspace. */
  caminhosRegistrados(caminhos: string[]): Promise<Set<string>>
  /** Apaga e devolve os caminhos efetivamente apagados. */
  apagar(caminhos: string[]): Promise<string[]>
  /** Registro de auditoria (só contagem). */
  auditar?(workspaceId: string, quantidade: number): Promise<void>
  /**
   * Execução real exclusiva: roda `fn` só se nenhuma outra execução real
   * estiver em andamento; senão devolve `{ executou: false }` sem rodar.
   */
  exclusividade?<T>(fn: () => Promise<T>): Promise<{ executou: true; valor: T } | { executou: false }>
}

export interface RelatorioDoWorkspace {
  workspaceId: string
  objetosVistos: number
  confirmados: number
  foraDoPadrao: number
  recentes: number
  elegiveis: number
  bytesElegiveis: number
  apagados: number
  /** Etapa que falhou — nada foi apagado depois dela neste workspace. */
  falha?: 'listagem' | 'registro' | 'exclusao'
}

export interface RelatorioDaLimpeza {
  modo: 'ensaio' | 'execucao'
  prazoHoras: number
  geradoEm: string
  workspaces: RelatorioDoWorkspace[]
  totais: Omit<RelatorioDoWorkspace, 'workspaceId' | 'falha'> & { workspacesComFalha: number }
  limiteDeExclusoesAtingido: boolean
  /** Outra execução real estava em andamento: esta não fez nada. */
  outraExecucaoEmAndamento?: true
}

type OpcoesDaLimpeza = {
  porta: PortaDaLimpeza
  agora: Date
  prazoHoras: number
  modo: 'ensaio' | 'execucao'
  workspaceId?: string
  maximoDeExclusoes?: number
}

/**
 * Disparo repetido ou simultâneo (dois agendadores, disparo manual por cima
 * do agendado): só UMA execução real por vez. A outra não lista, não apaga
 * e não audita — o relatório diz que outra estava em andamento. Ensaio não
 * escreve nada e não precisa da trava.
 */
export async function executarLimpeza(opcoes: OpcoesDaLimpeza): Promise<RelatorioDaLimpeza> {
  if (opcoes.modo !== 'execucao' || !opcoes.porta.exclusividade) return limpar(opcoes)
  const r = await opcoes.porta.exclusividade(() => limpar(opcoes))
  if (r.executou) return r.valor
  return { ...relatorioVazio(opcoes), outraExecucaoEmAndamento: true }
}

function relatorioVazio(opcoes: OpcoesDaLimpeza): RelatorioDaLimpeza {
  return {
    modo: opcoes.modo,
    prazoHoras: Math.max(opcoes.prazoHoras, PRAZO_MINIMO_HORAS),
    geradoEm: opcoes.agora.toISOString(),
    workspaces: [],
    totais: { objetosVistos: 0, confirmados: 0, foraDoPadrao: 0, recentes: 0, elegiveis: 0, bytesElegiveis: 0, apagados: 0, workspacesComFalha: 0 },
    limiteDeExclusoesAtingido: false,
  }
}

async function limpar(opcoes: OpcoesDaLimpeza): Promise<RelatorioDaLimpeza> {
  const { porta, agora, modo } = opcoes
  const prazoHoras = Math.max(opcoes.prazoHoras, PRAZO_MINIMO_HORAS)
  const maximo = opcoes.maximoDeExclusoes ?? MAXIMO_DE_EXCLUSOES_POR_EXECUCAO
  let restantes = maximo
  let limiteAtingido = false

  const perfis = await porta.listarPerfis(opcoes.workspaceId)
  const workspaces: RelatorioDoWorkspace[] = []

  for (const { workspaceId, profileId } of perfis) {
    if (opcoes.workspaceId && workspaceId !== opcoes.workspaceId) continue
    const r: RelatorioDoWorkspace = { workspaceId, objetosVistos: 0, confirmados: 0, foraDoPadrao: 0, recentes: 0, elegiveis: 0, bytesElegiveis: 0, apagados: 0 }
    workspaces.push(r)

    let objetos: ObjetoDoBucket[]
    try {
      objetos = await porta.listarObjetos(workspaceId, profileId)
    } catch {
      r.falha = 'listagem'
      continue
    }
    r.objetosVistos = objetos.length
    if (!objetos.length) continue

    let registrados: Set<string>
    try {
      registrados = await porta.caminhosRegistrados(objetos.map((o) => o.nome))
    } catch {
      r.falha = 'registro'
      continue
    }

    const elegiveis: string[] = []
    for (const obj of objetos) {
      const c = classificarObjeto(obj, { workspaceId, profileId, registrados, agora, prazoHoras })
      if (c === 'confirmado') r.confirmados++
      else if (c === 'fora-do-padrao') r.foraDoPadrao++
      else if (c === 'recente') r.recentes++
      else {
        r.elegiveis++
        r.bytesElegiveis += obj.tamanho ?? 0
        elegiveis.push(obj.nome)
      }
    }

    if (modo !== 'execucao' || !elegiveis.length) continue
    if (restantes <= 0) {
      limiteAtingido = true
      continue
    }

    // Segunda consulta, colada na exclusão: confirmação que tenha chegado
    // entre a listagem e agora preserva o objeto.
    let alvo: string[]
    try {
      const deNovo = await porta.caminhosRegistrados(elegiveis)
      alvo = elegiveis.filter((n) => !deNovo.has(n))
    } catch {
      r.falha = 'registro'
      continue
    }
    if (alvo.length > restantes) {
      alvo = alvo.slice(0, restantes)
      limiteAtingido = true
    }
    try {
      for (let i = 0; i < alvo.length; i += 100) {
        const apagados = await porta.apagar(alvo.slice(i, i + 100))
        r.apagados += apagados.length
        restantes -= apagados.length
      }
    } catch {
      r.falha = 'exclusao'
    }
    if (r.apagados && porta.auditar) await porta.auditar(workspaceId, r.apagados).catch(() => {})
  }

  const soma = (k: keyof Omit<RelatorioDoWorkspace, 'workspaceId' | 'falha'>) => workspaces.reduce((s, w) => s + w[k], 0)
  return {
    modo,
    prazoHoras,
    geradoEm: agora.toISOString(),
    workspaces,
    totais: {
      objetosVistos: soma('objetosVistos'),
      confirmados: soma('confirmados'),
      foraDoPadrao: soma('foraDoPadrao'),
      recentes: soma('recentes'),
      elegiveis: soma('elegiveis'),
      bytesElegiveis: soma('bytesElegiveis'),
      apagados: soma('apagados'),
      workspacesComFalha: workspaces.filter((w) => w.falha).length,
    },
    limiteDeExclusoesAtingido: limiteAtingido,
  }
}
