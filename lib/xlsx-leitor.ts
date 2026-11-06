/**
 * P2.19 — Leitor MÍNIMO de XLSX, sem dependência nova (o .xlsx é um zip de XML; o zlib é do próprio Node).
 *
 * Lê só a PRIMEIRA planilha: textos (compartilhados, inline e fórmula com texto), números e booleanos.
 * Número sai como `number` (nunca como texto, para não confundir 1.234 decimal com milhar).
 * Não executa nada, não lê macros, não resolve fórmulas (usa o último valor calculado que o arquivo trouxe).
 *
 * Travas: arquivo que não é zip/xlsx → erro claro; limite de tamanho descompactado (anti zip-bomb);
 * só os métodos de compressão "stored" e "deflate".
 */
import { inflateRawSync } from 'node:zlib'

export type Celula = string | number
export class ErroDeXlsx extends Error {}

const LIMITE_DESCOMPACTADO = 60 * 1024 * 1024

function lerZip(buf: Buffer): Map<string, () => Buffer> {
  let fim = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break }
  }
  if (fim < 0) throw new ErroDeXlsx('O arquivo não é um XLSX válido (não é um zip).')
  const total = buf.readUInt16LE(fim + 10)
  let p = buf.readUInt32LE(fim + 16)
  const entradas = new Map<string, () => Buffer>()
  let soma = 0
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ErroDeXlsx('XLSX corrompido (diretório do zip).')
    const metodo = buf.readUInt16LE(p + 10)
    const tamComp = buf.readUInt32LE(p + 20)
    const tam = buf.readUInt32LE(p + 24)
    const nNome = buf.readUInt16LE(p + 28), nExtra = buf.readUInt16LE(p + 30), nComent = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const nome = buf.toString('utf8', p + 46, p + 46 + nNome)
    p += 46 + nNome + nExtra + nComent
    soma += tam
    if (soma > LIMITE_DESCOMPACTADO) throw new ErroDeXlsx('XLSX grande demais depois de descompactado.')
    entradas.set(nome, () => {
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new ErroDeXlsx('XLSX corrompido (cabeçalho local).')
      const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const dado = buf.subarray(ini, ini + tamComp)
      if (metodo === 0) return Buffer.from(dado)
      if (metodo === 8) return inflateRawSync(dado, { maxOutputLength: LIMITE_DESCOMPACTADO })
      throw new ErroDeXlsx('XLSX com compressão não suportada.')
    })
  }
  return entradas
}

const entidades: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodificar = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : entidades[e.toLowerCase()])
/** Junta todos os <t> de um trecho (texto rico vem em vários "runs"). */
const textos = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodificar(m[1])).join('')

function colunaDe(ref: string): number {
  const letras = ref.match(/^[A-Z]+/)?.[0] ?? 'A'
  let n = 0
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export function ehXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50
}

/**
 * Primeira planilha do XLSX como tabela (linhas × colunas). Linhas vazias saem.
 * P2.29: QUALQUER falha de leitura vira ErroDeXlsx (recusa clara, 422, nada gravado) — zip truncado, tamanho
 * declarado mentiroso que estoura o limite ao descompactar, id de planilha com caracteres de expressão regular.
 */
export function lerXlsx(buf: Buffer): Celula[][] {
  try {
    return lerXlsxSemTrava(buf)
  } catch (e) {
    if (e instanceof ErroDeXlsx) throw e
    const codigo = (e as { code?: string }).code ?? ''
    if (codigo === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|too large/i.test(String((e as Error).message))) throw new ErroDeXlsx('XLSX grande demais depois de descompactado.')
    throw new ErroDeXlsx('XLSX corrompido ou em formato não suportado.')
  }
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function lerXlsxSemTrava(buf: Buffer): Celula[][] {
  const zip = lerZip(buf)
  const ler = (nome: string) => zip.get(nome)?.().toString('utf8')
  const workbook = ler('xl/workbook.xml')
  if (!workbook) throw new ErroDeXlsx('O arquivo não é uma planilha XLSX (falta xl/workbook.xml).')
  const primeiraBruta = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  const primeira = primeiraBruta ? escaparRegex(primeiraBruta) : undefined
  const rels = ler('xl/_rels/workbook.xml.rels') ?? ''
  let alvo = primeira ? rels.match(new RegExp(`<Relationship\\b[^>]*Id="${primeira}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${primeira}"`))?.[1] : undefined
  alvo = alvo ? (alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml'
  const planilha = ler(alvo)
  if (!planilha) throw new ErroDeXlsx('A planilha do XLSX não foi encontrada.')
  const compartilhadas = [...(ler('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1]))

  const tabela: Celula[][] = []
  for (const linha of planilha.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const celulas: Celula[] = []
    for (const c of linha[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], corpo = c[2] ?? ''
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]
      const tipo = attrs.match(/\bt="([^"]+)"/)?.[1] ?? 'n'
      const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let valor: Celula = ''
      if (tipo === 's') valor = v != null ? compartilhadas[Number(v)] ?? '' : ''
      else if (tipo === 'inlineStr') valor = textos(corpo)
      else if (tipo === 'str' || tipo === 'e') valor = v != null ? decodificar(v) : ''
      else if (tipo === 'b') valor = v === '1' ? 'VERDADEIRO' : 'FALSO'
      else if (v != null && v !== '') { const n = Number(v); valor = Number.isFinite(n) ? n : decodificar(v) }
      const col = ref ? colunaDe(ref) : celulas.length
      while (celulas.length < col) celulas.push('')
      celulas[col] = valor
    }
    if (celulas.some((x) => String(x).trim() !== '')) tabela.push(celulas)
  }
  return tabela
}
