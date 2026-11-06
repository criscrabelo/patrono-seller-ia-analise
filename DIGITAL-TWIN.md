# Digital Twin da Proprietária — Fundações

**Criado:** complemento à Rodada 6 (TikTok First). Só as fundações — nenhuma geração de avatar, clonagem de voz ou treinamento pesado nesta rodada.

## Finalidade

Permitir que o Patrono gere, no futuro, vídeos usando a aparência e a voz consistentes da própria proprietária (identidade facial, sincronização labial, roteiros/cenários variados) sem gravação manual de cada vídeo. É uma **representação digital autorizada da própria titular** — nunca uma ferramenta genérica de impersonação de terceiros.

Primeiro uso otimizado para **TikTok**, dentro do pipeline futuro:

```
Produto → Opportunity Radar → Script → Voice Clone → Digital Twin → Lip Sync
  → Renderer → TikTok Preflight → Commercial Disclosure → AI Content Disclosure
  → Consent Gate → Direct Post → Metrics → Sale/Commission → Learning Engine
```

Nada desse pipeline foi implementado de ponta a ponta nesta rodada — só os tipos/gates abaixo, para a etapa seguinte não precisar redesenhar nada.

## Consentimento

`lib/digital-twin.ts`: `IdentityConsent` e `VoiceConsent` — cada um com `status` (`NOT_REQUESTED | GRANTED | REVOKED | EXPIRED`), `grantedAt`, `revokedAt`, `expiresAt`. **Nenhuma geração ocorre sem consentimento `GRANTED` e não expirado/revogado** — checado a cada job (`podeGerarComDigitalTwin()`), nunca só uma vez no cadastro.

## Identidade (`DigitalTwinProfile`)

Perfil persistente da proprietária: `displayName`, `identityReferenceId` (referência ao material biométrico — nunca a mídia em si exposta), `voiceProfileId`, `consentStatus`, `enabled` (kill switch). Consistência exigida: rosto, cabelo, características principais, aparência geral, idade aparente coerente — **a pessoa precisa continuar reconhecivelmente a mesma** entre conteúdos. Pode variar: roupa, fundo, cenário, posição, enquadramento, iluminação.

## Voz (`VoiceProfile`)

`referenceAudio` (privado, nunca exposto publicamente), `consentId`, `provider`, `language`, `enabled`. A voz precisa ser **consistente entre os vídeos** — nunca uma voz diferente por conteúdo.

**Candidato à primeira avaliação (não integrado ainda):** Chatterbox TTS ou outra opção open source compatível com clonagem de voz autorizada, execução local, licença comercial adequada e custo R$ 0,00. Nenhum provider pago (ElevenLabs ou similar) foi ou será contratado sem autorização expressa.

## Avatar (não integrado)

Nenhum SaaS pago de avatar (HeyGen, Synthesia, D-ID) foi contratado. Antes de escolher um motor definitivo, será preciso documentar candidatos open source e verificar: licença, uso comercial permitido, GPU/VRAM necessária, qualidade, manutenção, riscos. **Open source não significa automaticamente permitido para uso comercial** — cada candidato precisa ser verificado individualmente.

## Providers desacoplados

`VoiceCloneProvider`, `AvatarVideoProvider`, `LipSyncProvider` (`lib/digital-twin.ts`) — interfaces puras, sem implementação, sem acoplamento a fornecedor específico. Trocar de provider no futuro não deve exigir mudar o resto do pipeline.

## Presenter Mode (único modo desta rodada)

`validarPresenterMode()` — o avatar apresenta informações **verificadas** do produto, nunca inventa experiência pessoal. Bloqueia frases como "eu usei", "eu testei", "eu recomendo porque uso", "na minha experiência". O avatar pode ser sintético; **o produto e as afirmações sobre ele nunca podem ser falsificados** (característica, funcionamento, cor, tamanho, benefício, resultado).

## TikTok AI Content Disclosure

`lib/ai-content-disclosure.ts`, `decidirAIContentDisclosure()` — distinto do `TikTokCommercialDisclosure` (relação comercial/afiliado). Um vídeo com Digital Twin pode precisar dos **dois disclosures ao mesmo tempo**. Fail-safe: qualquer elemento sintético (avatar, voz clonada, lip sync) já exige disclosure de IA — nunca escondido para tentar burlar a plataforma.

