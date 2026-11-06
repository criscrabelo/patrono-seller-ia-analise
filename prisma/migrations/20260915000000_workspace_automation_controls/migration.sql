-- Rodada 5: kill switch e modo de automação por workspace.
-- Default seguro: automação pausada (true) e modo MANUAL até a usuária
-- decidir ativar — nunca liga automação sozinha para workspace existente.
ALTER TABLE "Workspace" ADD COLUMN "automationPaused" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Workspace" ADD COLUMN "automationMode" TEXT NOT NULL DEFAULT 'MANUAL';
