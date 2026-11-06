-- P2.22 — processador de eventos (estado, tentativas, retry, erro, lease, linhagem anti-loop) + execuções/corte. Aditiva.
-- AlterTable
ALTER TABLE "DomainEvent" ADD COLUMN     "causadoPorEventoId" TEXT,
ADD COLUMN     "erroProcessamento" TEXT,
ADD COLUMN     "estadoProcessamento" TEXT,
ADD COLUMN     "processandoAte" TIMESTAMP(3),
ADD COLUMN     "processandoPor" TEXT,
ADD COLUMN     "profundidade" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "proximaTentativaEm" TIMESTAMP(3),
ADD COLUMN     "resultadoProcessamento" JSONB,
ADD COLUMN     "tentativas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ultimaTentativaEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ExecucaoDoProcessador" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "worker" TEXT NOT NULL,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminadoEm" TIMESTAMP(3),
    "processados" INTEGER NOT NULL DEFAULT 0,
    "falhas" INTEGER NOT NULL DEFAULT 0,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "ignorados" INTEGER NOT NULL DEFAULT 0,
    "detalhe" JSONB,

    CONSTRAINT "ExecucaoDoProcessador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecucaoDoProcessador_workspaceId_tipo_iniciadoEm_idx" ON "ExecucaoDoProcessador"("workspaceId", "tipo", "iniciadoEm");

-- CreateIndex
CREATE INDEX "DomainEvent_estadoProcessamento_proximaTentativaEm_idx" ON "DomainEvent"("estadoProcessamento", "proximaTentativaEm");

-- AddForeignKey
ALTER TABLE "ExecucaoDoProcessador" ADD CONSTRAINT "ExecucaoDoProcessador_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

