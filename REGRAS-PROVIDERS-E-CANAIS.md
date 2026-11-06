# Regras por Provider e Canal — Patrono Seller

**Criado:** 14/09/2026 — Rodada 4 do P0. **Atualizado:** 15/09/2026 — Rodada 5 (Primeiro Autopilot Real).

**Ajuste de prioridade estratégica (Rodada 5):** TikTok/TikTok Shop passou a ser a prioridade nº 1 do Patrono Seller. Ordem estratégica: 1. TikTok/TikTok Shop · 2. Instagram · 3. Amazon · 4. Mercado Livre · 5. Shopee · 6. Renner · 7. demais providers. As seções abaixo foram reordenadas para refletir isso.

Este documento registra, por plataforma, o que sabemos hoje sobre o que pode ser automatizado, o que exige autorização, e o que não pode ser automatizado de forma nenhuma. É a versão em texto corrido de `lib/affiliate-provider-capabilities.ts` (providers de afiliados) e `lib/channel-registry.ts` (canais de publicação).

**Regra de pesquisa (seguida à risca neste documento):** para cada linha, priorizar documentação oficial. Quando a regra não pôde ser confirmada contra uma fonte ao vivo — este ambiente de desenvolvimento não tem acesso à internet externa nesta rodada — o campo diz **A VERIFICAR**, nunca um "sim" por suposição. Nada aqui foi decidido só por conhecimento geral do modelo sem marcar essa limitação.

---

## Como ler este documento

| Coluna | Significado |
|---|---|
| Podemos automatizar hoje | O que já está implementado e funcionando de verdade no código |
| Exige autorização | Existe caminho oficial, mas precisa de credencial/aprovação que não temos configurada |
| Não podemos automatizar | Proibido pela própria plataforma, ou não existe caminho oficial conhecido |
| Pendências | O que falta verificar/implementar |

---

## Providers de afiliados

### Amazon Associados (Amazon Creators API)
- **Fonte oficial utilizada (Rodada 5):** Amazon Creators API — explicitamente NÃO a PA-API antiga/deprecated. Marketplace `www.amazon.com.br`, Locale `pt_BR`, Currency `BRL`. Implementado em `lib/amazon-creators.ts`.
- **Podemos automatizar hoje:** código real pronto (SearchItems com `resources` mínimos, OAuth 2.0 client-credentials com cache de token, SalesRank oficial distinguido do score interno, `detailPageUrl` nunca reconstruída) — falta só a credencial (`AMAZON_CREATORS_CREDENTIAL_ID`, `AMAZON_CREATORS_CREDENTIAL_SECRET`, `AMAZON_CREATORS_PARTNER_TAG`). Sem credencial: "AMAZON — AGUARDANDO CONFIGURAÇÃO", nunca simula conexão.
- **Exige autorização:** conta de Associados aprovada e credenciais da Creators API.
- **Não podemos automatizar:** uso de imagem/mídia sem `MediaUsagePolicy` confirmada (default `UNKNOWN`, que só libera exibição — nunca reuso social/derivação por padrão).
- **Pendências:** testar contra a API real assim que houver credencial (nenhuma chamada de rede real foi feita nesta rodada); confirmar `usagePolicy` real de imagens contra os termos do Programa de Associados.

### Mercado Livre
- **Fonte oficial utilizada (Rodada 5):** endpoints `/highlights` (destaques) e `/trends` do Mercado Livre — implementado em `lib/mercado-livre-radar.ts`.
- **Podemos automatizar hoje:** descoberta de produto (`productDiscovery = AUTOMATIC`) via `/highlights`, quando configurado (`MERCADO_LIVRE_APP_ID`, `MERCADO_LIVRE_CLIENT_SECRET`).
- **Exige autorização:** geração de link de afiliado (`affiliateLinkGeneration = ASSISTED`) — SEMPRE feita pela ferramenta oficial do programa pela própria usuária; nunca fabricado automaticamente.
- **Não podemos automatizar:** transformar ranking/categoria/busca diretamente em link (sempre resolve para o produto individual primeiro); Campanha de Criador com produto físico obrigatório nunca aceita vídeo gerado por IA fingindo ser gravação real (`podeSubmeterAutomaticamente()` bloqueia com `PHYSICAL_PRODUCT_REQUIRED`).
- **Pendências:** encontrar/confirmar API oficial específica de geração de link de afiliado antes de mudar `affiliateLinkGeneration` para `AUTOMATIC`.

### Shopee
- **REGRA CRÍTICA (inegociável):** nenhuma automação de navegador, nenhuma raspagem de página da Shopee, em nenhuma hipótese — nem para produtos, nem rankings, nem imagens, nem preços, nem criativos.
- **Fonte oficial utilizada:** nenhuma consultada nesta rodada.
- **Podemos automatizar hoje:** nada.
- **Exige autorização:** API oficial de afiliados/catálogo, se existir para nossa conta — A VERIFICAR.
- **Não podemos automatizar:** qualquer coisa que dependa de scraping ou automação de navegador.
- **Pendências:** confirmar se existe API oficial de afiliados acessível; até lá, o funcionamento continua 100% manual (cadastro do link feito pela própria usuária).

