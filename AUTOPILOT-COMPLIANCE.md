# Autopilot & Compliance — Patrono Seller

**Criado:** 15/09/2026 — Rodada 5 (Primeiro Autopilot Real).

Este documento explica, em texto corrido, como o primeiro ciclo real de automação (`runAutopilot`, `lib/autopilot.ts`) funciona e quais regras de conformidade ele nunca pode ignorar. Complementa `DOCUMENTACAO-PATRONO-SELLER.md` (seção 22) e `REGRAS-PROVIDERS-E-CANAIS.md`.

**Ajuste de prioridade estratégica:** TikTok/TikTok Shop é o canal e provider prioritário nº 1 do MVP Automation First. Ordem: TikTok → Instagram → Amazon → Mercado Livre → Shopee → Renner → demais.

## 1. Pergunta que o Patrono responde agora

Não é "qual produto vende mais?" — é **"qual o melhor produto que eu consigo vender automaticamente, com segurança e dentro das regras?"**. Isso é o `AutomationFeasibilityScore` (`lib/automation-feasibility.ts`): combina potencial de venda (55%) com automatizabilidade (45% — link automático, mídia autorizada, capacidade de gerar conteúdo, capacidade de publicar automaticamente, ausência de exigência de consentimento, ausência de restrição de plataforma, confiança das regras, custo da automação). Entre dois produtos parecidos, o Patrono pode priorizar o que exige menos ação manual, mesmo com potencial um pouco menor — o objetivo é a proprietária nunca virar operadora da plataforma.

## 2. Amazon Creators API

- Marketplace `www.amazon.com.br` · Locale `pt_BR` · Currency `BRL`.
- Credenciais **só no servidor**: `AMAZON_CREATORS_CREDENTIAL_ID`, `AMAZON_CREATORS_CREDENTIAL_SECRET`, `AMAZON_CREATORS_PARTNER_TAG` — nunca `NEXT_PUBLIC_`, nunca no frontend, nunca em log ou `AuditLog`.
- Token OAuth 2.0 client-credentials é obtido e **cacheado** (`lib/oauth-token-cache.ts`) enquanto válido — nunca uma chamada por requisição.
- Sem credencial: `healthCheck()` devolve `"AGUARDANDO CONFIGURAÇÃO"` — nunca simula conexão; o resto do Patrono continua funcionando.
- `SearchItems` pede só os `resources` estritamente necessários (título, imagem primária, preço, SalesRank).
- **SalesRank oficial ≠ score interno do Patrono.** `AmazonSalesRank` (`browse_node_sales_rank`/`website_sales_rank`) é sempre um campo separado de `AutomationFeasibilityScore` — nunca a mesma coisa, nunca inventamos "mais vendido" sem essa fonte.
- `detailPageUrl` é usada **exatamente** como a API devolve (com `partnerTag`) — nunca reconstruída, nunca com parâmetro removido/alterado.
- Toda imagem começa com `usagePolicy: 'UNKNOWN'` — nunca assumimos que pode ser reusada em rede social, transformada ou armazenada permanentemente até os termos oficiais confirmarem o contrário.

## 3. Mercado Livre

- `/highlights`/`/trends` oficiais alimentam a descoberta de produto (`productDiscovery = AUTOMATIC`).
- **Geração de link de afiliado é `ASSISTED`, nunca `AUTOMATIC`** — as regras atuais do programa exigem a ferramenta oficial da própria usuária. O Patrono aponta o produto; a usuária gera o link.
- Ranking/categoria/busca **nunca** vira link diretamente — sempre resolve para o produto individual primeiro.
- **Afiliado por venda ≠ Campanha de Criador** (remunerada por visualização). Campanha de Criador que exige produto físico real na gravação bloqueia automaticamente vídeo gerado por IA fingindo ser a gravação real (`PHYSICAL_PRODUCT_REQUIRED`, `podeSubmeterAutomaticamente()`).

## 4. Media Rights Gate

