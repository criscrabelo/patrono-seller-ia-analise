-- P1.0 Etapa 2.b — Publicacao como entidade propria de distribuicao real.
--
-- NAO APLICADA. Este arquivo esta aqui para revisao; nenhum banco recebeu
-- estas instrucoes ainda.
--
-- ── O QUE MUDA ──────────────────────────────────────────────────────────
-- A cadeia passa a ser explicita:
--
--   Conteudo -> Publicacao -> LinkDinamico -> EventoLink
--   LinkDinamico -> Produto        (o destino continua sendo o produto)
--
-- Ate aqui a ligacao publicacao->link era DERIVADA do slug (Etapa 2.a), que
-- e deterministico mas depende de recalcular a chave da tentativa. Com a
-- tabela, a relacao passa a ser um fato gravado.
--
-- ── PURAMENTE ADITIVA ───────────────────────────────────────────────────
-- Nenhuma coluna existente e removida, renomeada, alterada de tipo ou
-- promovida a NOT NULL. Nenhuma linha existente muda de significado.
-- `LinkDinamico.publicacaoId` nasce NULAVEL e continua nulo em todos os
-- links que ja existem. Nenhum UPDATE e executado.
--
-- ── SEM BACKFILL, E ISSO E DELIBERADO ───────────────────────────────────
-- Nenhuma Publicacao e criada para conteudo antigo. O banco atual nao
-- consegue provar quantas vezes um conteudo foi publicado, em que canal de
-- cada vez, nem qual link pertenceu a qual publicacao. Derivar isso do slug
-- produziria um historico plausivel e falso. Conteudo antigo fica sem
-- Publicacao — o registro honesto de que a informacao nao existe.
--
-- ── ENUM EM VEZ DE CHECK ────────────────────────────────────────────────
-- `estado` e um tipo nativo do Postgres, e nao TEXT com CHECK. O motivo e
-- exatamente o que voce levantou: um CHECK escrito a mao fica fora do
-- gerenciamento do Prisma e desapareceria num `migrate reset`, virando
-- divergencia silenciosa entre ambientes. O enum o Prisma gerencia.
--
-- Aqui ele e barato porque a TABELA E NOVA: nenhuma linha precisa ser
-- convertida, nenhum dado antigo pode violar o tipo.
--
-- O que o enum garante e o VOCABULARIO, nao a maquina de estados. Gravar
-- 'PUBLICADA' passa a ser impossivel; impedir DISTRIBUIDA vindo de REMOVIDA
-- continua sendo trabalho de `validarTransicao()`, no contrato, que tem
-- teste. As duas defesas se somam, nenhuma substitui a outra.
--
-- PRECO A ASSUMIR: acrescentar um estado novo no futuro exige
-- `ALTER TYPE "EstadoDaPublicacao" ADD VALUE '...'` numa migration. No
-- PG12+ isso roda dentro de transacao desde que o valor novo nao seja usado
-- na mesma transacao. O Prisma gera esse ALTER sozinho.
--
-- `dataOrigin` NAO virou enum de proposito: ela compartilha vocabulario com
-- Sale.dataOrigin e Commission, que sao TEXT. Converter so esta fragmentaria
-- o vocabulario da proveniencia em dois tipos diferentes.
--
-- ── SOBRE AS UNIQUE COM COLUNA NULAVEL ──────────────────────────────────
-- Duas constraints dependem da semantica NULLS DISTINCT do Postgres, que e
-- o padrao:
--
--   "Publicacao_workspaceId_provider_publicacaoExternaId_key"
--     vale SOMENTE quando ha id externo. Varias publicacoes com
--     publicacaoExternaId NULL (manual, provider sem id, processamento em
--     curso) convivem sem conflito, e duas publicacoes que apontem para o
--     MESMO post do MESMO provider sao recusadas. E o efeito de um indice
--     parcial `WHERE "publicacaoExternaId" IS NOT NULL`, sem precisar de
--     SQL fora do schema — e por isso preferimos a constraint declarada,
--     que o Prisma conhece e nao acusa drift.
--
--   "LinkDinamico_publicacaoId_workspaceId_key"
--     mesma logica: varios links sem publicacao (os 18 por produto da tela
--     "Meus Links") convivem; um segundo link para a MESMA publicacao e
--     recusado. Ver o bloco seguinte sobre por que UM indice basta.
--
-- ATENCAO ao operar: se um dia estas constraints forem recriadas com
-- `NULLS NOT DISTINCT` (PG15+), viram outra coisa. Nao mude sem revisar.
--
-- ── POR QUE UM INDICE SO EM LinkDinamico ────────────────────────────────
-- A versao anterior desta proposta tinha DOIS: UNIQUE(publicacaoId) e
-- UNIQUE(publicacaoId, workspaceId). O primeiro era redundante.
--
-- O composto sozinho ja garante "no maximo um link por publicacao", e a
-- prova depende da FK composta logo abaixo: se L1 e L2 apontam para a mesma
-- Publicacao P, a FK obriga os dois a terem o workspaceId de P. Entao o par
-- (publicacaoId, workspaceId) seria identico nos dois, e a UNIQUE recusa o
-- segundo. Com publicacaoId NULL a FK nao e checada, a UNIQUE ve NULL e
-- permite quantos houver — que e o desejado.
--
-- ── ISOLAMENTO MULTI-WORKSPACE NO BANCO ─────────────────────────────────
-- As duas FKs novas sao COMPOSTAS, incluindo workspaceId:
--
--   Publicacao(contentId, workspaceId)      -> Conteudo(id, workspaceId)
--   LinkDinamico(publicacaoId, workspaceId) -> Publicacao(id, workspaceId)
--
-- Assim o banco RECUSA uma publicacao do workspace A apontando para
-- conteudo do B, e um link do A apontando para publicacao do B. Ate hoje
-- esse isolamento dependia de todo caminho de escrita lembrar de conferir;
-- agora e defesa estrutural.
--
-- Cada FK composta exige UNIQUE no lado REFERENCIADO, e as duas estao
-- criadas abaixo: "Conteudo_id_workspaceId_key" e
-- "Publicacao_id_workspaceId_key". Elas sao redundantes com a PK sozinha e
-- existem exclusivamente para servir de alvo.
--
-- ON DELETE RESTRICT em LinkDinamico_publicacaoId: apagar uma Publicacao
-- que ainda tem link e recusado, em vez de orfanar o link em silencio.

