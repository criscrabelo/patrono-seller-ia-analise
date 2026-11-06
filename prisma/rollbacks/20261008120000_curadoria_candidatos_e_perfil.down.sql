-- ROLLBACK da migration 20261008120000_curadoria_candidatos_e_perfil (P2.14.5.13).
-- Execute DEPOIS do rollback da 0A (ordem inversa da aplicação).
-- Efeito: remove CandidatoDeProduto, PerfilDaLoja e o enum StatusDoCandidato.
-- NÃO toca em Produto nem em nenhuma tabela pré-existente.
-- Depois de executar (numa transação), marcar no Prisma:
--   prisma migrate resolve --rolled-back 20261008120000_curadoria_candidatos_e_perfil
BEGIN;
-- DropForeignKey
ALTER TABLE "CandidatoDeProduto" DROP CONSTRAINT "CandidatoDeProduto_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "CandidatoDeProduto" DROP CONSTRAINT "CandidatoDeProduto_produtoId_fkey";

-- DropForeignKey
ALTER TABLE "PerfilDaLoja" DROP CONSTRAINT "PerfilDaLoja_workspaceId_fkey";

-- DropTable
DROP TABLE "CandidatoDeProduto";

-- DropTable
DROP TABLE "PerfilDaLoja";

-- DropEnum
DROP TYPE "StatusDoCandidato";

COMMIT;
