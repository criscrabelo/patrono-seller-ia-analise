-- P2.20 — estado da conta na plataforma, contador diário de quota, consumo por ação e versões das regras. Aditiva (só tabelas novas).
-- CreateTable
CREATE TABLE "EstadoDaContaNaPlataforma" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "plataforma" TEXT NOT NULL,
    "conta" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "programa" TEXT NOT NULL,
    "participacao" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "regiao" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "statusDaConta" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "elegibilidade" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "regraDaQuota" TEXT,
    "quotaDiaria" INTEGER,
    "origem" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "dataDaFonte" TIMESTAMP(3),
    "verificadaEm" TIMESTAMP(3),
    "confianca" TEXT NOT NULL DEFAULT 'BAIXA',
    "observacoes" TEXT,
    "revisarEm" TIMESTAMP(3),
    "expiraEm" TIMESTAMP(3),
    "historico" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstadoDaContaNaPlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContadorDeCotaDiaria" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "plataforma" TEXT NOT NULL,
    "regra" TEXT NOT NULL,
    "programa" TEXT NOT NULL,
    "dia" TEXT NOT NULL,
    "usado" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContadorDeCotaDiaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumoDeCota" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "plataforma" TEXT NOT NULL,
    "regra" TEXT NOT NULL,
    "programa" TEXT NOT NULL,
    "dia" TEXT NOT NULL,
    "acaoId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'RESERVADA',
    "limiteNaHora" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsumoDeCota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersaoDeRegraDePlataforma" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "regraId" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "dados" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VersaoDeRegraDePlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EstadoDaContaNaPlataforma_workspaceId_plataforma_programa_key" ON "EstadoDaContaNaPlataforma"("workspaceId", "plataforma", "programa");

-- CreateIndex
CREATE UNIQUE INDEX "ContadorDeCotaDiaria_workspaceId_plataforma_regra_programa__key" ON "ContadorDeCotaDiaria"("workspaceId", "plataforma", "regra", "programa", "dia");

-- CreateIndex
CREATE INDEX "ConsumoDeCota_workspaceId_dia_idx" ON "ConsumoDeCota"("workspaceId", "dia");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumoDeCota_workspaceId_regra_acaoId_key" ON "ConsumoDeCota"("workspaceId", "regra", "acaoId");

-- CreateIndex
CREATE INDEX "VersaoDeRegraDePlataforma_workspaceId_regraId_idx" ON "VersaoDeRegraDePlataforma"("workspaceId", "regraId");

-- CreateIndex
CREATE UNIQUE INDEX "VersaoDeRegraDePlataforma_workspaceId_regraId_versao_key" ON "VersaoDeRegraDePlataforma"("workspaceId", "regraId", "versao");

-- AddForeignKey
ALTER TABLE "EstadoDaContaNaPlataforma" ADD CONSTRAINT "EstadoDaContaNaPlataforma_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContadorDeCotaDiaria" ADD CONSTRAINT "ContadorDeCotaDiaria_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoDeCota" ADD CONSTRAINT "ConsumoDeCota_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersaoDeRegraDePlataforma" ADD CONSTRAINT "VersaoDeRegraDePlataforma_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

