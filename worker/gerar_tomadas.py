"""
P2.40 — Várias TOMADAS de UMA frase com a voz da titular (mesma referência), carregando o modelo uma vez só.
Variações só no TEXTO LIDO pela voz (dica de tônica/pontuação; a legenda e as palavras faladas não mudam) e no
cfg_weight (aderência ao texto). Cada tomada: duração, similaridade com a titular, aviso de repetição.
  python gerar_tomadas.py --referencia ref --referencias-similaridade a b --saida-prefixo pasta/tomada
         --variantes variantes.json   ([{"id":"t1","texto":"…","cfg":0.3,"exaggeration":0.55,"seed":1}, …])
"""
import argparse, json, logging, os, subprocess, sys, tempfile
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"): _s.reconfigure(encoding="utf-8", errors="replace")
p = argparse.ArgumentParser()
p.add_argument("--referencia", required=True); p.add_argument("--referencias-similaridade", nargs="+", required=True)
p.add_argument("--saida-prefixo", required=True); p.add_argument("--variantes", required=True); p.add_argument("--temperature", type=float, default=0.8)
a = p.parse_args()
import numpy as np, torch, torchaudio, librosa
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from chatterbox.models.voice_encoder import VoiceEncoder
from huggingface_hub import hf_hub_download
FF = os.environ.get("FFMPEG", "ffmpeg"); tmp = tempfile.mkdtemp(prefix="tom-")
def wav(f, s, sr):
    subprocess.run([FF, "-v", "error", "-y", "-i", f, "-ac", "1", "-ar", str(sr), "-af", "silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_threshold=-45dB:stop_duration=0.6,loudnorm=I=-20:TP=-3", s], check=True); return s
prompt = wav(a.referencia, os.path.join(tmp, "p.wav"), 24000)
ve = VoiceEncoder(); ve.load_state_dict(torch.load(hf_hub_download("ResembleAI/chatterbox", "ve.pt"), map_location="cpu")); ve.eval()
emb = lambda y: (lambda e: e / np.linalg.norm(e))(np.asarray(ve.embeds_from_wavs([y], sample_rate=16000)).reshape(-1))
alvo = np.mean([emb(librosa.load(wav(r, os.path.join(tmp, f"r{i}.wav"), 16000), sr=16000)[0]) for i, r in enumerate(a.referencias_similaridade)], axis=0); alvo /= np.linalg.norm(alvo)
class Av(logging.Handler):
    rep = False
    def emit(self, r):
        if "forcing EOS" in r.getMessage() and "token_repetition=True" in r.getMessage(): Av.rep = True
logging.getLogger().addHandler(Av()); logging.getLogger("chatterbox").addHandler(Av())
m = ChatterboxMultilingualTTS.from_pretrained(device="cpu"); sr = m.sr
for v in json.load(open(a.variantes, encoding="utf-8")):
    torch.manual_seed(v["seed"]); Av.rep = False
    w = m.generate(v["texto"], language_id="pt", audio_prompt_path=prompt, exaggeration=v["exaggeration"], cfg_weight=v["cfg"], temperature=a.temperature).squeeze(0)
    amp = w.abs(); idx = (amp > 0.01 * amp.max()).nonzero()
    if len(idx): w = w[max(0, int(idx[0]) - int(0.02 * sr)): int(idx[-1]) + int(0.06 * sr)]
    n = int(0.015 * sr); r = torch.linspace(0, 1, n); w = w.clone(); w[:n] *= r; w[-n:] *= r.flip(0)
    saida = f"{a.saida_prefixo}-{v['id']}.wav"; torchaudio.save(saida, w.unsqueeze(0), sr)
    sim = float(emb(librosa.resample(w.numpy(), orig_sr=sr, target_sr=16000)) @ alvo)
    print(json.dumps({"id": v["id"], "texto_lido": v["texto"], "cfg": v["cfg"], "seed": v["seed"], "duracao": round(w.shape[-1] / sr, 2), "similaridade": round(sim, 3), "repeticao": Av.rep, "arquivo": saida}, ensure_ascii=False), flush=True)
