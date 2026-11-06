/**
 * P1.9.1 — A mídia que pode ir ao ar num canal real.
 *
 * `media-rights-produto` responde se a mídia do PRODUTO pode compor um
 * vídeo. Esta pergunta é outra e mais estrita: o ARQUIVO que vai ser
 * publicado tem direito de uso com evidência?
 *
 * ── O QUE A P1.8 E A P1.9 MOSTRARAM ─────────────────────────────────────
 * - `comprei_e_testei` diz como o produto foi obtido, não quem fez a foto.
 *   As nove imagens com essa origem estão no CDN da Shopee.
 * - O "Kit Torcedor" se declara `Gerado por IA` e tem as seis imagens no
 *   CDN da Shopee. Declaração e evidência se contradizem.
 *
 * ── A REGRA, FAIL-CLOSED ────────────────────────────────────────────────
 * O arquivo publicado precisa de um registro de direito NA PEÇA
 * (`alertasCompliance`, tipo `direito_da_midia`) que:
 *   1. declara uma origem do vocabulário permitido;
 *   2. aponta para ESTE arquivo, e não para outro;
 *   3. traz a evidência que a origem exige (termo de licença, id de geração);
 *   4. está em custódia da própria conta (storage do Supabase do projeto);
 *   5. não está em host de marketplace ou fornecedor.
 * Faltando qualquer um, a mídia não está autorizada. Não há "permitido por
 * omissão".
 *
 * Puro: o ambiente entra por parâmetro.
 */

/** Origens de mídia aceitas para publicação real. Vocabulário fechado. */
export const ORIGENS_DE_MIDIA_PUBLICAVEIS = [
  /** Foto ou vídeo feito pela própria dona da conta. */
  'PROPRIO',
  /** Licença com termo registrado. Sem termo, não vale. */
  'LICENCIADO',
  /** Gerado pelo próprio Patrono, com o id da geração. */
  'GERADO_PELO_PATRONO',
  /**
   * P1.9.2. Arquivo DERIVADO (FFmpeg) de outras mídias. Não tem direito
   * próprio: herda o das fontes, e só vale se TODAS valerem. Passar pelo
   * FFmpeg não lava direito de imagem.
   */
  'DERIVADO',
] as const
export type OrigemDeMidiaPublicavel = (typeof ORIGENS_DE_MIDIA_PUBLICAVEIS)[number]

export const TIPO_EVIDENCIA_DE_MIDIA = 'direito_da_midia'

/** O registro de direito, gravado em `Conteudo.alertasCompliance`. */
export interface EvidenciaDeMidia {
  tipo: typeof TIPO_EVIDENCIA_DE_MIDIA
  severidade: 'verde'
  origem: OrigemDeMidiaPublicavel
  /** O arquivo exato a que este direito se refere. */
  assetUrl: string
  /** Formato da peça que este arquivo compõe. */
  formato: string
  /** Quem declarou (id do usuário) e quando (ISO). */
  declaradoPor: string
  declaradoEm: string
  /** O que é o arquivo, nas palavras de quem declarou. */
  descricao: string
  /** LICENCIADO: referência do termo. Obrigatório para essa origem. */
  termoDeLicenca?: string | null
  /** GERADO_PELO_PATRONO / DERIVADO: id do job que gerou. Obrigatório para essas origens. */
  geracaoId?: string | null
  /** DERIVADO: cada mídia que entrou no arquivo, com o direito dela. */
  fontes?: FonteDaDerivacao[] | null
  /**
   * P1.9.2. Declarações de quem enviou o arquivo, no momento do envio.
   * Ficam gravadas com a evidência: são parte do que se afirma sobre ele.
   */
  declaracoes?: Record<string, boolean> | null
  /**
   * P2.50 (Codex 5). Prazo do direito (ISO). Vencido => a mídia não publica.
   * Ausente = sem prazo declarado (registros antigos continuam valendo).
   */
  validaAte?: string | null
  /**
   * P2.50 (Codex 5). Canais em que o direito vale (ex.: ["tiktok", "instagram"]).
   * Ausente ou vazio = sem restrição declarada. Presente => canal fora da lista bloqueia.
   */
  canaisPermitidos?: string[] | null
  mensagem: string
}

