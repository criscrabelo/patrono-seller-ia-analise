-- ROLLBACK da migration 20261010120000_fundacoes_autopilot_fase0a (P2.14.7 / P2.14.8).
-- Execute ANTES do rollback da Fase 2 (ordem inversa da aplicação).
-- Efeito: remove as 9 tabelas da Fase 0A (ledger, políticas, aprovações, runs,
-- flags, custo, recibos de webhook), as 3 colunas safeMode* de Workspace e os
-- 8 índices de desempenho. NÃO toca em nenhum dado das tabelas pré-existentes.
-- Perde apenas o que foi gravado NAS TABELAS NOVAS desde a aplicação.
-- Depois de executar (numa transação), marcar no Prisma:
--   prisma migrate resolve --rolled-back 20261010120000_fundacoes_autopilot_fase0a
BEGIN;
DROP INDEX IF EXISTS "PolicyVersion_uma_ativa_por_workspace";
-- DropForeignKey
ALTER TABLE "SupervisorRun" DROP CONSTRAINT "SupervisorRun_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "DecisionRecord" DROP CONSTRAINT "DecisionRecord_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "DomainEvent" DROP CONSTRAINT "DomainEvent_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "PolicyVersion" DROP CONSTRAINT "PolicyVersion_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "ApprovalRule" DROP CONSTRAINT "ApprovalRule_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "CostLedger" DROP CONSTRAINT "CostLedger_workspaceId_fkey";

-- DropIndex
DROP INDEX "LinkDinamico_produtoId_idx";

-- DropIndex
DROP INDEX "Conteudo_workspaceId_status_dataAgendamento_idx";

-- DropIndex
DROP INDEX "Sale_productId_idx";

-- DropIndex
DROP INDEX "Sale_linkId_idx";

-- DropIndex
DROP INDEX "Sale_clickEventId_idx";

-- DropIndex
DROP INDEX "Commission_saleId_idx";

-- DropIndex
DROP INDEX "AuditLog_workspaceId_action_createdAt_idx";

-- DropIndex
DROP INDEX "MLFeatureSnapshot_workspaceId_labeledAt_idx";

-- AlterTable
ALTER TABLE "Workspace" DROP COLUMN "safeModeAtivo",
DROP COLUMN "safeModeDesde",
DROP COLUMN "safeModeMotivo";

-- DropTable
DROP TABLE "SupervisorRun";

-- DropTable
DROP TABLE "DecisionRecord";

-- DropTable
DROP TABLE "DomainEvent";

-- DropTable
DROP TABLE "PolicyVersion";

-- DropTable
DROP TABLE "ApprovalRequest";

-- DropTable
DROP TABLE "ApprovalRule";

-- DropTable
DROP TABLE "FeatureFlag";

-- DropTable
DROP TABLE "CostLedger";

-- DropTable
DROP TABLE "WebhookReceipt";

-- DropEnum
DROP TYPE "EstadoDoRun";

-- DropEnum
DROP TYPE "StatusDaAprovacao";

COMMIT;
