-- P2.29 — RLS explícito nas tabelas criadas pelas migrations P2.20, P2.22 e P2.25.
-- Elas não traziam ENABLE ROW LEVEL SECURITY / REVOKE: no banco de TESTE estavam protegidas só pelo gatilho
-- `ensure_rls` e pelos privilégios padrão do projeto Supabase. O pacote não pode depender disso em outro banco.
-- Não muda esquema nem dados; é idempotente (pode rodar de novo sem efeito). O app usa o papel do dono (Prisma),
-- que não passa por RLS: nada muda para o app.
ALTER TABLE "EstadoDaContaNaPlataforma" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "EstadoDaContaNaPlataforma" FROM anon, authenticated;
ALTER TABLE "ContadorDeCotaDiaria" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ContadorDeCotaDiaria" FROM anon, authenticated;
ALTER TABLE "ConsumoDeCota" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ConsumoDeCota" FROM anon, authenticated;
ALTER TABLE "VersaoDeRegraDePlataforma" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "VersaoDeRegraDePlataforma" FROM anon, authenticated;
ALTER TABLE "ExecucaoDoProcessador" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ExecucaoDoProcessador" FROM anon, authenticated;
ALTER TABLE "HistoricoDeComissao" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "HistoricoDeComissao" FROM anon, authenticated;
