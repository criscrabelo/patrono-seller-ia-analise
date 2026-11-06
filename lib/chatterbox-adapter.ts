/**
 * ChatterboxVoiceCloneProvider (Rodada 7, corrigido na Rodada 8) —
 * primeiro provider REAL de `VoiceCloneProvider` (lib/digital-twin.ts),
 * usando o Chatterbox TTS oficial da Resemble AI: open source, MIT,
 * clonagem de voz, execução local, sem API paga.
 *
 * REGRA CRÍTICA: nunca usar a API paga da Resemble, nunca enviar a voz da
 * proprietária para um serviço externo — só a versão self-hosted/local.
 *
 * CORREÇÃO REAL (Rodada 8): a Rodada 7 checava `import chatterbox_tts`,
 * que está ERRADO — verificado baixando de verdade o pacote `chatterbox-tts`
 * do PyPI (pip index/download funcionam neste ambiente): o pacote Python se
 * chama `chatterbox-tts`, mas o MÓDULO importável é `chatterbox` (ex.:
 * `from chatterbox import ChatterboxMultilingualTTS`). `chatterbox/__init__.py`
 * exporta `ChatterboxTTS` (inglês, mono-idioma), `ChatterboxVC` (voice
 * conversion) e `ChatterboxMultilingualTTS` (multilíngue, inclui `pt`).
 *
 * NÃO EXISTE um repositório separado "ResembleAI/Chatterbox-Multilingual-pt-br"
 * — inspecionando `chatterbox/mtl_tts.py` de verdade, o único `REPO_ID` do
 * modelo multilíngue é `ResembleAI/chatterbox` (o mesmo repo do modelo em
 * inglês, com checkpoints diferentes), e `pt` (Portuguese genérico, não
 * "pt-BR" como variante própria) está em `SUPPORTED_LANGUAGES`. A Rodada 8
 * corrige a expectativa da Rodada 7 para refletir a realidade do projeto.
 *
 * Os PESOS do modelo (`ve.pt`, `t3_mtl23ls_v2.safetensors`, `s3gen.pt`,
 * `conds.pt` etc.) são baixados pelo próprio pacote via `huggingface_hub`
 * — e `huggingface.co` está bloqueado pela política de rede DESTE
 * ambiente de desenvolvimento específico (confirmado de novo na Rodada 9:
 * `curl` devolve 403 "connect_rejected"). Isso é
 * `CURRENT_ENVIRONMENT_NETWORK_RESTRICTION` (lib/digital-twin-network-access.ts)
 * — NUNCA documentado como o modelo estar indisponível globalmente
 * (`MODEL_UNAVAILABLE`). O repositório `ResembleAI/chatterbox` é público;
 * na máquina real da proprietária, sem esse bloqueio de proxy, a mesma
 * chamada deve funcionar — ver `DIGITAL-TWIN-BENCHMARK.md`.
 */

import { execFile } from 'child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type { VoiceCloneProvider } from './digital-twin'
import { verificarAcessoHuggingFace } from './digital-twin-network-access'

const execFileAsync = promisify(execFile)

/**
 * Descobre o Python que tem o Chatterbox instalado — nunca assume `python3`
 * (que não existe no Windows) nem uma pasta fixa.
 *
 * Ordem: `DIGITAL_TWIN_PYTHON` (caminho direto do interpretador) →
 * `DIGITAL_TWIN_VENV` (raiz do virtualenv) → `worker/.venv-digital-twin`
 * (padrão histórico) → `python3`/`python` do PATH.
 *
 * O venv NÃO pode ser assumido dentro do repositório: num caminho profundo
 * (ex.: a pasta do OneDrive da proprietária) a instalação do PyTorch estoura
 * o limite de 260 caracteres do Windows, e o venv precisa morar num caminho
 * curto como `C:\patrono-venv`. Ver DIGITAL-TWIN-WINDOWS-INSTALL.md.
 */
