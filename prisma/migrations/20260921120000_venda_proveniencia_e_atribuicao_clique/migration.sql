-- P0.2 Blocos 1 e 2 — proveniencia da venda e atribuicao determinista do clique.
--
-- Mudanca puramente ADITIVA: nenhuma coluna existente e alterada, renomeada
-- ou removida, e nenhuma linha existente muda de significado.
--
-- ── POR QUE `UNVERIFIED` E O DEFAULT ────────────────────────────────────
-- Toda Sale que ja existe passa a valer como "origem nao demonstravel". Nao
-- ha backfill para REAL_OPERATION, e isso e deliberado: promover historico
-- por conveniencia ensinaria o ML com dado de procedencia duvidosa. Perder
-- dado de treino e reversivel; modelo contaminado, nao.
--
-- ── SOBRE O PASSO 2 (EventoLink.workspaceId) ────────────────────────────
-- A coluna nasce NULL, e preenchida a partir do link (a unica fonte correta
-- e ja existente) e so entao vira NOT NULL. Se algum EventoLink apontasse
-- para um link inexistente, o ALTER ... SET NOT NULL falharia e a transacao
-- inteira seria desfeita — que e o comportamento desejado: melhor a migracao
-- recusar do que gravar um evento em workspace errado.

-- ── 1. Proveniencia da venda ────────────────────────────────────────────
ALTER TABLE "Sale" ADD COLUMN "dataOrigin" TEXT NOT NULL DEFAULT 'UNVERIFIED';
CREATE INDEX "Sale_workspaceId_dataOrigin_idx" ON "Sale"("workspaceId", "dataOrigin");

-- ── 2. Isolamento explicito do clique ───────────────────────────────────
ALTER TABLE "EventoLink" ADD COLUMN "workspaceId" TEXT;

UPDATE "EventoLink" AS e
   SET "workspaceId" = l."workspaceId"
  FROM "LinkDinamico" AS l
 WHERE e."linkId" = l."id";

ALTER TABLE "EventoLink" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "EventoLink"
  ADD CONSTRAINT "EventoLink_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "EventoLink_workspaceId_linkId_createdAt_idx"
  ON "EventoLink"("workspaceId", "linkId", "createdAt");

-- ── 3. Atribuicao auditavel do clique ───────────────────────────────────
-- `clickEventId` NULL significa "sem atribuicao confiavel", e
-- `attributionMethod` sempre diz por que. Nenhuma das duas colunas e
-- preenchida por inferencia.
ALTER TABLE "Sale" ADD COLUMN "clickEventId" TEXT;
ALTER TABLE "Sale" ADD COLUMN "attributionMethod" TEXT;

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_clickEventId_fkey"
  FOREIGN KEY ("clickEventId") REFERENCES "EventoLink"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
