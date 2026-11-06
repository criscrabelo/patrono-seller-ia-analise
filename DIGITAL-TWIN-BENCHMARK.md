# Digital Twin — Benchmark Real

**Criado:** Rodada 8 (Digital Twin Operacional + Primeira Prévia Real).

Regra seguida à risca: **nada nesta tabela é estimado.** Cada linha é ou (a) um teste real executado nesta rodada, com resultado observado, ou (b) marcada `NÃO TESTADO — depende de GPU/pesos indisponíveis neste ambiente`, nunca um número inventado.

## Ambiente de teste (Rodada 8)

Detectado de verdade via `lib/digital-twin-runtime.ts` (`detectarCapacidadesRuntime()`), rodado nesta sessão:

```json
{
  "cpuCores": 4,
  "totalRamGB": 15.7,
  "freeRamGB": 14.9,
  "gpuDetected": false,
  "cudaAvailable": false,
  "freeDiskGB": 243.3
}
```

Classificação (`classificarRuntime()`): **`CPU_ONLY`**.

## Conectividade real testada nesta rodada

| Destino | Resultado | Método |
|---|---|---|
| `pypi.org` | ✅ Acessível (HTTP 200) | `curl` real |
| PyPI: pacote `chatterbox-tts` | ✅ Baixável — versão 0.1.7 confirmada, `pip index versions` e `pip download` reais | `pip3 download --no-deps` |
| `huggingface.co` (site) | ❌ Bloqueado — `403 connect_rejected (organization policy)` | `curl` real |
| `huggingface.co/api/models/...` | ❌ Bloqueado — mesmo erro | `curl` real |

**Conclusão real:** o pacote Python do Chatterbox É instalável neste ambiente (PyPI liberado), mas os **pesos do modelo** (`ve.pt`, `t3_mtl23ls_v2.safetensors`, `s3gen.pt`, `conds.pt`) são baixados via Hugging Face Hub dentro do próprio pacote (`hf_hub_download`) — e o Hugging Face está bloqueado pela política de rede deste ambiente. Ou seja: **mesmo com o pacote instalado, a geração de voz real não é possível aqui**, independente de GPU.

## Correção real encontrada (bug da Rodada 7)

Inspecionando o wheel real do `chatterbox-tts` (`unzip -l`/`unzip -p`), descobrimos que:
- O módulo Python correto é `chatterbox` (não `chatterbox_tts`, como a Rodada 7 assumia sem verificar).
- Não existe um repositório `ResembleAI/Chatterbox-Multilingual-pt-br` — o único `REPO_ID` do modelo multilíngue é `ResembleAI/chatterbox`, com `pt` (Portuguese genérico) em `SUPPORTED_LANGUAGES`.
- Existe também `ResembleAI/chatterbox-turbo` (variante "turbo", não avaliada nesta rodada).

`lib/chatterbox-adapter.ts` foi corrigido para refletir isso — ver commit da Rodada 8.

## Tabela de testes

| Motor | Hardware | Entrada | Saída | Tempo | Memória | Resultado |
|---|---|---|---|---|---|---|
| Chatterbox TTS (import do módulo Python) | CPU_ONLY (4 cores, 15.7GB RAM) | `import chatterbox` | — | — | — | **TESTADO REALMENTE**: `ModuleNotFoundError` — pacote não instalado neste ambiente (decisão: não instalar o stack pesado de torch/transformers/diffusers só para confirmar um `import`, já que os pesos são inalcançáveis de qualquer forma — ver seção de conectividade acima). |
| Chatterbox TTS (síntese de voz real, `TEXTO_TESTE_PT_BR`) | — | texto pt-BR | áudio | — | — | **PREPARADO PARA GPU** — não executado. Depende de pesos do Hugging Face Hub, bloqueado neste ambiente. |
| MuseTalk (lip-sync real) | — | vídeo + áudio | vídeo sincronizado | — | — | **PREPARADO PARA GPU** — não executado. Mesma limitação de rede + exige GPU/CUDA que este ambiente não tem. |
| Postgres Job Queue — claim atômico concorrente | CPU_ONLY | 2 workers, 1 job `QUEUED` | 1 worker vence, 1 recebe `null` | ~15-30ms por claim | — | **TESTADO REALMENTE** — `reivindicarProximoJob()` rodado com `Promise.all` de dois workers reais contra o Postgres local; nunca os dois pegaram o mesmo job. |
| Worker end-to-end (`--once`) | CPU_ONLY | 1 job `QUEUED` sem asset | Fallback Motion Graphics tentado, falha honesta (sem asset), job reagendado (retry automático) | < 1s (sem asset real para baixar) | — | **TESTADO REALMENTE** — `npx tsx worker/digital-twin-worker.ts --once` rodado contra o Postgres local nesta sessão. |
| RendererFFmpeg (Motion Graphics fallback, com asset real) | CPU_ONLY | imagem + overlays | vídeo MP4 9:16 | (ver Rodada 5 — já medido em rodadas anteriores, reaproveitado sem mudança nesta rodada) | — | **TESTADO EM RODADA ANTERIOR** (Rodada 5), reaproveitado aqui sem re-medição. |

