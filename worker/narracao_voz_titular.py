"""
P2.39 — Narração com a VOZ DA TITULAR (Chatterbox Multilingual, MIT, zero-shot, CPU LOCAL), sob o consentimento
específico registrado em %LOCALAPPDATA%\\PatronoSeller\\emocionario\\v3-voz-titular\\CONSENTIMENTO-VOZ.txt.
Nada sai deste computador; não há modelo treinado separado (a voz é condicionada pela gravação a cada síntese).

Controle de qualidade por FRASE (até N tentativas, sementes diferentes), escolhe a melhor que passa:
  - duração dentro do esperado para o texto (repetição/corte → fora da faixa)
  - sem aviso do modelo de repetição ("forcing EOS … token_repetition=True")
  - maior similaridade de voz com as gravações da titular (VoiceEncoder do próprio Chatterbox)
Junta as frases com pausas naturais curtas e transições suaves (fade de 15 ms), sem corte seco.

  python narracao_voz_titular.py --referencia ref.(webm|wav) [--referencias-similaridade a b] --frases f.txt
         --saida previa.wav [--exaggeration 0.5] [--cfg 0.4] [--temperature 0.8] [--pausas 0.35,0.45,0.4,0.45]
         [--tentativas 4] [--seed 1]
"""
import argparse, json, logging, os, subprocess, sys, tempfile, time
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"): _s.reconfigure(encoding="utf-8", errors="replace")
p = argparse.ArgumentParser()
p.add_argument("--referencia", required=True); p.add_argument("--referencias-similaridade", nargs="*", default=None)
p.add_argument("--frases", required=True); p.add_argument("--saida", required=True)
p.add_argument("--exaggeration", type=float, default=0.5); p.add_argument("--cfg", type=float, default=0.4)
p.add_argument("--temperature", type=float, default=0.8); p.add_argument("--pausas", default="0.35,0.45,0.4,0.45")
p.add_argument("--tentativas", type=int, default=4); p.add_argument("--seed", type=int, default=1)
# P2.46: aceita a PRIMEIRA tomada que passa e tem similaridade >= este valor (perfil de voz aprovado), sem gastar as demais.
p.add_argument("--aceitar-acima", type=float, default=0.90)
a = p.parse_args()

import numpy as np, torch, torchaudio, librosa
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from chatterbox.models.voice_encoder import VoiceEncoder
from huggingface_hub import hf_hub_download

def ffmpeg():
    return os.environ.get("FFMPEG", "ffmpeg")  # o ffmpeg-static do projeto (passado pelo chamador)

tmp = tempfile.mkdtemp(prefix="voz-")
def para_wav(f, saida, sr=24000):
    # mono, 24 kHz, sem silêncio nas pontas, nível de fala normalizado (sem saturar)
    subprocess.run([ffmpeg(), "-v", "error", "-y", "-i", f, "-ac", "1", "-ar", str(sr), "-af",
                    "silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_threshold=-45dB:stop_duration=0.6,loudnorm=I=-20:TP=-3", saida], check=True)
    return saida
prompt = para_wav(a.referencia, os.path.join(tmp, "prompt.wav"))
refs = [para_wav(f, os.path.join(tmp, f"ref{i}.wav"), 16000) for i, f in enumerate(a.referencias_similaridade or [a.referencia])]

ve = VoiceEncoder(); ve.load_state_dict(torch.load(hf_hub_download("ResembleAI/chatterbox", "ve.pt"), map_location="cpu")); ve.eval()
def emb(y16):
    e = np.asarray(ve.embeds_from_wavs([y16], sample_rate=16000)).reshape(-1); return e / np.linalg.norm(e)
alvo = np.mean([emb(librosa.load(r, sr=16000)[0]) for r in refs], axis=0); alvo /= np.linalg.norm(alvo)

class Avisos(logging.Handler):
    def __init__(self): super().__init__(); self.repeticao = False
    def emit(self, r):
        if "forcing EOS" in r.getMessage() and "token_repetition=True" in r.getMessage(): self.repeticao = True
avisos = Avisos(); logging.getLogger("chatterbox").addHandler(avisos); logging.getLogger().addHandler(avisos)

frases = [l.strip() for l in open(a.frases, encoding="utf-8") if l.strip()]
pausas = [float(x) for x in a.pausas.split(",")]
t0 = time.time()
m = ChatterboxMultilingualTTS.from_pretrained(device="cpu"); sr = m.sr
partes, info = [], []
for i, f in enumerate(frases):
    letras = sum(c.isalpha() for c in f)
    faixa = (letras / 19.0, letras / 9.0 + 0.6)   # caracteres/s de fala natural em pt-BR ≈ 10–17
    melhor = None
    for k in range(a.tentativas):
        torch.manual_seed(a.seed * 100 + i * 10 + k)
        avisos.repeticao = False
        w = m.generate(f, language_id="pt", audio_prompt_path=prompt, exaggeration=a.exaggeration, cfg_weight=a.cfg, temperature=a.temperature).squeeze(0)
        amp = w.abs(); lim = 0.01 * amp.max(); idx = (amp > lim).nonzero()
        if len(idx): w = w[max(0, int(idx[0]) - int(0.02 * sr)): int(idx[-1]) + int(0.06 * sr)]
        dur = w.shape[-1] / sr
        y16 = librosa.resample(w.numpy(), orig_sr=sr, target_sr=16000)
        sim = float(emb(y16) @ alvo)
        ok = faixa[0] <= dur <= faixa[1] and not avisos.repeticao
        cand = {"tentativa": k + 1, "duracao": round(dur, 2), "similaridade": round(sim, 3), "repeticao": avisos.repeticao, "passou": ok}
        print(f"frase {i+1} tentativa {k+1}: {cand}", file=sys.stderr, flush=True)
        if melhor is None or (ok, sim) > (melhor[1]["passou"], melhor[1]["similaridade"]): melhor = (w, cand)
        if ok and sim >= a.aceitar_acima: break
    w, cand = melhor
    n = int(0.015 * sr); rampa = torch.linspace(0, 1, n)
    w = w.clone(); w[:n] *= rampa; w[-n:] *= rampa.flip(0)
    info.append({"frase": f, **cand, "faixa_esperada_s": [round(faixa[0], 2), round(faixa[1], 2)]})
    partes.append(w)
    if i < len(frases) - 1: partes.append(torch.zeros(int(pausas[min(i, len(pausas) - 1)] * sr)))
audio = torch.cat(partes).unsqueeze(0)
torchaudio.save(a.saida, audio, sr)
for i, x in enumerate(info): torchaudio.save(a.saida.rsplit(".", 1)[0] + f"-frase{i+1}.wav", partes[i * 2].unsqueeze(0), sr)
json.dump({"modelo": "Chatterbox Multilingual (MIT), CPU local, zero-shot", "voz": "voz da titular (consentimento específico registrado)",
           "parametros": {"exaggeration": a.exaggeration, "cfg_weight": a.cfg, "temperature": a.temperature, "pausas": pausas, "referencia": os.path.basename(a.referencia)},
           "frases": info, "duracao_total": round(audio.shape[-1] / sr, 2), "tempo_total_s": round(time.time() - t0, 1)},
          open(a.saida.rsplit(".", 1)[0] + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps({"ok": True, "saida": a.saida, "duracao": round(audio.shape[-1] / sr, 2), "passaram": sum(x["passou"] for x in info), "de": len(info),
                  "similaridade_media": round(float(np.mean([x["similaridade"] for x in info])), 3), "tempo_s": round(time.time() - t0, 1)}, ensure_ascii=False))