## Media Rights e Áudio

O Digital Twin respeita o `MediaRightsGate` (`lib/media-rights.ts`) já existente — nunca usa imagem de produto sem direito suficiente para transformação/publicação. Compatível com `AudioUsagePolicy` (`lib/audio-policy.ts`) — nunca música protegida sem direito de uso.

## Segurança

Arquivos de voz, rosto, vídeo e referência são sempre privados. Áudio de referência, material biométrico, tokens e segredos **nunca** em log ou URL pública permanente.

## Kill Switch — "DESATIVAR MEU AVATAR"

`DigitalTwinProfile.enabled` / `VoiceProfile.enabled`. Quando desativado, nenhuma nova geração usa rosto ou voz da proprietária. **Jobs pendentes verificam o status imediatamente antes de gerar**, nunca confiando num status checado no início do job (`podeGerarComDigitalTwin()` deve ser chamado de novo antes da etapa de geração, o mais tarde possível no fluxo).

## Fallback sem GPU

Se o Digital Twin completo não puder rodar gratuitamente no ambiente, o Autopilot continua funcionando com: voz autorizada (sem clone), produto, motion graphics, texto, legendas, B-roll permitido, animação — a automação nunca fica bloqueada por falta de GPU.

## Custo

Nenhum serviço pago contratado (HeyGen, Synthesia, ElevenLabs, D-ID, cloud GPU ou outro SaaS). **Custo novo: R$ 0,00.**

## Rodada 7 — Digital Twin Real (primeira implementação)

- **Persistência real:** `DigitalTwinProfile`, `VoiceProfile`, `IdentityConsent`, `VoiceConsent`, `DigitalTwinAsset`, `DigitalTwinJob` — todos escopados por `workspaceId` resolvido no servidor (migração `20260916000000_digital_twin_persistence`). `lib/digital-twin-store.ts` nunca devolve um registro de outro workspace, mesmo com o id certo.
- **Storage privado:** `lib/supabase.ts` ganha `uploadBufferPrivado`/`criarUrlAssinada`/`deleteFilePrivado` — bucket `digital-twin-private`, nunca URL pública permanente.
- **Runtime capabilities:** `lib/digital-twin-runtime.ts`, `detectarCapacidadesRuntime()` — detecção REAL de CPU/RAM/GPU/CUDA/disco (via `os` nativo + `nvidia-smi`), nunca assume presença de GPU.
- **Chatterbox TTS (Resemble AI, oficial, self-hosted):** `lib/chatterbox-adapter.ts` — checagem real de disponibilidade (nunca finge); texto de teste padronizado em pt-BR (`TEXTO_TESTE_PT_BR`); nunca a API paga da Resemble.
- **Voice Quality Gate:** `lib/voice-quality-gate.ts` + `lib/audio-ffprobe.ts` — duração plausível, volume mínimo, ausência de clipping extremo, via FFmpeg (`ffmpeg-static`, já dependência).
- **MuseTalk (lip-sync):** `lib/lipsync-provider.ts` — candidato principal (`AVAILABLE_CANDIDATE`); `Wav2Lip` e `LivePortrait` ficam `BLOCKED_BY_LICENSE` (ver `DIGITAL-TWIN-MODEL-LICENSES.md`), nunca integrados mesmo por engano (`bloquearMotor()`).
- **Identity Quality Gate:** `lib/identity-quality-gate.ts` — duração/resolução reais via FFmpeg; detecção de rosto honestamente `NOT_VERIFIED` (nenhum detector real disponível neste ambiente — nunca finge `true`).
- **Reference Video Based Digital Twin:** MVP prova "mesma pessoa + mesma voz + fala natural + vídeo TikTok válido" usando o vídeo de referência como veio — sem gerar roupas/cenários ainda (`lib/avatar-presets.ts`, arquitetura pronta para o futuro).
- **Virtual Presentation vs Real Product Experience:** `AUTOPILOT_PRODUCT_EXPERIENCE_MODE = 'VIRTUAL_PRESENTATION'` sempre — `validarUnboxingStyle()` nunca permite afirmar recebimento físico real gerado automaticamente.
- **TIKTOK_DIGITAL_TWIN_V1:** `lib/digital-twin-tiktok-preset.ts` — Presenter Mode + AI disclosure + captions (`lib/captions.ts`, determinístico, sem serviço pago) num único preset.
- **CreativePresenterMode:** `lib/creative-presenter-mode.ts` — prioridade `DIGITAL_TWIN > VOICE_ONLY > MOTION_GRAPHICS > PRODUCT_ONLY`; o Autopilot nunca trava por falta de GPU.
- **Job `GENERATE_DIGITAL_TWIN_VIDEO`:** `lib/digital-twin-job.ts` — 10 estados, retry só em etapas seguras, nunca reprocessa um artefato já `READY`, kill switch checado de novo antes de cada etapa crítica (`GENERATING_VOICE`/`GENERATING_AVATAR`).
- **DigitalTwinQualityGate:** `lib/digital-twin-quality-gate.ts` — última checagem antes de `READY_TO_PUBLISH`.
- **Segurança:** revogação (`lib/digital-twin-revoke.ts`) desativa perfil/voz imediatamente; isolamento cross-workspace testado (`tests/rodada7-digital-twin-real.test.ts`).
- **Tela:** Configurações → Conta → Digital Twin (`/conta/digital-twin`) — status real, CTA "Criar meu Digital Twin", sem redesenho do resto do Patrono.

