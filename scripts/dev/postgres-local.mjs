// PostgreSQL 17 local, descartável, só com dados fictícios, para rodar a suíte sem Supabase e sem custo.
// Não toca em nenhum banco real. Uso (fora da pasta do projeto, para não sincronizar com a nuvem):
//   mkdir <pasta-fora-do-onedrive>\pg17 && cd <essa pasta> && npm init -y && npm i embedded-postgres@17.11.0-beta.19
//   copie este arquivo para lá e rode:  node postgres-local.mjs   (deixe a janela aberta)
// Depois, na pasta do projeto, com as variáveis do README de testes (docs/TESTES-LOCAIS.md):
//   npx prisma migrate deploy
import EmbeddedPostgres from 'embedded-postgres'
import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'

const dir = './data'
const srv = new EmbeddedPostgres({ databaseDir: dir, user: 'patrono', password: 'patrono', port: 5433, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'] })
if (!existsSync(dir + '/PG_VERSION')) await srv.initialise()
await srv.start()
const c = new pg.Client({ connectionString: 'postgresql://patrono:patrono@localhost:5433/postgres' })
await c.connect()
// Papéis do Supabase que as migrations referenciam.
for (const r of ['anon', 'authenticated', 'service_role']) { try { await c.query(`CREATE ROLE ${r} NOLOGIN`) } catch {} }
if (!(await c.query("select 1 from pg_database where datname='patrono_test'")).rowCount) {
  await c.query("CREATE DATABASE patrono_test ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'")
}
await c.query("ALTER DATABASE patrono_test SET timezone TO 'UTC'") // o Supabase usa UTC; fuso diferente quebra testes de prazo
await c.end()
console.log('PRONTO: PostgreSQL ' + readFileSync(dir + '/PG_VERSION', 'utf8').trim() + ' em localhost:5433, banco patrono_test')
setInterval(() => {}, 1 << 30)