## O que isso significa para a proprietária

- **Hoje** (ambiente sem GPU, sem acesso ao Hugging Face): o Digital Twin com voz clonada e avatar realista **não pode gerar nada de verdade** — o Autopilot cai automaticamente para `MOTION_GRAPHICS`/`PRODUCT_ONLY` (voz não clonada, motion graphics, captions, CTA), que **funciona de verdade** e produz vídeo TikTok-ready.
- **Para ativar o Digital Twin de verdade**, é necessário rodar o worker numa máquina com: acesso à internet SEM bloqueio ao Hugging Face (o bloqueio observado é uma política deste ambiente de desenvolvimento específico, não do Chatterbox/MuseTalk em si) e, para MuseTalk, uma GPU NVIDIA compatível.

## Custo

Nenhum serviço pago usado para gerar os números acima — apenas `curl`/`pip download` (grátis) e o Postgres/FFmpeg já existentes no projeto.

---

## Rodada 9 — Worker Local + Primeira Voz Real + Primeiro Avatar Real quando o hardware permitir

Mesma regra: só números medidos de verdade nesta sessão entram aqui. Ambiente idêntico ao da Rodada 8 (4 cores, 15.7GB RAM, sem GPU, `huggingface.co`/`supabase.com` bloqueados com HTTP 403 — reclassificado corretamente como `CURRENT_ENVIRONMENT_NETWORK_RESTRICTION`, nunca `MODEL_UNAVAILABLE`, ver regra 1 e `lib/digital-twin-network-access.ts`).

### Correção de enquadramento (regra 1)

O bloqueio ao Hugging Face observado nas Rodadas 8 e 9 é, de novo, uma restrição desta sandbox específica (proxy da organização retorna 403 tanto para `huggingface.co` quanto para `supabase.com`) — **não** uma indisponibilidade do Chatterbox/MuseTalk em si. `verificarAcessoHuggingFace()` agora devolve `CURRENT_ENVIRONMENT_NETWORK_RESTRICTION` com o texto "retestar na máquina real", em vez de qualquer coisa que sugerisse "modelo indisponível". Isso precisa ser retestado numa máquina real (Windows da proprietária) antes de qualquer conclusão final sobre disponibilidade.

### Tabela de testes (Rodada 9)

