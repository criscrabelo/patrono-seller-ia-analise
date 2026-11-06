-- Rollback da P2.18 (limite de tentativas). Apaga só o histórico de tentativas.
DROP TABLE IF EXISTS "TentativaDeAcesso";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261013120000_tentativas_de_acesso';
