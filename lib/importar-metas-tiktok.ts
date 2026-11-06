/**
 * P2.17.4 — Importar missões do TikTok Shop a partir do TEXTO da tela de metas.
 * FUNÇÃO PURA. Nunca grava: devolve um RASCUNHO para a titular revisar.
 *
 * Por que texto e não imagem: não há API pública de missões confirmada, e OCR
 * de imagem no servidor seria frágil (ou pago). O caminho sem custo e mais
 * confiável é o próprio celular: no print da tela de metas, "copiar texto"
 * (iPhone: Texto ao Vivo; Android: Google Lens / "Selecionar texto") e colar
 * aqui. O parser tolera o texto bagunçado que esse recurso produz.
 *
 * O que lê (o que não achar vira AVISO, nunca valor inventado):
 *  - campanha: a primeira linha "título" (ex.: "Metas de Outubro");
 *  - período: "10/10/2026 - 19/10/2026", "10/10 a 19/10", "10 out – 19 out",
 *    "até 19/10";
 *  - recompensa total: o primeiro valor "R$ 230,00" (ou o marcado "total");
 *  - metas: linhas com "realizado/exigido" (ex.: "Vídeos qualificados 0/10");
 *    o tipo é inferido pelas palavras e pode ser corrigido na revisão.
 */
import type { TipoDeMeta } from './metas-tiktok'

export interface MetaRascunho {
  nome: string
  tipo: TipoDeMeta
  quantidadeRealizada: number
  quantidadeExigida: number
  linhaOriginal: string
}

export interface RascunhoDeCampanha {
  campanha: string | null
  inicio: string | null // AAAA-MM-DD
  fim: string | null
  recompensaTotal: number | null
  metas: MetaRascunho[]
  avisos: string[]
  exigeRevisao: true
}

const MESES: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 }

function semAcento(t: string) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (a: number, m: number, d: number) => `${a}-${pad(m)}-${pad(d)}`

function dataValida(a: number, m: number, d: number): boolean {
  const x = new Date(Date.UTC(a, m - 1, d))
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d
}

/** Datas do texto, na ordem em que aparecem. Ano ausente = ano de referência. */
export function extrairDatas(texto: string, anoReferencia: number): { dia: number; mes: number; ano: number | null }[] {
  const t = semAcento(texto)
  const achadas: { pos: number; dia: number; mes: number; ano: number | null }[] = []
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const ano = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null
    achadas.push({ pos: m.index ?? 0, dia: Number(m[1]), mes: Number(m[2]), ano })
  }
  for (const m of t.matchAll(/\b(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?(?:\s*(?:de\s+)?(\d{4}))?/g)) {
    achadas.push({ pos: m.index ?? 0, dia: Number(m[1]), mes: MESES[m[2]], ano: m[3] ? Number(m[3]) : null })
  }
  return achadas
    .sort((a, b) => a.pos - b.pos)
    .filter((d) => dataValida(d.ano ?? anoReferencia, d.mes, d.dia))
    .map(({ dia, mes, ano }) => ({ dia, mes, ano }))
}

