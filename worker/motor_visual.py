"""
P2.65 — MOTOR VISUAL do Studio (local, R$ 0): desenha CADA QUADRO do vídeo vertical (1080×1920, 30 fps) a partir de
um roteiro visual e entrega ao FFmpeg. Substitui o fundo de "quadradinhos" da v2 do Cordão (reprovada pela titular
por ser simples demais) por uma peça com identidade, hierarquia e movimento contínuo:
  - fundo vivo em camadas (gradiente que respira, luzes desfocadas em profundidade, neve, brilhos, ornamento girando);
  - abertura com explosão de luz e manchete palavra a palavra nos 2 primeiros segundos;
  - cartelas com os FATOS DO ANÚNCIO em hierarquia (número grande, unidade, rótulo "segundo o anúncio");
  - legenda dinâmica em blocos curtos, com a palavra falada em destaque (sincronizada pela própria voz);
  - #publi e "dados do anúncio · imagens ilustrativas" fixos e legíveis do 1º ao último quadro.
Tudo é desenho original por código (formas, partículas, fontes do Windows). Nada representa o produto nem simula
demonstração: luzes desfocadas são clima, não o cordão.
  python motor_visual.py <roteiro-visual.json> <saida.mp4> <geometria.json>
"""
import sys, json, math, re, subprocess, unicodedata, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"): _s.reconfigure(encoding="utf-8", errors="replace")

R = json.load(open(sys.argv[1], encoding="utf-8")); SAIDA, GEO = sys.argv[2], sys.argv[3]
W, H, FPS = 1080, 1920, 30
TOTAL = float(R["total"]); N = int(round(TOTAL * FPS))
FF = os.environ.get("FFMPEG", "ffmpeg")
FONTES = "C:/Windows/Fonts/"
def fonte(nome, px): return ImageFont.truetype(FONTES + nome, px)
BLACK, BOLD, SEMI, SERIF_I = "seguibl.ttf", "segoeuib.ttf", "seguisb.ttf", "georgiaz.ttf"

T = R.get("tema", {})
OURO = tuple(T.get("ouro", (245, 205, 120))); CREME = tuple(T.get("creme", (255, 246, 228))); VERMELHO = tuple(T.get("acento", (214, 52, 70)))
FUNDOS = [np.array(c, np.float32) for c in T.get("fundos", [[(6, 38, 30), (3, 14, 22)], [(10, 30, 52), (4, 10, 24)], [(40, 12, 22), (8, 6, 16)]])]
rng = np.random.default_rng(int(R.get("semente", 2026)))

ease = lambda x: 1 - (1 - min(1, max(0, x))) ** 3
def molinha(x):  # entrada com leve "passou do ponto" (overshoot), 0→1
    x = min(1, max(0, x)); return 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2 if x < 1 else 1.0
clamp = lambda x, a=0.0, b=1.0: min(b, max(a, x))

# ── Tempo de cada palavra: voz real (região com som) dividida por sílabas ─────────────────────────
def silabas(p):
    s = unicodedata.normalize("NFD", p.lower()); s = re.sub(r"[\u0300-\u036f]", "", s)
    return max(1, len(re.findall(r"[aeiouy]+", s)))
def regiao_com_voz(wav):
    import librosa
    y, sr = librosa.load(wav, sr=16000)
    rms = librosa.feature.rms(y=y, frame_length=512, hop_length=160)[0]; lim = 0.12 * rms.max()
    idx = np.where(rms > lim)[0]
    return (idx[0] * 160 / sr, idx[-1] * 160 / sr) if len(idx) else (0, len(y) / sr)
FALAS = []
for f in R["falas"]:
    a, b = regiao_com_voz(f["wav"]); toks = f["texto"].split()
    pes = [silabas(t) + (0.8 if t.endswith((",", ".", "?", "!")) else 0) for t in toks]; tot = sum(pes); acc = f["ini"] + a; pal = []
    for t, p in zip(toks, pes):
        d = (b - a) * p / tot; pal.append({"t": t, "ini": acc, "fim": acc + d * (0.82 if t.endswith((",", ".", "?")) else 1)}); acc += d
    FALAS.append({**f, "palavras": pal, "vozIni": f["ini"] + a, "vozFim": f["ini"] + b})
def instante(papel, palavra, padrao):
    f = next((x for x in FALAS if x["papel"] == papel), None)
    if not f or not palavra: return padrao
    alvo = re.sub(r"\W", "", unicodedata.normalize("NFD", palavra.lower()).encode("ascii", "ignore").decode())
    for p in f["palavras"]:
        if re.sub(r"\W", "", unicodedata.normalize("NFD", p["t"].lower()).encode("ascii", "ignore").decode()).startswith(alvo): return p["ini"] - 0.08
    return padrao