Antes de qualquer geração de criativo, todo asset passa por `direitosDaPolicy()` + `mediaRightsGate()` (`lib/media-rights.ts`). `MediaUsagePolicy`: `DISPLAY_ONLY | TEMPORARY_REFERENCE | SOCIAL_REUSE_ALLOWED | DERIVATIVE_ALLOWED | UNKNOWN | PROHIBITED`.

- `UNKNOWN` só libera **exibir** — nunca reusar em rede social, transformar, derivar ou armazenar por padrão.
- Quando os termos oficiais não confirmam uso social, o Autopilot **nunca pergunta primeiro** — tenta, na ordem: (1) outro asset autorizado, (2) outra mídia oficial, (3) asset próprio permitido, (4) outro produto, (5) outro provider. Só cria `HumanActionRequired` quando não há alternativa automática.
- Nenhum conteúdo (foto/descrição/texto do programa) é enviado a um modelo generativo sem essa checagem passar antes — vale até para modelo local/gratuito.

## 5. Automation Feasibility Score

`lib/automation-feasibility.ts`: `calcularFeasibility()` = 55% `notaPotencial()` (ranking de vendas, tendência, comissão) + 45% `notaAutomatizabilidade()` (6 capacidades binárias × confiança das regras × custo da automação). `AutomationFeasibilityScorer implements OpportunityScorer` — usado pelo Autopilot para ranquear candidatos antes de selecionar.

## 6. Creative Renderer (POC gratuito)

`lib/renderer-ffmpeg.ts` — primeira implementação real de `RendererProvider`, usando `ffmpeg-static` (grátis, já dependência do projeto). Formatos: Reel vertical 9:16 (zoom leve + overlays), Post 1:1, Carrossel (mínimo 3 cards: Hook / Produto-benefício / CTA, método `renderCarrossel()`). **Nunca inventa texto** — todo overlay vem de quem chama, e o Autopilot só usa dados presentes na oportunidade (nome do produto, preço com timestamp — nunca preço sem fonte, nunca benefício/desconto/certificação inventados). Upload via Supabase Storage (`uploadBuffer`, `lib/supabase.ts`) — já configurado no projeto, sem custo adicional.

## 7. TikTok (canal, prioridade nº 1) e TikTok Shop (provider, separado)

- `lib/tiktok-preflight.ts`: `TikTokPreflightValidator` consulta a própria conta (nunca hardcoda duração/formato). Estados: `NOT_VERIFIED` (sem credencial) → `TECHNICALLY_VALID`/`REQUIRES_USER_CONSENT`/`BLOCKED_BY_POLICY`.
- `TikTokPublicationStatus`: `PREVALIDATED_FOR_TIKTOK` (nossa pré-validação) → `PUBLISHING` → `ACCEPTED_BY_TIKTOK`/`REJECTED_BY_TIKTOK`/`FAILED`. **Nunca dizemos "validado pelo TikTok" antes de uma resposta real da API.**
- `TikTokHumanConsentGate` (`tiktokHumanConsentGate()`): quando a plataforma exige consentimento explícito, o Patrono faz todo o resto sozinho e só mostra: **"Conteúdo pronto. Autorizar publicação no TikTok."** — nunca vira um fluxo manual maior.
- `lib/tiktok-channel.ts`: `TikTokPublisher` (init por URL + status), `TikTokCommercialDisclosure` (`brand_content_toggle` quando há afiliado), `TikTokAnalyticsAdapter` (métricas reais, campo ausente vira `null`, nunca inventado).
- `lib/tiktok-shop-provider.ts`: `TikTokShopAffiliateProvider`, **deliberadamente separado** do canal — cuida de produto/link/comissão do TikTok Shop, quando/se uma API oficial de afiliados for confirmada (ainda não nesta rodada).

## 8. Instagram Preflight (canal, prioridade nº 2)

`lib/instagram-preflight.ts`: `InstagramPreflightValidator` valida contra as regras já conhecidas de `lib/channel-registry.ts` (aspect ratio, codec, tamanho) e contra o estado da mídia (autorizada, conta elegível, URL acessível). Campo técnico desconhecido nunca é tratado como "ok" — vira `NOT_VERIFIED`.

