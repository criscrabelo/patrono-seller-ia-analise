-- Rodada 8: job queue real (claim atômico + heartbeat), saúde do worker,
-- preferências globais do Digital Twin, retenção de prévias.

ALTER TABLE "DigitalTwinJob" ADD COLUMN "workerId" TEXT;
ALTER TABLE "DigitalTwinJob" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "DigitalTwinJob" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
CREATE INDEX "DigitalTwinJob_status_workerId_idx" ON "DigitalTwinJob"("status", "workerId");

CREATE TABLE "GenerationWorkerHealth" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "online" BOOLEAN NOT NULL DEFAULT true,
    "gpuDetected" BOOLEAN NOT NULL DEFAULT false,
    "gpuName" TEXT,
    "vramGB" DOUBLE PRECISION,
    "version" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GenerationWorkerHealth_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GenerationWorkerHealth_workerId_key" ON "GenerationWorkerHealth"("workerId");

ALTER TABLE "DigitalTwinProfile" ADD COLUMN "autoUseDigitalTwin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DigitalTwinProfile" ADD COLUMN "autoUseVoice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DigitalTwinProfile" ADD COLUMN "allowFallback" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DigitalTwinProfile" ADD COLUMN "priorityChannel" TEXT NOT NULL DEFAULT 'tiktok';
ALTER TABLE "DigitalTwinProfile" ADD COLUMN "defaultStyle" TEXT NOT NULL DEFAULT 'presenter';

ALTER TABLE "DigitalTwinAsset" ADD COLUMN "expiresAt" TIMESTAMP(3);
CREATE INDEX "DigitalTwinAsset_expiresAt_idx" ON "DigitalTwinAsset"("expiresAt");
