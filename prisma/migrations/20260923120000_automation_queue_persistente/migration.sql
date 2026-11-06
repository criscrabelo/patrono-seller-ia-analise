-- CreateEnum
CREATE TYPE "EstadoDoAutomationJob" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLED');

-- CreateTable
CREATE TABLE "AutomationJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "estado" "EstadoDoAutomationJob" NOT NULL DEFAULT 'PENDING',
    "classe" TEXT NOT NULL,
    "motivoHumano" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "contexto" JSONB,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "workerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "resolvidoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationJob_workspaceId_estado_proximaTentativaEm_idx" ON "AutomationJob"("workspaceId", "estado", "proximaTentativaEm");

-- CreateIndex
CREATE INDEX "AutomationJob_workspaceId_estado_heartbeatAt_idx" ON "AutomationJob"("workspaceId", "estado", "heartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationJob_workspaceId_chave_key" ON "AutomationJob"("workspaceId", "chave");

-- AddForeignKey
ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