### TikTok Shop (provider — separado do canal TikTok abaixo)
- **PRIORIDADE Nº 1 do Patrono Seller (ajuste estratégico, Rodada 5).** Deliberadamente separado de `TikTokChannel`: TikTok Shop cuida de produtos/oportunidades/links/comissões/vendas; o canal TikTok (abaixo) cuida de criação/publicação/disclosure/consentimento/status/métricas.
- **Fonte oficial utilizada (Rodada 6):** documentação do TikTok Shop Partner Center confirma que a Affiliate API "is inactive by default" e precisa de aprovação de Account/Partner Manager. `TikTokShopAffiliateCapabilityProbe` (`lib/tiktok-shop-provider.ts`) representa esse estado real: `NOT_CONFIGURED → APP_REGISTERED → CREATOR_AUTH_REQUIRED → AFFILIATE_API_APPROVAL_REQUIRED → AVAILABLE` (mais `UNAVAILABLE_FOR_REGION`/`ERROR`). **Nunca assumimos que a conta brasileira já tem esse acesso.**
- **Podemos automatizar hoje:** nada de catálogo/link/comissão ainda — `getCandidates()` sempre `[]` até a capability chegar a `AVAILABLE`. `Creator Authorization` (OAuth de criadora, `montarUrlAutorizacaoCreatorTikTokShop()`) já tem arquitetura pronta, sempre com token `creator` — nunca misturado com token `seller`/`partner` (`exigirTipoDeToken()`).
- **Exige autorização:** Creator Authorization (OAuth) + aprovação da Affiliate API por Account/Partner Manager.
- **Não podemos automatizar:** showcase/links/orders enquanto a capability não for `AVAILABLE` (`podeAdicionarAoShowcase()`, `obterLinkOficialTikTokShop()` nunca simulam sucesso).
- **Pendências:** solicitar aprovação real da Affiliate API; até lá, `TikTokShopAffiliateProvider` continua honesto sobre a indisponibilidade.

### Hotmart
- **Fonte oficial utilizada:** conhecimento geral de que a Hotmart documenta publicamente uma API de produtos/vendas/comissões e webhook de venda.
- **Podemos automatizar hoje:** nada (sem app/credenciais registrados).
- **Exige autorização:** toda a API — precisa registrar um app e ter credenciais aprovadas.
- **Não podemos automatizar:** nada identificado.
- **Pendências:** registrar o app na Hotmart e confirmar os escopos exatos antes de implementar.

### Favoritos Renner / Riachuelo / Netshoes
- **Fonte oficial utilizada:** nenhuma consultada nesta rodada.
- **Podemos automatizar hoje:** nada.
- **Exige autorização:** desconhecido — provavelmente operam por uma rede de afiliação parceira (qual rede, não confirmado).
- **Não podemos automatizar:** scraping do site do varejista.
- **Pendências:** identificar qual rede de afiliação cada varejista usa hoje (se ainda for a mesma) antes de prometer qualquer automação.

### Sephora (via Rakuten Advertising) / Rakuten Advertising / Awin / Impact / CJ Affiliate
- **Fonte oficial utilizada:** conhecimento geral de que essas quatro redes documentam publicamente APIs de publisher (relatórios, deep-link, e nos três últimos, webhooks de conversão).
- **Podemos automatizar hoje:** nada.
- **Exige autorização:** toda a API — precisa de conta de publisher aprovada pela rede e, em alguns casos, pelo anunciante específico dentro dela.
- **Não podemos automatizar:** nada identificado além da aprovação.
- **Pendências:** confirmar os termos e limites atuais de cada rede antes de implementar; cada anunciante dentro da rede pode ter regra de conteúdo própria.

### Lomadee / Monetizze / Eduzz / Kiwify / Magalu Parceiro
- **Fonte oficial utilizada:** nenhuma consultada ao vivo nesta rodada — apenas conhecimento histórico geral, marcado como **NOT_VERIFIED**.
- **Podemos automatizar hoje:** nada.
- **Exige autorização:** desconhecido até reverificação.
- **Não podemos automatizar:** nada identificado.
- **Pendências:** reconferir contra a documentação oficial atual de cada um antes de qualquer implementação.

---

## Canais de publicação

