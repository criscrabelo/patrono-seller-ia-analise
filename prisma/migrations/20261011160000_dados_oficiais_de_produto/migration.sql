-- P2.17.6 — Enriquecimento de produto (dados oficiais + histórico). Só aditiva.
CREATE TABLE "DadoOficialDeProduto" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "provider" TEXT,
    "externalId" TEXT,
    "linkProduto" TEXT,
    "preco" DOUBLE PRECISION,
    "precoAnterior" DOUBLE PRECISION,
    "descontoPercentual" DOUBLE PRECISION,
    "menorPrecoObservado" DOUBLE PRECISION,
    "moeda" TEXT,
    "comissaoPercentual" DOUBLE PRECISION,
    "comissaoValor" DOUBLE PRECISION,
    "unidadeDaComissao" TEXT,
    "vendas" INTEGER,
    "avaliacao" DOUBLE PRECISION,
    "numeroDeAvaliacoes" INTEGER,
    "estoque" INTEGER,
    "disponivel" BOOLEAN,
    "categoria" TEXT,
    "imagem" TEXT,
    "loja" TEXT,
    "fonte" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "motivoCurto" TEXT,
    "motivo" TEXT,
    "consultadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DadoOficialDeProduto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DadoOficialDeProduto_workspaceId_chave_key" ON "DadoOficialDeProduto"("workspaceId", "chave");
ALTER TABLE "DadoOficialDeProduto" ADD CONSTRAINT "DadoOficialDeProduto_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "HistoricoDadoDeProduto" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "valorAnterior" TEXT,
    "valorNovo" TEXT,
    "fonte" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HistoricoDadoDeProduto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HistoricoDadoDeProduto_workspaceId_chave_createdAt_idx" ON "HistoricoDadoDeProduto"("workspaceId", "chave", "createdAt");
ALTER TABLE "HistoricoDadoDeProduto" ADD CONSTRAINT "HistoricoDadoDeProduto_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mesmo padrão: RLS ligado, sem política, sem acesso pela API pública do Supabase.
ALTER TABLE "DadoOficialDeProduto" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "DadoOficialDeProduto" FROM anon, authenticated;
ALTER TABLE "HistoricoDadoDeProduto" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "HistoricoDadoDeProduto" FROM anon, authenticated;