| Item | Hardware | Entrada | Saída | Tempo medido | Memória | Resultado |
|---|---|---|---|---|---|---|
| `VOICE_ONLY_PREVIEW` real (foto + voz clonada + motion graphics + legenda via libass) | CPU_ONLY (4 cores) | imagem 480×480 + áudio de 8.4s + legenda de ~140 caracteres | MP4 1080×1920 com áudio, 356.297 bytes | **4.709ms** (render FFmpeg completo) | RSS do processo Node estável (~109MB antes/depois — FFmpeg roda como processo filho) | **TESTADO REALMENTE** — `ffmpeg` real, sem mock, medido com `Date.now()` antes/depois do `execFile`. |
| Descoberta: este build do `ffmpeg-static` **não tem o filtro `drawtext` compilado** | CPU_ONLY | `ffmpeg -filters` | lista de filtros sem `drawtext`, com `subtitles`/`ass` (libass) presentes | — | — | **TESTADO REALMENTE** — todas as legendas do `VOICE_ONLY_PREVIEW` passaram a usar `subtitles=filename=...` (arquivo `.srt` gerado por job) em vez de `drawtext`. Os métodos mais antigos do `RendererFFmpeg` que ainda usam `drawtext` (Reel/Carrossel/TikTok, Rodadas 5-6) **não foram alterados nesta rodada** e portanto continuam potencialmente quebrados neste ambiente específico — recomenda-se testar `drawtext` na máquina real de produção antes de assumir que funciona lá. |
| Worker token — gerar (`gerarTokenWorker`) | CPU_ONLY, Postgres local | workspaceId + label | token de 64 hex chars + hash gravado | **45ms** | — | **TESTADO REALMENTE** — contra o Postgres local desta sessão. |
| Worker token — verificar (`verificarTokenWorker`) | CPU_ONLY, Postgres local | token bruto | workspaceId resolvido + `lastUsedAt` atualizado | **4ms** | — | **TESTADO REALMENTE**. |
| Download retomável (`baixarComRetomada`) | CPU_ONLY | arquivo de 2.097.152 bytes, 60% já baixado (queda simulada), servidor HTTP local com suporte a `Range` | download retomado dos 40% restantes, conteúdo final byte-a-byte idêntico ao original | **65ms** para retomar os 838.861 bytes restantes | — | **TESTADO REALMENTE** — servidor HTTP real (`http.createServer`) rodando em `localhost`, não mockado. |
| Chatterbox — `import chatterbox` | CPU_ONLY | `python3 -c "import chatterbox"` | `ModuleNotFoundError: No module named 'chatterbox'` | — | — | **TESTADO REALMENTE** — pacote continua não instalado nesta sandbox (mesma decisão da Rodada 8: não instalar o stack pesado de torch/transformers só para confirmar o `import`, já que os pesos dependem do Hugging Face, bloqueado aqui). Precisa ser testado na máquina real via `worker/diagnose-digital-twin-worker.ps1`. |
| MuseTalk — versão instalada/preferida | — | — | `MUSETALK_VERSAO_PREFERIDA = '1.5'` documentada; nenhuma instalação real nesta sandbox (sem GPU) | — | — | **PREPARADO, NÃO EXECUTADO** — a preferência pela 1.5 é só uma configuração; a instalação real só acontece numa máquina com GPU. |
| Lip-sync real (MuseTalk) | — | Reference Video + áudio | vídeo 5-10s sincronizado | — | — | **PREPARADO PARA GPU** — `gerarPreviaLipSync()` tem a lógica completa (chamada ao provider + validação de duração 5-10s) coberta por testes com um provider **mockado**; a chamada real ao MuseTalk depende de GPU/pesos que este ambiente não tem. |
| Validação de duração do pipeline de lip-sync (5-10s) | CPU_ONLY | vídeo real de 7s / vídeo real de 15s gerados via FFmpeg | 7s aprovado, 15s reprovado com motivo explícito | < 1s por validação (leitura FFmpeg do cabeçalho) | — | **TESTADO REALMENTE** — vídeos de teste gerados com `ffmpeg -f lavfi`, validados com `analisarVideo()` real (não mockado). |

### O que isso significa para a proprietária (Rodada 9)

- **Hoje**, nesta sandbox de desenvolvimento: voz clonada e lip-sync continuam impossíveis de gerar de verdade (mesma causa da Rodada 8 — bloqueio de rede do ambiente, não do modelo). O fallback real e testado (`VOICE_ONLY_PREVIEW`) funciona de ponta a ponta com FFmpeg puro, sem GPU, sem custo.
- **Na máquina Windows real da proprietária**, o diagnóstico (`worker/diagnose-digital-twin-worker.ps1`) precisa rodar primeiro — ele testa acesso real ao Hugging Face/Supabase/Patrono dali, sem herdar o bloqueio desta sandbox.

### Custo (Rodada 9)

R$ 0,00 — nenhuma chamada a serviço pago. Servidor HTTP do teste de download é local (`http.createServer`, sem custo). Banco de dados é o Postgres local já usado pelo projeto.

---

## Retomada da Rodada 9 — instalação real do pacote `chatterbox-tts` (avanço genuíno sobre a Rodada 8/9)

Diferente das Rodadas 8 e 9 (que decidiram não instalar o stack pesado "só para confirmar um import"), nesta retomada o `pip install chatterbox-tts==0.1.7` foi executado de verdade, num venv Python 3.11 isolado (`.venv-chatterbox-test`, fora do repositório Git), porque o PyPI já era sabidamente acessível e o objetivo do usuário pede explicitamente "Chatterbox funcionando" como prioridade técnica #4.

