-- Rollback OPCIONAL do banco do pacote P2.19–P2.28 (+ P2.29). Só por decisão expressa da titular.
-- APAGA os dados que só o pacote grava: importações e pedidos do Creator Center (e o histórico deles), alertas
-- de redução de comissão, estado da conta/quotas/versões de regra, execuções do processador e da reconciliação,
-- histórico de comissão, DNA criativo dos resultados e o estado de processamento dos eventos.
-- NÃO é necessário para voltar o código: todas as migrations são aditivas e o código anterior (2180ecf/954ae68)
-- convive com elas (ensaio P2.29: suíte inteira do 2180ecf 2827/2827 contra o banco migrado).
-- NÃO desfaz o que o código novo já mudou em linhas antigas (ex.: Commission.status = 'REVERSED', publicação que
-- a reconciliação voltou para APROVADO): isso fica no histórico/auditoria, não aqui.
-- A 20261015010000_autorizacao_midia_vendedor é do RC 2180ecf: tem rollback próprio (P2.18.10-...down.sql).
-- Aplicar via: node scripts/seguranca/com-banco-de-producao.mjs --confirmo=<ref> -- <cliente psql> -f este arquivo.
BEGIN;
-- P2.29 (só RLS/REVOKE): nada a desfazer — desligar RLS reabriria as tabelas; elas somem abaixo.
-- P2.25
DROP TABLE IF EXISTS "HistoricoDeComissao";
-- P2.22
DROP TABLE IF EXISTS "ExecucaoDoProcessador";
DROP INDEX IF EXISTS "DomainEvent_estadoProcessamento_proximaTentativaEm_idx";
ALTER TABLE "DomainEvent" DROP COLUMN IF EXISTS "causadoPorEventoId", DROP COLUMN IF EXISTS "erroProcessamento",
  DROP COLUMN IF EXISTS "estadoProcessamento", DROP COLUMN IF EXISTS "processandoAte", DROP COLUMN IF EXISTS "processandoPor",
  DROP COLUMN IF EXISTS "profundidade", DROP COLUMN IF EXISTS "proximaTentativaEm", DROP COLUMN IF EXISTS "resultadoProcessamento",
  DROP COLUMN IF EXISTS "tentativas", DROP COLUMN IF EXISTS "ultimaTentativaEm";
-- P2.21
ALTER TABLE "VideoTikTokResultado" DROP COLUMN IF EXISTS "confiancaDoGancho", DROP COLUMN IF EXISTS "formatoDoConteudo",
  DROP COLUMN IF EXISTS "metodoDoGancho", DROP COLUMN IF EXISTS "origemDaMidia", DROP COLUMN IF EXISTS "origemDoDna",
  DROP COLUMN IF EXISTS "temDemonstracao", DROP COLUMN IF EXISTS "temNarracao", DROP COLUMN IF EXISTS "temRosto",
  DROP COLUMN IF EXISTS "temTextoNaTela", DROP COLUMN IF EXISTS "tipoDeCta", DROP COLUMN IF EXISTS "tipoDeGancho",
  DROP COLUMN IF EXISTS "tipoDeMidia", DROP COLUMN IF EXISTS "versaoDoDna";
-- P2.20
DROP TABLE IF EXISTS "VersaoDeRegraDePlataforma";
DROP TABLE IF EXISTS "ConsumoDeCota";
DROP TABLE IF EXISTS "ContadorDeCotaDiaria";
DROP TABLE IF EXISTS "EstadoDaContaNaPlataforma";
-- P2.19 (as vendas/comissões espelhadas da importação ficam em Sale/Commission, que são do núcleo)
DROP TABLE IF EXISTS "AlertaReducaoComissao";
DROP TABLE IF EXISTS "HistoricoPedidoAfiliadoTikTok";
DROP TABLE IF EXISTS "PedidoAfiliadoTikTok";
DROP TABLE IF EXISTS "ImportacaoCreatorCenter";
DELETE FROM "_prisma_migrations" WHERE migration_name IN (
  '20261017090000_p229_rls_explicito', '20261016200000_p225_historico_de_comissao', '20261016150000_p222_processador_de_eventos',
  '20261016090000_p221_dna_criativo', '20261015180000_p220_estado_da_conta_e_cotas', '20261015130000_p219_auditoria_e_alerta_comissao',
  '20261015120000_importacao_creator_center');
COMMIT;
