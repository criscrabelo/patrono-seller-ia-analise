-- P2.14.7 — Fase 0A: fundações do Autopilot.
-- SOMENTE ADITIVA: 2 enums, 9 tabelas novas, 3 colunas novas em Workspace
-- (com valor padrão), índices novos. Nenhum dado existente é alterado ou
-- apagado. Aplicar primeiro APENAS no banco de teste.

-- CreateEnum
CREATE TYPE "EstadoDoRun" AS ENUM ('PLANEJADO', 'DESCOBRINDO', 'VALIDANDO', 'RANQUEANDO', 'DECIDINDO', 'CRIANDO', 'AGUARDANDO_APROVACAO', 'AGENDANDO', 'PUBLICANDO', 'MEDINDO', 'APRENDENDO', 'CONCLUIDO', 'FALHOU', 'CANCELADO', 'PAUSADO');

-- CreateEnum
CREATE TYPE "StatusDaAprovacao" AS ENUM ('PENDENTE', 'APROVADA', 'REJEITADA', 'EXPIRADA', 'CANCELADA');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "safeModeAtivo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "safeModeDesde" TIMESTAMP(3),
ADD COLUMN     "safeModeMotivo" TEXT;

-- CreateTable
CREATE TABLE "SupervisorRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "modo" TEXT NOT NULL,
    "estado" "EstadoDoRun" NOT NULL DEFAULT 'PLANEJADO',
    "correlationId" TEXT NOT NULL,
    "passo" INTEGER NOT NULL DEFAULT 0,
    "checkpoint" JSONB,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "SupervisorRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "ator" TEXT NOT NULL,
    "atorUserId" TEXT,
    "correlationId" TEXT,
    "runId" TEXT,
    "entidadeTipo" TEXT,
    "entidadeId" TEXT,
    "decisao" TEXT NOT NULL,
    "confianca" DOUBLE PRECISION,
    "entradas" JSONB,
    "ausentes" TEXT[],
    "explicacao" TEXT[],
    "regra" TEXT,
    "politicaVersao" INTEGER,
    "chaveIdempotencia" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "correlationId" TEXT,
    "runId" TEXT,
    "entidadeTipo" TEXT,
    "entidadeId" TEXT,
    "payload" JSONB NOT NULL,
    "chaveIdempotencia" TEXT NOT NULL,
    "ocorridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "regras" JSONB NOT NULL,
    "motivo" TEXT,
    "ator" TEXT NOT NULL,
    "criadoPorUserId" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "resumo" TEXT NOT NULL,
    "porque" TEXT[],
    "risco" TEXT NOT NULL,
    "acaoProposta" JSONB NOT NULL,
    "entidadeTipo" TEXT,
    "entidadeId" TEXT,
    "status" "StatusDaAprovacao" NOT NULL DEFAULT 'PENDENTE',
    "correlationId" TEXT,
    "expiraEm" TIMESTAMP(3),
    "decididoEm" TIMESTAMP(3),
    "decididoPorUserId" TEXT,
    "decididoPorRegraId" TEXT,
    "motivoDaDecisao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "condicao" JSONB NOT NULL,
    "efeito" TEXT NOT NULL,
    "validaAte" TIMESTAMP(3),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "motivo" TEXT,
    "criadoPorUserId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogadaEm" TIMESTAMP(3),

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "escopo" TEXT NOT NULL DEFAULT 'global',
    "ligada" BOOLEAN NOT NULL DEFAULT false,
    "motivo" TEXT,
    "atualizadoPorUserId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostLedger" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "estimadoCentavos" INTEGER NOT NULL,
    "realCentavos" INTEGER,
    "moeda" TEXT NOT NULL DEFAULT 'BRL',
    "status" TEXT NOT NULL,
    "motivo" TEXT,
    "correlationId" TEXT,
    "chaveIdempotencia" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventoId" TEXT NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupervisorRun_correlationId_key" ON "SupervisorRun"("correlationId");

