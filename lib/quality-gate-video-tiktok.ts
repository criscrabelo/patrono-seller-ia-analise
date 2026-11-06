/**
 * P2.17.4 — Quality Gate de vídeo TikTok. FUNÇÃO PURA, determinística, sem IA.
 *
 * Roda ANTES da publicação (que continua manual pela titular). Avalia:
 * força do gancho, clareza, duração, presença do produto, CTA, divulgação,
 * adequação ao TikTok, potencial de retenção / clique / conversão e risco de
 * compliance. Resultado: APROVADO / REVISAR / BLOQUEADO, com explicação.
 *
 * "Potencial" aqui é heurística declarada, não previsão: nenhuma nota afirma
 * quantas views ou vendas o vídeo terá.
 */
import { canalDaHashtag, claimsNaoComprovados } from './copy-por-canal'

export type VereditoDoVideo = 'APROVADO' | 'REVISAR' | 'BLOQUEADO'

export interface VideoParaAvaliar {
  gancho: string
  roteiro: { etapa: string; texto: string; textoNaTela?: string | null }[]
  versaoCurta?: { segundos: number; roteiro: { etapa: string; texto: string }[] }
  cta: string
  legenda: string
  disclosure?: string
  hashtags: string[]
  duracaoSegundos: number
  exigeExperienciaReal: boolean
  objetivo?: string
}

export interface AvaliacaoDoVideo {
  veredito: VereditoDoVideo
  notas: {
    gancho: number
    clareza: number
    duracao: number
    produto: number
    cta: number
    divulgacao: number
    adequacaoTikTok: number
    retencao: number
    clique: number
    conversao: number
  }
  riscoDeCompliance: 'BAIXO' | 'MEDIO' | 'ALTO'
  motivos: string[]
  resumo: string
}

/** Promessas que nunca podem ir ao ar (além das alegações do filtro de copy). */
const PROMESSAS_PROIBIDAS = /\b(vai viralizar|viral garantid|garantid[oa]s?|milagr|100% (eficaz|garantido)|cura\b|emagrece|resultado imediato|fique rico)/i
const SINAL_DE_GANCHO_FORTE = /(\?|\b\d+\b|\bpov\b|\bvoce\b|\bvocê\b|\bpouca gente\b|\beu não esperava\b|\bolha\b)/i

function nota(v: number) {
  return Math.max(0, Math.min(100, Math.round(v)))
}

/**
 * P2.34 — COERÊNCIA com o produto: frases que o produto não sustenta (ex.: um LIVRO "funcionando de verdade",
 * "resultado final", "problema em casa"). Começa por Livros. FUNÇÃO PURA: devolve as frases encontradas.
 */
const INCOERENTE_COM_LIVRO = /(funcionand[oa]|como funciona|resultado final|problema em casa|o que muda na pr[aá]tica|antes e depois|em a[cç][aã]o|em uso)/gi
export function textosIncoerentesComOProduto(texto: string, produto: { nome: string; categoria: string | null } | null | undefined): string[] {
  if (!produto) return []
  const livro = produto.categoria === 'Livros' || /\b(livros?|dicion[aá]rio|gibis?|hqs?|mang[aá])\b/i.test(produto.nome)
  if (!livro) return []
  return [...new Set((texto.match(INCOERENTE_COM_LIVRO) ?? []).map((x) => x.toLowerCase()))]
}