### TikTok (canal — PRIORIDADE Nº 1, ajuste estratégico Rodada 5, integração real Rodada 6)
- **Canal principal de aquisição e conteúdo do MVP Automation First.**
- **Fonte oficial utilizada:** TikTok Login Kit (OAuth) + Content Posting API. OAuth real: `lib/tiktok-oauth.ts` + `/api/integracoes/tiktok/oauth/start|callback`, tokens persistidos em `Integracao` (`lib/tiktok-token-store.ts` renova via refresh automaticamente). Publicação: `lib/tiktok-channel.ts` (`TikTokPublisher.publicar()`/`publicarFotos()`, `consultarCreatorInfo`, `tiktokCommercialDisclosure`, `TikTokAnalyticsAdapter`), upload em chunks (`lib/tiktok-upload.ts`), retry seguro (`lib/tiktok-retry.ts`), rate limiter local (`lib/tiktok-rate-limiter.ts`), webhook com assinatura+idempotência (`lib/tiktok-webhook.ts`, `/api/webhooks/tiktok`). Ver `TIKTOK-INTEGRATION.md` para o detalhamento completo.
- **Podemos automatizar hoje (arquitetura real, aguardando credenciais para rodar contra a API de verdade):** OAuth completo; Direct Post de vídeo (`PULL_FROM_URL`/`FILE_UPLOAD`) e foto; preflight dinâmico contra `creator_info` real (`validarPreflightDinamico()`, nunca hardcoda duração/privacidade/comentário/duet/stitch); status oficial (`ACCEPTED_BY_TIKTOK`/`REJECTED_BY_TIKTOK`, nunca confundido com `PREVALIDATED_FOR_TIKTOK`); disclosure comercial (`brand_content_toggle`); 10 estados reais de configuração (`lib/tiktok-config-status.ts` — nunca "Conectado" só por existir client credentials).
- **Exige autorização:** toda publicação — e a própria API do TikTok exige consentimento explícito do criador. `TikTokHumanConsentGate` garante que o Patrono faz todo o resto sozinho e só pede: "Conteúdo pronto. Autorizar publicação no TikTok."
- **Não podemos automatizar:** publicação sem o consentimento do criador quando a API exigir; nunca hardcodar limite de duração/formato; publicação PÚBLICA enquanto o app não estiver auditado (`PRIVATE_TESTING_ONLY`, `lib/tiktok-privacy.ts` — ver `TIKTOK-APP-AUDIT-CHECKLIST.md`).
- **Pendências:** registrar app no TikTok for Developers, obter credenciais reais, testar contra a API de verdade, solicitar auditoria do app.

### Instagram (canal — prioridade nº 2)
- **Fonte oficial utilizada:** Meta Graph API — **já em uso real** no projeto (`lib/instagram.ts`), com `InstagramPreflightValidator` (`lib/instagram-preflight.ts`, Rodada 5) validando container/codec/aspect ratio/tamanho/URL/conta/mídia antes de publicar.
- **Podemos automatizar hoje:** publicação de imagem, carrossel, Reels e Stories via Graph API, com gate de aprovação humana antes de publicar (já implementado, rodadas anteriores).
- **Exige autorização:** token de app Meta configurado pela usuária (já é o fluxo atual).
- **Não podemos automatizar:** nada além da própria exigência de token/app da Meta.
- **Pendências:** reconferir limites exatos de tamanho/duração por tipo de conta antes de mudar qualquer regra.

### YouTube (Shorts)
- **Fonte oficial utilizada:** conhecimento geral de que existe a YouTube Data API (upload).
- **Podemos automatizar hoje:** nada.
- **Exige autorização:** toda a API (OAuth do canal).
- **Não podemos automatizar:** nada identificado além da autorização.
- **Pendências:** não implementado; reconferir limites de duração/tamanho antes de implementar.

### Facebook
- **Fonte oficial utilizada:** mesma família de API (Meta Graph API) do Instagram.
- **Podemos automatizar hoje:** nada — só o Instagram está implementado hoje, Facebook não.
- **Exige autorização:** mesmo token de app Meta, com permissões adicionais para páginas do Facebook.
- **Não podemos automatizar:** nada identificado.
- **Pendências:** decidir se vale a pena implementar Facebook como canal separado (mesma infraestrutura do Instagram).

### Pinterest
- **Fonte oficial utilizada:** conhecimento geral de que existe uma API de Pins pública.
- **Podemos automatizar hoje:** nada.
- **Exige autorização:** toda a API.
- **Não podemos automatizar:** nada identificado.
- **Pendências:** não implementado, não reconferido.

---

## Regra permanente

Nenhuma automação real (conexão, importação, publicação) deve ser ativada para nenhuma linha acima enquanto ela estiver marcada **A VERIFICAR** ou **NOT_VERIFIED**. Antes de implementar qualquer uma, reler a documentação oficial da plataforma, atualizar `lastVerifiedAt` no registro correspondente (`lib/affiliate-provider-capabilities.ts` ou `lib/channel-registry.ts`), e só então trocar `status`/`sourceType`.
