-- P2.14.5.13 — Fase 2: candidatos de produto e perfil da loja.
-- SOMENTE ADITIVA: cria 1 enum, 2 tabelas, 3 índices e 3 chaves
-- estrangeiras NAS TABELAS NOVAS. Nenhuma tabela existente é alterada e
-- nenhum dado é lido, alterado ou apagado.

-- CreateEnum
CREATE TYPE "StatusDoCandidato" AS ENUM ('NOVO', 'APRESENTADO', 'ESCOLHIDO', 'DESCARTADO', 'CADASTRADO');

-- CreateTable
CREATE TABLE "CandidatoDeProduto" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "chaveDeOrigem" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "providerId" TEXT,
    "externalId" TEXT,
    "produtoId" TEXT,
    "nome" TEXT NOT NULL,
    "linkProduto" TEXT,
    "imagem" TEXT,
    "imagemAutorizada" BOOLEAN NOT NULL DEFAULT false,
    "categoria" TEXT,
    "preco" DOUBLE PRECISION,
    "comissaoPercentual" DOUBLE PRECISION,
    "comissaoValor" DOUBLE PRECISION,
    "vendas" INTEGER,
    "velocidadeDeVendas" DOUBLE PRECISION,
    "avaliacao" DOUBLE PRECISION,
    "numeroDeAvaliacoes" INTEGER,
    "estoque" INTEGER,
    "score" INTEGER NOT NULL,
    "baseDeEvidencia" INTEGER NOT NULL,
    "aderencia" INTEGER,
    "aderenciaDoPerfil" INTEGER,
    "afinidade" INTEGER NOT NULL DEFAULT 0,
    "confianca" TEXT NOT NULL,
    "nivelDeRisco" TEXT,
    "complianceBloqueante" BOOLEAN NOT NULL DEFAULT false,
    "publicacaoImpedida" BOOLEAN NOT NULL DEFAULT false,
    "compradoPelaTitular" BOOLEAN NOT NULL DEFAULT false,
    "usadoPelaTitular" BOOLEAN NOT NULL DEFAULT false,
    "motivosPositivos" TEXT[],
    "riscos" TEXT[],
    "desconhecidos" TEXT[],
    "porqueDestaPosicao" TEXT[],
    "status" "StatusDoCandidato" NOT NULL DEFAULT 'NOVO',
    "posicao" INTEGER,
    "coletadoEm" TIMESTAMP(3) NOT NULL,
    "validoAte" TIMESTAMP(3) NOT NULL,
    "escolhidoEm" TIMESTAMP(3),
    "escolhidoPorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidatoDeProduto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerfilDaLoja" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "posicionamento" TEXT NOT NULL,
    "publico" TEXT NOT NULL,
    "categoriasPrioritarias" TEXT[],
    "categoriasDoCadastro" TEXT[],
    "subcategoriasPrioritarias" JSONB NOT NULL,
    "precoMinimo" DOUBLE PRECISION NOT NULL,
    "precoMaximo" DOUBLE PRECISION NOT NULL,
    "precoPremiumAte" DOUBLE PRECISION NOT NULL,
    "priorizarFacilDeDemonstrar" BOOLEAN NOT NULL DEFAULT true,
    "priorizarConteudoFaceless" BOOLEAN NOT NULL DEFAULT true,
    "marcasPreferidas" JSONB NOT NULL,
    "estilo" TEXT[],
    "marcadorDeUso" TEXT NOT NULL DEFAULT '#usei',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfilDaLoja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidatoDeProduto_workspaceId_status_idx" ON "CandidatoDeProduto"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CandidatoDeProduto_workspaceId_chaveDeOrigem_key" ON "CandidatoDeProduto"("workspaceId", "chaveDeOrigem");

-- CreateIndex
CREATE UNIQUE INDEX "PerfilDaLoja_workspaceId_key" ON "PerfilDaLoja"("workspaceId");

-- AddForeignKey
ALTER TABLE "CandidatoDeProduto" ADD CONSTRAINT "CandidatoDeProduto_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatoDeProduto" ADD CONSTRAINT "CandidatoDeProduto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerfilDaLoja" ADD CONSTRAINT "PerfilDaLoja_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mesmo padrão das tabelas existentes (RLS ligado, sem política, sem acesso
-- pela API pública do Supabase). Explícito para não depender do gatilho
-- `ensure_rls`, que existe no banco de teste e pode não existir em outro.
ALTER TABLE "CandidatoDeProduto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PerfilDaLoja" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CandidatoDeProduto" FROM anon, authenticated;
REVOKE ALL ON TABLE "PerfilDaLoja" FROM anon, authenticated;
