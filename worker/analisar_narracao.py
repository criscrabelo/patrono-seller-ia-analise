"""
P2.39 — Métricas OBJETIVAS de narração (não medem "naturalidade"; ajudam a achar voz chapada e defeitos):
  - variação de entonação: desvio-padrão do F0 em semitons (voz monótona ≈ < 2 st; fala conversada ≈ 3–5 st)
  - amplitude de entonação (p5–p95, semitons) · F0 mediano (timbre grave/agudo)
  - ritmo: caracteres por segundo de fala · pausas > 250 ms · fração com voz
  - defeitos: saturação (amostras ≥ 0,99), silêncio longo (> 1,2 s), frase com duração fora do esperado
  python analisar_narracao.py arquivo.wav [arquivo2.wav ...] --texto frases.txt
"""
import sys, json, numpy as np, librosa
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"): _s.reconfigure(encoding="utf-8", errors="replace")
args = sys.argv[1:]
texto = None
if "--texto" in args:
    i = args.index("--texto"); texto = open(args[i + 1], encoding="utf-8").read(); args = args[:i] + args[i + 2:]
caracteres = len("".join(c for c in (texto or "") if c.isalpha()))
for f in args:
    y, sr = librosa.load(f, sr=24000, mono=True)
    f0, voiced, _ = librosa.pyin(y, fmin=70, fmax=500, sr=sr, frame_length=1024, hop_length=240)
    f0v = f0[voiced & ~np.isnan(f0)]
    st = 12 * np.log2(f0v / np.median(f0v)) if len(f0v) else np.array([0])
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=240)[0]
    fala = rms > 0.02 * rms.max()
    dt = 240 / sr
    # pausas: sequências de não-fala entre trechos de fala
    pausas, atual = [], 0
    for v in fala:
        if not v: atual += 1
        else:
            if atual: pausas.append(atual * dt)
            atual = 0
    pausas_int = [p for p in pausas if p > 0.25]
    tempo_fala = fala.sum() * dt
    print(json.dumps({
        "arquivo": f.split("/")[-1].split("\\")[-1],
        "duracao_s": round(len(y) / sr, 2),
        "entonacao_desvio_semitons": round(float(np.std(st)), 2),
        "entonacao_amplitude_p5_p95_st": round(float(np.percentile(st, 95) - np.percentile(st, 5)), 2),
        "f0_mediano_hz": round(float(np.median(f0v)), 1) if len(f0v) else None,
        "fracao_com_voz": round(float(voiced.mean()), 2),
        "ritmo_caracteres_por_s": round(caracteres / tempo_fala, 1) if caracteres and tempo_fala else None,
        "pausas_maiores_250ms": len(pausas_int), "maior_pausa_s": round(max(pausas_int), 2) if pausas_int else 0,
        "saturacao_amostras": int((np.abs(y) >= 0.99).sum()),
        "silencio_longo": any(p > 1.2 for p in pausas_int),
    }, ensure_ascii=False))
