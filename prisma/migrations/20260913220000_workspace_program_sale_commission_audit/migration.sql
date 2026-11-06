-- ═══════════════════════════════════════════════════════════════════════
-- Workspace + Programa/Operação/Integração + Venda/Comissão + Auditoria
--
-- Migração escrita à mão (não pelo autogerador) para poder popular os dados
-- existentes com segurança, em vez de simplesmente adicionar colunas
-- NOT NULL vazias. Ordem: (1) cria tabelas novas, (2) adiciona as colunas
-- de workspaceId como NULAS, (3) povoa (um workspace por usuária já
-- existente), (4) só então torna as colunas obrigatórias, (5) índices e
-- chaves estrangeiras por último.
--
-- Nenhum dado existente é apagado. Projeto continua executável após esta
-- migração.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Tabelas novas ──────────────────────────────────────────────────

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateProgram" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_REGISTERED',
    "operationMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "integrationStatus" TEXT NOT NULL DEFAULT 'NOT_AVAILABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateProgram_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT,
    "affiliateProgramId" TEXT,
    "linkId" TEXT,
    "contentId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "saleId" TEXT,
    "productId" TEXT,
    "affiliateProgramId" TEXT,
    "expectedAmount" DOUBLE PRECISION,
    "confirmedAmount" DOUBLE PRECISION,
    "receivedAmount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'EXPECTED',
    "expectedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- ── 2. Colunas workspaceId, criadas NULAS por enquanto ──────────────────

ALTER TABLE "User" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Produto" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "LinkDinamico" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Integracao" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Conteudo" ADD COLUMN "workspaceId" TEXT;

-- ── 3. Povoamento: um workspace próprio para cada usuária já existente ──
-- Hoje cada usuária tem exatamente um workspace (o dela). Não existe
-- ainda o conceito de várias usuárias compartilhando um mesmo workspace
-- (isso é uma evolução futura, documentada em DOCUMENTACAO-PATRONO-SELLER.md).

INSERT INTO "Workspace" ("id", "name", "ownerId", "createdAt", "updatedAt")
SELECT
    'ws_' || substr(md5(u."id" || clock_timestamp()::text || random()::text), 1, 20),
    COALESCE(u."name", u."email") || ' — Workspace',
    u."id",
    now(),
    now()
FROM "User" u;

UPDATE "User" u
SET "workspaceId" = w."id"
FROM "Workspace" w
WHERE w."ownerId" = u."id";

UPDATE "Produto" p
SET "workspaceId" = w."id"
FROM "Workspace" w
WHERE w."ownerId" = p."userId";

UPDATE "LinkDinamico" l
SET "workspaceId" = w."id"
FROM "Workspace" w
WHERE w."ownerId" = l."userId";

UPDATE "Integracao" i
SET "workspaceId" = w."id"
FROM "Workspace" w
WHERE w."ownerId" = i."userId";

UPDATE "Conteudo" c
SET "workspaceId" = w."id"
FROM "Workspace" w
WHERE w."ownerId" = c."userId";

-- ── 4. Agora sim, obrigatórias ───────────────────────────────────────────

ALTER TABLE "User" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Produto" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "LinkDinamico" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Integracao" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Conteudo" ALTER COLUMN "workspaceId" SET NOT NULL;

-- ── 5. Índices ───────────────────────────────────────────────────────────

DROP INDEX "Integracao_userId_plataforma_key";

CREATE UNIQUE INDEX "Workspace_ownerId_key" ON "Workspace"("ownerId");
CREATE INDEX "AffiliateProgram_workspaceId_idx" ON "AffiliateProgram"("workspaceId");
CREATE UNIQUE INDEX "AffiliateProgram_workspaceId_platform_key" ON "AffiliateProgram"("workspaceId", "platform");
CREATE INDEX "Sale_workspaceId_idx" ON "Sale"("workspaceId");
CREATE INDEX "Sale_workspaceId_status_idx" ON "Sale"("workspaceId", "status");
CREATE INDEX "Commission_workspaceId_idx" ON "Commission"("workspaceId");
CREATE INDEX "Commission_workspaceId_status_idx" ON "Commission"("workspaceId", "status");
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "Conteudo_workspaceId_idx" ON "Conteudo"("workspaceId");
CREATE INDEX "Integracao_userId_idx" ON "Integracao"("userId");
CREATE UNIQUE INDEX "Integracao_workspaceId_plataforma_key" ON "Integracao"("workspaceId", "plataforma");
CREATE INDEX "LinkDinamico_workspaceId_idx" ON "LinkDinamico"("workspaceId");
CREATE INDEX "Produto_workspaceId_idx" ON "Produto"("workspaceId");

-- ── 6. Chaves estrangeiras ────────────────────────────────────────────────
-- (Workspace.ownerId NÃO tem FK: é só proveniência — "quem fundou este
-- workspace" — não uma fronteira de isolamento. A fronteira real é
-- User.workspaceId -> Workspace.id, logo abaixo, que É obrigatória. Sem FK
-- aqui evita uma referência circular entre User e Workspace na hora de
-- criar a conta: veja lib/workspace.ts.)

ALTER TABLE "User" ADD CONSTRAINT "User_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LinkDinamico" ADD CONSTRAINT "LinkDinamico_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Integracao" ADD CONSTRAINT "Integracao_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conteudo" ADD CONSTRAINT "Conteudo_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AffiliateProgram" ADD CONSTRAINT "AffiliateProgram_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_affiliateProgramId_fkey" FOREIGN KEY ("affiliateProgramId") REFERENCES "AffiliateProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "LinkDinamico"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Conteudo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_affiliateProgramId_fkey" FOREIGN KEY ("affiliateProgramId") REFERENCES "AffiliateProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
