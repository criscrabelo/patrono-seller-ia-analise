/**
 * P2.15.8 — Driver do Prisma: motor nativo (padrão) ou `pg` (opcional).
 *
 * Medido no site de TESTE (Netlify us-east-2 → Supabase sa-east-1, pooler
 * de TRANSAÇÃO, o mesmo de Production): o motor nativo com `pgbouncer=true`
 * gasta ~643 ms por consulta (várias idas e voltas de protocolo); o driver
 * `pg` gasta ~126 ms (uma ida). Ciclo do Supervisor 8,9–10,2 s → 2,1–3,6 s.
 *
 * Só liga com PRISMA_DRIVER=pg. Sem a variável, NADA muda. Continua no
 * pooler de transação (o indicado para serverless): o modo sessão foi
 * descartado porque limita os clientes ao pool_size (15) — reproduzido na
 * P2.15.8 com EMAXCONNSESSION.
 *
 * - Mesma DATABASE_URL (a trava de ambiente continua valendo).
 * - `pgbouncer` e `connection_limit` são parâmetros do motor nativo: saem da
 *   URL do `pg`; `connection_limit` vira o tamanho do pool (padrão igual ao
 *   do Prisma: CPUs × 2 + 1).
 * - SSL cifrado sem verificar a cadeia, igual ao padrão do motor nativo
 *   (sslmode=prefer); `sslmode=disable` desliga, como antes.
 */
import os from 'node:os'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

export function driverPg(env: Record<string, string | undefined>): boolean {
  return (env.PRISMA_DRIVER ?? '').trim().toLowerCase() === 'pg'
}

/** FUNÇÃO PURA: configuração do pool `pg` a partir da DATABASE_URL. */
export function configDoPool(url: string, cpus = os.cpus().length): { connectionString: string; max: number; ssl: false | { rejectUnauthorized: false } } {
  const u = new URL(url)
  const limite = Number(u.searchParams.get('connection_limit'))
  const semSsl = u.searchParams.get('sslmode') === 'disable'
  for (const p of ['pgbouncer', 'connection_limit', 'pool_timeout', 'sslmode', 'schema']) u.searchParams.delete(p)
  return {
    connectionString: u.toString(),
    max: Number.isInteger(limite) && limite > 0 ? limite : cpus * 2 + 1,
    ssl: semSsl ? false : { rejectUnauthorized: false },
  }
}

export function opcoesDoDriver(env: Record<string, string | undefined>): { adapter?: PrismaPg } {
  if (!driverPg(env) || !env.DATABASE_URL) return {}
  // No build da Netlify ("collect page data") os módulos são avaliados com a
  // URL mascarada. O motor nativo só lê a URL ao conectar; aqui, URL que não
  // se lê = segue o motor nativo (o comportamento de sempre).
  let config: ReturnType<typeof configDoPool>
  try {
    config = configDoPool(env.DATABASE_URL)
  } catch {
    return {}
  }
  return { adapter: new PrismaPg(new Pool(config)) }
}
