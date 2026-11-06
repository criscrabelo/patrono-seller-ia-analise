/**
 * Classifica cada migration do repo pelo que ela faz e pelo risco que traz.
 *
 * Uso (não toca em banco nenhum):
 *   npx tsx scripts/analisar-migrations.ts
 *
 * ── POR QUE ANALISAR UMA A UMA ──────────────────────────────────────────
 * "Aplicar as migrations atrasadas" só é uma frase segura quando o banco
 * está num dos pontos da própria história. Se o banco veio por outro
 * caminho, cada migration precisa ser conferida contra o estado real: uma
 * que cria tabela já existente falha, uma com NOT NULL sem default falha se
 * houver linha, e uma com UNIQUE novo falha se o dado real colidir.
 *
 * Este script não decide nada — ele levanta os fatos que a decisão precisa.
 * Só lê arquivos.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
const DIR = join(RAIZ, 'prisma', 'migrations')

/** Tabelas que EXISTEM em produção hoje (levantadas pela auditoria read-only). */
const TABELAS_EM_PRODUCAO = new Set([
  'Conteudo', 'Creator', 'DecisaoMotor', 'EntregaUGC', 'EventoLink', 'Fornecedor',
  'ImagemCriativo', 'Integracao', 'LinkDinamico', 'LogCompliance', 'Produto',
  'SerieFxa', 'TendenciaRadar', 'TermoJuridico', 'User', 'VideoAutorizado',
])

/** Tabelas com linhas em produção — onde NOT NULL e UNIQUE novos importam. */
const TABELAS_COM_DADO: Record<string, number> = {
  User: 1, Produto: 25, Conteudo: 17, LinkDinamico: 126, Integracao: 3, EventoLink: 0,
}

type Analise = {
  nome: string
  criaTabelas: string[]
  alteraTabelas: string[]
  dropTabelas: string[]
  dropColunas: number
  criaEnum: string[]
  addNotNullSemDefault: string[]
  uniqueNovos: string[]
  fks: number
  temDML: boolean
  bytes: number
}

function analisar(nome: string): Analise {
  const arq = join(DIR, nome, 'migration.sql')
  const sql = existsSync(arq) ? readFileSync(arq, 'utf8') : ''
  // Comentário não executa: fora antes de classificar.
  const codigo = sql.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

  const cap = (re: RegExp) => [...codigo.matchAll(re)].map((m) => m[1])

  const criaTabelas = cap(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"([^"]+)"/gi)
  const alteraTabelas = [...new Set(cap(/ALTER TABLE\s+"([^"]+)"/gi))]
  const dropTabelas = cap(/DROP TABLE(?:\s+IF EXISTS)?\s+"([^"]+)"/gi)
  const criaEnum = cap(/CREATE TYPE\s+"([^"]+)"\s+AS ENUM/gi)
  const uniqueNovos = cap(/CREATE UNIQUE INDEX(?:\s+IF NOT EXISTS)?\s+"([^"]+)"/gi)

  // ADD COLUMN ... NOT NULL sem DEFAULT é o que quebra tabela com linha.
  const addNotNullSemDefault: string[] = []
  for (const m of codigo.matchAll(/ADD COLUMN\s+"([^"]+)"\s+([^,;]+)/gi)) {
    const [, coluna, resto] = m
    if (/\bNOT NULL\b/i.test(resto) && !/\bDEFAULT\b/i.test(resto)) {
      addNotNullSemDefault.push(coluna)
    }
  }

  return {
    nome,
    criaTabelas,
    alteraTabelas,
    dropTabelas,
    dropColunas: [...codigo.matchAll(/DROP COLUMN/gi)].length,
    criaEnum,
    addNotNullSemDefault,
    uniqueNovos,
    fks: [...codigo.matchAll(/ADD CONSTRAINT\s+"[^"]+"\s+FOREIGN KEY/gi)].length,
    temDML: /^\s*(INSERT|UPDATE|DELETE)\b/im.test(codigo),
    bytes: sql.length,
  }
}