/** Contexto do USO: em que canal e quando a mídia vai ao ar (prazo e canal do direito). */
export interface UsoDaMidia {
  canal?: string | null
  agora?: Date
}

/**
 * P2.50 (Codex 5). O direito vale para ESTE uso? Prazo vencido, prazo ilegível
 * ou canal fora da lista bloqueiam. Sem prazo/canais declarados, nada muda.
 */
export function direitoValeParaOUso(ev: Pick<EvidenciaDeMidia, 'validaAte' | 'canaisPermitidos'>, uso: UsoDaMidia = {}): string | null {
  const agora = uso.agora ?? new Date()
  if (ev.validaAte != null && ev.validaAte !== '') {
    const ate = new Date(ev.validaAte)
    if (!Number.isFinite(ate.getTime())) return 'O prazo do direito de uso é ilegível.'
    if (ate.getTime() < agora.getTime()) return `O direito de uso venceu em ${ate.toISOString().slice(0, 10)}.`
  }
  const canais = Array.isArray(ev.canaisPermitidos) ? ev.canaisPermitidos.map((c) => String(c).trim().toLowerCase()).filter(Boolean) : []
  const canal = (uso.canal ?? '').trim().toLowerCase()
  if (canais.length && canal && !canais.includes(canal)) return `O direito de uso não cobre o canal "${canal}" (vale para: ${canais.join(', ')}).`
  return null
}

/** Uma mídia que entrou num arquivo derivado. */
export interface FonteDaDerivacao {
  /** O que ela é no derivado: imagem do produto, vídeo base, voz, fundo. */
  papel: string
  /**
   * URL do arquivo-fonte, ou `patrono:<algo>` para o que o próprio Patrono
   * sintetizou sem arquivo de terceiro (fundo neutro, texto, voz gerada).
   */
  assetUrl: string
  /** O direito da fonte. `null` = sem evidência, e o derivado fica bloqueado. */
  evidencia: EvidenciaDeMidia | null
}

/**
 * Hosts de terceiros: marketplace, fornecedor, CDN de vitrine. Uma mídia
 * nestes hosts é do vendedor ou da plataforma, seja qual for a origem
 * declarada no cadastro.
 */
const HOSTS_DE_TERCEIROS: { nome: string; padrao: RegExp }[] = [
  { nome: 'Shopee', padrao: /(^|\.)susercontent\.com$|(^|\.)shopee\.com(\.br)?$/i },
  { nome: 'Mercado Livre', padrao: /(^|\.)mlstatic\.com$|(^|\.)mercadolivre\.com(\.br)?$|(^|\.)mercadolibre\.com$/i },
  { nome: 'Amazon', padrao: /(^|\.)media-amazon\.com$|(^|\.)ssl-images-amazon\.com$|(^|\.)amazon\.com(\.br)?$/i },
  { nome: 'AliExpress/Alibaba', padrao: /(^|\.)alicdn\.com$|(^|\.)aliexpress\.com$/i },
  { nome: 'TikTok', padrao: /(^|\.)tiktokcdn(-\w+)?\.com$|(^|\.)ibyteimg\.com$/i },
  { nome: 'Magalu', padrao: /(^|\.)mlcdn\.com\.br$|(^|\.)magazineluiza\.com\.br$/i },
]

