"""P2.74 — Fidelidade ao produto em tomada com MOVIMENTO DE CÂMERA (local, R$ 0).

O SSIM contra o 1º quadro (lib/video-pro/fidelidade.ts) não serve para aproximação, giro ou travelling: o
enquadramento muda e a nota despenca mesmo com o produto intacto (medido: aproximação fiel = 0,11). Aqui cada
quadro (a cada `--passo` s) é ALINHADO à foto oficial por pontos-chave (AKAZE + RANSAC, homografia); a foto é
projetada no quadro e as duas são comparadas por regiões (grade 6×6, correlação normalizada sobre imagem suavizada).

  - sem alinhamento (poucos pontos coerentes) → o quadro não mostra o produto da foto  → reprova;
  - correlação global baixa                     → produto trocado/derretido            → reprova;
  - uma região muito pior que as outras         → alteração LOCAL (letreiro, chip)     → reprova.

Uso: python fidelidade_geometrica.py --referencia foto.png --video gerado.mp4 [--passo 0.5]
Saída: JSON em stdout {aprovado, quadros:[{t, pontos, correlacao, piorRegiao}], motivos}.
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

LIMITES = {"pontosMin": 40, "correlacaoMin": 0.80, "piorRegiaoMin": 0.45, "areaMinDaRegiao": 0.6, "grade": 6, "sigma": 1.2, "texturaMinRef": 12, "texturaNovaMax": 18}


def longo(p):
    """Windows: caminho com 240+ caracteres só abre com o prefixo de caminho longo."""
    p = os.path.abspath(p)
    prefixo = "\\\\?\\"
    return prefixo + p if os.name == "nt" and len(p) >= 240 and not p.startswith(prefixo) else p


def cinza(img):
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img


def zncc(a, b):
    a = a.astype(np.float32).ravel()
    b = b.astype(np.float32).ravel()
    a -= a.mean()
    b -= b.mean()
    d = float(np.sqrt((a * a).sum() * (b * b).sum()))
    return float((a * b).sum() / d) if d > 1e-6 else 0.0


def avaliar_quadro(ref, quadro, det, L):
    kr, dr = det.detectAndCompute(ref, None)
    kq, dq = det.detectAndCompute(quadro, None)
    if dr is None or dq is None or len(kr) < 8 or len(kq) < 8:
        return {"pontos": 0, "correlacao": 0.0, "piorRegiao": 0.0, "motivo": "sem pontos-chave"}
    pares = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(dr, dq, k=2)
    bons = [m for m, *n in pares if n and m.distance < 0.75 * n[0].distance]
    if len(bons) < 8:
        return {"pontos": len(bons), "correlacao": 0.0, "piorRegiao": 0.0, "motivo": "não alinha com a foto"}
    src = np.float32([kr[m.queryIdx].pt for m in bons]).reshape(-1, 1, 2)
    dst = np.float32([kq[m.trainIdx].pt for m in bons]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
    inl = int(mask.sum()) if mask is not None else 0
    if H is None or inl < 8:
        return {"pontos": inl, "correlacao": 0.0, "piorRegiao": 0.0, "motivo": "não alinha com a foto"}
    h, w = quadro.shape[:2]
    proj = cv2.warpPerspective(ref, H, (w, h))
    # borda da projeção: a interpolação mistura o preto de fora e cria "textura" falsa → máscara encolhida 8 px
    valida = cv2.erode(cv2.warpPerspective(np.full(ref.shape[:2], 255, np.uint8), H, (w, h)), np.ones((17, 17), np.uint8)) > 0
    s = L["sigma"]
    a = cv2.GaussianBlur(proj, (0, 0), s)
    b = cv2.GaussianBlur(quadro, (0, 0), s)
    if valida.sum() < 0.05 * w * h:
        return {"pontos": inl, "correlacao": 0.0, "piorRegiao": 0.0, "motivo": "produto quase fora do quadro"}
    glob = zncc(a[valida], b[valida])
    g = L["grade"]
    pior = 1.0
    novos = 0
    for i in range(g):
        for j in range(g):
            ys, ye, xs, xe = i * h // g, (i + 1) * h // g, j * w // g, (j + 1) * w // g
            m = valida[ys:ye, xs:xe]
            if m.mean() < L["areaMinDaRegiao"]:
                continue
            ra, rb = a[ys:ye, xs:xe][m], b[ys:ye, xs:xe][m]
            if ra.std() < L["texturaMinRef"]:
                # fundo liso na foto: correlação não informa; mas textura forte no quadro = objeto que NÃO está na foto
                if rb.std() > L["texturaNovaMax"]:
                    novos += 1
                continue
            pior = min(pior, zncc(ra, rb))
    return {"pontos": inl, "correlacao": round(glob, 3), "piorRegiao": round(pior, 3), "regioesComObjetoNovo": novos}


def main():
    # "-I" ignora PYTHONIOENCODING: no Windows a saída sairia em cp1252
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--referencia", required=True)
    ap.add_argument("--video", required=True)
    ap.add_argument("--passo", type=float, default=0.5)
    a = ap.parse_args()
    L = LIMITES
    # imdecode: cv2.imread falha em caminho longo ou com acento no Windows
    bruto = np.fromfile(longo(a.referencia), dtype=np.uint8) if os.path.exists(longo(a.referencia)) else None
    img = cv2.imdecode(bruto, cv2.IMREAD_COLOR) if bruto is not None and bruto.size else None
    ref = cinza(img) if img is not None else None
    cap = cv2.VideoCapture(a.video)
    if not cap.isOpened() and os.path.exists(longo(a.video)):
        # VideoCapture falha em caminho longo ou com acento no Windows: cópia temporária com nome curto
        import shutil, tempfile
        fd, curto = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)
        shutil.copyfile(longo(a.video), curto)
        cap = cv2.VideoCapture(curto)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if ref is None or total <= 0:
        print(json.dumps({"aprovado": False, "quadros": [], "motivos": ["referência ou vídeo ilegível"]}))
        return 2
    det = cv2.AKAZE_create()
    quadros, motivos = [], []
    t = 0.0
    while t * fps < total:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
        ok, fr = cap.read()
        if not ok:
            break
        q = cinza(fr)
        # mesma escala de trabalho: quadro com ~720 px de altura, referência na sua escala
        esc = 720 / q.shape[0]
        q = cv2.resize(q, (int(q.shape[1] * esc), 720), interpolation=cv2.INTER_AREA)
        r = avaliar_quadro(ref, q, det, L)
        r["t"] = round(t, 2)
        quadros.append(r)
        if r["pontos"] < L["pontosMin"]:
            motivos.append(f"{t:.1f} s: produto não alinha com a foto oficial ({r['pontos']} pontos; mín. {L['pontosMin']})")
        elif r["correlacao"] < L["correlacaoMin"]:
            motivos.append(f"{t:.1f} s: produto difere da foto (correlação {r['correlacao']}; mín. {L['correlacaoMin']})")
        elif r.get("regioesComObjetoNovo", 0) > 0:
            motivos.append(f"{t:.1f} s: objeto que não está na foto oficial ({r['regioesComObjetoNovo']} região(ões) com textura nova sobre fundo liso)")
        elif r["piorRegiao"] < L["piorRegiaoMin"]:
            motivos.append(f"{t:.1f} s: alteração local (pior região {r['piorRegiao']}; mín. {L['piorRegiaoMin']})")
        t += a.passo
    print(json.dumps({"aprovado": bool(quadros) and not motivos, "limites": L, "quadros": quadros, "motivos": motivos}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
