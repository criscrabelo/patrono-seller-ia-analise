# TikTok — Integração Real (Patrono Seller)

**Criado:** Rodada 6 — TikTok First: Primeira Integração Real.

TikTok/TikTok Shop é a prioridade estratégica nº 1 do Patrono Seller. Este documento registra a integração real (não mais só arquitetura/prevalidação) construída nesta rodada: OAuth, escopos, creator info, preflight dinâmico, Direct Post (vídeo e foto), status/webhook, modo de teste privado, e o estado real do TikTok Shop Affiliate.

## 1. Duas integrações, sempre separadas

- **`TikTokChannel`** (`lib/tiktok-oauth.ts`, `lib/tiktok-channel.ts`, `lib/tiktok-preflight.ts`, `lib/tiktok-privacy.ts`, `lib/tiktok-upload.ts`, `lib/tiktok-retry.ts`, `lib/tiktok-rate-limiter.ts`, `lib/tiktok-webhook.ts`): autorização da conta, creator info, criação/publicação de vídeo e foto, status, métricas, consentimento, disclosure, validação técnica.
- **`TikTokShopAffiliateProvider`** (`lib/tiktok-shop-provider.ts`): perfil de afiliada/creator, oportunidades de produto, colaboração, showcase, links, pedidos, comissões — só onde a API oficial e nossa conta tiverem acesso.

**Nunca** o mesmo token/escopo entre as duas. `TikTokShopToken` distingue explicitamente `creator`/`seller`/`partner` (`exigirTipoDeToken()` lança erro se alguém tentar usar um no lugar do outro).

## 2. OAuth real do TikTok Channel

`lib/tiktok-oauth.ts`. Fluxo padrão Authorization Code:

1. `GET /api/integracoes/tiktok/oauth/start` — gera `state` assinado (HMAC, TTL 10min, amarrado ao `workspaceId`) e redireciona para `https://www.tiktok.com/v2/auth/authorize/`.
2. TikTok redireciona de volta para `GET /api/integracoes/tiktok/oauth/callback` com `code`+`state`.
3. `validarState()` confere assinatura e validade — nunca aceita `state` que não foi gerado por nós.
4. `trocarCodigoPorToken()` troca o code por `access_token`/`refresh_token`/`expires_in`/`open_id`/`scope`.
5. Tokens são persistidos em `Integracao` (mesma tabela do Instagram/Shopee — nenhuma tabela nova), `plataforma = 'tiktok'`, `accountId = open_id`.
6. `lib/tiktok-token-store.ts` (`obterTikTokTokenValido()`) renova automaticamente via `refresh_token` quando o `access_token` expira — nunca pede novo consentimento à toa.

**Secrets:** `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` — só no servidor, nunca `NEXT_PUBLIC_`. Access/refresh token nunca vão para o browser/localStorage — ficam em `Integracao.accessToken`/`refreshToken` (coluna já existente, texto no Postgres da própria stack).

## 3. Escopos

| Escopo | Finalidade | Por que precisamos | Tela/recurso |
|---|---|---|---|
| `video.publish` | Direct Post de vídeo/foto | É o escopo oficial mínimo para publicar conteúdo diretamente na conta da criadora | Autopilot → publicação no TikTok; tela de Integrações (status "pronto para postar") |

Nenhum outro escopo é solicitado nesta rodada. Se/quando Upload/Draft for implementado, o escopo oficial correspondente será documentado aqui antes de ser pedido.

## 4. Estados de configuração (tela de Integrações)

`lib/tiktok-config-status.ts`, `calcularStatusConfiguracaoTikTok()`: `NAO_CONFIGURADO` → `AUTORIZACAO_NECESSARIA` → (`ESCOPO_PENDENTE` se faltar escopo) → `PRONTO_PARA_POSTAGEM_PRIVADA` (app não auditado) ou `PRONTO_PARA_POSTAGEM_PUBLICA` (app auditado) — mais `TOKEN_EXPIRADO` e `ERRO`. **Nunca mostra "Conectado" só porque existem client credentials** — precisa de token real e válido.

## 5. Creator Info real

`consultarCreatorInfo()` (`lib/tiktok-channel.ts`) chama `POST /v2/post/publish/creator_info/query/` com o access token da conta. Devolve `username`, `nickname`, `privacy_level_options`, `comment_disabled`, `duet_disabled`, `stitch_disabled`, `max_video_post_duration_sec` — **nunca hardcodado**. Campo ausente na resposta vira `'unknown'`, nunca um valor inventado.

## 6. Preflight dinâmico