/** "R$ 230,00", "R$230", "R$ 1.234,56" → número. */
export function extrairValor(texto: string): number | null {
  const m = texto.match(/R\$\s*([\d.]+(?:,\d{1,2})?)/i)
  if (!m) return null
  const n = Number(m[1].replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Tipo pelas palavras da linha (a titular pode corrigir na revisão). */
export function tipoDaLinha(linha: string): TipoDeMeta {
  const t = semAcento(linha)
  if (/amostra/.test(t)) return 'SOLICITAR_AMOSTRAS'
  if (/video/.test(t) && /(produtos? a venda|com produtos?|produto marcado)/.test(t)) return 'VIDEOS_COM_PRODUTO'
  if (/video/.test(t) && /qualificad/.test(t)) return 'VIDEOS_QUALIFICADOS'
  if (/produto/.test(t) && /(adicionad|adicionar|vitrine)/.test(t)) return 'ADICIONAR_PRODUTOS'
  if (/video/.test(t)) return 'VIDEOS_QUALIFICADOS'
  return 'OUTRO'
}

const LINHA_DE_PROGRESSO = /^(.*?)[\s:–-]*\(?\s*(\d{1,6})\s*\/\s*(\d{1,6})\s*\)?\s*$/

export function lerTextoDeMetas(texto: string, agora: Date = new Date()): RascunhoDeCampanha {
  const linhas = texto.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const avisos: string[] = []
  const anoRef = agora.getFullYear()

  // Metas: linhas com "x/y" que NÃO são datas.
  const metas: MetaRascunho[] = []
  for (const l of linhas) {
    if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(l)) continue
    const m = l.match(LINHA_DE_PROGRESSO)
    if (!m) continue
    const nome = m[1].replace(/[•·*\-–:]+$/g, '').trim()
    const feito = Number(m[2])
    const exigido = Number(m[3])
    if (!nome || /^\d/.test(nome) || exigido < 1) continue
    // "10/10" sozinho numa linha de data abreviada (sem texto) não é meta.
    if (!/[a-zà-ú]/i.test(nome)) continue
    metas.push({ nome, tipo: tipoDaLinha(nome), quantidadeRealizada: Math.min(feito, 1_000_000), quantidadeExigida: exigido, linhaOriginal: l })
    if (feito > exigido) avisos.push(`"${nome}": realizado (${feito}) maior que o exigido (${exigido}) — confira.`)
  }
  if (!metas.length) avisos.push('Não encontrei nenhuma meta no formato "feito/exigido" (ex.: "Vídeos qualificados 0/10").')

  // Período: as duas primeiras datas fora das linhas de meta.
  const textoSemMetas = linhas.filter((l) => !metas.some((m) => m.linhaOriginal === l)).join('\n')
  const datas = extrairDatas(textoSemMetas, anoRef)
  let inicio: string | null = null
  let fim: string | null = null
  if (datas.length >= 2) {
    const [a, b] = datas
    const anoA = a.ano ?? b.ano ?? anoRef
    let anoB = b.ano ?? anoA
    if (!b.ano && (b.mes < a.mes || (b.mes === a.mes && b.dia < a.dia))) anoB = anoA + 1
    inicio = iso(anoA, a.mes, a.dia)
    fim = iso(anoB, b.mes, b.dia)
  } else if (datas.length === 1) {
    const d = datas[0]
    fim = iso(d.ano ?? anoRef, d.mes, d.dia)
    avisos.push('Encontrei só uma data (usei como fim). Informe o início na revisão.')
  } else {
    avisos.push('Não encontrei o período (início e fim). Informe na revisão.')
  }
  if (!datas.some((d) => d.ano !== null) && datas.length) avisos.push(`O texto não traz o ano: usei ${anoRef}. Confira.`)

  // Recompensa: linha com "total" primeiro; senão o primeiro R$.
  const linhaTotal = linhas.find((l) => /total/i.test(l) && /R\$/.test(l))
  const recompensaTotal = extrairValor(linhaTotal ?? linhas.find((l) => /R\$/.test(l)) ?? '')
  if (recompensaTotal === null) avisos.push('Não encontrei a recompensa em R$. Informe na revisão, se houver.')
  else if (!linhaTotal) avisos.push('Usei o primeiro valor em R$ como recompensa total da campanha. Confira se é o total.')

  // Campanha: primeira linha com letras que não é meta, data, valor nem rótulo genérico.
  // Símbolos de navegação do app ("‹", "←", "•") saem antes; títulos genéricos
  // ("Metas", "Missões", "Ver regras") não contam como nome da campanha.
  const limpar = (l: string) => l.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  const campanha =
    linhas
      .filter((l) => !metas.some((m) => m.linhaOriginal === l))
      .map(limpar)
      .find(
        (l) =>
          /[a-zà-ú]{3}/i.test(l) &&
          !/R\$/.test(l) &&
          !/\d{1,2}\/\d{1,2}/.test(l) &&
          !/^(recompensa|premio|periodo|progresso|ganhe|ver regras|regras|metas?$|missoes?$|minhas metas$|centro de)/i.test(semAcento(l))
      ) ?? null
  if (!campanha) avisos.push('Não encontrei o nome da campanha. Informe na revisão.')

  return { campanha, inicio, fim, recompensaTotal, metas, avisos, exigeRevisao: true }
}
