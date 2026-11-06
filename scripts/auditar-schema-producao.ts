/**
 * Auditoria SOMENTE LEITURA do schema de um banco.
 *
 * Uso:
 *   DATABASE_URL="..." npx tsx scripts/auditar-schema-producao.ts
 *
 * ── SOMENTE LEITURA, POR CONSTRUÇÃO ─────────────────────────────────────
 * Toda consulta daqui é `SELECT` contra `information_schema` / `pg_*` ou
 * contra `_prisma_migrations`. Não há DDL, INSERT, UPDATE, DELETE nem
 * `migrate` em lugar nenhum deste arquivo. Há uma guarda em `ler()` que
 * recusa qualquer SQL que não comece com SELECT — para que um descuido
 * futuro falhe alto em vez de escrever no banco errado.
 *
 * ── O QUE ELE RESPONDE ──────────────────────────────────────────────────
 * Quais tabelas existem, o que `_prisma_migrations` registra, quais
 * migrations do repo estão aplicadas / ausentes / falhadas / divergentes,
 * e se as tabelas que o ciclo de oportunidades lê estão lá.
 *
 * ── NÃO IMPRIME SEGREDO ─────────────────────────────────────────────────
 * A connection string nunca é ecoada. Só o host e o ref do projeto.
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const RAIZ = join(__dirname, '..')
const DIR_MIGRATIONS = join(RAIZ, 'prisma', 'migrations')

const prisma = new PrismaClient({ log: ['error'] })

/** Executa SELECT. Recusa qualquer outra coisa. */
async function ler<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const limpo = sql.trim().replace(/^--.*$/gm, '').trim()
  if (!/^(select|with)\b/i.test(limpo)) {
    throw new Error(`BLOQUEADO: esta auditoria só executa SELECT. Recebido: ${limpo.slice(0, 40)}`)
  }
  return (await prisma.$queryRawUnsafe(sql)) as T[]
}

function titulo(t: string) {
  console.log(`\n${'='.repeat(74)}\n${t}\n${'='.repeat(74)}`)
}

