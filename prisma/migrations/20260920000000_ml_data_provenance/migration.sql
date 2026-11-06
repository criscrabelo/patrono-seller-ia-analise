-- Correção pós-aprovação do complemento ML: proveniência dos dados
-- (MLDataOrigin). Nenhum dado de teste/fixture/demo/seed pode contar para
-- o MLReadinessGate de produção nem promover um MLModel a ACTIVE. Colunas
-- adicionadas com DEFAULT só para não quebrar linhas já existentes desta
-- sessão de desenvolvimento — o Prisma Client (schema.prisma) declara o
-- campo como obrigatório, então todo código novo precisa declarar
-- explicitamente a origem, nunca depender do default do banco.

ALTER TABLE "MLTrainingRun" ADD COLUMN "dataOrigin" TEXT NOT NULL DEFAULT 'TEST_FIXTURE';
ALTER TABLE "MLModel" ADD COLUMN "dataOrigin" TEXT NOT NULL DEFAULT 'TEST_FIXTURE';
ALTER TABLE "MLFeatureSnapshot" ADD COLUMN "dataOrigin" TEXT NOT NULL DEFAULT 'TEST_FIXTURE';

ALTER TABLE "MLTrainingRun" ALTER COLUMN "dataOrigin" DROP DEFAULT;
ALTER TABLE "MLModel" ALTER COLUMN "dataOrigin" DROP DEFAULT;
ALTER TABLE "MLFeatureSnapshot" ALTER COLUMN "dataOrigin" DROP DEFAULT;