function hostDe(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

/** O nome do terceiro dono do host, ou `null` quando não é host conhecido de terceiro. */
export function hostDeTerceiro(url: string): string | null {
  const host = hostDe(url)
  if (!host) return null
  return HOSTS_DE_TERCEIROS.find((h) => h.padrao.test(host))?.nome ?? null
}

/**
 * O arquivo está no storage do PRÓPRIO projeto?
 *
 * Custódia prova que a conta subiu o arquivo. Não prova autoria — por isso
 * ela é condição necessária, nunca suficiente: a origem declarada continua
 * obrigatória.
 */
export function emCustodiaPropria(url: string, env: Record<string, string | undefined>): boolean {
  const host = hostDe(url)
  const hostDoProjeto = hostDe(env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  if (!host || !hostDoProjeto) return false
  if (host !== hostDoProjeto) return false
  try {
    return new URL(url).pathname.startsWith('/storage/v1/object/')
  } catch {
    return false
  }
}

/**
 * Lê o registro de direito da peça, se houver um bem formado.
 *
 * Com `assetUrl`, devolve o registro DESTE arquivo — uma peça pode guardar
 * o direito da prévia privada e o do vídeo publicável, e confundir os dois
 * seria aplicar o direito de um arquivo a outro. Sem `assetUrl`, o primeiro.
 */
export function lerEvidenciaDeMidia(
  alertas: unknown[] | null | undefined,
  assetUrl?: string | null
): EvidenciaDeMidia | null {
  if (!Array.isArray(alertas)) return null
  const validas: EvidenciaDeMidia[] = []
  for (const a of alertas) {
    const item = (a ?? {}) as Record<string, unknown>
    if (item.tipo !== TIPO_EVIDENCIA_DE_MIDIA) continue
    if (typeof item.assetUrl !== 'string' || typeof item.origem !== 'string') continue
    validas.push(item as unknown as EvidenciaDeMidia)
  }
  if (assetUrl) return validas.find((e) => e.assetUrl.trim() === assetUrl.trim()) ?? validas[0] ?? null
  return validas[0] ?? null
}

/** Prefixo de fonte sintetizada pelo próprio Patrono, sem arquivo de terceiro. */
export const PREFIXO_FONTE_DO_PATRONO = 'patrono:'

/** Profundidade máxima da cadeia. Derivado de derivado de derivado é o teto. */
const PROFUNDIDADE_MAXIMA = 3

/**
 * O direito de UMA fonte de um derivado.
 *
 * Fonte sintetizada pelo Patrono (`patrono:...`) não tem arquivo para estar
 * em custódia: vale com origem GERADO_PELO_PATRONO e id de geração. Fonte
 * com arquivo passa pela MESMA régua de um arquivo publicado.
 */
function avaliarFonte(
  fonte: FonteDaDerivacao,
  env: Record<string, string | undefined>,
  profundidade: number,
  uso: UsoDaMidia = {}
): AvaliacaoDaMidia {
  const url = (fonte.assetUrl ?? '').trim()
  if (url.startsWith(PREFIXO_FONTE_DO_PATRONO)) {
    const ev = fonte.evidencia
    if (!ev || ev.origem !== 'GERADO_PELO_PATRONO' || !(ev.geracaoId ?? '').trim()) {
      return nao(`Fonte "${fonte.papel}" se diz do Patrono e não traz o registro da geração.`)
    }
    const fora = direitoValeParaOUso(ev, uso)
    if (fora) return nao(fora, ev.origem)
    return { autorizada: true, motivo: `Fonte "${fonte.papel}" sintetizada pelo Patrono.`, origem: ev.origem }
  }
  return avaliarComProfundidade({ assetUrl: url, evidencia: fonte.evidencia, env, uso }, profundidade + 1)
}

export interface AvaliacaoDaMidia {
  autorizada: boolean
  motivo: string
  origem: OrigemDeMidiaPublicavel | null
}

const nao = (motivo: string, origem: OrigemDeMidiaPublicavel | null = null): AvaliacaoDaMidia => ({
  autorizada: false,
  motivo,
  origem,
})

/**
 * A mídia que vai ser publicada tem direito de uso com evidência?
 *
 * A origem do PRODUTO (`comprei_e_testei`, `Shopee`, `De fornecedor`) não
 * entra nesta conta: ela não diz nada sobre quem fez o arquivo.
 */
/**
 * As fontes de um derivado dão direito? Só a cadeia — não olha onde o
 * arquivo final está. Todas precisam valer; a primeira que falha decide.
 */
export function avaliarFontesDaDerivacao(
  fontes: FonteDaDerivacao[] | null | undefined,
  env: Record<string, string | undefined>,
  uso: UsoDaMidia = {}
): AvaliacaoDaMidia {
  const lista = Array.isArray(fontes) ? fontes : []
  if (lista.length === 0) return nao('Derivado sem fontes registradas — não há de onde herdar direito.', 'DERIVADO')
  for (const f of lista) {
    const r = avaliarFonte(f, env, 0, uso)
    if (!r.autorizada) return nao(`Fonte "${f.papel}" sem direito: ${r.motivo}`, 'DERIVADO')
  }
  return { autorizada: true, motivo: 'Todas as fontes têm direito registrado.', origem: 'DERIVADO' }
}

export function avaliarMidiaParaPublicacao(params: {
  assetUrl: string | null
  evidencia: EvidenciaDeMidia | null
  env: Record<string, string | undefined>
  /** P2.50 (Codex 5): canal e momento do uso — prazo e canais do direito. */
  uso?: UsoDaMidia
}): AvaliacaoDaMidia {
  return avaliarComProfundidade(params, 0)
}

function avaliarComProfundidade(
  params: {
    assetUrl: string | null
    evidencia: EvidenciaDeMidia | null
    env: Record<string, string | undefined>
    uso?: UsoDaMidia
  },
  profundidade: number
): AvaliacaoDaMidia {
  const assetUrl = (params.assetUrl ?? '').trim()
  if (!assetUrl) return nao('A peça não tem mídia.')

  const terceiro = hostDeTerceiro(assetUrl)
  if (terceiro) {
    return nao(`O arquivo está hospedado em ${terceiro}: é mídia de terceiro, seja qual for a origem declarada.`)
  }

  const ev = params.evidencia
  if (!ev) {
    return nao(
      'A peça não tem registro de direito da mídia. A origem do produto (comprei_e_testei, Shopee, fornecedor) não prova autoria do arquivo.'
    )
  }
  if (!(ORIGENS_DE_MIDIA_PUBLICAVEIS as readonly string[]).includes(ev.origem)) {
    return nao(`Origem "${ev.origem}" não está no vocabulário permitido para publicação.`)
  }
  if (ev.assetUrl.trim() !== assetUrl) {
    return nao('O registro de direito se refere a outro arquivo, não ao que seria publicado.', ev.origem)
  }
  if (!(ev.declaradoPor ?? '').trim() || !(ev.declaradoEm ?? '').trim()) {
    return nao('O registro de direito não diz quem declarou nem quando.', ev.origem)
  }
  const foraDoUso = direitoValeParaOUso(ev, params.uso)
  if (foraDoUso) return nao(foraDoUso, ev.origem)
  if (ev.origem === 'LICENCIADO' && !(ev.termoDeLicenca ?? '').trim()) {
    return nao('Mídia licenciada sem referência do termo de licença.', ev.origem)
  }
  if (ev.origem === 'GERADO_PELO_PATRONO' && !(ev.geracaoId ?? '').trim()) {
    return nao('Mídia "gerada pelo Patrono" sem o id da geração que a produziu.', ev.origem)
  }
  if (ev.origem === 'DERIVADO') {
    // O derivado não tem direito próprio. Herda — e só herda o que TODAS as
    // fontes têm. Uma fonte sem direito contamina o arquivo inteiro.
    if (!(ev.geracaoId ?? '').trim()) {
      return nao('Arquivo derivado sem o id da geração que o produziu.', ev.origem)
    }
    const fontes = Array.isArray(ev.fontes) ? ev.fontes : []
    if (fontes.length === 0) {
      return nao('Arquivo derivado sem fontes registradas — não há de onde herdar direito.', ev.origem)
    }
    if (profundidade >= PROFUNDIDADE_MAXIMA) {
      return nao('Cadeia de derivação longa demais para ser verificada.', ev.origem)
    }
    for (const f of fontes) {
      const r = avaliarFonte(f, params.env, profundidade, params.uso)
      if (!r.autorizada) {
        return nao(`Derivado bloqueado pela fonte "${f.papel}": ${r.motivo}`, ev.origem)
      }
    }
  }
  if (!emCustodiaPropria(assetUrl, params.env)) {
    return nao('O arquivo não está no storage da própria conta — custódia não comprovada.', ev.origem)
  }

  return { autorizada: true, motivo: `Mídia ${ev.origem}, em custódia própria, com registro de direito.`, origem: ev.origem }
}
