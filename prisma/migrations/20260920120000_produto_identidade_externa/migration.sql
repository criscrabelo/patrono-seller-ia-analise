-- Identidade externa e sincronizacao automatica de catalogo (Rodada 11).
--
-- AUTOMATION FIRST: a proprietaria nao deve cadastrar produto, preco, imagem,
-- comissao ou disponibilidade a mao quando a plataforma oferecer isso por API
-- oficial. Estas colunas sao o que torna a importacao da Vitrine/Showcase
-- IDEMPOTENTE — sem elas, cada sincronizacao duplicaria a vitrine inteira.
--
-- Mudanca puramente ADITIVA: nenhuma coluna existente e alterada ou removida.
-- As novas colunas sao nulaveis, exceto "origemDados", que entra com default
-- 'MANUAL' — entao todo produto ja cadastrado mantem exatamente o
-- comportamento anterior.
--
-- O indice unico leva "workspaceId" como PRIMEIRA coluna de proposito: o
-- mesmo externalId do TikTok pode existir em negocios diferentes sem colidir.
-- Em Postgres NULL nao colide com NULL, entao produto manual (providerId
-- nulo) segue sem restricao.

-- AlterTable
ALTER TABLE "Produto" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "origemDados" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "providerId" TEXT,
ADD COLUMN     "removidoDaOrigemEm" TIMESTAMP(3),
ADD COLUMN     "sincronizadoEm" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Produto_workspaceId_origemDados_idx" ON "Produto"("workspaceId", "origemDados");

-- CreateIndex
CREATE UNIQUE INDEX "Produto_workspaceId_providerId_externalId_key" ON "Produto"("workspaceId", "providerId", "externalId");
