# Digital Twin — Licenças de Modelos Avaliados

**Criado:** Rodada 7 (Digital Twin Real). **Atualizado:** Rodada 8 — correção real do Chatterbox (módulo/repositório verificados via PyPI de verdade) e inventário de dependências do MuseTalk. **Atualizado novamente:** Rodada 9 — preferência pela versão 1.5 do MuseTalk e o inventário de dependências agora é um **gate de código** (`podeAtivarMuseTalkComercialmente()`, `lib/lipsync-provider.ts`), não só uma tabela em Markdown.

**Regra de pesquisa:** este ambiente de desenvolvimento não tem acesso à internet externa nesta rodada — toda linha reflete o conhecimento disponível sobre cada projeto no momento em que a Rodada 7 foi escrita, registrado como **A VERIFICAR** onde não há confirmação ao vivo contra a documentação/licença atual. Antes de instalar qualquer um em produção, reconferir a licença/termos vigentes.

| Modelo | Função | Licença código | Licença pesos | Comercial | GPU | Decisão |
|---|---|---|---|---|---|---|
| **Chatterbox TTS** (Resemble AI, oficial, pacote `chatterbox-tts` 0.1.7 no PyPI, módulo `chatterbox`) | Clonagem de voz (voice cloning), TTS multilíngue (inclui `pt`, via `ChatterboxMultilingualTTS`, `REPO_ID = ResembleAI/chatterbox`) | MIT | MIT (conforme repositório oficial) | Sim — self-hosted | CPU funciona, GPU acelera | **ADOTADO** (self-hosted apenas — nunca a API paga da Resemble). Pacote confirmado instalável via PyPI nesta rodada; pesos bloqueados por acesso ao Hugging Face neste ambiente (ver `DIGITAL-TWIN-BENCHMARK.md`). **Correção Rodada 8:** não existe repositório dedicado "pt-br" — é o mesmo `ResembleAI/chatterbox` multilíngue. |
| **MuseTalk** (preferencialmente versão **1.5** — Rodada 9, regra 12; nunca um fork da comunidade como implementação principal) | Lip-sync (sincronização labial) | MIT (código) | Modelos informados pelo projeto como disponíveis para uso comercial — **A VERIFICAR** antes de produção | Sim, conforme informado pelo projeto, **mas condicionado às dependências abaixo** (ver gate de código) | GPU recomendada (VRAM ainda não medida neste ambiente) | **CANDIDATO PRINCIPAL** (`AVAILABLE_CANDIDATE`). `verificarDisponibilidadeMuseTalk()` — não instalado neste ambiente nesta rodada; quando instalado, também reporta a versão detectada (`versaoPreferidaConfirmada`). Reconferir a licença de cada dependência efetivamente usada antes de integrar em produção. |
| **Wav2Lip** (tradicional, projeto original) | Lip-sync | Código com uso restrito conforme o projeto original | Modelos publicados restritos a uso pessoal/acadêmico/pesquisa/não comercial | **NÃO** — incompatível com finalidade comercial do Patrono | GPU | **BLOCKED_BY_LICENSE** — nunca integrado (`lib/lipsync-provider.ts`, `bloquearMotor()` impede uso mesmo por engano). |
| **LivePortrait** | Geração/animação de retrato (avatar) | Mista — cadeia de dependências inclui componentes de detecção facial com restrições comerciais não totalmente esclarecidas | Não totalmente esclarecida nesta rodada | **NÃO CONFIRMADO** | GPU | **BLOCKED_BY_LICENSE** nesta rodada — só reavaliar se TODA a cadeia de dependências for confirmada compatível com uso comercial. |

## Inventário de dependências do MuseTalk (Rodada 8, regra 17)

Antes de qualquer instalação definitiva, cada dependência da cadeia do MuseTalk precisa ser verificada individualmente — **licença MIT do projeto principal não cobre automaticamente as dependências**. Nenhuma foi instalada/verificada ao vivo nesta rodada (sem acesso ao Hugging Face); linhas marcadas **A VERIFICAR**:

| Dependência | Função na cadeia | Licença (a confirmar) | Status |
|---|---|---|---|
| MuseTalk (núcleo) | Lip-sync | MIT (código) | A VERIFICAR (pesos) |
| Whisper (OpenAI) | Alinhamento áudio/texto | MIT | A VERIFICAR contra a versão exata usada |
| ft-mse-vae | Codificação de frames | A VERIFICAR | A VERIFICAR |
| DWPose | Estimativa de pose | A VERIFICAR — projetos de pose estimation frequentemente têm licenças de pesos separadas do código | A VERIFICAR |
| S3FD | Detecção facial | A VERIFICAR | A VERIFICAR |
| MMDetection | Framework de detecção (OpenMMLab) | Apache 2.0 (código), mas modelos individuais variam | A VERIFICAR modelo específico usado |
| MMPose | Framework de pose (OpenMMLab) | Apache 2.0 (código), modelos variam | A VERIFICAR modelo específico usado |

**Regra permanente desta seção:** se qualquer dependência acima não puder ser confirmada como compatível com uso comercial, o MuseTalk **não é usado** até a cadeia ser resolvida (substituição do componente problemático ou confirmação da licença) — nunca "assumir que deve estar tudo bem".

### Gate de código (Rodada 9)

Esta tabela deixou de ser só documentação: `lib/lipsync-provider.ts` tem `MUSETALK_DEPENDENCY_LICENSES` (o mesmo inventário acima, como dados) e `podeAtivarMuseTalkComercialmente()`, que só devolve `pode: true` quando **todas** as dependências estão `CLEARED` — nenhuma começa assim por padrão (testado em `tests/rodada9-worker-real.test.ts`: hoje `podeAtivarMuseTalkComercialmente().pode` é sempre `false`, com uma pendência por dependência ainda não revalidada). Mudar uma dependência para `CLEARED` exige edição manual do código por alguém que efetivamente conferiu a licença — nunca automático.

## Regra permanente

Nenhum motor listado como `BLOCKED_BY_LICENSE` pode ser integrado, mesmo que tecnicamente funcione no ambiente — a decisão é sobre licença, não sobre capacidade técnica. Qualquer novo candidato entra nesta tabela **antes** de qualquer linha de código de integração ser escrita, com a mesma coluna de decisão.

## Dependências pesadas (regra 49)

Nenhum modelo/peso foi adicionado ao repositório Git nesta rodada. Nenhum pacote Python pesado (Chatterbox, MuseTalk) foi instalado neste ambiente — os adapters (`lib/chatterbox-adapter.ts`, `lib/lipsync-provider.ts`) fazem uma checagem real de disponibilidade (`import` via subprocesso) e nunca simulam sucesso quando o pacote não está presente.