## Rodada 8 — Digital Twin Operacional + Primeira Prévia Real

Ver `DIGITAL-TWIN-WORKER.md` e `DIGITAL-TWIN-BENCHMARK.md`. Nesta rodada:

- **Onboarding completo na UI:** `/conta/digital-twin` — consentimento (imagem/voz), upload de foto/vídeo de referência, voz (gravação pelo navegador via `MediaRecorder` ou upload de arquivo, com texto guiado em pt-BR), aprovação única do perfil, preferências globais (usar Digital Twin/voz automaticamente, permitir fallback, canal prioritário, estilo padrão).
- **Chatterbox corrigido:** o módulo Python correto é `chatterbox` (não `chatterbox_tts`) — descoberto inspecionando o pacote real via PyPI. Seleção de provider `PT_BR_SINGLE_LANGUAGE → MULTILINGUAL_PT → VOICE_ONLY_FALLBACK` (não existe checkpoint pt-BR dedicado — é o modelo multilíngue).
- **Job Queue real:** Postgres, claim atômico (`SELECT FOR UPDATE SKIP LOCKED`), heartbeat, retry automático, worker offline nunca perde o job.
- **Patrono Generation Worker:** processo separado (`worker/digital-twin-worker.ts`), scripts de instalação assistida para Windows, nunca dentro do request HTTP.
- **Runtime classificado:** `GPU_READY | GPU_LIMITED | CPU_ONLY | UNSUPPORTED`, com rótulos amigáveis na UI.
- **DigitalTwinPreviewScore:** nota composta com threshold; regeneração automática (até 3 tentativas) antes de acionar a usuária.
- **DigitalTwinIdentityLock:** depois da aprovação, o Autopilot só usa referências do perfil aprovado.
- **Dois kill switches independentes:** Autopilot (publicação) e Digital Twin (identidade/voz) — testados como independentes.
- **CreativePresenterMode integrado ao Autopilot:** escolha automática (`DIGITAL_TWIN > VOICE_ONLY > MOTION_GRAPHICS > PRODUCT_ONLY`), nunca perguntado a cada postagem.
- **Segunda prévia com produto:** layout `PRESENTER_PRODUCT_PANEL` (produto autorizado ao lado do avatar) ou `PRESENTER_INTRO_BROLL` — nunca finge que o avatar segura o produto fisicamente.

## Rodada 9 — Worker Local + Primeira Voz Real + Primeiro Avatar Real quando o hardware permitir

Ver `DIGITAL-TWIN-WORKER.md`, `DIGITAL-TWIN-BENCHMARK.md`, `DIGITAL-TWIN-MODEL-LICENSES.md` e `DIGITAL-TWIN-WINDOWS-INSTALL.md`. Nesta rodada:

