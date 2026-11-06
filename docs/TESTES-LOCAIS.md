# Testes locais (sem Supabase, sem custo)

Tudo com dados fictícios. Nenhuma credencial real é necessária.

1. **Banco:** `scripts/dev/postgres-local.mjs` (instruções no cabeçalho). Sobe PostgreSQL 17 em `localhost:5433`, cria os papéis `anon`/`authenticated`/`service_role`, banco UTF8 e fuso UTC.
2. **Variáveis** (PowerShell/bash), sem `PATRONO_AMBIENTE` nem `PATRONO_REF_DO_BANCO_DE_PRODUCAO`, igual à CI:
   ```
   DATABASE_URL=postgresql://patrono:patrono@localhost:5433/patrono_test
   DIRECT_URL=<mesmo valor>
   NEXTAUTH_SECRET=teste-local-somente   NEXTAUTH_URL=http://localhost:3100
   NEXT_PUBLIC_SUPABASE_URL=https://exemplo-local.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=falsa   SUPABASE_SERVICE_ROLE_KEY=falsa
   TOKENS_ENCRYPTION_KEY=<64 caracteres hex fictícios>   CRON_SECRET=teste-cron-local
   ```
3. `npx prisma migrate deploy` (use as migrations, não `db push`: há constraints só em SQL).
4. Suíte `.ts`: `node ./node_modules/tsx/dist/cli.mjs --test --test-concurrency=2 tests/*.test.ts`
5. Suíte `.mjs` (precisa do servidor): `npm run build`, `npx next start -p 3100` e `BASE_URL=http://localhost:3100 node --test --test-concurrency=1 tests/*.test.mjs`

**Limite conhecido:** os blocos "contra o Supabase de TESTE" (`rodada56`, `rodada57`: bucket, URL assinada, limite de 50 MB) só rodam com `PATRONO_REF_DO_BANCO_DE_PRODUCAO` definido e um projeto Supabase de TESTE real. Sem ele ficam *skipped*. Eles não são exercitados localmente.
