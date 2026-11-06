-- ======================================================================
-- SOMAS DE VERIFICAÇÃO DO DADO — para comparar dois bancos
-- ======================================================================
-- Rodar contra origem e contra a restauração e comparar os hashes. Contagem
-- igual prova que nenhuma linha sumiu; hash igual prova que nenhum VALOR
-- mudou. São coisas diferentes, e a segunda é a que interessa depois de um
-- restore.
--
-- ── NENHUMA COLUNA SENSÍVEL É LIDA ────────────────────────────────────
-- De propósito, ficam de fora: `accessToken`, `refreshToken` e `extraData`
-- de `Integracao`, e `password` e `email` de `User`. O que sai daqui é
-- hash, não conteúdo — mas mesmo assim não há por que tocar nessas colunas.
--
-- ── SOMENTE LEITURA ───────────────────────────────────────────────────

SELECT 'User' AS tabela, count(*) AS linhas,
       coalesce(md5(string_agg("id" || '|' || "role" || '|' || "status", ',' ORDER BY "id")), '(vazia)') AS soma
  FROM "User"
UNION ALL
SELECT 'Produto', count(*),
       coalesce(md5(string_agg("id" || '|' || "nome" || '|' || "categoria" || '|' || coalesce("preco"::text,'-')
                    || '|' || "origemConteudo" || '|' || "tipoVenda" || '|' || "status", ',' ORDER BY "id")), '(vazia)')
  FROM "Produto"
UNION ALL
SELECT 'Conteudo', count(*),
       coalesce(md5(string_agg("id" || '|' || "userId" || '|' || "produtoId", ',' ORDER BY "id")), '(vazia)')
  FROM "Conteudo"
UNION ALL
SELECT 'LinkDinamico', count(*),
       coalesce(md5(string_agg("id" || '|' || "slug" || '|' || "urlDestino" || '|' || "plataforma"
                    || '|' || "cliques"::text || '|' || "conversoes"::text || '|' || "receitaTotal"::text,
                    ',' ORDER BY "id")), '(vazia)')
  FROM "LinkDinamico"
UNION ALL
SELECT 'EventoLink', count(*),
       coalesce(md5(string_agg("id" || '|' || "linkId" || '|' || "tipo", ',' ORDER BY "id")), '(vazia)')
  FROM "EventoLink"
UNION ALL
SELECT 'Integracao', count(*),
       coalesce(md5(string_agg("id" || '|' || "plataforma" || '|' || "status", ',' ORDER BY "id")), '(vazia)')
  FROM "Integracao"
ORDER BY 1;
