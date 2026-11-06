-- P2.17.3 — Metas/missões do TikTok Shop (registradas pela titular). Só aditiva.

-- CreateTable
CREATE TABLE "MetaTikTokShop" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "recompensaValor" DOUBLE PRECISION,
    "recompensaDescricao" TEXT,
    "quantidadeExigida" INTEGER NOT NULL,
    "quantidadeRealizada" INTEGER NOT NULL DEFAULT 0,
    "requisitos" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ATIVA',
    "origem" TEXT NOT NULL DEFAULT 'MANUAL',
    "criadoPorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaTikTokShop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetaTikTokShop_workspaceId_status_idx" ON "MetaTikTokShop"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "MetaTikTokShop" ADD CONSTRAINT "MetaTikTokShop_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mesmo padrão das tabelas existentes: RLS ligado, sem política, sem acesso
-- pela API pública do Supabase.
ALTER TABLE "MetaTikTokShop" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MetaTikTokShop" FROM anon, authenticated;
