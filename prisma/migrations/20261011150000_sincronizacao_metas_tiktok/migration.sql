-- P2.17.5 — TikTok Mission Sync. Só aditiva.
ALTER TABLE "MetaTikTokShop" ADD COLUMN "chaveExterna" TEXT;
ALTER TABLE "MetaTikTokShop" ADD COLUMN "fonteSincronizacao" TEXT;
ALTER TABLE "MetaTikTokShop" ADD COLUMN "ultimaSincronizacaoEm" TIMESTAMP(3);
ALTER TABLE "MetaTikTokShop" ADD COLUMN "ausenteDesde" TIMESTAMP(3);
ALTER TABLE "MetaTikTokShop" ADD COLUMN "ausenciasSeguidas" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "MetaTikTokShop_workspaceId_chaveExterna_key" ON "MetaTikTokShop"("workspaceId", "chaveExterna");

CREATE TABLE "SincronizacaoMetasTikTok" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "gatilho" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "criadas" INTEGER NOT NULL DEFAULT 0,
    "atualizadas" INTEGER NOT NULL DEFAULT 0,
    "inalteradas" INTEGER NOT NULL DEFAULT 0,
    "ausentes" INTEGER NOT NULL DEFAULT 0,
    "encerradas" INTEGER NOT NULL DEFAULT 0,
    "mensagem" TEXT,
    "reacao" JSONB,
    "userId" TEXT,
    "iniciadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidaEm" TIMESTAMP(3),
    CONSTRAINT "SincronizacaoMetasTikTok_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SincronizacaoMetasTikTok_workspaceId_iniciadaEm_idx" ON "SincronizacaoMetasTikTok"("workspaceId", "iniciadaEm");
ALTER TABLE "SincronizacaoMetasTikTok" ADD CONSTRAINT "SincronizacaoMetasTikTok_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AlteracaoMetaTikTok" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "metaId" TEXT NOT NULL,
    "sincronizacaoId" TEXT,
    "campo" TEXT NOT NULL,
    "valorAnterior" TEXT,
    "valorNovo" TEXT,
    "origem" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlteracaoMetaTikTok_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AlteracaoMetaTikTok_workspaceId_metaId_createdAt_idx" ON "AlteracaoMetaTikTok"("workspaceId", "metaId", "createdAt");
ALTER TABLE "AlteracaoMetaTikTok" ADD CONSTRAINT "AlteracaoMetaTikTok_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AlteracaoMetaTikTok" ADD CONSTRAINT "AlteracaoMetaTikTok_sincronizacaoId_fkey" FOREIGN KEY ("sincronizacaoId") REFERENCES "SincronizacaoMetasTikTok"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mesmo padrão: RLS ligado, sem política, sem acesso pela API pública do Supabase.
ALTER TABLE "SincronizacaoMetasTikTok" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "SincronizacaoMetasTikTok" FROM anon, authenticated;
ALTER TABLE "AlteracaoMetaTikTok" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AlteracaoMetaTikTok" FROM anon, authenticated;