fala = {f["papel"]: f for f in FALAS}
ini_papel = {f["papel"]: f["ini"] for f in FALAS}
ordem = [f["papel"] for f in FALAS]
fim_papel = {p: (ini_papel[ordem[i + 1]] if i + 1 < len(ordem) else TOTAL) for i, p in enumerate(ordem)}

# ── Fundo vivo ────────────────────────────────────────────────────────────────────────────────────
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
grad = (yy / H)[..., None]
vinheta = (1 - 0.55 * np.clip(((xx - W / 2) / (W * 0.75)) ** 2 + ((yy - H * 0.45) / (H * 0.7)) ** 2, 0, 1))[..., None].astype(np.float32)
def sprite_luz(r, cor, nitidez=1.0):
    d = np.mgrid[-r:r + 1, -r:r + 1].astype(np.float32); q = np.sqrt(d[0] ** 2 + d[1] ** 2) / r
    a = np.clip(1 - q, 0, 1) ** (1.6 / nitidez) * (0.55 + 0.45 * (q < 0.82))  # disco com borda macia (bokeh)
    return a[..., None] * np.array(cor, np.float32)[None, None, :] / 255.0
CORES_LUZ = [OURO, CREME, (255, 180, 90), VERMELHO, (120, 200, 160)]
BOKEH = []
for i in range(46):
    z = rng.uniform(0.25, 1.0)  # profundidade: perto = maior, mais rápido, mais desfocado
    r = int(18 + 120 * z ** 1.6); cor = CORES_LUZ[i % len(CORES_LUZ)] if i % 7 else VERMELHO
    # P2.65 (1ª medição da v3: movimento 0,003–0,011, "fundo quase parado"): luzes 2× mais rápidas e balanço maior
    BOKEH.append(dict(x=rng.uniform(-80, W + 80), y=rng.uniform(0, H), z=z, r=r, spr=sprite_luz(r, cor), a=rng.uniform(0.22, 0.55) * (1.1 - z * 0.5),
                      v=45 + 150 * z, fase=rng.uniform(0, 6.28), bal=rng.uniform(20, 70)))
NEVE = [dict(x=rng.uniform(0, W), y=rng.uniform(-H, H), r=int(rng.uniform(2, 8)), v=rng.uniform(120, 320), fase=rng.uniform(0, 6.28)) for _ in range(220)]
SPR_NEVE = {r: sprite_luz(r, (255, 255, 255), 2.2) for r in range(2, 9)}
# Raios de luz girando atrás do conteúdo (feixes suaves, como luz de vitrine): o fundo inteiro respira e gira.
# Calculados em meia resolução e ampliados (rápido); intensidade baixa para não competir com o texto.
_yh, _xh = np.mgrid[0:H // 2, 0:W // 2].astype(np.float32)
_ANG = np.arctan2(_yh - 430, _xh - W / 4); _RAIO = np.sqrt((_xh - W / 4) ** 2 + (_yh - 430) ** 2)
_QUEDA = np.clip(1 - _RAIO / 1100, 0, 1) ** 1.4
def raios(t, forca):
    r = ((0.5 + 0.5 * np.cos(10 * (_ANG - 0.32 * t))) ** 6 * 0.7 + (0.5 + 0.5 * np.cos(7 * (_ANG + 0.21 * t))) ** 8 * 0.5) * _QUEDA * forca
    return np.repeat(np.repeat(r, 2, axis=0), 2, axis=1)[..., None]
def brilho_estrela(tam):
    im = Image.new("L", (tam * 2 + 1, tam * 2 + 1), 0); d = ImageDraw.Draw(im); c = tam
    d.polygon([(c, 0), (c + tam * 0.12, c - tam * 0.12), (2 * c, c), (c + tam * 0.12, c + tam * 0.12), (c, 2 * c), (c - tam * 0.12, c + tam * 0.12), (0, c), (c - tam * 0.12, c - tam * 0.12)], fill=255)
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(1.2)), np.float32)[..., None] / 255.0
    return a * np.array(OURO, np.float32)[None, None, :] / 255.0
SPR_BRILHO = brilho_estrela(34)
BRILHOS = [dict(x=rng.uniform(60, W - 60), y=rng.uniform(380, 1250), t0=rng.uniform(0, TOTAL), d=rng.uniform(0.5, 0.9)) for _ in range(int(TOTAL * 1.6))]

def somar(img, spr, x, y, ganho):
    h, w = spr.shape[:2]; x0, y0 = int(x - w / 2), int(y - h / 2)
    xa, ya, xb, yb = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if xa >= xb or ya >= yb: return
    img[ya:yb, xa:xb] += spr[ya - y0:yb - y0, xa - x0:xb - x0] * ganho