## 9. Autopilot — ciclo de 14 etapas

`runAutopilot(workspaceId, deps, { dryRun })`:

1. Kill switch checado.
2. Encontrar oportunidades elegíveis (todas as `OpportunitySource` configuradas).
3. Pontuar via `AutomationFeasibilityScorer`.
4. Excluir candidatos `BLOCKED_BY_POLICY` (Media Rights Gate) automaticamente, sem perguntar primeiro.
5. Selecionar o melhor candidato restante.
6. Obter link autorizado (produtos que exigem consentimento — ex.: Mercado Livre — param aqui com `REQUIRES_USER_CONSENT`).
7. Confirmar mídia autorizada.
8. Gerar conteúdo (`RendererFFmpeg`, texto só com dados factuais da oportunidade).
9. Validar (TikTok primeiro, Instagram como alternativa).
10. Preparar publicação (`ComplianceEngine` decide disclosure).
11. Publicar quando permitido.
12. Registrar publicação (`AuditLog`, via `AutopilotStore`).
13. Acompanhar status.
14. Registrar métricas (consulta seguinte, `TikTokAnalyticsAdapter` — fora do ciclo síncrono).

## 10. Dry Run

`dryRun` (parâmetro ou `AUTOPILOT_DRY_RUN`, **default `true`**): executa até `READY_TO_PUBLISH`/`DRY_RUN_COMPLETE` e registra exatamente o que teria sido publicado — **nunca chama publicação real**.

## 11. Publicação real (produção)

Só publica de verdade quando **todas** as condições valem: `dryRun = false` **e** `Workspace.automationMode === 'AUTOMATIC'` **e** canal validado (TikTok/Instagram) **e** mídia autorizada **e** link autorizado **e** disclosure decidido **e** dentro dos limites/anti-spam **e** kill switch ainda desligado (checado de novo, imediatamente antes da chamada externa).

## 12. Kill Switch

`Workspace.automationPaused` (migração `20260915000000_workspace_automation_controls`, default `true` — automação nasce pausada). Quando ligado: nenhum job novo publica; um job em andamento é interrompido antes da etapa externa.

## 13. Limites e anti-spam

`LIMITES_PADRAO` (`lib/autopilot.ts`): `maxPublicacoesPorDia`, `cooldownMinutos` — limites internos de segurança, **nunca** descritos como "limite de shadowban" ou atribuídos à plataforma. Anti-spam: nunca republica o mesmo produto no mesmo dia (`produtosPublicadosHoje`).

## 14. Auditoria

Toda etapa relevante do Autopilot é registrada via `AutopilotStore.registrarAuditoria()` (implementação real: `lib/autopilot-store-prisma.ts`, usando `AuditLog`) — oportunidade encontrada, score, motivo da seleção, direitos de mídia, validações, conteúdo criado, publicação, erro, resultado. **Nunca registra segredo/token/credencial.**

## 15. Status Home (dado, sem redesenho)

`lib/autopilot-status.ts`, `calcularStatusAutopilotHome()`: `ATIVO | PAUSADO | PRECISA_DE_CONFIGURACAO | PRECISA_DE_VOCE | BLOQUEADO_POR_REGRA` — pronto para um futuro widget pequeno na Home, sem mudança visual nesta rodada.

## 15.1 Rodada 6 — TikTok First: Primeira Integração Real

Ver `TIKTOK-INTEGRATION.md` para o detalhamento completo. Resumo do que virou integração REAL nesta rodada (antes era só arquitetura/prevalidação):

