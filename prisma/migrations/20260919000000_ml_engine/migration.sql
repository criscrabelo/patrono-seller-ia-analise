-- Rodada 9 (complemento) — Machine Learning Real: MLTrainingRun, MLModel,
-- MLPrediction, MLFeatureSnapshot, CreativeExperiment. Todos escopados por
-- workspaceId (regra 39) — nenhum modelo/feature global nesta rodada.

CREATE TABLE "MLTrainingRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "modelFamily" TEXT NOT NULL,
    "datasetVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "sampleCount" INTEGER NOT NULL,
    "featureNames" TEXT[],
    "metrics" JSONB,
    "baselineMetrics" JSONB,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MLTrainingRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MLTrainingRun_workspaceId_modelFamily_idx" ON "MLTrainingRun"("workspaceId", "modelFamily");
ALTER TABLE "MLTrainingRun" ADD CONSTRAINT "MLTrainingRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MLModel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "trainingRunId" TEXT,
    "trainingDate" TIMESTAMP(3) NOT NULL,
    "trainingDatasetVersion" TEXT NOT NULL,
    "features" TEXT[],
    "metrics" JSONB NOT NULL,
    "baselineMetrics" JSONB,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "artifactPath" TEXT,
    "artifact" JSONB,
    "promotedAt" TIMESTAMP(3),
    "deprecatedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MLModel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MLModel_workspaceId_family_version_key" ON "MLModel"("workspaceId", "family", "version");
CREATE INDEX "MLModel_workspaceId_family_status_idx" ON "MLModel"("workspaceId", "family", "status");
ALTER TABLE "MLModel" ADD CONSTRAINT "MLModel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MLModel" ADD CONSTRAINT "MLModel_trainingRunId_fkey" FOREIGN KEY ("trainingRunId") REFERENCES "MLTrainingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MLPrediction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "modelRowId" TEXT,
    "modelFamily" TEXT,
    "modelVersion" INTEGER,
    "decisionType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "inputFeatures" JSONB NOT NULL,
    "predictedConversionProbability" DOUBLE PRECISION,
    "expectedCommissionValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MLPrediction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MLPrediction_workspaceId_entityType_idx" ON "MLPrediction"("workspaceId", "entityType");
CREATE INDEX "MLPrediction_workspaceId_modelRowId_idx" ON "MLPrediction"("workspaceId", "modelRowId");
ALTER TABLE "MLPrediction" ADD CONSTRAINT "MLPrediction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MLPrediction" ADD CONSTRAINT "MLPrediction_modelRowId_fkey" FOREIGN KEY ("modelRowId") REFERENCES "MLModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MLFeatureSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "featureVersion" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "label" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "labeledAt" TIMESTAMP(3),
    CONSTRAINT "MLFeatureSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MLFeatureSnapshot_workspaceId_entityType_idx" ON "MLFeatureSnapshot"("workspaceId", "entityType");
ALTER TABLE "MLFeatureSnapshot" ADD CONSTRAINT "MLFeatureSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CreativeExperiment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "variantA" JSONB NOT NULL,
    "variantB" JSONB NOT NULL,
    "assignmentStrategy" TEXT NOT NULL DEFAULT 'EPSILON_GREEDY',
    "epsilon" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "assignments" JSONB[] DEFAULT ARRAY[]::JSONB[],
    "resultsA" JSONB,
    "resultsB" JSONB,
    "winner" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concludedAt" TIMESTAMP(3),
    CONSTRAINT "CreativeExperiment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CreativeExperiment_workspaceId_status_idx" ON "CreativeExperiment"("workspaceId", "status");
ALTER TABLE "CreativeExperiment" ADD CONSTRAINT "CreativeExperiment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
