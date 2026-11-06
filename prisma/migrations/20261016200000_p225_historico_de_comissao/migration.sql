-- CreateTable
CREATE TABLE "HistoricoDeComissao" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "chave" TEXT,
    "anterior" JSONB,
    "novo" JSONB NOT NULL,
    "motivo" TEXT,
    "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricoDeComissao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistoricoDeComissao_workspaceId_commissionId_idx" ON "HistoricoDeComissao"("workspaceId", "commissionId");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricoDeComissao_workspaceId_chave_key" ON "HistoricoDeComissao"("workspaceId", "chave");

-- AddForeignKey
ALTER TABLE "HistoricoDeComissao" ADD CONSTRAINT "HistoricoDeComissao_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

