"""
P2.40 — Verificação OBJETIVA de pronúncia (local): Whisper "base" (MIT) transcreve cada tomada em pt, com o
tempo de cada palavra. Para a palavra-alvo: reconhecida inteira? quanto dura? há silêncio entre ela e a anterior?
Não mede "naturalidade" (quem decide é a titular, ouvindo); acha separação de sílabas e troca de palavra.
  python verificar_pronuncia.py --alvo sacolinha arquivo1.wav arquivo2.wav ...
"""
import sys, json, re, argparse, unicodedata
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"): _s.reconfigure(encoding="utf-8", errors="replace")
p = argparse.ArgumentParser(); p.add_argument("--alvo", required=True); p.add_argument("arquivos", nargs="+")
a = p.parse_args()
import librosa, numpy as np
from transformers import pipeline
asr = pipeline("automatic-speech-recognition", model="openai/whisper-base", device="cpu")
norm = lambda s: re.sub(r"[^a-z]", "", unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode())
for f in a.arquivos:
    y, sr = librosa.load(f, sr=16000)
    r = asr({"raw": y, "sampling_rate": 16000}, return_timestamps="word", generate_kwargs={"language": "portuguese", "task": "transcribe"})
    palavras = [(c["text"].strip(), c["timestamp"][0], c["timestamp"][1]) for c in r.get("chunks", [])]
    alvo = [i for i, (w, _, _) in enumerate(palavras) if norm(w) == norm(a.alvo)]
    info = {"arquivo": f.replace("\\", "/").split("/")[-1], "transcricao": r["text"].strip(), "alvo_reconhecido": bool(alvo)}
    if alvo:
        i = alvo[-1]; w, t0, t1 = palavras[i]
        info["alvo_duracao_s"] = round((t1 or t0) - t0, 2)
        if i > 0: info["silencio_antes_do_alvo_s"] = round(max(0.0, t0 - (palavras[i - 1][2] or t0)), 2)
        # silêncio DENTRO da palavra (energia abaixo de 20% do pico por > 80 ms) — sílabas separadas
        seg = y[int(t0 * sr): int((t1 or t0 + 0.6) * sr)]
        if len(seg) > 400:
            rms = librosa.feature.rms(y=seg, frame_length=400, hop_length=160)[0]
            baixo = rms < 0.2 * rms.max(); run = mx = 0
            for b in baixo[2:-2]:
                run = run + 1 if b else 0; mx = max(mx, run)
            info["maior_queda_dentro_da_palavra_s"] = round(mx * 160 / sr, 2)
    print(json.dumps(info, ensure_ascii=False), flush=True)