`lib/tiktok-preflight.ts`:
- `validarPreflightDinamico(creatorInfo, content)` — valida duração vs. `max_video_post_duration_sec`, privacidade vs. `privacidadeOpcoesPermitidas`, comentários/duet/stitch vs. o que a conta permite. `creatorInfo` com campo `'unknown'` nunca é tratado como "sem limite" — vira `NOT_VERIFIED`.
- `TikTokPreflightLive` — implementação real da interface `TikTokPreflightValidator`, usada quando há token ativo.
- `PREVALIDATED_FOR_TIKTOK` (nossa pré-validação) nunca é confundido com `ACCEPTED_BY_TIKTOK` (resposta real da API).

## 7. Consentimento explícito (mínima intervenção)

`tiktokHumanConsentGate()` — o Patrono faz sozinho: encontrar produto, gerar vídeo/legenda/hashtags, disclosure, validar mídia, consultar creator info, preparar privacidade, validar tudo. Só então, quando a API exige, mostra: **"Conteúdo pronto. Autorizar publicação no TikTok."** Nunca um fluxo manual maior que isso.

### Não perguntar o que já pode decidir

`lib/tiktok-privacy.ts`, `resolverPrivacidadeTikTok()`: usa a preferência já configurada pela usuária automaticamente enquanto ela continuar válida para a conta. Só interrompe quando a própria API exige escolha, a preferência não é mais válida, há risco de compliance, ou é exigido consentimento explícito.

## 8. Direct Post — vídeo real

`TikTokPublisher.publicar()` (`lib/tiktok-channel.ts`): 1) Query Creator Info → 2) Initialize Direct Post (`POST /v2/post/publish/video/init/`) → 3) Upload (`PULL_FROM_URL` ou `FILE_UPLOAD`) → 4) acompanhar processamento → 5) registrar `publish_id` → 6) consultar status (`POST /v2/post/publish/status/fetch/`). **Nunca marcado como publicado no `init`** — só `ACCEPTED_BY_TIKTOK` depois do status real.

### Upload de arquivo (`FILE_UPLOAD`)

`lib/tiktok-upload.ts`, `planejarChunks()`/`enviarArquivoEmChunks()` — chunking oficial (5MB-64MB por pedaço, `Content-Range` por PUT). Nunca um único POST com o vídeo inteiro no corpo.

### Pull From URL

Usado quando a mídia já está hospedada (Supabase Storage, `lib/renderer-ffmpeg.ts` → `uploadBuffer`). Antes de usar, confirmar: domínio/URL verificado conforme exigência TikTok, arquivo acessível, media rights válidos, URL não expira antes da ingestão. Nunca assumir que qualquer URL pública é aceita.

## 9. Photo Post

`TikTokPublisher.publicarFotos()` — mesma Content Posting API, `media_type: PHOTO`. Suporta uma ou várias fotos, `coverIndex`, `description`, `privacyLevel`, `autoAddMusic`. Base real para Carrossel/Photo Post automático no TikTok.

## 10. Status e Webhook

`statusPublicacao()` mapeia os estados oficiais (`PUBLISH_COMPLETE` → `ACCEPTED_BY_TIKTOK`, `FAILED` → `REJECTED_BY_TIKTOK`, `PROCESSING_*`/`SEND_TO_USER_INBOX` → `PUBLISHING`). Um timeout do nosso polling **nunca** vira falha definitiva sozinho.

`lib/tiktok-webhook.ts` + `POST /api/webhooks/tiktok`: verifica assinatura HMAC (`TikTok-Signature`/`TikTok-Timestamp`), janela de replay de 5 minutos, e idempotência por evento (`event:user_openid:create_time`) — nunca processa o mesmo evento duas vezes, nunca confia em payload sem assinatura válida.

## 11. Retry e Rate Limit

`lib/tiktok-retry.ts` — nunca republica um post já `ACCEPTED_BY_TIKTOK`/`PUBLISHING` (usa `publish_id` como chave de idempotência); retry só para falha de rede/processamento, com backoff exponencial.

`lib/tiktok-rate-limiter.ts` — janela deslizante local, sem serviço pago; limite interno de segurança, nunca descrito como limite da plataforma.

## 12. App não auditado

`lib/tiktok-privacy.ts` — enquanto o app não estiver auditado, a única privacidade aceitável é privada (`PRIVATE_TESTING_ONLY`). `lib/tiktok-autopilot.ts`, `executarTikTokPrivateTest()` publica de verdade, mas força privacidade privada — nunca pública. Ver `TIKTOK-APP-AUDIT-CHECKLIST.md` para o que falta para solicitar auditoria.

## 13. TikTok Shop — estado real de acesso