-- ── 1. O vocabulario dos estados, no banco ──────────────────────────────
CREATE TYPE "EstadoDaPublicacao" AS ENUM ('PREPARADA', 'DISTRIBUINDO', 'DISTRIBUIDA', 'FALHOU', 'REMOVIDA');

-- ── 2. A coluna de ligacao, opcional ────────────────────────────────────
ALTER TABLE "LinkDinamico" ADD COLUMN     "publicacaoId" TEXT;

-- ── 3. A tabela ─────────────────────────────────────────────────────────
CREATE TABLE "Publicacao" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "chaveDaTentativa" TEXT NOT NULL,
    "estado" "EstadoDaPublicacao" NOT NULL DEFAULT 'PREPARADA',
    "publicacaoExternaId" TEXT,
    "distribuidaEm" TIMESTAMP(3),
    "evidencia" JSONB,
    "dataOrigin" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publicacao_pkey" PRIMARY KEY ("id")
);

-- ── 4. Indices de consulta ──────────────────────────────────────────────
CREATE INDEX "Publicacao_workspaceId_estado_idx" ON "Publicacao"("workspaceId", "estado");

CREATE INDEX "Publicacao_workspaceId_contentId_createdAt_idx" ON "Publicacao"("workspaceId", "contentId", "createdAt");

-- ── 5. Alvos das FKs compostas ──────────────────────────────────────────
CREATE UNIQUE INDEX "Publicacao_id_workspaceId_key" ON "Publicacao"("id", "workspaceId");

CREATE UNIQUE INDEX "Conteudo_id_workspaceId_key" ON "Conteudo"("id", "workspaceId");

-- ── 6. Idempotencia PRIMARIA — sempre existe ────────────────────────────
-- Retry reenvia a mesma chave e reencontra esta linha; republicacao gera
-- outra chave e nasce como outra Publicacao. E o que separa os dois casos.
CREATE UNIQUE INDEX "Publicacao_workspaceId_chaveDaTentativa_key" ON "Publicacao"("workspaceId", "chaveDaTentativa");

-- ── 7. Idempotencia EXTERNA — so quando ha id do provider ───────────────
-- Protege o caso oposto: o mesmo post chegando duas vezes (webhook
-- reentregue, adapter reprocessado) sob chaves de tentativa diferentes.
--
-- PREMISSA: o identificador externo e unico DENTRO daquele provider. Vale
-- para os providers em jogo (media id da Meta, video id do TikTok sao
-- globais na plataforma), inclusive quando o mesmo workspace conecta duas
-- contas do mesmo provider.
--
-- LIMITACAO REGISTRADA: um provider cujo id so seja unico por conta/loja
-- quebraria a premissa — duas contas poderiam repetir o mesmo numero. Nao
-- criamos coluna de conta agora porque nenhum provider atual precisa dela;
-- quando precisar, a chave passa a incluir a conta, e isto aqui e o aviso
-- de onde mexer.
CREATE UNIQUE INDEX "Publicacao_workspaceId_provider_publicacaoExternaId_key" ON "Publicacao"("workspaceId", "provider", "publicacaoExternaId");

-- ── 8. Um link por publicacao, no maximo ────────────────────────────────
CREATE UNIQUE INDEX "LinkDinamico_publicacaoId_workspaceId_key" ON "LinkDinamico"("publicacaoId", "workspaceId");

-- ── 9. As relacoes ──────────────────────────────────────────────────────
ALTER TABLE "LinkDinamico" ADD CONSTRAINT "LinkDinamico_publicacaoId_workspaceId_fkey" FOREIGN KEY ("publicacaoId", "workspaceId") REFERENCES "Publicacao"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Publicacao" ADD CONSTRAINT "Publicacao_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Publicacao" ADD CONSTRAINT "Publicacao_contentId_workspaceId_fkey" FOREIGN KEY ("contentId", "workspaceId") REFERENCES "Conteudo"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
