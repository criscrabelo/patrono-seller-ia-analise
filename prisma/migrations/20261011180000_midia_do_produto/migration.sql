-- P2.17.12 — Fonte única de mídia por produto + demonstração no modo assistido.

ALTER TABLE "PublicacaoAssistida" ADD COLUMN "demonstracao" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MidiaDoProduto" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "produtoId" TEXT,
    "candidatoId" TEXT,
    "nomeProduto" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "titularidade" TEXT NOT NULL,
    "direitoDeUso" TEXT NOT NULL,
    "evidencia" JSONB,
    "status" TEXT NOT NULL,
    "motivoStatus" TEXT NOT NULL,
    "declaradoPor" TEXT,
    "declaradoEm" TIMESTAMP(3),
    "demonstracao" BOOLEAN NOT NULL DEFAULT false,
    "usos" INTEGER NOT NULL DEFAULT 0,
    "ultimoUsoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MidiaDoProduto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MidiaDoProduto_workspaceId_url_key" ON "MidiaDoProduto"("workspaceId", "url");
CREATE INDEX "MidiaDoProduto_workspaceId_produtoId_idx" ON "MidiaDoProduto"("workspaceId", "produtoId");
CREATE INDEX "MidiaDoProduto_workspaceId_candidatoId_idx" ON "MidiaDoProduto"("workspaceId", "candidatoId");
ALTER TABLE "MidiaDoProduto" ADD CONSTRAINT "MidiaDoProduto_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MidiaDoProduto" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MidiaDoProduto" FROM anon, authenticated;
