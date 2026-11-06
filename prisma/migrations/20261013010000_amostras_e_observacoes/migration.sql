-- P2.17.17/18 — Amostras do TikTok Shop (operação) e evidência observada à mão no app (snapshot). Só tabelas novas.
CREATE TABLE "AmostraTikTokShop" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "candidatoId" TEXT,
    "produtoId" TEXT,
    "productIdExterno" TEXT,
    "nomeProduto" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'tiktok-shop',
    "tipo" TEXT,
    "estado" TEXT NOT NULL,
    "papeis" TEXT[] DEFAULT ARRAY['PRODUTO_AFILIADO']::TEXT[],
    "comissaoObservada" DOUBLE PRECISION,
    "comissaoFonte" TEXT,
    "solicitadaEm" TIMESTAMP(3),
    "aprovadaEm" TIMESTAMP(3),
    "enviadaEm" TIMESTAMP(3),
    "recebidaEm" TIMESTAMP(3),
    "rejeitadaEm" TIMESTAMP(3),
    "prazoConteudoEm" TIMESTAMP(3),
    "prazoConteudoFonte" TEXT,
    "missaoComputada" BOOLEAN,
    "missaoComputadaEm" TIMESTAMP(3),
    "metaId" TEXT,
    "publicacaoAssistidaId" TEXT,
    "campanha" TEXT,
    "motivo" TEXT,
    "observacao" TEXT,
    "historico" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmostraTikTokShop_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AmostraTikTokShop_workspaceId_chave_key" ON "AmostraTikTokShop"("workspaceId", "chave");
CREATE INDEX "AmostraTikTokShop_workspaceId_estado_idx" ON "AmostraTikTokShop"("workspaceId", "estado");
ALTER TABLE "AmostraTikTokShop" ADD CONSTRAINT "AmostraTikTokShop_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AmostraTikTokShop" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AmostraTikTokShop" FROM anon, authenticated;

CREATE TABLE "ObservacaoDeMercado" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "candidatoId" TEXT,
    "nomeProduto" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "observadoEm" TIMESTAMP(3) NOT NULL,
    "validaAte" TIMESTAMP(3) NOT NULL,
    "rankingCategoria" TEXT,
    "rankingPosicao" INTEGER,
    "vendasExibidas" INTEGER,
    "vendasExibidasTexto" TEXT,
    "comissaoExibida" DOUBLE PRECISION,
    "comissaoPercentualExibida" DOUBLE PRECISION,
    "preco" DOUBLE PRECISION,
    "estoque" INTEGER,
    "tipoDeAmostra" TEXT,
    "observacao" TEXT,
    "registradoPorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ObservacaoDeMercado_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ObservacaoDeMercado_workspaceId_chave_observadoEm_idx" ON "ObservacaoDeMercado"("workspaceId", "chave", "observadoEm");
ALTER TABLE "ObservacaoDeMercado" ADD CONSTRAINT "ObservacaoDeMercado_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ObservacaoDeMercado" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ObservacaoDeMercado" FROM anon, authenticated;