# Ornamento: estrela de 8 pontas em linha fina dourada (desenho original), supersample 2× e reduzida
def ornamento(tam=980):
    s = tam * 2; im = Image.new("RGBA", (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(im); c = s / 2
    for k, (rr, lw) in enumerate([(0.48, 5), (0.40, 3), (0.30, 3)]):
        pts = []
        for i in range(16):
            ang = math.pi * i / 8 - math.pi / 2; raio = s * rr * (1 if i % 2 == 0 else 0.42 + 0.08 * k)
            pts.append((c + raio * math.cos(ang), c + raio * math.sin(ang)))
        d.line(pts + [pts[0]], fill=OURO + (150 - 35 * k,), width=lw * 2, joint="curve")
    d.ellipse([c - s * 0.2, c - s * 0.2, c + s * 0.2, c + s * 0.2], outline=OURO + (90,), width=4)
    return im.resize((tam, tam), Image.LANCZOS)
ORN = ornamento()

def fundo(t):
    # paleta muda por bloco (gancho/fatos/fechamento) com transição suave
    fases = [0, ini_papel.get(ordem[1], 3) if len(ordem) > 1 else 3, ini_papel.get("CTA", TOTAL * 0.8)]
    k = 0 if t < fases[1] else (1 if t < fases[2] else 2); mix = clamp((t - fases[k]) / 0.8) if k else 1
    a = FUNDOS[k]; b = FUNDOS[k - 1] if k else FUNDOS[0]
    top = b[0] * (1 - mix) + a[0] * mix; base = b[1] * (1 - mix) + a[1] * mix
    respira = 1 + 0.06 * math.sin(t * 1.3)
    img = (top[None, None, :] * (1 - grad) + base[None, None, :] * grad) / 255.0 * respira
    img = np.broadcast_to(img, (H, W, 3)).copy()
    # no gancho os raios giram ~4× mais rápido (abertura com energia); depois voltam ao ritmo calmo
    tg = ini_papel.get(ordem[1], 3) if len(ordem) > 1 else 3
    img += raios(t + 3.0 * min(t, tg), 0.16 + 0.05 * math.sin(t * 0.9) + 0.08 * clamp(1 - t / tg)) * np.array(OURO, np.float32)[None, None, :] / 255.0
    deriva = 60 * math.sin(t * 0.45)  # câmera flutuando: paralaxe pela profundidade
    for b_ in BOKEH:
        y = (b_["y"] - t * b_["v"]) % (H + 2 * b_["r"]) - b_["r"]; x = b_["x"] + b_["bal"] * math.sin(t * 0.7 + b_["fase"]) + deriva * b_["z"]
        somar(img, b_["spr"], x, y, b_["a"] * (0.75 + 0.25 * math.sin(t * 2.1 + b_["fase"])))
    for n in NEVE:
        y = (n["y"] + t * n["v"]) % (H + 20) - 10; x = (n["x"] + 30 * math.sin(t * 0.9 + n["fase"]) + t * 12) % W
        somar(img, SPR_NEVE[n["r"]], x, y, 0.7)
    for g in BRILHOS:
        u = (t - g["t0"]) / g["d"]
        if 0 <= u <= 1: somar(img, SPR_BRILHO, g["x"], g["y"], math.sin(math.pi * u) * 1.4)
    return img * vinheta

# ── Textos: imagens RGBA em cache, compostas com escala/alfa/deslocamento ────────────────────────
CACHE_TXT = {}
def texto_img(txt, nome, px, cor, brilho=None, contorno=0, sombra=True, espac=0):
    k = (txt, nome, px, cor, brilho, contorno, espac)
    if k in CACHE_TXT: return CACHE_TXT[k]
    f = fonte(nome, px); bb = f.getbbox(txt); w = bb[2] - bb[0] + 2 * contorno + espac * max(0, len(txt) - 1); h = bb[3] - bb[1] + 2 * contorno
    pad = int(px * 0.45); im = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    def escreve(d, fill, dx=0, dy=0):
        if espac:
            x = pad - bb[0] + contorno + dx
            for ch in txt: d.text((x, pad - bb[1] + contorno + dy), ch, font=f, fill=fill); x += f.getlength(ch) + espac
        else: d.text((pad - bb[0] + contorno + dx, pad - bb[1] + contorno + dy), txt, font=f, fill=fill, stroke_width=contorno, stroke_fill=(0, 0, 0, 160) if contorno else None)
    if sombra:
        s = Image.new("RGBA", im.size, (0, 0, 0, 0)); escreve(ImageDraw.Draw(s), (0, 0, 0, 170), 0, int(px * 0.05))
        im = Image.alpha_composite(im, s.filter(ImageFilter.GaussianBlur(px * 0.08)))
    if brilho:
        g = Image.new("RGBA", im.size, (0, 0, 0, 0)); escreve(ImageDraw.Draw(g), brilho + (210,))
        im = Image.alpha_composite(im, g.filter(ImageFilter.GaussianBlur(px * 0.22)))
    escreve(ImageDraw.Draw(im), cor + (255,) if len(cor) == 3 else cor)
    CACHE_TXT[k] = im; return im
def texto_misto(linha, nome, px, cor=None):
    """Linha com trechos {em destaque} (ouro + brilho) e o resto em creme, lado a lado, sem chaves na tela."""
    k = ("misto", linha, nome, px)
    if k in CACHE_TXT: return CACHE_TXT[k]
    partes = [(m, i % 2 == 1) for i, m in enumerate(re.split(r"[{}]", linha)) if m]
    ims = [texto_img(m.strip(), nome, px, OURO if d else (cor or CREME), brilho=(255, 190, 80) if d else None) for m, d in partes]
    pad = int(px * 0.45); esp = int(fonte(nome, px).getlength(" "))
    larg = sum(i.width - 2 * pad for i in ims) + 2 * pad + esp * sum(1 for m, _ in partes if m.endswith(" ")); alt = max(i.height for i in ims)
    im = Image.new("RGBA", (larg, alt), (0, 0, 0, 0)); x = 0
    for (m, _), i in zip(partes, ims):
        im.alpha_composite(i, (x, (alt - i.height) // 2)); x += i.width - 2 * pad + (esp if m.endswith(" ") else 0)
    CACHE_TXT[k] = im; return im
def cartao(w, h, raio=46, borda=OURO, alfa=120):
    k = ("cartao", w, h, raio, borda, alfa)
    if k in CACHE_TXT: return CACHE_TXT[k]
    im = Image.new("RGBA", (w + 60, h + 60), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([30, 36, 30 + w, 36 + h], raio, fill=(0, 0, 0, 90)); im = im.filter(ImageFilter.GaussianBlur(14)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([30, 30, 30 + w, 30 + h], raio, fill=(8, 18, 26, alfa), outline=borda + (200,), width=3)
    CACHE_TXT[k] = im; return im
def por(base, im, cx, cy, escala=1.0, alfa=1.0, ancora="c"):
    if alfa <= 0.01 or escala <= 0.01: return
    if abs(escala - 1) > 0.004: im = im.resize((max(1, int(im.width * escala)), max(1, int(im.height * escala))), Image.BILINEAR)
    if alfa < 0.999:
        a = im.getchannel("A").point(lambda v: int(v * alfa)); im = im.copy(); im.putalpha(a)
    x = int(cx - im.width / 2) if ancora == "c" else int(cx); y = int(cy - im.height / 2)
    if x >= base.width or y >= base.height or x + im.width <= 0 or y + im.height <= 0: return  # fora da tela
    base.alpha_composite(im, (max(0, x), max(0, y)), (max(0, -x), max(0, -y)))

GEOM = {}  # o que o Quality Gate mede: cada texto (uma vez só, embora desenhado em muitos quadros) com topo/base/tamanho
BATIDAS = set()  # instantes em que a tela muda de verdade (entra cartela, linha, item, botão): viram os "trechos" medidos
def geo(ini, fim, texto, cy, px, tipo="DESTAQUE", linhas=1, fixo=False):
    k = (texto, tipo, round(ini, 2))
    if k in GEOM: return
    # texto de cena sai 0,15 s antes da troca: é quando a transição já o apagou (sem "sobreposição" de 0,1 s no registro)
    if not fixo and tipo == "DESTAQUE" and fim - ini > 1: fim -= 0.15
    GEOM[k] = {"ini": round(ini, 3), "fim": round(fim, 3), "texto": texto, "topo": int(cy - px * 0.7 * linhas), "base": int(cy + px * 0.7 * linhas), "tipo": tipo, "tamanhoPx": px}
    if not fixo and tipo == "DESTAQUE": BATIDAS.add(round(ini, 2))

# ── Ícones originais (traço dourado) ─────────────────────────────────────────────────────────────
def icone(nome, tam=120):
    s = tam * 2; im = Image.new("RGBA", (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(im); c = s / 2
    d.ellipse([6, 6, s - 6, s - 6], fill=OURO + (40,), outline=OURO + (255,), width=6)
    if nome == "raio": d.polygon([(c + 14, s * 0.18), (s * 0.32, c + 10), (c, c + 10), (c - 14, s * 0.82), (s * 0.68, c - 10), (c, c - 10)], fill=OURO + (255,))
    elif nome == "gota":
        d.ellipse([c - s * 0.2, c - s * 0.02, c + s * 0.2, c + s * 0.38], fill=OURO + (255,)); d.polygon([(c, s * 0.16), (c - s * 0.19, c + s * 0.12), (c + s * 0.19, c + s * 0.12)], fill=OURO + (255,))
    elif nome == "tomada":
        d.rounded_rectangle([c - s * 0.2, c - s * 0.12, c + s * 0.2, c + s * 0.2], 18, fill=OURO + (255,)); d.rectangle([c - s * 0.12, c - s * 0.3, c - s * 0.06, c - s * 0.12], fill=OURO + (255,)); d.rectangle([c + s * 0.06, c - s * 0.3, c + s * 0.12, c - s * 0.12], fill=OURO + (255,)); d.rectangle([c - s * 0.03, c + s * 0.2, c + s * 0.03, c + s * 0.34], fill=OURO + (255,))
    elif nome == "estrela":
        pts = [(c + (s * 0.36 if i % 2 == 0 else s * 0.15) * math.cos(math.pi * i / 5 - math.pi / 2), c + (s * 0.36 if i % 2 == 0 else s * 0.15) * math.sin(math.pi * i / 5 - math.pi / 2)) for i in range(10)]
        d.polygon(pts, fill=OURO + (255,))
    return im.resize((tam, tam), Image.LANCZOS)
ESTRELA_CHEIA = icone("estrela", 86)

# ── Cenas ────────────────────────────────────────────────────────────────────────────────────────
CENAS = R["telas"]; MEIO = 860  # centro óptico das cartelas (acima da legenda, longe da interface do app)
def cena_manchete(base, t, c, t0, t1):
    linhas = c["linhas"]; px = c.get("px", 128)
    if "sobretitulo" in c:
        por(base, texto_img(c["sobretitulo"], SERIF_I, 58, OURO, espac=10), W / 2, MEIO - 380, 1, ease((t - t0 - 0.05) / 0.4))
    passo = c.get("passo", 0.32); y0 = MEIO - (len(linhas) - 1) * px * 0.62
    if t - t0 < 1.6: faiscas(base, W / 2, MEIO, (t - t0) / 1.6, 60, 950)  # explosão de faíscas que abre o vídeo
    td = t0 + 0.12 + passo * next((i for i, l in enumerate(linhas) if l.startswith("{")), 0)  # a palavra em destaque também "estoura"
    if 0 <= t - td < 1.0: faiscas(base, W / 2, y0 + px * 1.24 * next((i for i, l in enumerate(linhas) if l.startswith("{")), 0), (t - td) / 1.0, 34, 560)
    for i, l in enumerate(linhas):
        inteira = l.startswith("{") and l.endswith("}"); u = (t - t0 - 0.12 - i * passo) / 0.38
        if u <= 0: continue
        im = texto_misto(l, BLACK, int(px * (1.22 if inteira else 1)))
        zoom = 1 + 0.04 * clamp((t - t0) / max(0.1, t1 - t0))  # leve aproximação contínua
        por(base, im, W / 2, y0 + i * px * 1.24 + 40 * (1 - ease(u)), molinha(u) * zoom, ease(u * 1.6) * clamp((t1 + 0.1 - t) / 0.2))
    BATIDAS.update(round(t0 + 0.12 + i * passo, 2) for i in range(len(linhas)))
    geo(t0 + 0.12, t1, "\n".join(x.replace("{", "").replace("}", "") for x in linhas), MEIO, px, "DESTAQUE", len(linhas))

def rotulo_chip(base, txt, cy, alfa):
    im = texto_img(txt, SEMI, 40, OURO, espac=4); w = im.width + 10
    por(base, cartao(w, 78, 39, OURO, 150), W / 2, cy, 1, alfa); por(base, im, W / 2, cy + 2, 1, alfa)

def cena_numeros(base, t, cs, papel, t0, t1):
    # cada cartela entra na palavra que a narra ("na") e sai quando a próxima entra
    inis = [t0] + [instante(papel, c.get("na"), t0 + (t1 - t0) * k / len(cs)) for k, c in enumerate(cs) if k > 0]
    rot = next((c["rotulo"] for c in cs if c.get("rotulo")), None)
    if rot: rotulo_chip(base, rot, MEIO - 330, ease((t - t0) / 0.3)); geo(t0, t1, rot, MEIO - 330, 40)
    for k, c in enumerate(cs):
        a, b = inis[k], (inis[k + 1] if k + 1 < len(cs) else t1)
        if not (a - 0.05 <= t <= b + 0.2): continue
        u = (t - a) / 0.34; sai = clamp((t - b) / 0.2)
        esc = molinha(u) * (1 + 0.12 * sai); alf = ease(u * 1.5) * (1 - sai)
        por(base, cartao(900, 470), W / 2, MEIO + 30, esc, alf * 0.95)
        if c["tipo"] == "numero":
            vi = texto_img(c["valor"], BLACK, 230, OURO, brilho=(255, 180, 70))
            if c.get("unidade") and len(c["valor"]) <= 3:  # "50 m": número e unidade na mesma linha, centrados juntos
                ui = texto_img(c["unidade"], BLACK, 110, CREME); wv = vi.width - 2 * int(230 * 0.45); wu = ui.width - 2 * int(110 * 0.45); x0 = W / 2 - (wv + 24 + wu) / 2
                por(base, vi, x0 + wv / 2, MEIO - 20, esc, alf); por(base, ui, x0 + wv + 24 + wu / 2, MEIO + 28, esc, alf)
            else:
                por(base, vi, W / 2, MEIO - 20, esc, alf)
                if c.get("unidade"): por(base, texto_img(c["unidade"], BLACK, 96, CREME), W / 2, MEIO + 150, esc, alf)
            if c.get("sub"): por(base, texto_img(c["sub"], SEMI, 46, (210, 220, 215)), W / 2, MEIO + 225, esc, alf)
            geo(a, b, f"{c['valor']} {c.get('unidade', '')}".strip(), MEIO + 20, 230)
        elif c["tipo"] == "cor":
            r = 150 + 18 * math.sin(t * 5)
            orb = sprite_luz(int(r), (255, 214, 150)); tmp = np.zeros((orb.shape[0], orb.shape[1], 4), np.float32); tmp[..., :3] = orb; tmp[..., 3] = orb.max(axis=2)
            por(base, Image.fromarray((np.clip(tmp, 0, 1) * 255).astype(np.uint8), "RGBA"), W / 2, MEIO - 110, esc, alf)
            for j, pal in enumerate(c["valor"].split()):  # uma palavra por linha: nunca transborda o cartão
                por(base, texto_img(pal, BLACK, 118, CREME, brilho=(255, 214, 150)), W / 2, MEIO + 62 + j * 124, esc, alf)
            geo(a, b, c["valor"].replace(" ", "\n"), MEIO + 154, 118, "DESTAQUE", len(c["valor"].split()))

def cena_lista(base, t, c, papel, t0, t1):
    rotulo_chip(base, c["rotulo"], MEIO - 360, ease((t - t0) / 0.3)); geo(t0, t1, c["rotulo"], MEIO - 360, 40)
    for k, it in enumerate(c["itens"]):
        a = instante(papel, it.get("na"), t0 + 0.4 + k * 0.9); u = (t - a) / 0.32
        if u <= 0: continue
        cy = MEIO - 170 + k * 210; dx = 140 * (1 - ease(u)); alf = ease(u * 1.6) * clamp((t1 + 0.15 - t) / 0.2)
        ativo = 1 + 0.035 * math.exp(-max(0, t - a) * 3)  # "pulso" quando a voz diz o item
        por(base, cartao(860, 170, 40, OURO, 140), W / 2 + dx, cy, ativo, alf)
        por(base, icone(it["icone"]), W / 2 - 330 + dx, cy, ativo, alf)
        por(base, texto_img(it["texto"], BLACK, 78, CREME), W / 2 - 230 + dx, cy, ativo, alf, ancora="l")
        geo(a, t1, it["texto"], cy, 78)

def cena_avaliacao(base, t, c, papel, t0, t1):
    rotulo_chip(base, c["rotulo"], MEIO - 360, ease((t - t0) / 0.3)); geo(t0, t1, c["rotulo"], MEIO - 360, 40)
    u = (t - t0 - 0.1) / 0.35; alf = ease(u * 1.5) * clamp((t1 + 0.15 - t) / 0.2)
    por(base, cartao(900, 560), W / 2, MEIO + 20, molinha(u), alf * 0.95)
    por(base, texto_img(c["nota"], BLACK, 210, OURO, brilho=(255, 180, 70)), W / 2, MEIO - 120, molinha(u), alf)
    for i in range(5):  # estrelas acendem em sequência
        v = (t - t0 - 0.35 - i * 0.09) / 0.25
        if v > 0: por(base, ESTRELA_CHEIA, W / 2 - 200 + i * 100, MEIO + 40, molinha(v), alf)
    a = instante(papel, c.get("na_vendidos"), t0 + 1.4); v = (t - a) / 0.6
    if v > 0:
        alvo = int(re.sub(r"\D", "", c["vendidos"]) or 0); n = max(1, round(alvo * ease(v)))  # contador até o número do anúncio
        txt = c["vendidos"] if v >= 1 else f"+{n} mil"
        por(base, texto_img(txt, BLACK, 104, CREME), W / 2, MEIO + 175, molinha(v * 1.4), alf)
        por(base, texto_img("vendidos", SEMI, 46, (210, 220, 215)), W / 2, MEIO + 255, 1, alf * ease(v))
        geo(a, t1, f"{c['vendidos']} vendidos", MEIO + 190, 104)
    geo(t0 + 0.1, t1, f"nota {c['nota']}", MEIO - 120, 210)

FAISCA = Image.fromarray((np.clip(np.concatenate([sprite_luz(24, (255, 226, 160), 1.3), sprite_luz(24, (255, 226, 160), 1.3).max(axis=2, keepdims=True)], axis=2), 0, 1) * 255).astype(np.uint8), "RGBA")
ANG_FAISCAS = [(rng.uniform(0, 6.283), rng.uniform(0.55, 1.0)) for _ in range(60)]
def faiscas(base, cx, cy, u, n, alcance):
    """Faíscas douradas saindo do centro e desacelerando (u: 0→1)."""
    for ang, v in ANG_FAISCAS[:n]:
        d = alcance * v * ease(u); por(base, FAISCA, cx + d * math.cos(ang), cy + d * math.sin(ang), 1.4 - 0.8 * u, 1 - u)

def cena_cta(base, t, c, t0, t1):
    linhas = c["linhas"]; px = 112
    for i, l in enumerate(linhas):
        u = (t - t0 - i * 0.22) / 0.36
        if u > 0: por(base, texto_misto(l, BLACK, px), W / 2, MEIO - 330 + i * 140, molinha(u), ease(u * 1.6))
    geo(t0, t1, "\n".join(x.replace("{", "").replace("}", "") for x in linhas), MEIO - 190, px, "DESTAQUE", len(linhas))
    u = (t - t0 - 0.7) / 0.4
    if u > 0:
        # batida na palavra "link": o botão dá um salto e solta faíscas (segunda mudança real da cena final)
        tl = instante("CTA", c.get("na", "link"), t0 + 2.6); BATIDAS.add(round(tl, 2))
        salto = 0.16 * math.exp(-max(0, t - tl) * 5) if t >= tl else 0
        pulso = 1 + 0.05 * math.sin((t - t0) * 7) + salto
        if 0 <= t - tl < 0.9: faiscas(base, W / 2, MEIO + 240, (t - tl) / 0.9, 26, 420)
        bt = Image.new("RGBA", (700, 170), (0, 0, 0, 0)); d = ImageDraw.Draw(bt); d.rounded_rectangle([0, 0, 699, 169], 85, fill=OURO + (255,))
        tx = texto_img(c["botao"], BLACK, 76, (20, 24, 30), sombra=False); bt.alpha_composite(tx, ((700 - tx.width) // 2, (170 - tx.height) // 2))
        halo = bt.filter(ImageFilter.GaussianBlur(26))
        por(base, halo, W / 2, MEIO + 240, molinha(u) * pulso * 1.06, 0.55 * ease(u))
        por(base, bt, W / 2, MEIO + 240, molinha(u) * pulso, ease(u * 1.5))
        seta = texto_img("▲", BOLD, 64, OURO); por(base, seta, W / 2, MEIO + 100 - 14 * abs(math.sin((t - t0) * 4)), 1, ease(u))
        geo(t0 + 0.7, t1, c["botao"], MEIO + 240, 76)

# ── Legenda dinâmica: blocos de até ~3 palavras, palavra falada em ouro ─────────────────────────
BLOCOS = []
for f in FALAS:
    if f["papel"] in R.get("semLegenda", ["GANCHO"]): continue
    ps = f["palavras"]; i = 0
    while i < len(ps):
        j = i; chars = 0
        # até 3 palavras/22 letras; mas nunca menos de 0,75 s na tela (aí aceita até 4 palavras/28 letras)
        while j < len(ps) and (((j - i < 3) and chars + len(ps[j]["t"]) <= 22) or (ps[j - 1]["fim"] - ps[i]["ini"] < 0.75 if j > i else True) and (j - i < 4) and chars + len(ps[j]["t"]) <= 28):
            chars += len(ps[j]["t"]) + 1; j += 1
            if ps[j - 1]["t"].endswith((",", ".", "?")) and ps[j - 1]["fim"] - ps[i]["ini"] >= 0.75: break
        j = max(j, i + 1)
        # última palavra sozinha da fala ("quente.", "bio.") fica rápida demais: junta ao bloco anterior da mesma fala
        if j - i == 1 and i > 0 and ps[i]["fim"] - ps[i]["ini"] < 0.75 and BLOCOS and BLOCOS[-1]["papel"] == f["papel"] and len(" ".join(p["t"] for p in BLOCOS[-1]["pal"])) + len(ps[i]["t"]) <= 30:
            BLOCOS[-1]["pal"] = BLOCOS[-1]["pal"] + ps[i:j]; BLOCOS[-1]["fim"] = ps[i]["fim"] + 0.12; i = j; continue
        BLOCOS.append({"ini": ps[i]["ini"], "fim": ps[j - 1]["fim"] + 0.12, "pal": ps[i:j], "papel": f["papel"]}); i = j
for k in range(len(BLOCOS) - 1): BLOCOS[k]["fim"] = min(BLOCOS[k]["fim"], BLOCOS[k + 1]["ini"])
LEG_Y, LEG_PX = 1330, 70
for b in BLOCOS: geo(b["ini"], b["fim"], " ".join(p["t"] for p in b["pal"]), LEG_Y, LEG_PX, "LEGENDA")
def legenda(base, t):
    b = next((x for x in BLOCOS if x["ini"] <= t < x["fim"]), None)
    if not b: return
    imgs = []
    for p in b["pal"]:
        falando = p["ini"] <= t < p["fim"] + 0.05
        imgs.append((texto_img(p["t"], BLACK, LEG_PX, OURO if falando else (255, 255, 255), contorno=4), falando))
    larg = sum(im.width for im, _ in imgs) - 40 * (len(imgs) - 1)
    u = (t - b["ini"]) / 0.12; x = W / 2 - larg / 2
    por(base, cartao(int(larg + 10), 118, 30, (255, 255, 255), 150), W / 2, LEG_Y, 1, min(1, u) * 0.85)
    for im, falando in imgs:
        por(base, im, x + im.width / 2, LEG_Y - 4 * falando, 1.08 if falando else 1, min(1, u)); x += im.width - 40

# ── Selo e transparência fixos ───────────────────────────────────────────────────────────────────
SELO = R.get("selo", "#publi"); AVISO = R.get("aviso", "")
def fixos(base):
    s = texto_img(SELO, BLACK, 50, (255, 255, 255), sombra=False); w = s.width + 6
    por(base, cartao(w, 82, 41, VERMELHO, 210), 60 + (w + 60) / 2, 262, 1, 1); por(base, s, 60 + (w + 60) / 2, 264, 1, 1)
    for i, l in enumerate(AVISO_LINHAS): por(base, texto_img(l, SEMI, 38, (235, 235, 230)), W / 2, 338 + i * 46, 1, 0.92)
# aviso em linhas curtas (≤ 34 letras: legível no celular), quebrado no "·"
AVISO_LINHAS = [x.strip() for x in AVISO.split("·")] if AVISO else []
geo(0, TOTAL, SELO, 262, 50, fixo=True); (geo(0, TOTAL, "\n".join(AVISO_LINHAS), 361, 38, "DESTAQUE", len(AVISO_LINHAS), fixo=True) if AVISO else None)

# ── Transições: varredura de luz na troca de bloco + clarão de abertura ─────────────────────────
CORTES = [ini_papel[p] for p in ordem[1:]]
def varredura(img, t):
    for c in CORTES:
        u = (t - c + 0.12) / 0.45
        if 0 <= u <= 1:
            pos = -400 + u * (W + H * 0.5 + 800); banda = np.exp(-(((xx + yy * 0.5) - pos) / 110) ** 2)[..., None]
            img += banda * np.array(OURO, np.float32)[None, None, :] / 255.0 * 0.55 * math.sin(math.pi * u)
    if t < 0.45:  # explosão de luz que abre o vídeo
        k = 1 - t / 0.45; r2 = ((xx - W / 2) ** 2 + (yy - MEIO) ** 2) / (300 + 1400 * (1 - k)) ** 2
        img += np.exp(-r2)[..., None] * np.array((255, 214, 150), np.float32)[None, None, :] / 255.0 * 0.75 * k

def quadro(i):
    t = i / FPS
    img = fundo(t)
    # ornamento girando atrás das cartelas (mais forte nos blocos de fatos)
    varredura(img, t)
    base = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8), "RGB").convert("RGBA")
    orn = ORN.rotate(t * 9, resample=Image.BILINEAR)
    por(base, orn, W / 2, MEIO + 20, 1 + 0.03 * math.sin(t), 0.35 if t > ini_papel.get(ordem[1], 99) else 0.18)
    for papel, c in CENAS.items():
        t0, t1 = ini_papel.get(papel, 0) - (0.0 if papel == ordem[0] else 0.1), fim_papel.get(papel, TOTAL)
        if papel == ordem[0]: t0 = 0
        if not (t0 - 0.05 <= t <= t1 + 0.3): continue
        if isinstance(c, list): cena_numeros(base, t, c, papel, t0, t1)
        elif c["tipo"] == "manchete": cena_manchete(base, t, c, t0, t1)
        elif c["tipo"] == "lista": cena_lista(base, t, c, papel, t0, t1)
        elif c["tipo"] == "avaliacao": cena_avaliacao(base, t, c, papel, t0, t1)
        elif c["tipo"] == "cta": cena_cta(base, t, c, t0, t1)
    legenda(base, t); fixos(base)
    return base.convert("RGB")

if __name__ == "__main__":
    so = [float(x) for x in os.environ.get("PATRONO_SO_QUADROS", "").split(",") if x]
    if so:  # prévia: só alguns instantes, em PNG (análise visual)
        for s in so: quadro(int(s * FPS)).save(f"{SAIDA}-{s:05.2f}.png")
        sys.exit(0)
    p = subprocess.Popen([FF, "-hide_banner", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                          "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", SAIDA], stdin=subprocess.PIPE)
    for i in range(N):
        p.stdin.write(quadro(i).tobytes())
        if i % 90 == 0: print(json.dumps({"quadro": i, "de": N}), flush=True)
    p.stdin.close(); p.wait()
    json.dump({"textos": sorted(GEOM.values(), key=lambda g: (g["ini"], g["tipo"])), "palavras": [{"papel": f["papel"], "palavras": f["palavras"]} for f in FALAS], "cortes": CORTES, "batidas": sorted(BATIDAS)},
              open(GEO, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({"ok": p.returncode == 0, "quadros": N}))
