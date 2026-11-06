-- Vitrine (showcase) do TikTok Shop: registro por produto, confirmado pelo Get Showcase Products.
CREATE TABLE "VitrineTikTokShop" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "candidatoId" TEXT,
    "productId" TEXT NOT NULL,
    "nomeProduto" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "enviadoEm" TIMESTAMP(3),
    "verificadoEm" TIMESTAMP(3),
    "confirmadoEm" TIMESTAMP(3),
    "requestIdAdd" TEXT,
    "requestIdGet" TEXT,
    "detalhe" TEXT,
    "historico" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VitrineTikTokShop_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VitrineTikTokShop_workspaceId_productId_key" ON "VitrineTikTokShop"("workspaceId", "productId");
CREATE INDEX "VitrineTikTokShop_workspaceId_estado_idx" ON "VitrineTikTokShop"("workspaceId", "estado");
ALTER TABLE "VitrineTikTokShop" ADD CONSTRAINT "VitrineTikTokShop_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VitrineTikTokShop" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "VitrineTikTokShop" FROM anon, authenticated;