| Item | Entrada | Saída | Resultado |
|---|---|---|---|
| `pip install chatterbox-tts==0.1.7` (venv isolado, PyPI real) | `pip install chatterbox-tts==0.1.7` | Instalação completa: `torch==2.6.0`, `torchaudio==2.6.0`, `transformers==5.2.0`, `diffusers==0.29.0` (exatamente as versões pinadas em `worker/requirements-chatterbox.txt`), mais `chatterbox-tts-0.1.7` e todas as dependências transitivas | **TESTADO REALMENTE** — `pip install` real contra PyPI, sem mock, log completo salvo. |
| `import chatterbox` / `from chatterbox.tts import ChatterboxTTS` | módulo Python | `ChatterboxTTS` importado com sucesso, `torch.__version__ == '2.6.0+cu124'`, `torch.cuda.is_available() == False` | **TESTADO REALMENTE** — o pacote é genuinamente instalável e importável nesta sandbox. Corrige a limitação da Rodada 9 anterior (que só tinha `ModuleNotFoundError` por decisão de não instalar). |
| `ChatterboxTTS.from_pretrained(device='cpu')` (tentativa real de carregar os pesos) | chamada real ao Hugging Face Hub | `httpx.ProxyError: 403 Forbidden` ao buscar metadados do arquivo no Hub (`get_hf_file_metadata` → proxy da organização recusa) | **TESTADO REALMENTE** — confirma com evidência concreta (stack trace real, não suposição) que o único bloqueio é a rede desta sandbox ao Hugging Face, exatamente como já classificado (`CURRENT_ENVIRONMENT_NETWORK_RESTRICTION`). O pacote em si, uma vez instalado, chega exatamente até este ponto e não mais longe. |

### Conclusão prática desta descoberta

- O Chatterbox **não é mais uma incógnita de "será que instala?"** — instala e importa de verdade, com as versões exatas já documentadas.
- O único obstáculo real e medido para gerar a primeira voz clonada nesta sandbox é o download dos pesos do Hugging Face Hub (`ve.pt`, `t3_mtl23ls_v2.safetensors`, `s3gen.pt`, `conds.pt`), bloqueado pela política de rede desta sandbox de desenvolvimento — não pela existência/licença/funcionamento do Chatterbox.
- Na máquina Windows real da proprietária (sem esse bloqueio de proxy), a expectativa é que `pip install -r worker/requirements-chatterbox.txt` funcione igual, e `ChatterboxTTS.from_pretrained()` consiga baixar os pesos e carregar o modelo — isso ainda precisa ser confirmado na máquina real, não é assumido aqui.
- Este venv de teste (`.venv-chatterbox-test/`) é descartável, fica fora do Git (`/tmp`, não no repositório) e não é usado por nenhum código de produção — serviu só para produzir esta evidência real.

### Custo (Retomada)

R$ 0,00 — `pip install` contra PyPI é gratuito; nenhum peso de modelo foi baixado (o download real do Hugging Face foi bloqueado antes de transferir qualquer byte de peso).

---

## Máquina real da proprietária — primeira voz clonada de verdade (Windows, sem GPU)

Primeira execução fora da sandbox de desenvolvimento. Todos os números abaixo
foram **medidos nesta máquina**, não estimados. O bloqueio de rede que limitava
as rodadas anteriores não existe aqui: `huggingface.co` responde 200.

### Hardware real

| Item | Valor |
|---|---|
| Windows | 11 Home, build 26200 |
| CPU | Intel Core 7 240H — 10 núcleos físicos / 16 threads |
| RAM | 15,7 GB (2×8 GB @ 5600 MHz) |
| GPU | Intel(R) Graphics integrada, ~2 GB — **nenhuma GPU NVIDIA** |
| CUDA / driver NVIDIA | ausentes (`nvidia-smi` e `nvcc` não existem) |
| Disco livre | 723 GB |

Classificação resultante (`classificarMaquina()`): **`VOICE_ONLY`** — confirmada
por medição. `FULL_DIGITAL_TWIN` e `VOICE_AND_LIPSYNC` são inatingíveis aqui:
`REQUISITOS_MINIMOS_AVATAR_LOCAL` exige 8 GB de VRAM e não há GPU NVIDIA.

### Ambiente instalado

