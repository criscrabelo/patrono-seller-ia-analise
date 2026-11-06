-- Rodada 9: worker pairing (token escopado por workspace), terceiro kill
-- switch (workerPaused), aprovação de voz separada, tipo de job.

CREATE TABLE "WorkerToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "WorkerToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkerToken_tokenHash_key" ON "WorkerToken"("tokenHash");
CREATE INDEX "WorkerToken_workspaceId_idx" ON "WorkerToken"("workspaceId");
ALTER TABLE "WorkerToken" ADD CONSTRAINT "WorkerToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DigitalTwinProfile" ADD COLUMN "workerPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DigitalTwinProfile" ADD COLUMN "voiceApprovedAt" TIMESTAMP(3);

ALTER TABLE "DigitalTwinJob" ADD COLUMN "jobType" TEXT NOT NULL DEFAULT 'AVATAR_PREVIEW';