- **Correção de enquadramento (regra 1):** o bloqueio ao Hugging Face/Supabase observado nas sandboxes de desenvolvimento é reclassificado como `CURRENT_ENVIRONMENT_NETWORK_RESTRICTION` (`lib/digital-twin-network-access.ts`) — nunca `MODEL_UNAVAILABLE`. Precisa ser retestado na máquina real antes de qualquer conclusão sobre disponibilidade do modelo.
- **Diagnóstico da máquina Windows:** `worker/diagnose-digital-twin-worker.ps1` (somente leitura, nunca modifica nada) + `classificarMaquina()` (`lib/digital-twin-machine-classification.ts`) → `FULL_DIGITAL_TWIN | VOICE_AND_LIPSYNC | VOICE_ONLY | MOTION_GRAPHICS_ONLY | UNAVAILABLE`.
- **Primeiro teste de voz real:** `lib/digital-twin-voice-job.ts`, `gerarPreviaDeVoz()` — Reference Audio → Chatterbox → texto novo em pt-BR → Voice Quality Gate → prévia privada. Texto oficial: *"Oi! Esta é uma prévia da minha voz digital no Patrono Seller. Os próximos conteúdos poderão ser produzidos automaticamente para mim."* Nunca publica.
- **Aprovação da voz separada da aprovação do avatar:** `DigitalTwinProfile.voiceApprovedAt` é independente de `approvedAt` — a usuária pode aprovar a voz antes do avatar estar pronto (`app/api/digital-twin/voice-approve`).
- **MuseTalk 1.5 + licenças por dependência:** `MUSETALK_VERSAO_PREFERIDA = '1.5'` e `podeAtivarMuseTalkComercialmente()` (`lib/lipsync-provider.ts`) bloqueiam ativação comercial até cada dependência (Whisper, ft-mse-vae, DWPose, S3FD, MMDetection, MMPose) ser revalidada manualmente — nenhuma começa `CLEARED`.
- **Primeiro pipeline de lip-sync real:** `lib/digital-twin-lipsync-job.ts`, `gerarPreviaLipSync()` — Reference Video + áudio Chatterbox → MuseTalk → vídeo de 5-10s, validado (duração real via FFmpeg) antes de aprovar como prévia.
- **`VOICE_ONLY_PREVIEW` — fallback real sem GPU:** `gerarPreviaVozSomente()` gera de verdade (FFmpeg, sem GPU) foto + voz clonada + motion graphics + legenda — nunca rotulado como lip-sync. Testado ponta a ponta nesta sandbox (ver `DIGITAL-TWIN-BENCHMARK.md`).
- **Segunda prévia com produto (pipeline completo):** `lib/digital-twin-product-preview-job.ts`, `gerarSegundaPreviaComProduto()` — roteiro/captions/CTA (preset TikTok) → voz → avatar (lip-sync ou VOICE_ONLY_PREVIEW) → produto autorizado → AI disclosure → commercial disclosure → TikTok preflight → `DigitalTwinQualityGate`. Nunca publica.
- **Worker pairing seguro:** `WorkerToken` (`lib/digital-twin-worker-token.ts`) — hash sha256, comparação `timingSafeEqual`, escopado a um único workspace, revogável, nunca loga o valor bruto.
- **Terceiro kill switch — Worker ON/OFF:** `DigitalTwinProfile.workerPaused`, independente do Autopilot e do Digital Twin. Um job de um perfil pausado nunca é reivindicado (`reivindicarProximoJob()`), mesmo por um worker sem pareamento.
- **Cache de modelos fora do Git + download retomável:** `lib/digital-twin-model-cache.ts` — diretório fora do repositório, download com `Range` HTTP retomado de onde parou.

## O que ainda não existe

Nenhuma geração de voz/avatar/lip-sync real de ponta a ponta com pesos verdadeiros do Chatterbox/MuseTalk (bloqueio de rede desta sandbox de desenvolvimento, reclassificado como `CURRENT_ENVIRONMENT_NETWORK_RESTRICTION` — precisa ser retestado na máquina real da proprietária). O que roda de verdade sem GPU e sem depender do Hugging Face: fallback Motion Graphics/Product Only (FFmpeg), `VOICE_ONLY_PREVIEW` completo (foto + voz + motion graphics + legenda), job queue completo, worker pairing, cache de modelos com download retomável, onboarding, preferências, três kill switches independentes.