- **OAuth real** (`lib/tiktok-oauth.ts` + `/api/integracoes/tiktok/oauth/start|callback`) — Authorization Code, `state` assinado (HMAC, TTL 10min), token/refresh persistidos em `Integracao`, renovação automática (`lib/tiktok-token-store.ts`).
- **Escopo único:** `video.publish`.
- **10 estados de configuração reais** (`lib/tiktok-config-status.ts`) — nunca "Conectado" só por existir client credentials.
- **Preflight dinâmico** (`validarPreflightDinamico()`) contra `creator_info` REAL — nunca hardcoda duração/privacidade/comentário/duet/stitch.
- **Direct Post real:** vídeo (`PULL_FROM_URL` e `FILE_UPLOAD` com chunking oficial) e **Photo Post** (`publicarFotos()`).
- **Status/Webhook:** polling oficial + `/api/webhooks/tiktok` com verificação de assinatura, janela anti-replay e idempotência.
- **Retry seguro** (`publicarComRetry()`) — nunca duplica publicação já `ACCEPTED_BY_TIKTOK`.
- **Rate limiter local** (`TikTokRateLimiter`) — sem serviço pago.
- **App não auditado → `PRIVATE_TESTING_ONLY`** (`lib/tiktok-privacy.ts`) — nunca contornado; `executarTikTokPrivateTest()` só publica em privacidade privada.
- **TikTok Shop Affiliate:** `TikTokShopAffiliateCapabilityProbe` nunca assume `AVAILABLE` sem aprovação real confirmada; `creator`/`seller`/`partner` tokens nunca se misturam.
- **CreativeFactory `TIKTOK_FIRST`** e **RendererFFmpeg.renderTikTokVideo()** — conteúdo específico do TikTok, nunca reaproveitado do Instagram; nunca watermark cruzado entre canais.
- **AudioUsagePolicy** (`lib/audio-policy.ts`) — sem API de biblioteca autorizada, o conteúdo sai sem música.
- **`dryRunTikTokAutopilot()`** (`lib/tiktok-autopilot.ts`) — os 7 passos até `READY_TO_PUBLISH`, nunca chama Direct Post.

## 15.2 Complemento — Digital Twin (fundações)

Ver `DIGITAL-TWIN.md`. Preparação para o Patrono gerar vídeos com a aparência e a voz consistentes da própria proprietária, primeiro uso otimizado para TikTok. `podeGerarComDigitalTwin()` (`lib/digital-twin.ts`) exige perfil habilitado, voz habilitada, e ambos os consentimentos (`IdentityConsent`/`VoiceConsent`) `GRANTED` e não expirados — checado a cada geração, nunca só no cadastro. `validarPresenterMode()` bloqueia depoimento pessoal não verídico ("eu usei", "eu testei"). `decidirAIContentDisclosure()` exige disclosure de IA sempre que houver avatar sintético, voz clonada ou lip sync — além do (não em vez do) disclosure comercial. Kill switch "DESATIVAR MEU AVATAR" já modelado. Nenhum provider de voz/avatar/lip sync foi implementado ou contratado.

## 15.3 Rodada 7 — Digital Twin Real (primeira implementação)

Persistência real (`lib/digital-twin-store.ts`, sempre escopada por `workspaceId`); storage privado com signed URL (`lib/supabase.ts`); Chatterbox TTS (Resemble AI, self-hosted, MIT) como `VoiceCloneProvider` real, checagem honesta de disponibilidade (`lib/chatterbox-adapter.ts` — não instalado neste ambiente); Voice/Identity Quality Gates via FFmpeg; MuseTalk `AVAILABLE_CANDIDATE`, Wav2Lip/LivePortrait `BLOCKED_BY_LICENSE` (`lib/lipsync-provider.ts`, `DIGITAL-TWIN-MODEL-LICENSES.md`); `AUTOPILOT_PRODUCT_EXPERIENCE_MODE = 'VIRTUAL_PRESENTATION'` sempre; preset `TIKTOK_DIGITAL_TWIN_V1`; `CreativePresenterMode` (fallback sem GPU nunca trava o Autopilot); job `GENERATE_DIGITAL_TWIN_VIDEO` (10 estados, retry seguro, kill switch checado antes de cada etapa crítica); `DigitalTwinQualityGate` antes de `READY_TO_PUBLISH`; revogação real e isolamento cross-workspace testado.

