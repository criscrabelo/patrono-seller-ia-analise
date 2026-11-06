// P2.84 — Registra a CONFERÊNCIA DAS INSCRIÇÕES de uma tomada gerada por IA, feita por uma PESSOA independente
// (titular ou revisor humano), a partir do que ela declarou depois de olhar a folha de quadros. Presa ao sha256 do arquivo.
//   node node_modules/tsx/dist/cli.mjs scripts/video-pro/registrar-conferencia-inscricoes.ts <gerado.mp4> --revisor="Nome" --aprovada=sim|nao [--divergencias="IOREF → ZOREF; GND → CND"]
// Recusa revisor que seja o produtor (Patrono/agente/IA). Grava conferencia-<arquivo>/conferencia-inscricoes.json,
// que é o que encaixar-tomada-ia.ts lê. Aprovada com divergência listada = reprovada.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { ARQUIVO_DE_CONFERENCIA, revisorIndependente, type ConferenciaDeInscricoes } from '../../lib/video-pro/inscricoes'

const [GERADO, ...resto] = process.argv.slice(2)
const opt = (k: string) => resto.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const revisor = opt('revisor') ?? ''
const aprovada = opt('aprovada')
if (!GERADO || !aprovada || !/^(sim|nao)$/.test(aprovada)) throw new Error('uso: <gerado.mp4> --revisor="Nome" --aprovada=sim|nao [--divergencias="A → B; C → D"]')
if (!revisorIndependente(revisor)) { console.error(`RECUSADO: "${revisor}" não é revisor humano independente (o produtor não confere a própria criação).`); process.exit(4) }
const divergencias = (opt('divergencias') ?? '').split(';').map((x) => x.trim()).filter(Boolean)
const c: ConferenciaDeInscricoes = { sha256: createHash('sha256').update(readFileSync(GERADO)).digest('hex'), aprovada: aprovada === 'sim' && divergencias.length === 0, por: 'HUMANO', em: new Date().toISOString(), divergencias, revisor }
const pasta = join(dirname(GERADO), `conferencia-${basename(GERADO, '.mp4')}`)
mkdirSync(pasta, { recursive: true })
writeFileSync(join(pasta, ARQUIVO_DE_CONFERENCIA), JSON.stringify(c, null, 1))
console.log(JSON.stringify({ registrado: join(pasta, ARQUIVO_DE_CONFERENCIA), ...c }))
