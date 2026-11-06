"""
Síntese de voz real com Chatterbox (Resemble AI), chamada como subprocesso
pelo `ChatterboxVoiceCloneProvider` (lib/chatterbox-adapter.ts).

Roda SEMPRE local, na mesma máquina do worker: o áudio de referência da
proprietária nunca sai daqui, nunca vai para uma API paga. Zero-shot — não
existe "voiceId" persistente; cada síntese recebe o áudio de referência já
autorizado (`--prompt`) e o usa como `audio_prompt_path`.

Protocolo com o chamador (contrato estável — não mudar sem ajustar o
adapter): tudo o que for legível por humano vai para STDERR; o STDOUT
recebe exatamente UMA linha, um JSON. Assim o adapter nunca precisa
adivinhar o que é log e o que é resultado.

  sucesso: {"ok": true,  "saida": "<caminho .wav>", "duracaoSegundos": 12.6,
            "segundosSintese": 91.2, "modelo": "...", "idioma": "pt"}
  falha:   {"ok": false, "erro": "<mensagem>", "tipo": "<classe do erro>"}

O texto vem por ARQUIVO (`--texto-arquivo`, UTF-8), nunca por argumento de
linha de comando: no Windows, acentuação em argv depende da code page do
console e corrompe silenciosamente ("ofertas incríveis" vira outra coisa).

Uso:
  python chatterbox_synthesize.py --prompt ref.wav --texto-arquivo t.txt \
      --saida saida.wav [--idioma pt] [--device cpu]
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import traceback
import time

# Taxa que o Chatterbox usa internamente para o áudio de referência.
PROMPT_SAMPLE_RATE = 24000

# Windows: sem isto, o Python codifica stdout/stderr na code page do console
# (cp1252 por aqui) e toda acentuação chega corrompida ao adapter — o erro
# "áudio de referência não encontrado" virava "�udio de refer�ncia".
# O lado Node decodifica como UTF-8, então é o Python que precisa ceder.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")


def log(msg: str) -> None:
    """Log humano — sempre STDERR, para não poluir o JSON do STDOUT."""
    print(msg, file=sys.stderr, flush=True)


def responder(payload: dict, codigo: int) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    sys.exit(codigo)


def encontrar_ffmpeg() -> str | None:
    """
    Procura o ffmpeg além do PATH.

    Só o PATH não basta: no Windows, `winget install Gyan.FFmpeg` altera a
    variável de ambiente do usuário, mas processos já abertos continuam com
    o PATH antigo — e o worker normalmente foi iniciado antes. Medido de
    verdade nesta máquina: `shutil.which("ffmpeg")` devolveu None enquanto
    o ffmpeg 9.0.1 estava instalado e funcionando.
    """
    if (env := os.environ.get("DIGITAL_TWIN_FFMPEG")) and os.path.isfile(env):
        return env

    if (no_path := shutil.which("ffmpeg")):
        return no_path

    local = os.environ.get("LOCALAPPDATA", "")
    if local:
        # Atalho que o winget cria, e o diretório real do pacote.
        candidatos = [os.path.join(local, "Microsoft", "WinGet", "Links", "ffmpeg.exe")]
        raiz = os.path.join(local, "Microsoft", "WinGet", "Packages")
        if os.path.isdir(raiz):
            for pasta in os.listdir(raiz):
                if "ffmpeg" in pasta.lower():
                    for atual, _dirs, arquivos in os.walk(os.path.join(raiz, pasta)):
                        if "ffmpeg.exe" in arquivos:
                            candidatos.append(os.path.join(atual, "ffmpeg.exe"))
                            break
        for c in candidatos:
            if os.path.isfile(c):
                return c

    return None


def legivel_sem_conversao(caminho: str) -> bool:
    """O Chatterbox abre este arquivo direto? (WAV/FLAC/OGG sim; WebM não.)"""
    try:
        import soundfile
        soundfile.info(caminho)
        return True
    except Exception:
        return False


def normalizar_prompt(origem: str) -> tuple[str, str | None]:
    """
    Converte o áudio de referência para WAV mono 24 kHz.

    Necessário de verdade: o worker baixa o VOICE_REFERENCE com sufixo
    `.wav`, mas o conteúdo é o que o navegador gravou — normalmente WebM/Opus.
    O librosa (usado pelo Chatterbox) não abre WebM: falha com
    `NoBackendError`, uma exceção SEM MENSAGEM, que sozinha não diz nada
    sobre a causa. Por isso, quando não dá para converter nem ler, este
    código falha com uma mensagem que diz o que fazer.
    """
    ffmpeg = encontrar_ffmpeg()

    if not ffmpeg:
        if legivel_sem_conversao(origem):
            return origem, "ffmpeg não encontrado, mas o áudio de referência já está num formato legível — seguindo sem conversão."
        raise RuntimeError(
            f"O áudio de referência ({os.path.basename(origem)}) está num formato que o modelo não abre "
            "(normalmente WebM, como o navegador grava) e o ffmpeg não foi encontrado para convertê-lo. "
            "Instale com `winget install --id Gyan.FFmpeg --scope user` ou aponte o executável "
            "na variável de ambiente DIGITAL_TWIN_FFMPEG."
        )

    destino = os.path.join(tempfile.gettempdir(), f"chatterbox-prompt-{os.getpid()}.wav")
    try:
        subprocess.run(
            [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
             "-i", origem, "-ac", "1", "-ar", str(PROMPT_SAMPLE_RATE), destino],
            check=True, capture_output=True,
        )
    except subprocess.CalledProcessError as e:
        detalhe = (e.stderr or b"").decode("utf-8", "replace").strip()
        if legivel_sem_conversao(origem):
            return origem, f"ffmpeg não converteu o áudio de referência ({detalhe or 'sem detalhe'}) — usando o original, que é legível."
        raise RuntimeError(f"Não foi possível converter o áudio de referência: {detalhe or 'ffmpeg falhou sem detalhe'}")

    return destino, None


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--prompt", required=True, help="áudio de referência autorizado (audio_prompt_path)")
    p.add_argument("--texto-arquivo", required=True, help="arquivo UTF-8 com o texto a sintetizar")
    p.add_argument("--saida", required=True, help="caminho do .wav a gerar")
    p.add_argument("--idioma", default="pt")
    p.add_argument("--device", default="cpu", help="cpu | cuda | mps — esta máquina usa cpu")
    args = p.parse_args()

    if not os.path.isfile(args.prompt):
        responder({"ok": False, "erro": f"Áudio de referência não encontrado: {args.prompt}", "tipo": "PromptAusente"}, 2)
    if not os.path.isfile(args.texto_arquivo):
        responder({"ok": False, "erro": f"Arquivo de texto não encontrado: {args.texto_arquivo}", "tipo": "TextoAusente"}, 2)

    with open(args.texto_arquivo, encoding="utf-8") as fh:
        texto = fh.read().strip()
    if not texto:
        responder({"ok": False, "erro": "Texto vazio — nada a sintetizar.", "tipo": "TextoVazio"}, 2)

    # Importado aqui, não no topo: o import do torch custa segundos, e os
    # erros acima devem falhar rápido, sem pagar esse custo.
    try:
        import torch  # noqa: F401
        import torchaudio
        from chatterbox.mtl_tts import SUPPORTED_LANGUAGES, ChatterboxMultilingualTTS
    except Exception as e:
        responder({"ok": False,
                   "erro": f"Chatterbox/torch não disponíveis neste ambiente Python ({e}). Ver worker/requirements-chatterbox.txt.",
                   "tipo": type(e).__name__}, 3)

    # O modelo usa códigos de idioma simples ("pt", "en"), mas o Patrono
    # guarda locale completo em `VoiceProfile.language` — o padrão é "pt-BR".
    # Sem esta normalização a síntese falhava com "Idioma 'pt-BR' não
    # suportado", apesar de o português existir. Cai para a subtag base
    # ("pt-BR" → "pt"), que é o que o modelo entende; vale igual para
    # "en-US" → "en", "es-MX" → "es".
    idioma = args.idioma
    if idioma not in SUPPORTED_LANGUAGES:
        base = idioma.split("-")[0].split("_")[0].lower()
        if base in SUPPORTED_LANGUAGES:
            log(f"idioma '{idioma}' normalizado para '{base}' (o modelo usa códigos simples)")
            idioma = base
        else:
            responder({"ok": False,
                       "erro": f"Idioma '{args.idioma}' não suportado pelo modelo. Suportados: {', '.join(sorted(SUPPORTED_LANGUAGES))}.",
                       "tipo": "IdiomaNaoSuportado"}, 2)

    try:
        prompt_path, aviso = normalizar_prompt(args.prompt)
    except Exception as e:
        # Falha aqui é de PRÉ-REQUISITO (ffmpeg/formato), não do modelo —
        # devolvida com tipo próprio para a mensagem não culpar o Chatterbox.
        responder({"ok": False, "erro": str(e), "tipo": "PromptNaoConversivel"}, 2)
    if aviso:
        log(f"aviso: {aviso}")

    try:
        log("carregando modelo (os pesos vêm do cache do Hugging Face; a primeira vez baixa ~3 GB)...")
        t0 = time.time()
        modelo = ChatterboxMultilingualTTS.from_pretrained(device=args.device)
        log(f"modelo pronto em {time.time() - t0:.1f}s")

        t1 = time.time()
        wav = modelo.generate(texto, language_id=idioma, audio_prompt_path=prompt_path)
        segundos_sintese = time.time() - t1

        os.makedirs(os.path.dirname(os.path.abspath(args.saida)), exist_ok=True)
        torchaudio.save(args.saida, wav, modelo.sr)
    except Exception as e:
        # `str(e)` vazio acontece de verdade (ex.: alguns erros de decodificação
        # de áudio) e produziria "Falha ao sintetizar: " sem informação nenhuma.
        # O traceback completo vai para o stderr, que o worker registra.
        traceback.print_exc(file=sys.stderr)
        detalhe = str(e).strip() or f"{type(e).__name__} sem mensagem (traceback completo no log do worker)"
        responder({"ok": False, "erro": f"Falha ao sintetizar: {detalhe}", "tipo": type(e).__name__}, 1)
    finally:
        if prompt_path != args.prompt and os.path.exists(prompt_path):
            try:
                os.remove(prompt_path)
            except OSError:
                pass  # arquivo temporário: falhar ao limpar nunca invalida a síntese

    responder({
        "ok": True,
        "saida": os.path.abspath(args.saida),
        "duracaoSegundos": round(wav.shape[-1] / modelo.sr, 2),
        "segundosSintese": round(segundos_sintese, 1),
        "modelo": "ChatterboxMultilingualTTS (ResembleAI/chatterbox)",
        "idioma": idioma,
    }, 0)


if __name__ == "__main__":
    main()
