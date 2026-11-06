-- P2.18 — Limite de tentativas de acesso. Aditiva: só cria uma tabela nova.
CREATE TABLE "TentativaDeAcesso" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "sucesso" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TentativaDeAcesso_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TentativaDeAcesso_chave_tipo_criadoEm_idx" ON "TentativaDeAcesso"("chave", "tipo", "criadoEm");
CREATE INDEX "TentativaDeAcesso_criadoEm_idx" ON "TentativaDeAcesso"("criadoEm");

-- Nunca acessível pela API pública do Supabase.
ALTER TABLE "TentativaDeAcesso" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "TentativaDeAcesso" FROM anon, authenticated;
