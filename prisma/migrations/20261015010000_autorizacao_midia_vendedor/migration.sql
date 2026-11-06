-- P2.18.10 — Autorização de mídia do vendedor. Aditiva: só cria uma tabela nova.
CREATE TABLE "AutorizacaoDeMidiaDoVendedor" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lojaChave" TEXT NOT NULL,
    "lojaId" TEXT,
    "lojaNome" TEXT NOT NULL,
    "vendedorNome" TEXT,
    "tipo" TEXT NOT NULL,
    "candidatoIds" TEXT[],
    "status" TEXT NOT NULL,
    "canaisPermitidos" TEXT[],
    "tiposDeMidia" TEXT[],
    "edicaoPermitida" BOOLEAN NOT NULL DEFAULT false,
    "cortesPermitidos" BOOLEAN NOT NULL DEFAULT false,
    "legendasPermitidas" BOOLEAN NOT NULL DEFAULT false,
    "ctaPermitido" BOOLEAN NOT NULL DEFAULT false,
    "usoComercialPermitido" BOOLEAN NOT NULL DEFAULT false,
    "textoDaAutorizacao" TEXT NOT NULL,
    "respostaDoVendedor" TEXT,
    "evidenciaUrl" TEXT,
    "dataSolicitacao" TIMESTAMP(3) NOT NULL,
    "dataAprovacao" TIMESTAMP(3),
    "dataRevogacao" TIMESTAMP(3),
    "validaAte" TIMESTAMP(3),
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutorizacaoDeMidiaDoVendedor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutorizacaoDeMidiaDoVendedor_workspaceId_lojaChave_idx" ON "AutorizacaoDeMidiaDoVendedor"("workspaceId", "lojaChave");
CREATE INDEX "AutorizacaoDeMidiaDoVendedor_workspaceId_status_idx" ON "AutorizacaoDeMidiaDoVendedor"("workspaceId", "status");

ALTER TABLE "AutorizacaoDeMidiaDoVendedor" ADD CONSTRAINT "AutorizacaoDeMidiaDoVendedor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nunca acessível pela API pública do Supabase.
ALTER TABLE "AutorizacaoDeMidiaDoVendedor" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AutorizacaoDeMidiaDoVendedor" FROM anon, authenticated;
