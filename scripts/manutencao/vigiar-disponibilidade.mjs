// Vigia SOMENTE LEITURA da disponibilidade durante uma manutenção (ex.: Nano → Micro): a cada N s testa o site
// (/login) e o banco (select 1 pelo pooler de transação) e registra cada mudança de estado e a indisponibilidade total.
// A senha vem do .env fora do OneDrive e nunca é impressa.
//   node scripts/manutencao/vigiar-disponibilidade.mjs <.env-com-DATABASE_URL> <minutos> [intervalo-s] [saida.json]
import pg from 'pg'
import { readFileSync, writeFileSync } from 'node:fs'
const [ENV, MIN = '20', INTERVALO = '5', SAIDA] = process.argv.slice(2)
const env = Object.fromEntries(readFileSync(ENV, 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^(['"])(.*)\1$/, '$2')]))
const SITE = 'https://seller.exemplo.com.br/login'
// Mesmo caminho do aplicativo: pooler de transação (o host direto db.<ref> não resolve nesta rede).
const u = new URL(env.DATABASE_URL), REF = (u.username.split('.')[1] || u.hostname.split('.')[1])
const CONEXAO = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 6543, user: `postgres.${REF}`, password: decodeURIComponent(u.password), database: 'postgres' }
const fim = Date.now() + Number(MIN) * 60_000
const eventos = []
let anterior = null, foraDesde = null, foraTotalMs = 0, amostras = 0
const testarBanco = async () => {
  const c = new pg.Client({ ...CONEXAO, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000, query_timeout: 8000 })
  try { await c.connect(); await c.query('select 1'); return 'ok' } catch (e) { return 'falha:' + (e.code || e.message).slice(0, 60) } finally { c.end().catch(() => {}) }
}
const testarSite = async () => { try { const r = await fetch(SITE, { signal: AbortSignal.timeout(10_000), redirect: 'manual' }); return r.status < 500 ? 'ok' : 'http' + r.status } catch (e) { return 'falha:' + e.name } }
while (Date.now() < fim) {
  const [banco, site] = await Promise.all([testarBanco(), testarSite()]); amostras++
  const estado = `banco=${banco} site=${site}`, agora = new Date()
  const ok = banco === 'ok' && site === 'ok'
  if (!ok && !foraDesde) foraDesde = agora
  if (ok && foraDesde) { foraTotalMs += agora - foraDesde; foraDesde = null }
  if (estado !== anterior) { eventos.push({ em: agora.toISOString(), estado }); console.log(agora.toISOString(), estado); anterior = estado }
  await new Promise((r) => setTimeout(r, Number(INTERVALO) * 1000))
}
if (foraDesde) foraTotalMs += Date.now() - foraDesde
const resumo = { amostras, indisponivelSegundos: Math.round(foraTotalMs / 1000), terminouDisponivel: !foraDesde, eventos }
if (SAIDA) writeFileSync(SAIDA, JSON.stringify(resumo, null, 1))
console.log(JSON.stringify({ amostras, indisponivelSegundos: resumo.indisponivelSegundos, terminouDisponivel: resumo.terminouDisponivel }))
