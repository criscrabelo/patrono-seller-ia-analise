"""
P2.39 — Prévias de NARRAÇÃO (só áudio) com o Chatterbox Multilingual já instalado (MIT), na CPU, local.

Voz: a VOZ GENÉRICA embutida no modelo (sem --referencia) ou uma referência SINTÉTICA/autorizada passada
explicitamente. NUNCA a voz da titular sem consentimento específico registrado (P2.33.1).

Cada frase é gerada separadamente (o modelo fica mais estável em trechos curtos) e as frases são unidas com
pausas naturais curtas e um respiro de silêncio (sem cortes secos). Saída: WAV 24 kHz mono + JSON com
duração de cada frase (para sincronizar as legendas depois).

  python narracao_previas.py --frases frases.txt --saida previa.wav [--exaggeration 0.5] [--cfg 0.5]
         [--temperature 0.8] [--pausas 0.35,0.45,0.4,0.45] [--referencia ref.wav] [--seed 7] [--so-primeira]
"""
import argparse, json, sys, time, wave
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

p = argparse.ArgumentParser()
p.add_argument("--frases", required=True); p.add_argument("--saida", required=True)
p.add_argument("--exaggeration", type=float, default=0.5); p.add_argument("--cfg", type=float, default=0.5)
p.add_argument("--temperature", type=float, default=0.8); p.add_argument("--pausas", default="0.35,0.45,0.4,0.45")
p.add_argument("--referencia", default=None); p.add_argument("--seed", type=int, default=7)
p.add_argument("--so-primeira", action="store_true")
a = p.parse_args()

import torch, torchaudio
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
torch.manual_seed(a.seed)
frases = [l.strip() for l in open(a.frases, encoding="utf-8") if l.strip()]
if a.so_primeira: frases = frases[:1]
pausas = [float(x) for x in a.pausas.split(",")]
t0 = time.time()
m = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
sr = m.sr
partes, info = [], []
for i, f in enumerate(frases):
    ti = time.time()
    kw = dict(language_id="pt", exaggeration=a.exaggeration, cfg_weight=a.cfg, temperature=a.temperature)
    if a.referencia: kw["audio_prompt_path"] = a.referencia
    w = m.generate(f, **kw).squeeze(0)
    # apara silêncio das pontas (limiar baixo) para que a pausa entre frases seja só a escolhida
    amp = w.abs(); limiar = 0.01 * amp.max()
    idx = (amp > limiar).nonzero()
    if len(idx): w = w[max(0, int(idx[0]) - int(0.03 * sr)): int(idx[-1]) + int(0.08 * sr)]
    info.append({"frase": f, "duracao": round(w.shape[-1] / sr, 3), "sintese_s": round(time.time() - ti, 1)})
    partes.append(w)
    if i < len(frases) - 1:
        partes.append(torch.zeros(int(pausas[min(i, len(pausas) - 1)] * sr)))
    print(f"frase {i+1}/{len(frases)}: {info[-1]['duracao']} s (síntese {info[-1]['sintese_s']} s)", file=sys.stderr, flush=True)
audio = torch.cat(partes).unsqueeze(0)
torchaudio.save(a.saida, audio, sr)
json.dump({"modelo": "Chatterbox Multilingual (MIT), CPU", "voz": "referência " + a.referencia if a.referencia else "voz genérica embutida no modelo (não é a voz da titular)",
           "parametros": {"exaggeration": a.exaggeration, "cfg_weight": a.cfg, "temperature": a.temperature, "seed": a.seed, "pausas": pausas},
           "frases": info, "duracao_total": round(audio.shape[-1] / sr, 3), "tempo_total_s": round(time.time() - t0, 1)},
          open(a.saida.rsplit(".", 1)[0] + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps({"ok": True, "saida": a.saida, "duracao": round(audio.shape[-1] / sr, 2), "tempo_s": round(time.time() - t0, 1)}, ensure_ascii=False))
