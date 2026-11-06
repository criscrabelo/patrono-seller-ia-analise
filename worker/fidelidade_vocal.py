"""
P2.39 — FIDELIDADE vocal (só análise, local, nada é gerado): similaridade de "impressão digital" de voz
(VoiceEncoder que vem com o Chatterbox) + qualidade das gravações (duração, ruído, saturação).
  - mesma pessoa, gravações diferentes  → referência do "quão parecido é possível" (tipicamente > 0,80)
  - voz genérica × gravação             → referência de "outra pessoa"
  python fidelidade_vocal.py --referencias a b --comparar x y z
Nunca envia nada para fora; não gera voz.
"""
import sys, json, argparse, numpy as np, librosa
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"): _s.reconfigure(encoding="utf-8", errors="replace")
p = argparse.ArgumentParser(); p.add_argument("--referencias", nargs="+", required=True); p.add_argument("--comparar", nargs="*", default=[])
a = p.parse_args()
from chatterbox.models.voice_encoder import VoiceEncoder
import torch
ve = VoiceEncoder(); ve.load_state_dict(torch.load(__import__("huggingface_hub").hf_hub_download("ResembleAI/chatterbox", "ve.pt"), map_location="cpu")); ve.eval()

def qualidade(f):
    y, sr = librosa.load(f, sr=16000, mono=True)
    rms = librosa.feature.rms(y=y, frame_length=512, hop_length=160)[0]
    db = 20 * np.log10(rms + 1e-9)
    ruido, fala = np.percentile(db, 10), np.percentile(db, 90)
    return y, {"duracao_s": round(len(y) / sr, 1), "snr_aprox_db": round(float(fala - ruido), 1), "saturacao_amostras": int((np.abs(y) >= 0.99).sum())}

def emb(y):
    e = ve.embeds_from_wavs([y], sample_rate=16000)
    e = np.asarray(e).reshape(-1); return e / np.linalg.norm(e)

nome = lambda f: f.replace("\\", "/").split("/")[-1]
refs = {}
for f in a.referencias:
    y, q = qualidade(f); refs[f] = emb(y); print(json.dumps({"referencia": nome(f), **q}, ensure_ascii=False))
ks = list(refs)
for i in range(len(ks)):
    for j in range(i + 1, len(ks)):
        print(json.dumps({"mesma_pessoa": f"{nome(ks[i])} × {nome(ks[j])}", "similaridade": round(float(refs[ks[i]] @ refs[ks[j]]), 3)}, ensure_ascii=False))
media = np.mean([refs[k] for k in ks], axis=0); media /= np.linalg.norm(media)
for f in a.comparar:
    y, q = qualidade(f)
    print(json.dumps({"comparado": nome(f), "similaridade_com_as_referencias": round(float(emb(y) @ media), 3), **q}, ensure_ascii=False))
