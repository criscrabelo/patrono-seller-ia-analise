/**
 * Quanto dado real existe naquilo que uma reconciliação ingênua apagaria.
 *
 * Uso:
 *   DATABASE_URL="..." npx tsx scripts/auditar-dados-legados-producao.ts
 *
 * ── POR QUE ESTE SCRIPT EXISTE ──────────────────────────────────────────
 * `prisma migrate diff` entre o banco de produção e o `schema.prisma`
 * atual gera DDL que DERRUBA 10 tabelas e 2 colunas — porque elas não
 * existem mais no modelo. "Não existe no schema" não é o mesmo que "não
 * tem dado". Antes de propor qualquer migration, é preciso saber o que
 * seria perdido.
 *
 * ── SOMENTE LEITURA ─────────────────────────────────────────────────────
 * Só `SELECT count(*)`. Nenhum DDL, nenhuma escrita.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({ log: ['error'] })

/** Tabelas que o diff derrubaria. */
const TABELAS_QUE_O_DIFF_APAGA = [
  'Creator',
  'DecisaoMotor',
  'EntregaUGC',
  'Fornecedor',
  'ImagemCriativo',
  'LogCompliance',
  'SerieFxa',
  'TendenciaRadar',
  'TermoJuridico',
  'VideoAutorizado',
]

/** Colunas que o diff derrubaria, por tabela. */
const COLUNAS_QUE_O_DIFF_APAGA: Record<string, string[]> = {
  Conteudo: ['linkUrl', 'videoResultUrl', 'videoStatusUrl'],
}

/** Tabelas preservadas, para dimensionar o que está em jogo do outro lado. */
const TABELAS_PRESERVADAS = ['User', 'Produto', 'Conteudo', 'LinkDinamico', 'EventoLink', 'Integracao']

async function contar(tabela: string): Promise<number | null> {
  try {
    const r = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM public."${tabela}"`
    )) as { n: number }[]
    return r[0]?.n ?? null
  } catch {
    return null
  }
}

async function preenchidas(tabela: string, coluna: string): Promise<number | null> {
  try {
    const r = (await prisma.$queryRawUnsafe(
      `SELECT count("${coluna}")::int AS n FROM public."${tabela}"`
    )) as { n: number }[]
    return r[0]?.n ?? null
  } catch {
    return null
  }
}

function titulo(t: string) {
  console.log(`\n${'='.repeat(74)}\n${t}\n${'='.repeat(74)}`)
}

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  console.log(`alvo: ${url.match(/@([^/:]+)/)?.[1] ?? '?'} — ref ${url.match(/[a-z]{20}/)?.[0] ?? '?'}`)
  console.log('modo: SOMENTE LEITURA')

  titulo('TABELAS QUE UMA RECONCILIAÇÃO INGÊNUA APAGARIA')
  let totalLegado = 0
  let comDado = 0
  for (const t of TABELAS_QUE_O_DIFF_APAGA) {
    const n = await contar(t)
    if (n === null) {
      console.log(`  ${t.padEnd(18)} (não existe)`)
      continue
    }
    totalLegado += n
    if (n > 0) comDado += 1
    console.log(`  ${t.padEnd(18)} ${String(n).padStart(6)} linhas${n > 0 ? '   <-- TEM DADO' : ''}`)
  }
  console.log(`\n  ${comDado} das ${TABELAS_QUE_O_DIFF_APAGA.length} têm dado. Total: ${totalLegado} linhas.`)

  titulo('COLUNAS QUE UMA RECONCILIAÇÃO INGÊNUA APAGARIA')
  for (const [tabela, colunas] of Object.entries(COLUNAS_QUE_O_DIFF_APAGA)) {
    const total = await contar(tabela)
    console.log(`  ${tabela} (${total} linhas)`)
    for (const c of colunas) {
      const n = await preenchidas(tabela, c)
      if (n === null) {
        console.log(`    ${c.padEnd(18)} (não existe)`)
        continue
      }
      console.log(`    ${c.padEnd(18)} ${String(n).padStart(6)} preenchidas${n > 0 ? '   <-- TEM DADO' : ''}`)
    }
  }

  titulo('TABELAS PRESERVADAS PELA RECONCILIAÇÃO')
  for (const t of TABELAS_PRESERVADAS) {
    const n = await contar(t)
    console.log(`  ${t.padEnd(18)} ${n === null ? '(não existe)' : `${String(n).padStart(6)} linhas`}`)
  }

  titulo('FIM — nenhuma escrita foi executada')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(2)
})