-- CreateIndex
CREATE INDEX "SupervisorRun_workspaceId_estado_idx" ON "SupervisorRun"("workspaceId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "SupervisorRun_workspaceId_chave_key" ON "SupervisorRun"("workspaceId", "chave");

-- CreateIndex
CREATE INDEX "DecisionRecord_workspaceId_criadoEm_idx" ON "DecisionRecord"("workspaceId", "criadoEm");

-- CreateIndex
CREATE INDEX "DecisionRecord_workspaceId_tipo_criadoEm_idx" ON "DecisionRecord"("workspaceId", "tipo", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionRecord_workspaceId_chaveIdempotencia_key" ON "DecisionRecord"("workspaceId", "chaveIdempotencia");

-- CreateIndex
CREATE INDEX "DomainEvent_workspaceId_ocorridoEm_idx" ON "DomainEvent"("workspaceId", "ocorridoEm");

-- CreateIndex
CREATE INDEX "DomainEvent_workspaceId_tipo_ocorridoEm_idx" ON "DomainEvent"("workspaceId", "tipo", "ocorridoEm");

-- CreateIndex
CREATE UNIQUE INDEX "DomainEvent_workspaceId_chaveIdempotencia_key" ON "DomainEvent"("workspaceId", "chaveIdempotencia");

-- CreateIndex
CREATE INDEX "PolicyVersion_workspaceId_ativa_idx" ON "PolicyVersion"("workspaceId", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_workspaceId_versao_key" ON "PolicyVersion"("workspaceId", "versao");

-- CreateIndex
CREATE INDEX "ApprovalRequest_workspaceId_status_criadoEm_idx" ON "ApprovalRequest"("workspaceId", "status", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_workspaceId_chave_key" ON "ApprovalRequest"("workspaceId", "chave");

-- CreateIndex
CREATE INDEX "ApprovalRule_workspaceId_tipo_ativa_idx" ON "ApprovalRule"("workspaceId", "tipo", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_chave_escopo_key" ON "FeatureFlag"("chave", "escopo");

-- CreateIndex
CREATE INDEX "CostLedger_workspaceId_criadoEm_idx" ON "CostLedger"("workspaceId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "CostLedger_workspaceId_chaveIdempotencia_key" ON "CostLedger"("workspaceId", "chaveIdempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookReceipt_provider_eventoId_key" ON "WebhookReceipt"("provider", "eventoId");

-- CreateIndex
CREATE INDEX "LinkDinamico_produtoId_idx" ON "LinkDinamico"("produtoId");

-- CreateIndex
CREATE INDEX "Conteudo_workspaceId_status_dataAgendamento_idx" ON "Conteudo"("workspaceId", "status", "dataAgendamento");

-- CreateIndex
CREATE INDEX "Sale_productId_idx" ON "Sale"("productId");

-- CreateIndex
CREATE INDEX "Sale_linkId_idx" ON "Sale"("linkId");

-- CreateIndex
CREATE INDEX "Sale_clickEventId_idx" ON "Sale"("clickEventId");

-- CreateIndex
CREATE INDEX "Commission_saleId_idx" ON "Commission"("saleId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_action_createdAt_idx" ON "AuditLog"("workspaceId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "MLFeatureSnapshot_workspaceId_labeledAt_idx" ON "MLFeatureSnapshot"("workspaceId", "labeledAt");

-- AddForeignKey
ALTER TABLE "SupervisorRun" ADD CONSTRAINT "SupervisorRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionRecord" ADD CONSTRAINT "DecisionRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLedger" ADD CONSTRAINT "CostLedger_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- No máximo UMA política ativa por workspace.
CREATE UNIQUE INDEX "PolicyVersion_uma_ativa_por_workspace" ON "PolicyVersion"("workspaceId") WHERE "ativa";

-- Mesmo padrão das tabelas existentes: RLS ligado, sem política, sem
-- acesso pela API pública do Supabase (explícito, não depende de gatilho).
ALTER TABLE "SupervisorRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DecisionRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DomainEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApprovalRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApprovalRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeatureFlag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CostLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookReceipt" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "SupervisorRun" FROM anon, authenticated;
REVOKE ALL ON TABLE "DecisionRecord" FROM anon, authenticated;
REVOKE ALL ON TABLE "DomainEvent" FROM anon, authenticated;
REVOKE ALL ON TABLE "PolicyVersion" FROM anon, authenticated;
REVOKE ALL ON TABLE "ApprovalRequest" FROM anon, authenticated;
REVOKE ALL ON TABLE "ApprovalRule" FROM anon, authenticated;
REVOKE ALL ON TABLE "FeatureFlag" FROM anon, authenticated;
REVOKE ALL ON TABLE "CostLedger" FROM anon, authenticated;
REVOKE ALL ON TABLE "WebhookReceipt" FROM anon, authenticated;