## 15.4 Rodada 8 — Digital Twin Operacional

Job Queue real (`lib/digital-twin-job-queue.ts`) — claim atômico Postgres, heartbeat, retry, worker offline nunca perde o job. Worker separado do request HTTP (`worker/digital-twin-worker.ts`). `determinarModoAutopilot()` (`lib/digital-twin-autopilot-integration.ts`) escolhe `CreativePresenterMode` sozinho, considerando preferências globais + worker online — nunca pergunta a cada postagem. `DigitalTwinIdentityLock` garante que só o perfil aprovado é reutilizado. `avaliarKillSwitches()` confirma os dois níveis (Autopilot/Digital Twin) independentes. Segunda prévia com produto nunca finge posse física (`PRESENTER_PRODUCT_PANEL`/`PRESENTER_INTRO_BROLL`).

## 15.5 Rodada 9 (complemento) — Machine Learning Real

Ver `MACHINE-LEARNING.md`. Relevante para compliance/transparência do Autopilot:

- **Nunca opaco**: todo `OpportunityScore` composto (`lib/opportunity-score-composite.ts`) registra separadamente `externalMarketSignals`/`automationFeasibility`/`historicalPerformance`/`mlPrediction` — nunca um número só escondendo a origem da decisão (regra 12/36).
- **Toda decisão sabe seu próprio tipo**: `MLDecisionType` (`RULE_BASED`/`STATISTICAL_LEARNING`/`MACHINE_LEARNING`/`MODEL_BASED`) registrado em cada `MLPrediction`, nunca chamando de "IA" uma regra fixa.
- **Nunca trava o Autopilot**: `AutopilotDeps.mlEngine` é opcional; qualquer falha (modelo corrompido, artifact inválido, dimensão dessincronizada) cai para o score determinístico da Rodada 5, testado explicitamente (`ml_prediction_failed` na auditoria).
- **Nunca promove modelo ruim**: `ModelPromotionGate` só ativa um candidato que supera o baseline determinístico por margem mínima — nunca por empate/ruído; rollback sempre disponível.
- **Nunca promove modelo de teste**: um `MLModel` com `dataOrigin` diferente de `REAL_OPERATION` (teste/fixture/demo/seed) nunca vira `ACTIVE`, mesmo com métricas excelentes — testado explicitamente. O `MLReadinessGate` de produção também só conta amostras `REAL_OPERATION`: 250 registros de teste nunca substituem dados reais insuficientes.
- **Nunca usa dado biométrico do Digital Twin para otimizar venda**: `verificarSemDadosBiometricos()` bloqueia a persistência de qualquer feature de performance com campo de áudio/rosto brutos; `nuncaAlterarIdentidade()` bloqueia qualquer sugestão de apresentação do Digital Twin que toque identidade — o `DigitalTwinIdentityLock` continua sendo a única fronteira de identidade.
- **Auditoria completa**: cada previsão de ML é persistida (`MLPrediction`) e auditada (reaproveita `AuditLog`, mesmo padrão do resto do Autopilot) — nunca silenciosa.
- **Isolamento por workspace**: nenhum modelo/feature/experimento de um workspace é usado por outro.

## 16. O que ainda não existe

Nenhuma credencial real (Amazon, Mercado Livre, TikTok) foi configurada ou inventada nesta rodada — tudo funciona em modo "aguardando configuração" até a usuária conectar. `runAutopilot` ainda não cria `Produto`/`Conteudo`/`Sale` reais no banco por padrão — usa um `AutopilotStore` injetável (testável sem banco), com uma implementação Prisma pronta para ligar quando o fluxo completo de persistência for desenhado. `TikTokShopAffiliateProvider` aguarda confirmação de API oficial de afiliados. App do TikTok Channel ainda não foi submetido para auditoria (`TIKTOK-APP-AUDIT-CHECKLIST.md`) — nenhum item do checklist foi executado nesta rodada.