export function avaliarVideo(v: VideoParaAvaliar, ctx: { tiktokShop: boolean; temVendasReais?: boolean; produto?: { nome: string; categoria: string | null } | null }): AvaliacaoDoVideo {
  const motivos: string[] = []
  const textoTodo = [v.gancho, v.legenda, ...v.roteiro.map((r) => `${r.texto} ${r.textoNaTela ?? ''}`)].join(' ')
  // Só o que vai à TELA e à legenda conta para coerência (instruções de gravação, "Mostre…", não aparecem).
  const textoVisivel = [v.gancho, v.legenda, v.cta, ...v.roteiro.map((r) => r.textoNaTela ?? '')].join(' ')
  const incoerentes = textosIncoerentesComOProduto(textoVisivel, ctx.produto)
  if (incoerentes.length) motivos.push(`Texto incoerente com o produto (livro): ${incoerentes.join(', ')}.`)

  // Gancho: curto, direto, com elemento de atenção (pergunta, número, "você", POV…).
  const palavras = v.gancho.trim().split(/\s+/).filter(Boolean).length
  let g = 50
  if (palavras >= 3 && palavras <= 14) g += 20
  else motivos.push(palavras < 3 ? 'Gancho curto demais para prender.' : 'Gancho longo: o ideal são até 14 palavras nos primeiros 3 s.')
  if (SINAL_DE_GANCHO_FORTE.test(v.gancho)) g += 20
  if (v.gancho.length > 90) { g -= 20; motivos.push('Gancho passa de 90 caracteres.') }
  const gancho = nota(g)

  // Clareza: 3 a 8 etapas, nenhuma vazia, texto de tela curto.
  let c = 100
  if (v.roteiro.length < 3 || v.roteiro.length > 8) { c -= 30; motivos.push('Roteiro deve ter de 3 a 8 etapas.') }
  if (v.roteiro.some((r) => !r.texto.trim())) { c -= 40; motivos.push('Há etapa sem texto.') }
  if (v.roteiro.some((r) => (r.textoNaTela ?? '').length > 40)) { c -= 20; motivos.push('Texto na tela passa de 40 caracteres (difícil de ler).') }
  const clareza = nota(c)

  // Duração: TikTok de afiliado funciona melhor curto; > 60 s pede revisão.
  const d = v.duracaoSegundos
  const duracao = nota(d >= 7 && d <= 34 ? 100 : d <= 60 ? 70 : 30)
  if (d > 60) motivos.push('Mais de 60 s: para afiliado, prefira até 30 s.')
  if (d < 7) motivos.push('Menos de 7 s: pouco tempo para mostrar o produto.')

  // Produto presente: demonstração no roteiro e na versão curta.
  // Livro: folhear as páginas É mostrar o produto.
  const temDemo = v.roteiro.some((r) => /demonstra|em uso|em ação|mostre o produto|folheie|por dentro/i.test(`${r.etapa} ${r.texto}`))
  const curtaComProduto = !v.versaoCurta || v.versaoCurta.roteiro.some((r) => /demonstra|produto|motivo|abertura/i.test(`${r.etapa} ${r.texto}`))
  const produto = nota((temDemo ? 70 : 20) + (curtaComProduto ? 30 : 0))
  if (!temDemo) motivos.push('O produto não aparece em uso no roteiro.')

  // CTA coerente com onde o link fica.
  const ctaOk = !!v.cta.trim()
  const ctaCoerente = ctx.tiktokShop ? /marcado|produto/i.test(v.cta) : /bio/i.test(v.cta)
  const cta = nota(ctaOk ? (ctaCoerente ? 100 : 50) : 0)
  if (!ctaOk) motivos.push('Sem CTA.')
  else if (!ctaCoerente) motivos.push(ctx.tiktokShop ? 'CTA não fala do produto marcado.' : 'Produto fora do TikTok Shop: o CTA deve apontar para a bio.')

  // Divulgação de afiliado na legenda.
  const temDivulgacao = /comiss|afiliad|#publi\b|publicidade/i.test(v.legenda)
  const divulgacao = temDivulgacao ? 100 : 0
  if (!temDivulgacao) motivos.push('Falta a divulgação de afiliado na legenda.')

  // Adequação ao TikTok: hashtags (até 5, nenhuma de outro canal), sem link na legenda.
  let a = 100
  const deOutroCanal = v.hashtags.filter((h) => canalDaHashtag(h, 'tiktok') !== null)
  if (deOutroCanal.length) { a -= 40; motivos.push(`Hashtag de outro canal: ${deOutroCanal.join(', ')}.`) }
  if (v.hashtags.length > 5) { a -= 20; motivos.push('Mais de 5 hashtags.') }
  if (/https?:\/\//i.test(v.legenda)) { a -= 40; motivos.push('Link na legenda não abre no TikTok.') }
  const adequacaoTikTok = nota(a)

  // Potenciais (heurística declarada).
  const retencao = nota(gancho * 0.6 + (d <= 20 ? 30 : d <= 34 ? 20 : 5) + (temDemo ? 10 : 0))
  const clique = nota(cta * 0.5 + (ctx.tiktokShop ? 35 : 15) + (v.objetivo === 'CLIQUE' ? 15 : 5))
  const conversao = nota((temDemo ? 40 : 10) + (ctx.temVendasReais ? 30 : 10) + (ctx.tiktokShop ? 20 : 5) + (v.objetivo === 'VENDA' ? 10 : 0))

  // Compliance.
  const alegacoes = claimsNaoComprovados(textoTodo)
  const promessa = PROMESSAS_PROIBIDAS.test(textoTodo)
  const riscoDeCompliance: AvaliacaoDoVideo['riscoDeCompliance'] = promessa || alegacoes.length ? 'ALTO' : v.exigeExperienciaReal ? 'MEDIO' : 'BAIXO'
  if (promessa) motivos.push('Promessa proibida (viralização, garantia, cura, resultado).')
  if (alegacoes.length) motivos.push(`Alegação sem comprovação: ${alegacoes.join(', ')}.`)
  if (v.exigeExperienciaReal) motivos.push('Este formato exige que você tenha testado o produto de verdade.')

  const notas = { gancho, clareza, duracao, produto, cta, divulgacao, adequacaoTikTok, retencao, clique, conversao }
  const bloqueado = !temDivulgacao || riscoDeCompliance === 'ALTO' || !ctaOk
  const revisar = !bloqueado && (Object.values(notas).some((n) => n < 50) || v.exigeExperienciaReal || d > 60 || !ctaCoerente || incoerentes.length > 0)
  const veredito: VereditoDoVideo = bloqueado ? 'BLOQUEADO' : revisar ? 'REVISAR' : 'APROVADO'
  const resumo =
    veredito === 'APROVADO'
      ? 'Aprovado: gancho, produto, CTA e divulgação em ordem.'
      : veredito === 'BLOQUEADO'
        ? `Bloqueado: ${motivos.find((m) => /divulgação|Promessa|Alegação|Sem CTA/.test(m)) ?? motivos[0]}`
        : `Revisar: ${motivos[0] ?? 'alguma nota abaixo de 50.'}`
  return { veredito, notas, riscoDeCompliance, motivos, resumo }
}

// ── P2.17.10: a checagem dentro do fluxo de publicação ─────────────────

/**
 * Roteiro gravado no `Conteudo` pelo modo assistido, uma etapa por linha:
 *   "Etapa — texto [tela: texto na tela]"
 * Conteúdo de outra origem (texto livre) vira uma etapa por linha.
 */
export function roteiroComoTexto(etapas: { etapa: string; texto: string; textoNaTela?: string | null }[]): string {
  return etapas.map((e) => `${e.etapa} — ${e.texto}${e.textoNaTela ? ` [tela: ${e.textoNaTela}]` : ''}`).join('\n')
}

export function roteiroDoTexto(texto: string | null): { etapa: string; texto: string; textoNaTela: string | null }[] {
  return (texto ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      const m = l.match(/^(.+?) — (.+?)(?: \[tela: (.+)\])?$/)
      return m ? { etapa: m[1], texto: m[2], textoNaTela: m[3] ?? null } : { etapa: `Etapa ${i + 1}`, texto: l, textoNaTela: null }
    })
}