export function resolverPythonDoChatterbox(): string {
  const direto = process.env.DIGITAL_TWIN_PYTHON
  if (direto && existsSync(direto)) return direto

  const candidatosDeVenv = [
    process.env.DIGITAL_TWIN_VENV,
    join(process.cwd(), 'worker', '.venv-digital-twin'),
  ].filter((v): v is string => Boolean(v))

  for (const venv of candidatosDeVenv) {
    for (const rel of [join('Scripts', 'python.exe'), join('bin', 'python')]) {
      const caminho = join(venv, rel)
      if (existsSync(caminho)) return caminho
    }
  }

  return process.platform === 'win32' ? 'python' : 'python3'
}

export type ChatterboxAvailability =
  | { available: false; reason: string }
  | { available: true; pythonVersion: string }

/**
 * Nunca assume que o Chatterbox está instalado — tenta importar de verdade
 * (módulo correto: `chatterbox`).
 *
 * O padrão é o interpretador RESOLVIDO, não `python3`: esta função é chamada
 * sem argumento por `detectarCapacidadesDeGeracao()`, e no Windows `python3`
 * não existe. O efeito era silencioso e grave — a detecção devolvia
 * `available: false` com o Chatterbox instalado e funcionando, o worker
 * concluía que não havia voz disponível e caía no fallback de motion
 * graphics, que então falhava por falta de asset de mídia. Verificado na
 * máquina real: `Chatterbox=false` mesmo após a síntese já ter funcionado.
 */
