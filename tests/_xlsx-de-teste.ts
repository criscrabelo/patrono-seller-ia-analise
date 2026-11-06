/**
 * Gera um .xlsx mínimo e VÁLIDO para os testes do leitor (sem biblioteca): zip com deflate do zlib.
 * Textos vão para sharedStrings (como o Excel faz); números ficam numéricos; `null` = célula ausente.
 */
import { crc32, deflateRawSync } from 'node:zlib'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const letra = (i: number) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s }

function zip(arquivos: Record<string, string>): Buffer {
  const locais: Buffer[] = [], centrais: Buffer[] = []
  let offset = 0
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const dado = Buffer.from(conteudo, 'utf8'), comp = deflateRawSync(dado), n = Buffer.from(nome, 'utf8'), crc = crc32(dado)
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(dado.length, 22); l.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(dado.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42)
    locais.push(l, n, comp); centrais.push(c, n)
    offset += 30 + n.length + comp.length
  }
  const central = Buffer.concat(centrais)
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(centrais.length / 2, 8); fim.writeUInt16LE(centrais.length / 2, 10); fim.writeUInt32LE(central.length, 12); fim.writeUInt32LE(offset, 16)
  return Buffer.concat([...locais, central, fim])
}

export function gerarXlsx(linhas: (string | number | null)[][]): Buffer {
  const textos: string[] = []
  const idx = (s: string) => { let i = textos.indexOf(s); if (i < 0) { i = textos.length; textos.push(s) } return i }
  const rows = linhas.map((l, r) => `<row r="${r + 1}">${l.map((v, c) => v == null ? '' : typeof v === 'number'
    ? `<c r="${letra(c)}${r + 1}"><v>${v}</v></c>`
    : `<c r="${letra(c)}${r + 1}" t="s"><v>${idx(v)}</v></c>`).join('')}</row>`).join('')
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pedidos" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${textos.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
  })
}