function main() {
  const nomes = readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  const todas = nomes.map(analisar)

  console.log(`\n${nomes.length} migrations no repo. Nenhuma registrada em produção.\n`)

  // ── Colisão direta: migration cria tabela que JÁ EXISTE em produção ───
  console.log('='.repeat(78))
  console.log('COLISÃO: CREATE TABLE de tabela que JÁ EXISTE em produção')
  console.log('='.repeat(78))
  let colisoes = 0
  for (const a of todas) {
    const bate = a.criaTabelas.filter((t) => TABELAS_EM_PRODUCAO.has(t))
    if (bate.length === 0) continue
    colisoes += 1
    console.log(`\n  ${a.nome}`)
    console.log(`    cria ${bate.length} tabela(s) que já existem: ${bate.join(', ')}`)
    console.log(`    -> esta migration FALHA em produção (relation already exists)`)
  }
  if (colisoes === 0) console.log('  nenhuma')

  // ── NOT NULL sem default sobre tabela com dado ───────────────────────
  console.log(`\n${'='.repeat(78)}`)
  console.log('RISCO: ADD COLUMN NOT NULL sem DEFAULT em tabela com linhas')
  console.log('='.repeat(78))
  let riscoNN = 0
  for (const a of todas) {
    if (a.addNotNullSemDefault.length === 0) continue
    const afetadas = a.alteraTabelas.filter((t) => (TABELAS_COM_DADO[t] ?? 0) > 0)
    if (afetadas.length === 0) continue
    riscoNN += 1
    console.log(`\n  ${a.nome}`)
    console.log(`    colunas NOT NULL sem default: ${a.addNotNullSemDefault.join(', ')}`)
    console.log(`    tabelas com dado tocadas: ${afetadas.map((t) => `${t}(${TABELAS_COM_DADO[t]})`).join(', ')}`)
    console.log(`    -> exige BACKFILL: adicionar anulável, preencher, SET NOT NULL`)
  }
  if (riscoNN === 0) console.log('  nenhum')

  // ── Tabela completa ──────────────────────────────────────────────────
  console.log(`\n${'='.repeat(78)}`)
  console.log('INVENTÁRIO COMPLETO')
  console.log('='.repeat(78))
  console.log(
    '\n  ordem | migration                                            | cria | altera | drop | enum | uniq | fk | NN'
  )
  console.log('  ' + '-'.repeat(108))
  todas.forEach((a, i) => {
    console.log(
      `  ${String(i + 1).padStart(5)} | ${a.nome.padEnd(52)} | ${String(a.criaTabelas.length).padStart(4)} | ` +
        `${String(a.alteraTabelas.length).padStart(6)} | ${String(a.dropTabelas.length).padStart(4)} | ` +
        `${String(a.criaEnum.length).padStart(4)} | ${String(a.uniqueNovos.length).padStart(4)} | ` +
        `${String(a.fks).padStart(2)} | ${String(a.addNotNullSemDefault.length).padStart(2)}`
    )
  })

  console.log(`\n  Enums criados ao longo da história:`)
  for (const a of todas) {
    if (a.criaEnum.length) console.log(`    ${a.nome} -> ${a.criaEnum.join(', ')}`)
  }

  const comDML = todas.filter((a) => a.temDML)
  console.log(`\n  Migrations com DML (INSERT/UPDATE/DELETE): ${comDML.length}`)
  for (const a of comDML) console.log(`    ${a.nome}`)

  console.log(`\n  Totais: ${todas.reduce((s, a) => s + a.criaTabelas.length, 0)} CREATE TABLE, ` +
    `${todas.reduce((s, a) => s + a.fks, 0)} FKs, ` +
    `${todas.reduce((s, a) => s + a.uniqueNovos.length, 0)} índices únicos.`)
}

main()