export async function verificarDisponibilidadeChatterbox(pythonBin: string = resolverPythonDoChatterbox()): Promise<ChatterboxAvailability> {
  try {
    const { stdout } = await execFileAsync(pythonBin, ['-c', 'import chatterbox; import sys; print(sys.version)'])
    return { available: true, pythonVersion: stdout.trim() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha desconhecida'
    return { available: false, reason: `Chatterbox TTS não encontrado no ambiente (${msg}). Instale o pacote oficial da Resemble AI (self-hosted) antes de usar — ver worker/requirements-chatterbox.txt.` }
  }
}

// ── Provider Selection (Rodada 8, regra 7) ────────────────────────────────
// Cadeia real de prioridade. `PT_BR_SINGLE_LANGUAGE` é mantido como conceito
// na cadeia (a documentação oficial pode vir a publicar um checkpoint
// dedicado no futuro), mas HOJE não existe — o código nunca finge que
// existe; `disponibilidadeDePtBrDedicado()` sempre devolve `false` até um
// repositório real e verificado ser confirmado.

export const CHATTERBOX_PROVIDER_TIERS = ['PT_BR_SINGLE_LANGUAGE', 'MULTILINGUAL_PT', 'VOICE_ONLY_FALLBACK'] as const
export type ChatterboxProviderTier = (typeof CHATTERBOX_PROVIDER_TIERS)[number]

export interface ChatterboxProviderSelection {
  tier: ChatterboxProviderTier
  modelo: string | null
  motivo: string
}

/** Nunca assumido disponível — nenhum checkpoint pt-BR dedicado foi confirmado (ver comentário do arquivo). */
function disponibilidadeDePtBrDedicado(): boolean {
  return false
}

/**
 * Escolhe o tier real a usar, na ordem PT_BR_SINGLE_LANGUAGE → MULTILINGUAL_PT
 * → VOICE_ONLY_FALLBACK. Cada resultado registra QUAL modelo geraria o
 * áudio (regra 7: "registrar qual modelo gerou cada arquivo").
 */
export function selecionarProviderChatterbox(disponibilidade: ChatterboxAvailability): ChatterboxProviderSelection {
  if (disponibilidadeDePtBrDedicado()) {
    return { tier: 'PT_BR_SINGLE_LANGUAGE', modelo: 'chatterbox-pt-br (não confirmado nesta rodada)', motivo: 'Checkpoint dedicado pt-BR não existe/confirmado — nunca selecionado de verdade nesta rodada.' }
  }
  if (disponibilidade.available) {
    return { tier: 'MULTILINGUAL_PT', modelo: 'ChatterboxMultilingualTTS (ResembleAI/chatterbox, language_id="pt")', motivo: 'Pacote Chatterbox disponível — usaria o modelo multilíngue com idioma pt.' }
  }
  return { tier: 'VOICE_ONLY_FALLBACK', modelo: null, motivo: disponibilidade.reason }
}

/**
 * Texto de teste padronizado em pt-BR (Rodada 7, regra 13) — cobre
 * pronúncia, naturalidade, ritmo, pausas, nome de marca, número, preço e
 * CTA num único trecho, para avaliar a mesma frase toda vez que o
 * Chatterbox for testado/reavaliado.
 */
export const TEXTO_TESTE_PT_BR =
  'Oi! Encontrei uma opção interessante na categoria eletrônicos. ' +
  'O produto da marca AcmeTech custa R$ 149,90 — um preço bem em conta. ' +
  'Ele vem com bateria de 20 horas e conexão sem fio. ' +
  'Confira o preço atual no link da bio.'

/**
 * Texto guiado curto para a proprietária gravar UMA vez no onboarding
 * (Rodada 8, regra 4) — cobre variedade fonética suficiente sem exigir
 * gravação longa.
 */
export const TEXTO_GUIADO_ONBOARDING_VOZ =
  'Olá! Esta é a minha voz para o Patrono. Hoje é um bom dia para encontrar ofertas incríveis, ' +
  'com números como 10, 25 e 100, e preços como R$ 49,90. Espero que você aproveite!'

/**
 * Script de síntese que roda no venv do worker (subprocesso local).
 *
 * `DIGITAL_TWIN_SYNTH_SCRIPT` tem precedência sobre o caminho derivado do
 * diretório atual: uma tarefa agendada do Windows roda a partir de
 * `System32`, não da pasta do projeto, e ali `process.cwd()` apontaria para
 * um lugar onde o script não existe. `start-digital-twin-worker.ps1` define
 * essa variável com o caminho absoluto.
 */
const CAMINHO_SCRIPT_SINTESE =
  process.env.DIGITAL_TWIN_SYNTH_SCRIPT || join(process.cwd(), 'worker', 'chatterbox_synthesize.py')

/**
 * Teto de tempo para uma síntese. Generoso de propósito: medido na máquina
 * real da proprietária (CPU, sem GPU), a síntese roda a ~7x o tempo real e
 * a carga do modelo leva ~1 min por processo — ver DIGITAL-TWIN-BENCHMARK.md.
 * Um teto apertado transformaria "lento, mas funcionando" em falha.
 */
const TIMEOUT_SINTESE_MS = 30 * 60 * 1000

type RespostaDoScript =
  | { ok: true; saida: string; duracaoSegundos: number; segundosSintese: number }
  | { ok: false; erro: string; tipo?: string }

/**
 * O script garante UMA linha de JSON no stdout (o resto vai para stderr).
 * Ainda assim lemos a última linha não vazia: em Windows um `print` de
 * biblioteca pode furar o contrato, e falhar por isso seria falha boba.
 */
function interpretarSaidaDoScript(stdout: string): RespostaDoScript {
  const linhas = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  const ultima = linhas[linhas.length - 1]
  if (!ultima) return { ok: false, erro: 'O script de síntese não devolveu resultado (stdout vazio).' }
  try {
    return JSON.parse(ultima) as RespostaDoScript
  } catch {
    return { ok: false, erro: `Resposta ilegível do script de síntese: ${ultima.slice(0, 200)}` }
  }
}

/**
 * Quando o script sai com código != 0, o `execFile` rejeita — mas o JSON de
 * erro ainda está no stdout do próprio erro. Recuperá-lo dá uma mensagem
 * útil ("Idioma não suportado") em vez de "Command failed with exit code 2".
 */
function extrairErroDoScript(e: unknown): string | null {
  const stdout = (e as { stdout?: string } | null)?.stdout
  if (!stdout) return null
  const resposta = interpretarSaidaDoScript(stdout)
  return resposta.ok ? null : resposta.erro
}

export class ChatterboxVoiceCloneProvider implements VoiceCloneProvider {
  constructor(private pythonBin: string = resolverPythonDoChatterbox()) {}

  /**
   * Zero-shot (regra 10 da Continuação da Retomada da Rodada 9) — sem
   * `clonarVoz()`/`voiceId`. Cada síntese recebe `audioPromptPath`
   * diretamente (o áudio de referência JÁ autorizado pela proprietária —
   * o consentimento é checado antes disso, no kill switch do worker;
   * nunca duplicado aqui). Confirmado inspecionando o código real do
   * pacote instalado (`chatterbox/mtl_tts.py`:
   * `generate(text, language_id, audio_prompt_path=...)`).
   */
  async sintetizar(params: { audioPromptPath: string; texto: string; idioma?: string }): Promise<{ audioUrl: string }> {
    if (!params.audioPromptPath) throw new Error('Síntese de voz exige audioPromptPath (áudio de referência autorizado) — nunca sintetizar sem ele.')
    const disponibilidade = await verificarDisponibilidadeChatterbox(this.pythonBin)
    const selecao = selecionarProviderChatterbox(disponibilidade)
    if (selecao.tier === 'VOICE_ONLY_FALLBACK') throw new Error(selecao.motivo)

    // Síntese real: subprocesso Python NESTA MESMA MÁQUINA (worker local) —
    // o áudio de referência nunca é enviado para fora. O texto vai por
    // arquivo UTF-8, nunca por argv: no Windows a acentuação em argv
    // depende da code page do console e se corrompe em silêncio.
    const dir = mkdtempSync(join(tmpdir(), 'chatterbox-'))
    const arquivoTexto = join(dir, 'texto.txt')
    const arquivoSaida = join(dir, `voz-${Date.now()}.wav`)
    writeFileSync(arquivoTexto, params.texto, 'utf8')

    try {
      const { stdout } = await execFileAsync(
        this.pythonBin,
        [
          CAMINHO_SCRIPT_SINTESE,
          '--prompt', params.audioPromptPath,
          '--texto-arquivo', arquivoTexto,
          '--saida', arquivoSaida,
          '--idioma', params.idioma ?? 'pt',
          '--device', 'cpu',
        ],
        { maxBuffer: 10 * 1024 * 1024, timeout: TIMEOUT_SINTESE_MS }
      )

      const resultado = interpretarSaidaDoScript(stdout)
      if (!resultado.ok) throw new Error(`${selecao.tier} — ${resultado.erro}`)

      // `audioUrl` aqui é um CAMINHO LOCAL de propósito: o worker resolve
      // com `resolverParaCaminhoLocal: (c) => c`, porque o provider roda na
      // mesma máquina e não há upload intermediário.
      return { audioUrl: resultado.saida }
    } catch (e) {
      // Falha do subprocesso: pode ser erro do modelo OU pesos inacessíveis.
      // Distinguir importa — culpar o modelo quando o problema é a rede
      // deste ambiente já levou a diagnóstico errado antes.
      const bruto = e instanceof Error ? e.message : String(e)
      const doScript = extrairErroDoScript(e)
      if (doScript) throw new Error(`Provider ${selecao.tier} (${selecao.modelo}): ${doScript}`)

      const hf = await verificarAcessoHuggingFace()
      if (hf.status === 'CURRENT_ENVIRONMENT_NETWORK_RESTRICTION') {
        throw new Error(
          `Provider selecionado (${selecao.tier} — ${selecao.modelo}), mas o Hugging Face Hub está bloqueado neste ambiente específico (${hf.detalhe}) — o modelo em si é público. Retestar na máquina real.`
        )
      }
      throw new Error(`Provider ${selecao.tier} (${selecao.modelo}) falhou ao sintetizar: ${bruto}`)
    } finally {
      // Só o texto temporário é removido — o .wav gerado é o retorno da
      // função e quem o consome (o worker) é que decide quando descartar.
      try { rmSync(arquivoTexto, { force: true }) } catch { /* temporário: limpar é best-effort */ }
    }
  }
}
