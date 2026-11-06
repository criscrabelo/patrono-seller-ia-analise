/**
 * Produção está, coluna por coluna, no estado do baseline?
 *
 * Uso:
 *   DATABASE_URL="..." npx tsx scripts/comparar-producao-com-baseline.ts
 *
 * ── A PERGUNTA QUE ISTO RESPONDE ────────────────────────────────────────
 * O caminho barato de reconciliar produção é o baselining do Prisma:
 * registrar a primeira migration como já aplicada (só escreve em
 * `_prisma_migrations`, nenhum DDL) e deixar o `migrate deploy` aplicar as
 * seguintes — inclusive a nº 2, que já cria o Workspace e preenche
 * `workspaceId` a partir de `userId`.
 *
 * Isso só é legítimo se o schema real de produção FOR o que o baseline
 * descreve. Se uma coluna faltar ou sobrar, uma migration posterior pode
 * falhar no meio — e migration que falha no meio é o pior estado possível.
 *
 * Este script compara, coluna a coluna, o que o baseline declara com o que
 * produção tem. Ele não conserta nada; ele diz se dá para confiar.
 *
 * ── SOMENTE LEITURA ─────────────────────────────────────────────────────
 * Só `information_schema`. Nenhum dado de linha é lido.
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join(__dirname, '..')
const BASELINE = join(RAIZ, 'prisma', 'migrations', '20260101000000_baseline_pre_workspace', 'migration.sql')

const prisma = new PrismaClient({ log: ['error'] })

/**
 * Colunas que produção tem, o baseline não declara, e que já foram medidas
 * como inertes: 100% nulas e não mencionadas por nenhuma migration.
 * Sobra fora desta lista volta a ser divergência de verdade.
 */
const CONHECIDAS: Record<string, string[]> = {
  Conteudo: ['linkUrl', 'videoResultUrl', 'videoStatusUrl'],
}

/** Colunas que cada CREATE TABLE do baseline declara. */
function colunasDoBaseline(): Map<string, Set<string>> {
  const sql = readFileSync(BASELINE, 'utf8')
  const mapa = new Map<string, Set<string>>()
  for (const m of sql.matchAll(/CREATE TABLE "([^"]+)"\s*\(([\s\S]*?)\n\);/g)) {
    const [, tabela, corpo] = m
    const cols = new Set<string>()
    for (const linha of corpo.split('\n')) {
      const t = linha.trim()
      // Linhas de constraint não declaram coluna.
      if (/^(CONSTRAINT|PRIMARY KEY|FOREIGN KEY|UNIQUE)\b/i.test(t)) continue
      const c = t.match(/^"([^"]+)"/)
      if (c) cols.add(c[1])
    }
    mapa.set(tabela, cols)
  }
  return mapa
}

async function colunasDeProducao(tabela: string): Promise<Set<string> | null> {
  const r = (await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='${tabela}'`
  )) as { column_name: string }[]
  if (r.length === 0) return null
  return new Set(r.map((x) => x.column_name))
}

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  console.log(`alvo: ${url.match(/@([^/:]+)/)?.[1] ?? '?'} — ref ${url.match(/[a-z]{20}/)?.[0] ?? '?'}`)
  console.log('modo: SOMENTE LEITURA (apenas information_schema)\n')

  const baseline = colunasDoBaseline()
  console.log(`O baseline declara ${baseline.size} tabelas.\n`)
  console.log('='.repeat(78))

  let divergencias = 0
  let ausentes = 0
  let conhecidas = 0

  for (const [tabela, esperadas] of baseline) {
    const reais = await colunasDeProducao(tabela)
    if (reais === null) {
      ausentes += 1
      console.log(`\n  ${tabela}: NÃO EXISTE em produção`)
      console.log(`    o baseline a declara com ${esperadas.size} colunas`)
      console.log(`    -> precisa ser criada antes do baselining`)
      continue
    }
    const faltando = [...esperadas].filter((c) => !reais.has(c))
    const sobrando = [...reais].filter((c) => !esperadas.has(c))
    if (faltando.length === 0 && sobrando.length === 0) {
      console.log(`\n  ${tabela}: confere (${esperadas.size} colunas)`)
      continue
    }
    // Sobra conhecida: as três colunas mortas de `Conteudo`. A auditoria da
    // P1.7.1 mediu que estão 100% nulas, nenhuma migration as menciona, e o
    // ensaio da P1.7.2 reproduziu exatamente este estado e fez o baselining
    // funcionar em cima dele. Tratá-las como divergência deixaria este gate
    // permanentemente vermelho — e gate sempre vermelho ninguém lê.
    const sobrasInesperadas = sobrando.filter((c) => !(CONHECIDAS[tabela] ?? []).includes(c))
    if (faltando.length === 0 && sobrasInesperadas.length === 0) {
      conhecidas += 1
      console.log(`\n  ${tabela}: confere, com sobra conhecida`)
      console.log(`    colunas mortas, já auditadas e inertes: ${sobrando.join(', ')}`)
      continue
    }

    divergencias += 1
    console.log(`\n  ${tabela}: DIVERGE`)
    if (faltando.length) console.log(`    no baseline e AUSENTES em produção: ${faltando.join(', ')}`)
    if (sobrasInesperadas.length) {
      console.log(`    em produção e FORA do baseline (INESPERADAS): ${sobrasInesperadas.join(', ')}`)
    }
  }

  console.log(`\n${'='.repeat(78)}`)
  console.log('VEREDITO')
  console.log('='.repeat(78))
  console.log(`  tabelas do baseline que conferem      ${baseline.size - divergencias - ausentes - conhecidas}`)
  console.log(`  conferem com sobra conhecida          ${conhecidas}`)
  console.log(`  tabelas ausentes em produção          ${ausentes}`)
  console.log(`  tabelas com divergência INESPERADA    ${divergencias}`)

  if (divergencias === 0 && ausentes === 0) {
    console.log(`\n  Produção ESTÁ no estado do baseline. O baselining é seguro.`)
  } else if (divergencias === 0) {
    console.log(
      `\n  Nenhuma divergência inesperada. Faltam apenas tabelas inteiras —\n` +
        `  criá-las é aditivo e não toca dado existente. Depois disso o\n` +
        `  baselining é seguro.`
    )
  } else {
    console.log(`\n  HÁ DIVERGÊNCIA INESPERADA. O baselining NÃO é seguro sem tratar isso antes.`)
  }
  console.log('\n  (nenhuma escrita foi executada)')

  await prisma.$disconnect()
  process.exit(divergencias === 0 && ausentes === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(2)
})
