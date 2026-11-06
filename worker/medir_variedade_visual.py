"""
P2.66 — VARIEDADE VISUAL medida no VÍDEO FINAL (não no roteiro): quão diferentes entre si são as cenas.
12 quadros espaçados → miniaturas coloridas 54×96 → distância média absoluta entre todos os pares (0–1).
  - `variedade`  = mediana das distâncias entre pares (o vídeo inteiro parece "a mesma tela"?);
  - `fundoFixo`  = fração da área que quase não muda em NENHUM par (fundo/molde repetido o tempo todo);
  - `cenasDistintas` = grupos de quadros parecidos (distância < 0,06 = mesma cena).
Não mede beleza: mede repetição. Calibrado em 27/10 com o vídeo APROVADO pela titular (Emocionário v4, imagens
reais) contra os reprovados (Cordão v2/v3 e Kappa v2, gráficos abstratos).
  python medir_variedade_visual.py <video.mp4> [mais vídeos...]   → uma linha JSON por vídeo
"""
import sys, json, subprocess, os, re
import numpy as np
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"): _s.reconfigure(encoding="utf-8", errors="replace")
FF = os.environ.get("FFMPEG", "ffmpeg"); W, H, N = 54, 96, 12

def duracao(v):
    s = subprocess.run([FF, "-hide_banner", "-i", v], capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", s); return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])

def quadros(v):
    d = duracao(v); out = []
    for k in range(N):
        t = d * (k + 0.5) / N
        raw = subprocess.run([FF, "-v", "error", "-ss", f"{t:.2f}", "-i", v, "-frames:v", "1", "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
        out.append(np.frombuffer(raw, np.uint8).reshape(H, W, 3).astype(np.float32) / 255)
    return out

def medir(v):
    q = quadros(v); dist = []; parado = np.ones((H, W), bool)
    for i in range(N):
        for j in range(i + 1, N):
            diff = np.abs(q[i] - q[j]).mean(axis=2); dist.append(float(diff.mean())); parado &= diff < 0.04
    grupos = []
    for i in range(N):
        g = next((g for g in grupos if np.abs(q[i] - q[g[0]]).mean() < 0.06), None)
        (g.append(i) if g else grupos.append([i]))
    return {"video": os.path.basename(v), "variedade": round(float(np.median(dist)), 4), "fundoFixo": round(float(parado.mean()), 3), "cenasDistintas": len(grupos), "quadros": N}

for v in sys.argv[1:]: print(json.dumps(medir(v), ensure_ascii=False), flush=True)
