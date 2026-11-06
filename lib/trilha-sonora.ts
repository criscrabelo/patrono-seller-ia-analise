/**
 * P2.32 — TRILHA DO VÍDEO (recomendação honesta, sem inventar tendência nem licença).
 *
 * Fatos (verificados em 19/10/2026, P2.32-INTELIGENCIA-DE-TRILHAS-DESENHO.md):
 *   - a Content Posting API do TikTok NÃO tem campo de som → a trilha é escolhida pela titular no app;
 *   - a Biblioteca de Música Comercial (CML) não tem API pública → o Patrono não lista "músicas em alta";
 *   - colocar música no MP4 fora do app não tem licença comprovada → o vídeo do Patrono sai SEM trilha.
 * Por isso o Patrono recomenda o PERFIL do som (clima, voz/instrumental, andamento) a partir do próprio vídeo
 * e registra o som que a titular de fato usou (histórico próprio = única fonte de desempenho confiável).
 * FUNÇÕES PURAS (sem rede): servem à tela e aos testes.
 */

export interface PerfilSonoro {
  instrumental: boolean
  clima: string[]
  andamento: 'CALMO' | 'MODERADO' | 'ANIMADO'
  /** Intervalo entre as trocas de imagem (s) — o pulso da música deve acompanhar essas viradas. */
  trocaACadaS: number | null
  porque: string[]
  comoEscolherNoApp: string[]
  aviso: string
}

const LIVRO = /\b(livros?|dicion[aá]rio|gibis?|hqs?|mang[aá])\b/i
const INFANTIL = /\b(infantil|crian[cç]as?|beb[eê]s?|kids)\b/i

export const COMO_ESCOLHER_NO_APP = [
  'No app, ao publicar, toque em "Adicionar som".',
  'Use só os sons que o app oferece como comerciais (conteúdo de afiliada é comercial).',
  'Ouça junto com o vídeo inteiro: as trocas de imagem devem cair nas batidas.',
  'Deixe o volume da música baixo se houver narração ou texto para ler.',
]

export const AVISO_DA_TRILHA = 'O Patrono não sabe quais músicas estão em alta (o TikTok não oferece esse dado por API) e nunca coloca música no arquivo: a escolha é sua, no app, entre os sons comerciais.'

/** FUNÇÃO PURA. O perfil de som que combina com ESTE vídeo (nunca o nome de uma música). */
export function perfilSonoroDoVideo(p: { nome: string; categoria: string | null; estrutura?: string | null; duracaoSegundos?: number | null; trechos?: number | null; temNarracao?: boolean; temTextoNaTela?: boolean }): PerfilSonoro {
  const porque: string[] = []
  const livro = p.categoria === 'Livros' || LIVRO.test(p.nome)
  const infantil = INFANTIL.test(p.nome) || livro
  let andamento: PerfilSonoro['andamento'] = 'MODERADO'
  let clima = ['leve', 'positivo']
  if (livro) {
    andamento = 'CALMO'
    clima = ['delicado', 'acolhedor', 'envolvente']
    porque.push('É um livro: o som deve valorizar a leitura e o tema, sem competir com o texto.')
  } else if (p.categoria === 'Beleza' || p.categoria === 'Moda') {
    andamento = 'ANIMADO'
    clima = ['moderno', 'confiante']
    porque.push(`${p.categoria}: ritmo mais vivo costuma combinar com troca rápida de imagens.`)
  } else if (p.categoria === 'Casa e Decoração') {
    clima = ['tranquilo', 'organizado']
    porque.push('Casa: clima tranquilo para mostrar o produto sem pressa.')
  }
  if (p.estrutura === 'PRESENTE' || p.estrutura === 'NATAL') { clima = [...new Set([...clima, 'afetivo'])]; porque.push('Formato de presente: um toque afetivo.') }
  if (infantil && !livro) porque.push('Público infantil/família: evite letra com conteúdo adulto.')
  const temTexto = p.temTextoNaTela !== false
  const instrumental = !!p.temNarracao || temTexto
  if (p.temNarracao) porque.push('Tem narração: só instrumental, baixo, para a voz aparecer.')
  else if (temTexto) porque.push('Tem texto na tela: instrumental (sem voz cantada) ajuda a leitura.')
  const trocaACadaS = p.trechos && p.duracaoSegundos ? +(p.duracaoSegundos / p.trechos).toFixed(2) : null
  if (trocaACadaS) porque.push(`As imagens trocam a cada ${trocaACadaS} s: um pulso regular que acompanhe essas viradas deixa o vídeo sincronizado.`)
  return { instrumental, clima, andamento, trocaACadaS, porque, comoEscolherNoApp: COMO_ESCOLHER_NO_APP, aviso: AVISO_DA_TRILHA }
}

/** FUNÇÃO PURA. O som que a titular informou ter usado (texto livre do app), limpo e limitado. `null` se vazio. */
export function normalizarSomUsado(texto: unknown): string | null {
  if (typeof texto !== 'string') return null
  const t = texto.replace(/\s+/g, ' ').trim().slice(0, 120)
  return t.length >= 2 ? t : null
}
