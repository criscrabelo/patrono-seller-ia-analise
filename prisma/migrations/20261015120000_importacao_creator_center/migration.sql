-- P2.19 — Importação do Creator Center (pedidos de afiliado, comissão em 3 estados + histórico). Aditiva: só cria 3 tabelas.
-- CreateTable
CREATE TABLE "ImportacaoCreatorCenter" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "nomeArquivo" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'CREATOR_CENTER_CSV',
    "dataOrigin" TEXT NOT NULL,
    "mapeamento" JSONB NOT NULL,
    "colunasIgnoradas" TEXT[],
    "linhasTotal" INTEGER NOT NULL,
    "linhasNovas" INTEGER NOT NULL,
    "linhasAtualizadas" INTEGER NOT NULL,
    "linhasIguais" INTEGER NOT NULL,
    "linhasRejeitadas" INTEGER NOT NULL,
    "ocorrencias" JSONB NOT NULL,
    "importadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluida" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ImportacaoCreatorCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoAfiliadoTikTok" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "skuId" TEXT,
    "produtoIdExterno" TEXT,
    "produtoNome" TEXT NOT NULL,
    "lojaNome" TEXT,
    "quantidade" INTEGER,
    "valorBase" DOUBLE PRECISION,
    "taxaComissao" DOUBLE PRECISION,
    "tipoConteudo" TEXT,
    "conteudoIdExterno" TEXT,
    "estado" TEXT NOT NULL,
    "statusOriginal" TEXT,
    "comissaoEstimada" DOUBLE PRECISION,
    "comissaoLiquidada" DOUBLE PRECISION,
    "dataPedido" TIMESTAMP(3),
    "dataLiquidacao" TIMESTAMP(3),
    "origem" TEXT NOT NULL DEFAULT 'CREATOR_CENTER_CSV',
    "dataOrigin" TEXT NOT NULL,
    "primeiraImportacaoId" TEXT NOT NULL,
    "ultimaImportacaoId" TEXT NOT NULL,
    "produtoId" TEXT,
    "videoResultadoId" TEXT,
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PedidoAfiliadoTikTok_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricoPedidoAfiliadoTikTok" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "importacaoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "anterior" JSONB,
    "novo" JSONB NOT NULL,
    "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricoPedidoAfiliadoTikTok_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportacaoCreatorCenter_workspaceId_importadoEm_idx" ON "ImportacaoCreatorCenter"("workspaceId", "importadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "ImportacaoCreatorCenter_workspaceId_sha256_key" ON "ImportacaoCreatorCenter"("workspaceId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoAfiliadoTikTok_saleId_key" ON "PedidoAfiliadoTikTok"("saleId");

-- CreateIndex
CREATE INDEX "PedidoAfiliadoTikTok_workspaceId_estado_idx" ON "PedidoAfiliadoTikTok"("workspaceId", "estado");

-- CreateIndex
CREATE INDEX "PedidoAfiliadoTikTok_workspaceId_dataPedido_idx" ON "PedidoAfiliadoTikTok"("workspaceId", "dataPedido");

-- CreateIndex
CREATE UNIQUE INDEX "PedidoAfiliadoTikTok_workspaceId_chave_key" ON "PedidoAfiliadoTikTok"("workspaceId", "chave");

-- CreateIndex
CREATE INDEX "HistoricoPedidoAfiliadoTikTok_workspaceId_pedidoId_idx" ON "HistoricoPedidoAfiliadoTikTok"("workspaceId", "pedidoId");

-- AddForeignKey
ALTER TABLE "ImportacaoCreatorCenter" ADD CONSTRAINT "ImportacaoCreatorCenter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PedidoAfiliadoTikTok" ADD CONSTRAINT "PedidoAfiliadoTikTok_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoPedidoAfiliadoTikTok" ADD CONSTRAINT "HistoricoPedidoAfiliadoTikTok_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoPedidoAfiliadoTikTok" ADD CONSTRAINT "HistoricoPedidoAfiliadoTikTok_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "PedidoAfiliadoTikTok"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoPedidoAfiliadoTikTok" ADD CONSTRAINT "HistoricoPedidoAfiliadoTikTok_importacaoId_fkey" FOREIGN KEY ("importacaoId") REFERENCES "ImportacaoCreatorCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Nunca acessíveis pela API pública do Supabase.
ALTER TABLE "ImportacaoCreatorCenter" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ImportacaoCreatorCenter" FROM anon, authenticated;
ALTER TABLE "PedidoAfiliadoTikTok" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PedidoAfiliadoTikTok" FROM anon, authenticated;
ALTER TABLE "HistoricoPedidoAfiliadoTikTok" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "HistoricoPedidoAfiliadoTikTok" FROM anon, authenticated;
