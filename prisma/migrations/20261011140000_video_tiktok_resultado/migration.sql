-- P2.17.4 — Resultados reais de vídeos do TikTok (aprendizado). Só aditiva.
CREATE TABLE "VideoTikTokResultado" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "produtoId" TEXT,
    "candidatoId" TEXT,
    "estrutura" TEXT NOT NULL,
    "gancho" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "duracaoSegundos" INTEGER NOT NULL,
    "publicadoEm" TIMESTAMP(3) NOT NULL,
    "urlDoVideo" TEXT,
    "views" INTEGER,
    "retencaoMedia" DOUBLE PRECISION,
    "tempoMedioSeg" DOUBLE PRECISION,
    "cliquesProduto" INTEGER,
    "ctr" DOUBLE PRECISION,
    "adicoesCarrinho" INTEGER,
    "vendas" INTEGER,
    "comissao" DOUBLE PRECISION,
    "metasIds" TEXT[],
    "origemMetricas" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoTikTokResultado_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VideoTikTokResultado_workspaceId_publicadoEm_idx" ON "VideoTikTokResultado"("workspaceId", "publicadoEm");
ALTER TABLE "VideoTikTokResultado" ADD CONSTRAINT "VideoTikTokResultado_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Mesmo padrão: RLS ligado, sem política, sem acesso pela API pública do Supabase.
ALTER TABLE "VideoTikTokResultado" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "VideoTikTokResultado" FROM anon, authenticated;
