-- P2.17.10 — Resultados reais por vídeo (contexto + receita) e modo assistido. Só aditiva.
ALTER TABLE "VideoTikTokResultado" ADD COLUMN "canal" TEXT NOT NULL DEFAULT 'tiktok';
ALTER TABLE "VideoTikTokResultado" ADD COLUMN "nomeProduto" TEXT;
ALTER TABLE "VideoTikTokResultado" ADD COLUMN "categoria" TEXT;
ALTER TABLE "VideoTikTokResultado" ADD COLUMN "ctaTexto" TEXT;
ALTER TABLE "VideoTikTokResultado" ADD COLUMN "receita" DOUBLE PRECISION;
ALTER TABLE "VideoTikTokResultado" ADD COLUMN "conteudoId" TEXT;
ALTER TABLE "VideoTikTokResultado" ADD COLUMN "publicacaoAssistidaId" TEXT;
ALTER TABLE "VideoTikTokResultado" ADD COLUMN "postId" TEXT;
CREATE UNIQUE INDEX "VideoTikTokResultado_publicacaoAssistidaId_key" ON "VideoTikTokResultado"("publicacaoAssistidaId");

CREATE TABLE "PublicacaoAssistida" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ordem" INTEGER,
    "estado" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "canal" TEXT NOT NULL DEFAULT 'tiktok',
    "candidatoId" TEXT,
    "produtoId" TEXT,
    "conteudoId" TEXT,
    "nomeProduto" TEXT NOT NULL,
    "varianteId" TEXT NOT NULL,
    "estrutura" TEXT NOT NULL,
    "apresentacao" JSONB NOT NULL,
    "qualityGate" JSONB NOT NULL,
    "historico" JSONB NOT NULL DEFAULT '[]',
    "aprovadoDePrimeira" BOOLEAN,
    "versaoFinal" JSONB,
    "motivoEscolha" TEXT NOT NULL,
    "objetivoDoTeste" TEXT NOT NULL,
    "vezesQueOProdutoApareceu" INTEGER NOT NULL DEFAULT 0,
    "horarioPlanejado" TIMESTAMP(3),
    "metasIds" TEXT[],
    "publicacaoId" TEXT,
    "publishId" TEXT,
    "postId" TEXT,
    "urlPublicada" TEXT,
    "modoDePublicacao" TEXT,
    "bloqueio" TEXT,
    "erro" TEXT,
    "publicadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicacaoAssistida_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PublicacaoAssistida_workspaceId_estado_idx" ON "PublicacaoAssistida"("workspaceId", "estado");
ALTER TABLE "PublicacaoAssistida" ADD CONSTRAINT "PublicacaoAssistida_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Ordem 1..10 única por workspace (só publicações confirmadas recebem ordem).
CREATE UNIQUE INDEX "PublicacaoAssistida_workspaceId_ordem_key" ON "PublicacaoAssistida"("workspaceId", "ordem");

ALTER TABLE "PublicacaoAssistida" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PublicacaoAssistida" FROM anon, authenticated;