`lib/tiktok-shop-provider.ts`, `TikTokShopAffiliateCapabilityProbe`: `NOT_CONFIGURED → APP_REGISTERED → CREATOR_AUTH_REQUIRED → AFFILIATE_API_APPROVAL_REQUIRED → AVAILABLE` (mais `UNAVAILABLE_FOR_REGION`/`ERROR`). A documentação oficial informa que a Affiliate API "is inactive by default" e precisa de aprovação de Account/Partner Manager — **nunca assumimos que a conta brasileira já tem esse acesso**. `getCandidates()` só deixa de devolver `[]` quando a capability chegar a `AVAILABLE` com dados oficiais reais.

**Creator Authorization** (`montarUrlAutorizacaoCreatorTikTokShop()`) é OAuth de criadora, diferente de autorização de vendedora — nunca o mesmo token.

**Scoring** (`calcularScoreProdutoTikTokShop()`): comissão, preço, categoria, disponibilidade, colaboração aberta, automatizabilidade, mídia autorizada, possibilidade de showcase, desempenho anterior real do Patrono. Nunca inventa "mais vendido" sem a API fornecer.

**Showcase/Links**: `podeAdicionarAoShowcase()`/`obterLinkOficialTikTokShop()` só operam com capability `AVAILABLE` — nunca simulam sucesso, nunca fabricam URL.

**Orders**: `TikTokShopOrder.orderId` é a chave de idempotência para nunca criar `Sale` duplicada (reaproveita `Sale.idempotencyKey`, já implementado na Rodada 4).

**External Traffic Program (Brasil)**: o programa brasileiro permite Affiliate Link sharing para criadoras elegíveis — nunca assumido automaticamente; capability real decide.

## 14. Creative Factory TIKTOK_FIRST

`gerarPacoteCriativoTikTokFirst()` (`lib/creative-factory.ts`) — 3 hooks, caption, CTA, hashtags, disclosure, gerados especificamente para o TikTok (nunca reaproveitando texto do Instagram). Só usa fatos presentes na fonte (nome, categoria, preço com timestamp) — nunca inventa benefício/desconto/certificação.

## 15. Renderer TikTok

`RendererFFmpeg.renderTikTokVideo()` (`lib/renderer-ffmpeg.ts`) — vídeo vertical com movimento mais forte que o Reel padrão, hook/legenda/CTA com timing próprio (cortes via `drawtext enable=`), sem nenhum SaaS pago. **Nunca aceita um asset de watermark do Instagram** — cada canal gera seu próprio arquivo final.

## 16. Áudio

`lib/audio-policy.ts`, `AudioUsagePolicy`: `ORIGINAL | GENERATED_ALLOWED | LICENSED | TIKTOK_LIBRARY_REQUIRED | UNKNOWN | PROHIBITED`. Quando a música precisaria vir da biblioteca do TikTok e não há API autorizada de escolha, o Autopilot gera o conteúdo **sem música** — nunca pede uma decisão desnecessária, nunca arrisca direito autoral.

## 17. Disclosure

`TikTokCommercialDisclosure`/`tiktokCommercialDisclosure()` (`lib/tiktok-channel.ts`) decide `brand_content_toggle`/`brand_organic_toggle` antes de qualquer publicação — nunca esconde relação comercial quando obrigatório.

## 18. Autopilot TikTok

`lib/tiktok-autopilot.ts`:
- `dryRunTikTokAutopilot()` — os 7 passos (seleciona produto → gera asset → preflight → creator info se conectado → disclosure → consent gate → `READY_TO_PUBLISH`), nunca chama Direct Post.
- `executarTikTokPrivateTest()` — publica de verdade, mas só na privacidade `PRIVATE_TESTING_ONLY`.
- Autopilot real (`Direct Post` de produção) só depois de: app auditado, `video.publish` aprovado, usuária autorizada, media rights válidos, consentimento, preflight, disclosure, kill switch `OFF`, `automationMode = AUTOMATIC` (`lib/autopilot.ts`, já existente desde a Rodada 5).

## 19. Ações humanas que ainda não podem ser eliminadas

- Autorizar OAuth (uma vez, ou quando o refresh token expirar) — `OAUTH_AUTHORIZATION_REQUIRED`.
- Consentir publicação quando a API exigir (`TIKTOK_CONSENT`).
- Concluir cadastro/auditoria do app — `TIKTOK-APP-AUDIT-CHECKLIST.md`.
- Autorizar TikTok Shop (Creator Authorization) quando/se formos usar o provider de afiliados.

## 20. Custo

Nenhum serviço pago, nenhuma dependência nova, nenhum upgrade. **R$ 0,00 de custo novo.**