/** O vídeo de um `Conteudo` no formato da checagem (nada é completado: falta = nota baixa). */
export function videoDoConteudo(c: {
  roteiro: string | null
  textoTela: string | null
  chamadaAcao: string | null
  legendaTiktok: string | null
  hashtags: string[]
  duracao: number | null
  objetivo: string | null
  exigeExperienciaReal: boolean
}): VideoParaAvaliar {
  const roteiro = roteiroDoTexto(c.roteiro)
  const abertura = roteiro.find((r) => /gancho/i.test(r.etapa)) ?? null
  return {
    gancho: abertura?.texto ?? (c.textoTela ?? '').split(/\r?\n/)[0] ?? roteiro[0]?.texto ?? '',
    roteiro,
    cta: c.chamadaAcao ?? '',
    legenda: c.legendaTiktok ?? '',
    hashtags: c.hashtags,
    duracaoSegundos: c.duracao ?? 0,
    exigeExperienciaReal: c.exigeExperienciaReal,
    objetivo: c.objetivo ?? undefined,
  }
}

/**
 * A regra do fluxo: BLOQUEADO não publica; REVISAR volta para correção;
 * só APROVADO segue. Devolve a pendência que segura a publicação (ou null).
 */
export function pendenciaDaChecagem(a: AvaliacaoDoVideo): string | null {
  if (a.veredito === 'APROVADO') return null
  return a.veredito === 'BLOQUEADO' ? `Quality Gate BLOQUEADO — não publica: ${a.resumo}` : `Quality Gate pede REVISÃO — volta para correção: ${a.resumo}`
}