| Item | Versão | Onde |
|---|---|---|
| Python | 3.11.9 (64-bit) | `%LOCALAPPDATA%\Programs\Python\Python311` (escopo de usuário) |
| FFmpeg | 9.0.1 (Gyan.FFmpeg via winget) | pacote do WinGet |
| torch / torchaudio | **2.6.0+cpu** — build sem CUDA | venv |
| chatterbox-tts | 0.1.7 | venv |
| venv | 2,03 GB | **`C:\patrono-venv`** (ver abaixo) |
| Pesos do modelo | 2,99 GB | `~/.cache/huggingface` |

### Medições de síntese (CPU, 10 threads)

| Teste | Entrada | Saída | Tempo | Resultado |
|---|---|---|---|---|
| `ChatterboxMultilingualTTS.from_pretrained('cpu')` — 1ª vez | — | modelo carregado | **561,4 s** (inclui baixar 2,99 GB) | **TESTADO REALMENTE** |
| `from_pretrained` com pesos em cache | — | modelo carregado | ~60 s por processo | **TESTADO REALMENTE** |
| `generate(texto, language_id='pt', audio_prompt_path=...)` — script direto | texto pt-BR + gravação real de 18,3 s | WAV 12,6 s, 24 kHz mono | **91,2 s** | **TESTADO REALMENTE** — voz clonada audível |
| `ChatterboxVoiceCloneProvider.sintetizar()` — pelo adapter do Patrono | WebM do bucket + texto pt-BR | WAV 9,5 s | **101,6 s** (carga + síntese) | **TESTADO REALMENTE** |

**Fator de tempo real: ~7,2×** — cada segundo de fala custa ~7 s de CPU. Um
vídeo com 30 s de narração leva ~3,5 min; com 60 s, ~7 min. Utilizável para
alguns vídeos por dia; inviável para lote grande. Como a carga do modelo custa
~1 min por processo, o worker deve ficar **residente**, não subir e descer por job.

### Bugs reais encontrados e corrigidos nesta execução

Nenhum destes é defensividade hipotética — todos falharam de verdade aqui:

1. **`sintetizar()` nunca sintetizava.** O método lançava erro em todos os
   caminhos; onde deveria estar a chamada ao Python havia o comentário
   "Chamada real ficaria aqui". Implementado em `worker/chatterbox_synthesize.py`
   + `lib/chatterbox-adapter.ts`.
2. **Caminho longo demais para o venv.** `worker\.venv-digital-twin` dentro do
   repositório (que fica no OneDrive) gera caminhos de **266 caracteres**, acima
   do limite de 260 do Windows; o `pip install` do PyTorch morreu aos 1,6 GB com
   `OSError [Errno 2]`. O venv passou a ser configurável (`worker/resolver-venv.ps1`),
   com padrão `C:\patrono-venv`. Efeito colateral positivo: fica fora do OneDrive,
   que senão sincronizaria ~2 GB para a nuvem.
3. **Atalho falso do Python.** `Get-Command python` encontra o stub da Microsoft
   Store em `WindowsApps`, que não é interpretador — o diagnóstico chegou a
   reportar `pythonDisponivel: true` sem haver Python instalado. `setup-` passou
   a validar executando `--version`.
4. **Acentuação corrompida.** O Python no Windows escreve stdout em cp1252;
   "áudio de referência" chegava como "�udio de refer�ncia" ao Node. Resolvido
   com `reconfigure(encoding='utf-8')` e passando o texto por arquivo, nunca por `argv`.
5. **Áudio de referência em WebM.** O worker baixa o `VOICE_REFERENCE` com sufixo
   `.wav`, mas o navegador grava **WebM** — o librosa falha com `NoBackendError`,
   uma exceção **sem mensagem**. O script transcodifica com ffmpeg antes de sintetizar.
6. **ffmpeg fora do `PATH`.** O winget altera o PATH do usuário, mas processos
   já abertos mantêm o antigo: `shutil.which("ffmpeg")` devolvia `None` com o
   ffmpeg 9.0.1 instalado. A busca passou a cobrir `DIGITAL_TWIN_FFMPEG`, o
   atalho do WinGet e a pasta real do pacote.

### Custo

R$ 0,00. Nenhum serviço pago, nenhuma GPU em nuvem, nenhuma API de voz.
Python, FFmpeg, Chatterbox e os pesos do modelo são gratuitos e rodam local —
o áudio da proprietária nunca sai da máquina dela.
