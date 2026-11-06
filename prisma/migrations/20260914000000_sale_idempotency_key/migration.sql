-- Idempotência persistente para Sale (Rodada 4).
--
-- Coluna nula por padrão: registros já existentes ficam com
-- idempotencyKey = NULL, e um índice único do Postgres trata múltiplos
-- NULLs como valores distintos entre si (não conflita) — só passa a
-- reforçar unicidade quando uma chave de verdade é enviada.

ALTER TABLE "Sale" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Sale_workspaceId_idempotencyKey_key" ON "Sale"("workspaceId", "idempotencyKey");
