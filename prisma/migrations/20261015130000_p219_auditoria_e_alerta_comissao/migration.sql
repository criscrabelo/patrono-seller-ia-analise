-- P2.19 — auditoria do importador (arquivo original, versão do parser, colunas extras, vínculos) e alerta de redução de comissão (30 dias). Aditiva.
-- AlterTable
ALTER TABLE "ImportacaoCreatorCenter" ADD COLUMN     "cabecalhoOriginal" TEXT[],
ADD COLUMN     "conteudoOriginal" TEXT,
ADD COLUMN     "formato" TEXT NOT NULL DEFAULT 'CSV',
ADD COLUMN     "versaoDoParser" TEXT NOT NULL DEFAULT 'creator-center@1';

-- AlterTable
ALTER TABLE "PedidoAfiliadoTikTok" ADD COLUMN     "candidatoId" TEXT,
ADD COLUMN     "colunasExtras" JSONB,
ADD COLUMN     "vinculoProduto" TEXT NOT NULL DEFAULT 'NAO_VINCULADO',
ADD COLUMN     "vinculoVideo" TEXT NOT NULL DEFAULT 'NAO_VINCULADO';

-- CreateTable
CREATE TABLE "AlertaReducaoComissao" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "candidatoId" TEXT,
    "chaveProduto" TEXT NOT NULL,
    "nomeProduto" TEXT NOT NULL,
    "taxaAtual" DOUBLE PRECISION NOT NULL,
    "taxaNova" DOUBLE PRECISION NOT NULL,
    "dataInicialDaTaxa" TIMESTAMP(3),
    "dataDoAnuncio" TIMESTAMP(3) NOT NULL,
    "fonteDoAnuncio" TEXT NOT NULL,
    "dataEfetiva" TIMESTAMP(3),
    "fonteDataEfetiva" TEXT,
    "produtoJaAdicionado" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "nivel" TEXT,
    "historico" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertaReducaoComissao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertaReducaoComissao_workspaceId_status_idx" ON "AlertaReducaoComissao"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AlertaReducaoComissao_workspaceId_chaveProduto_dataDoAnunci_key" ON "AlertaReducaoComissao"("workspaceId", "chaveProduto", "dataDoAnuncio");

-- AddForeignKey
ALTER TABLE "AlertaReducaoComissao" ADD CONSTRAINT "AlertaReducaoComissao_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "AlertaReducaoComissao" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AlertaReducaoComissao" FROM anon, authenticated;