/** Migrations do repo, em ordem, com o sha256 do migration.sql. */
function migrationsDoRepo() {
  if (!existsSync(DIR_MIGRATIONS)) return []
  return readdirSync(DIR_MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((nome) => {
      const arq = join(DIR_MIGRATIONS, nome, 'migration.sql')
      const sql = existsSync(arq) ? readFileSync(arq, 'utf8') : ''
      return { nome, sha256: createHash('sha256').update(sql).digest('hex'), bytes: sql.length }
    })
}

/** Models declarados no schema.prisma (sem @@map neste projeto: nome = tabela). */
function modelosDoSchema(): string[] {
  const s = readFileSync(join(RAIZ, 'prisma', 'schema.prisma'), 'utf8')
  return [...s.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]).sort()
}

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  if (!url) {
    console.error('sem DATABASE_URL')
    process.exit(2)
  }
  // Só host e ref — nunca usuário, senha ou a string inteira.
  const host = url.match(/@([^/:]+)/)?.[1] ?? '(desconhecido)'
  const ref = url.match(/[a-z]{20}/)?.[0] ?? '(desconhecido)'

  titulo('ALVO DA AUDITORIA')
  console.log(`  host   ${host}`)
  console.log(`  ref    ${ref}`)
  console.log(`  modo   SOMENTE LEITURA (apenas SELECT)`)
  console.log(`  quando ${new Date().toISOString()}`)

  const versao = await ler<{ v: string }>('SELECT version() AS v')
  console.log(`  pg     ${versao[0]?.v?.split(' ').slice(0, 2).join(' ')}`)

  // ── 1. TABELAS ────────────────────────────────────────────────────────
  titulo('1. TABELAS EM public')
  const tabelas = await ler<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  )
  const nomes = tabelas.map((t) => t.table_name)
  console.log(`  ${nomes.length} tabelas:`)
  for (const n of nomes) console.log(`    ${n}`)

  // ── 2. MODELS DO CÓDIGO × TABELAS DO BANCO ────────────────────────────
  titulo('2. O QUE O CÓDIGO ESPERA × O QUE O BANCO TEM')
  const models = modelosDoSchema()
  const faltando = models.filter((m) => !nomes.includes(m))
  const sobrando = nomes.filter((n) => n !== '_prisma_migrations' && !models.includes(n))
  console.log(`  models no schema.prisma      ${models.length}`)
  console.log(`  tabelas em public            ${nomes.length}`)
  console.log(`\n  AUSENTES no banco (${faltando.length}):`)
  for (const m of faltando) console.log(`    FALTA  ${m}`)
  if (faltando.length === 0) console.log('    (nenhuma)')
  console.log(`\n  No banco e fora do schema.prisma (${sobrando.length}):`)
  for (const n of sobrando) console.log(`    extra  ${n}`)
  if (sobrando.length === 0) console.log('    (nenhuma)')

  // ── 3. TABELAS CRÍTICAS DO CICLO ──────────────────────────────────────
  titulo('3. TABELAS QUE O CICLO DE OPORTUNIDADES LÊ E ESCREVE')
  const CRITICAS = [
    'Workspace',
    'Produto',
    'Oportunidade',
    'Conteudo',
    'Publicacao',
    'AutomationJob',
    'EventoLink',
    'LinkDinamico',
  ]
  for (const t of CRITICAS) {
    const existe = nomes.includes(t)
    let detalhe = ''
    if (existe) {
      const cols = await ler<{ n: bigint }>(
        `SELECT count(*)::int AS n FROM information_schema.columns
         WHERE table_schema='public' AND table_name='${t}'`
      )
      detalhe = `${cols[0]?.n} colunas`
    }
    console.log(`  ${existe ? 'OK   ' : 'FALTA'} ${t.padEnd(16)} ${detalhe}`)
  }

  // ── 4. _prisma_migrations ─────────────────────────────────────────────
  titulo('4. _prisma_migrations')
  const temTabela = nomes.includes('_prisma_migrations')
  const repo = migrationsDoRepo()

  if (!temTabela) {
    console.log('  A tabela _prisma_migrations NÃO EXISTE.')
    console.log('  Este banco nunca foi gerenciado por `prisma migrate`.')
    console.log(`\n  As ${repo.length} migrations do repo estão, todas, NÃO REGISTRADAS:`)
    for (const m of repo) console.log(`    AUSENTE  ${m.nome}`)
  } else {
    const aplicadas = await ler<{
      migration_name: string
      checksum: string
      finished_at: Date | null
      rolled_back_at: Date | null
      applied_steps_count: number
      started_at: Date
    }>(
      `SELECT migration_name, checksum, finished_at, rolled_back_at,
              applied_steps_count, started_at
       FROM _prisma_migrations ORDER BY started_at`
    )
    console.log(`  ${aplicadas.length} registros.\n`)
    for (const a of aplicadas) {
      const estado = a.rolled_back_at
        ? 'ROLLED BACK'
        : a.finished_at
          ? 'aplicada'
          : 'FALHADA (started, never finished)'
      console.log(`    ${estado.padEnd(34)} ${a.migration_name}`)
    }

    const nomesAplicados = new Set(aplicadas.map((a) => a.migration_name))
    const porNome = new Map(aplicadas.map((a) => [a.migration_name, a]))

    titulo('5. RECONCILIAÇÃO: REPO × BANCO')
    console.log(`  migrations no repo   ${repo.length}`)
    console.log(`  registros no banco   ${aplicadas.length}\n`)

    const ausentes: string[] = []
    const falhadas: string[] = []
    const divergentes: string[] = []
    let conferem = 0

    for (const m of repo) {
      const a = porNome.get(m.nome)
      if (!a) {
        ausentes.push(m.nome)
        console.log(`    AUSENTE      ${m.nome}`)
        continue
      }
      if (a.rolled_back_at) {
        falhadas.push(m.nome)
        console.log(`    ROLLED BACK  ${m.nome}`)
        continue
      }
      if (!a.finished_at) {
        falhadas.push(m.nome)
        console.log(`    FALHADA      ${m.nome}`)
        continue
      }
      if (a.checksum !== m.sha256) {
        divergentes.push(m.nome)
        console.log(`    DIVERGENTE   ${m.nome}`)
        console.log(`                 banco ${a.checksum.slice(0, 16)}… repo ${m.sha256.slice(0, 16)}…`)
        continue
      }
      conferem += 1
      console.log(`    ok           ${m.nome}`)
    }

    const orfas = [...nomesAplicados].filter((n) => !repo.some((m) => m.nome === n))
    if (orfas.length) {
      console.log(`\n  Registradas no banco e INEXISTENTES no repo (${orfas.length}):`)
      for (const o of orfas) console.log(`    ÓRFÃ         ${o}`)
    }

    titulo('RESUMO DA RECONCILIAÇÃO')
    console.log(`  conferem (nome + checksum)   ${conferem}`)
    console.log(`  ausentes no banco            ${ausentes.length}`)
    console.log(`  falhadas / rolled back       ${falhadas.length}`)
    console.log(`  divergentes (checksum)       ${divergentes.length}`)
    console.log(`  órfãs (no banco, fora do repo) ${orfas.length}`)
    if (conferem === 0 && aplicadas.length > 0) {
      console.log(
        `\n  ATENÇÃO: nenhuma conferiu. Se os NOMES batem mas os checksums não,\n` +
          `  a comparação de checksum pode não refletir o algoritmo do Prisma —\n` +
          `  trate "divergente" como inconclusivo e confira pelos nomes.`
      )
    }
  }

  // ── 6. ÍNDICES E CONSTRAINTS DAS TABELAS CRÍTICAS QUE EXISTEM ─────────
  titulo('6. ÍNDICES E CONSTRAINTS (tabelas críticas presentes)')
  const presentes = CRITICAS.filter((t) => nomes.includes(t))
  if (presentes.length === 0) {
    console.log('  Nenhuma das tabelas críticas existe — nada a inspecionar.')
  } else {
    for (const t of presentes) {
      const idx = await ler<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname='public' AND tablename='${t}' ORDER BY indexname`
      )
      const fks = await ler<{ conname: string }>(
        `SELECT conname FROM pg_constraint
         WHERE conrelid = 'public."${t}"'::regclass AND contype='f' ORDER BY conname`
      )
      console.log(`\n  ${t} — ${idx.length} índices, ${fks.length} FKs`)
      for (const i of idx) {
        const unico = /UNIQUE/i.test(i.indexdef) ? 'UNIQUE ' : '       '
        console.log(`    ${unico}${i.indexname}`)
      }
    }
  }

  // ── 7. VOLUME DAS TABELAS CRÍTICAS PRESENTES ─────────────────────────
  titulo('7. VOLUME (tabelas críticas presentes)')
  if (presentes.length === 0) {
    console.log('  Nenhuma tabela crítica existe.')
  } else {
    for (const t of presentes) {
      const r = await ler<{ n: number }>(`SELECT count(*)::int AS n FROM public."${t}"`)
      console.log(`  ${t.padEnd(16)} ${r[0]?.n} linhas`)
    }
  }

  titulo('FIM — nenhuma escrita foi executada')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('\nERRO:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(2)
})
