-- Rodada 7: persistência real das fundações do Digital Twin (Rodada 6).
-- Todas as tabelas escopadas por workspaceId; ownerUserId/subjectUserId
-- gravados como texto simples (mesmo padrão de Workspace.ownerId), sem FK.

CREATE TABLE "IdentityConsent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "status" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IdentityConsent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VoiceConsent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "status" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VoiceConsent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VoiceProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "consentId" TEXT,
    "provider" TEXT,
    "modelVersion" TEXT,
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VoiceProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DigitalTwinProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "identityConsentId" TEXT,
    "voiceProfileId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DigitalTwinProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DigitalTwinAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "purpose" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DigitalTwinAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DigitalTwinJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "contentId" TEXT,
    "resultAssetId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DigitalTwinJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DigitalTwinProfile_workspaceId_key" ON "DigitalTwinProfile"("workspaceId");
CREATE INDEX "IdentityConsent_workspaceId_idx" ON "IdentityConsent"("workspaceId");
CREATE INDEX "VoiceConsent_workspaceId_idx" ON "VoiceConsent"("workspaceId");
CREATE INDEX "VoiceProfile_workspaceId_idx" ON "VoiceProfile"("workspaceId");
CREATE INDEX "DigitalTwinAsset_workspaceId_profileId_idx" ON "DigitalTwinAsset"("workspaceId", "profileId");
CREATE INDEX "DigitalTwinJob_workspaceId_status_idx" ON "DigitalTwinJob"("workspaceId", "status");

ALTER TABLE "IdentityConsent" ADD CONSTRAINT "IdentityConsent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoiceConsent" ADD CONSTRAINT "VoiceConsent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoiceProfile" ADD CONSTRAINT "VoiceProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DigitalTwinProfile" ADD CONSTRAINT "DigitalTwinProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DigitalTwinAsset" ADD CONSTRAINT "DigitalTwinAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DigitalTwinAsset" ADD CONSTRAINT "DigitalTwinAsset_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "DigitalTwinProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DigitalTwinJob" ADD CONSTRAINT "DigitalTwinJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DigitalTwinJob" ADD CONSTRAINT "DigitalTwinJob_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "DigitalTwinProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
