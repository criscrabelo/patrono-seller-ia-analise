-- P2.17 RELEASE CANDIDATE — desfaz as 10 migrations da P2.17 (todas aditivas: só tabelas novas e colunas
-- nessas tabelas novas). NÃO é necessário para voltar o código: o código de Production (31434fb) ignora
-- estas tabelas. Só use se a titular decidir APAGAR os dados novos (perde metas, resultados, assistidas,
-- mídias, vitrine, amostras e observações). Rodar via scripts/seguranca/com-banco-de-producao.mjs.
BEGIN;
DROP TABLE IF EXISTS "ObservacaoDeMercado";
DROP TABLE IF EXISTS "AmostraTikTokShop";
DROP TABLE IF EXISTS "VitrineTikTokShop";
DROP TABLE IF EXISTS "MidiaDoProduto";
DROP TABLE IF EXISTS "PublicacaoAssistida";
DROP TABLE IF EXISTS "HistoricoDadoDeProduto";
DROP TABLE IF EXISTS "DadoOficialDeProduto";
DROP TABLE IF EXISTS "AlteracaoMetaTikTok";
DROP TABLE IF EXISTS "SincronizacaoMetasTikTok";
DROP TABLE IF EXISTS "VideoTikTokResultado";
DROP TABLE IF EXISTS "MetaTikTokShop";
DELETE FROM "_prisma_migrations" WHERE migration_name IN (
  '20261011120000_metas_tiktok_shop', '20261011130000_metas_tiktok_campanha', '20261011140000_video_tiktok_resultado',
  '20261011150000_sincronizacao_metas_tiktok', '20261011160000_dados_oficiais_de_produto', '20261011170000_publicacao_assistida_e_resultados',
  '20261011180000_midia_do_produto', '20261012090000_vitrine_tiktok_shop', '20261012120000_gestor_de_vitrine', '20261013010000_amostras_e_observacoes'
);
COMMIT;
