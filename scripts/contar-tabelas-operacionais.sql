-- Contagem das tabelas que uma execução operacional pode tocar.
--
-- `AutomationJob` e `Conteudo` PODEM mudar numa operação interna — é o
-- trabalho que ela faz. As outras cinco não: `Publicacao`, `LinkDinamico`
-- e `EventoLink` só mudam quando algo vai ao ar ou alguém clica, e
-- `MLModel`/`MLTrainingRun` só mudam se o ML sair do shadow mode.
--
-- Separar as duas listas é o ponto: "mudou" não é o mesmo que "mudou
-- indevidamente".
--
-- SOMENTE LEITURA.

SELECT 'AutomationJob'  AS tabela, count(*) AS linhas, 'pode mudar'      AS esperado FROM "AutomationJob"
UNION ALL SELECT 'Conteudo',      count(*), 'pode mudar'      FROM "Conteudo"
UNION ALL SELECT 'Publicacao',    count(*), 'NAO pode mudar'  FROM "Publicacao"
UNION ALL SELECT 'LinkDinamico',  count(*), 'NAO pode mudar'  FROM "LinkDinamico"
UNION ALL SELECT 'EventoLink',    count(*), 'NAO pode mudar'  FROM "EventoLink"
UNION ALL SELECT 'MLModel',       count(*), 'NAO pode mudar'  FROM "MLModel"
UNION ALL SELECT 'MLTrainingRun', count(*), 'NAO pode mudar'  FROM "MLTrainingRun"
ORDER BY 1;
