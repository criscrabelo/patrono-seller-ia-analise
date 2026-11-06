-- Rollback OPCIONAL do banco do RC consolidado 2180ecf (P2.18.10).
-- Só por decisão expressa da titular: APAGA as autorizações de mídia de vendedor registradas.
-- Não é necessário para voltar o código: a migration é aditiva e o código anterior (954ae68) convive com a tabela.
-- Aplicar via: node scripts/seguranca/com-banco-de-producao.mjs --confirmo=<ref> -- psql/cliente com este arquivo.
BEGIN;
DROP TABLE IF EXISTS "AutorizacaoDeMidiaDoVendedor";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261015010000_autorizacao_midia_vendedor';
COMMIT;
