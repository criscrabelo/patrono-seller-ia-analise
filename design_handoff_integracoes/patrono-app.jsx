
/* ===== icons.jsx ===== */
/* ============ Icons (lucide-style, simple strokes) ============ */
const Icon = ({ name, size = 18, style }) => {
  const p = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style,
  };
  const paths = {
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    menu: <><path d="M3 6h18M3 12h18M3 18h18"/></>,
    moon: <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
    eyeOff: <><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.45 18.45 0 0 1 4.06-5.06M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></>,
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
    radar: <><circle cx="12" cy="12" r="2"/><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 12l7-7"/><path d="M12 7a5 5 0 1 0 5 5"/></>,
    sparkles: <><path d="M12 3l1.8 4.9L18.7 9 13.8 10.8 12 15.7 10.2 10.8 5.3 9l4.9-1.1z"/><path d="M19 14l.9 2.4L22 17l-2.1.6L19 20l-.9-2.4L16 17l2.1-.6z"/><path d="M5 15l.7 1.9L7.5 17l-1.8.6L5 19.5l-.7-1.9L2.5 17l1.8-.5z"/></>,
    library: <><path d="M3 5v14M8 5v14"/><rect x="11" y="4" width="4" height="16" rx="1"/><path d="M18 5l3 13-2 .5L16 6z"/></>,
    check: <><path d="M20 6L9 17l-5-5"/></>,
    checkCircle: <><circle cx="12" cy="12" r="9"/><path d="M8.5 12l2.5 2.5 4.5-5"/></>,
    calendar: <><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></>,
    chart: <><path d="M3 3v18h18"/><path d="M7 14l3-4 3 2 4-6"/></>,
    video: <><rect x="2" y="5" width="14" height="14" rx="2.5"/><path d="M16 10l6-3v10l-6-3z"/></>,
    bag: <><path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></>,
    plug: <><path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0z"/><path d="M12 16v6"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></>,
    dollar: <><path d="M12 2v20M17 6a4 4 0 0 0-4-3H10a3.5 3.5 0 0 0 0 7h4a3.5 3.5 0 0 1 0 7h-3.5A4 4 0 0 1 7 18"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>,
    message: <><path d="M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12z"/></>,
    users: <><circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.5a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.5a6 6 0 0 1 3 5.5"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    brain: <><path d="M9 4a2.5 2.5 0 0 0-2.5 2.5A2.5 2.5 0 0 0 5 11a2.5 2.5 0 0 0 1.5 4.5A2.5 2.5 0 0 0 9 20a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="M15 4a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 19 11a2.5 2.5 0 0 1-1.5 4.5A2.5 2.5 0 0 1 15 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></>,
    layers: <><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></>,
    bolt: <><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M10.5 21a2 2 0 0 0 3 0"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    x: <><path d="M18 6L6 18M6 6l12 12"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
    heart: <><path d="M12 20s-7-4.5-9.5-9A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 9.5 5c-2.5 4.5-9.5 9-9.5 9z"/></>,
    share: <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></>,
    bookmark: <><path d="M6 3h12v18l-6-4-6 4z"/></>,
    trend: <><path d="M3 17l6-6 4 4 7-7"/><path d="M17 8h4v4"/></>,
    fire: <><path d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5C8 10 7 12 7 14a5 5 0 0 0 10 0c0-5-5-8-5-12z"/></>,
    pencil: <><path d="M16 3l5 5L8 21H3v-5z"/></>,
    play: <><path d="M6 4l14 8-14 8z"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    chevR: <><path d="M9 6l6 6-6 6"/></>,
    chevD: <><path d="M6 9l6 6 6-6"/></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></>,
    menu: <><path d="M3 6h18M3 12h18M3 18h18"/></>,
    shield: <><path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z"/><path d="M9 12l2 2 4-4"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
    rocket: <><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2c.9-.9.9-2.4 0-3.3a2.3 2.3 0 0 0-3 .3z"/><path d="M9 12l3 3M19 3s-4 0-8 4c-1.6 1.6-2.5 3-3 4l4 4c1-.5 2.4-1.4 4-3 4-4 4-8 4-8z"/><circle cx="14" cy="9" r="1.2"/></>,
    flask: <><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7 15h10"/></>,
    copy: <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></>,
    download: <><path d="M12 3v12M7 11l5 5 5-5"/><path d="M5 21h14"/></>,
    alert: <><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/></>,
    star: <><path d="M12 3l2.6 5.6L21 9.3l-4.5 4.3 1.1 6.4L12 17l-5.6 3 1.1-6.4L3 9.3l6.4-.7z"/></>,
    filter: <><path d="M3 5h18l-7 8v5l-4 2v-7z"/></>,
    refresh: <><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 4v4h-4M3 20v-4h4"/></>,
    folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></>,
    tag: <><path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1.5"/></>,
    pause: <><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></>,
    lock: <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
    doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h5"/></>,
    scale: <><path d="M12 3v18M8 21h8"/><path d="M5 6h14l-3-2"/><path d="M5 6l-2.5 6a3 3 0 0 0 5 0z"/><path d="M19 6l-2.5 6a3 3 0 0 0 5 0z"/></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 21h14"/></>,
    ban: <><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></>,
    crown: <><path d="M3 7l4 4 5-7 5 7 4-4-2 12H5z"/></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
  };
  return <svg {...p}>{paths[name] || null}</svg>;
};

/* ============ Brand mark ============ */
const BrandMark = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 2.5l1.7 4.6 4.8.2-3.7 3 1.3 4.6L12 16.3 7.9 14.9l1.3-4.6-3.7-3 4.8-.2z"
      fill="oklch(0.2 0.02 70)"/>
    <circle cx="12" cy="19.5" r="1.6" fill="oklch(0.2 0.02 70)"/>
  </svg>
);

window.Icon = Icon;
window.BrandMark = BrandMark;


/* ===== ui.jsx ===== */
/* ============ Shared UI components ============ */
const { useState } = React;

const Badge = ({ status }) => {
  const m = window.statusMap[status] || { label: status, cls: 'gray', icon: null };
  return (
    <span className={`badge ${m.cls}`}>
      {m.icon && <Icon name={m.icon} size={12} />}
      {m.label}
    </span>
  );
};

const StatCard = ({ icon, color, value, label, trend, trendDir }) => (
  <div className="stat-card">
    <div className="ico" style={{ background: `var(--${color}-soft)`, color: `var(--${color})` }}>
      <Icon name={icon} />
    </div>
    <div className="stat-value">{value}</div>
    <div className="stat-label">{label}</div>
    {trend && (
      <div className={`stat-trend ${trendDir}`}>
        <Icon name={trendDir === 'up' ? 'trend' : 'arrow'} size={13} />{trend}
      </div>
    )}
  </div>
);

const Media = ({ label, ratio = '9 / 16', style }) => (
  <div className="media" style={{ aspectRatio: ratio, ...style }}>
    <span className="ph-label">{label}</span>
  </div>
);

const SectionTitle = ({ children, action }) => (
  <div className="row spread" style={{ marginBottom: 2 }}>
    <h2 style={{ fontSize: 17 }}>{children}</h2>
    {action}
  </div>
);

const Pill = ({ children, color = 'gray' }) => (
  <span className={`badge ${color}`}>{children}</span>
);

// A vertical "phone" preview frame for video content
const PhonePreview = ({ label, badge, children, w = 150 }) => (
  <div style={{
    width: w, flexShrink: 0, borderRadius: 18, padding: 5,
    background: 'linear-gradient(160deg, var(--surface-3), var(--surface))',
    border: '1px solid var(--border)', boxShadow: 'var(--shadow)',
  }}>
    <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden' }}>
      <Media label={label} ratio="9 / 16" />
      {badge && <div style={{ position: 'absolute', top: 8, left: 8 }}>{badge}</div>}
      <div style={{ position: 'absolute', right: 8, bottom: 10, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', color: 'rgba(255,255,255,.85)' }}>
        <Icon name="heart" size={18} /><Icon name="message" size={18} /><Icon name="bookmark" size={18} /><Icon name="share" size={18} />
      </div>
      {children}
    </div>
  </div>
);

// A carousel preview frame (square, swipeable dots) for multi-slide image posts
const CarouselPreview = ({ label, slides = 4, badge, w = 150, ratio = '4 / 5' }) => {
  const [i, setI] = React.useState(0);
  return (
    <div style={{
      width: w, flexShrink: 0, borderRadius: 18, padding: 5,
      background: 'linear-gradient(160deg, var(--surface-3), var(--surface))',
      border: '1px solid var(--border)', boxShadow: 'var(--shadow)',
    }}>
      <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden' }}>
        <Media label={`${label}\nslide ${i + 1}/${slides}`} ratio={ratio} />
        {badge && <div style={{ position: 'absolute', top: 8, left: 8 }}>{badge}</div>}
        <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.55)', borderRadius: 99, padding: '2px 7px', fontSize: 10, fontWeight: 700, color: 'white', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Icon name="layers" size={10} />{i + 1}/{slides}
        </div>
        <button onClick={() => setI((i - 1 + slides) % slides)} style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, borderRadius: 99, border: 'none', background: 'rgba(0,0,0,.5)', color: 'white', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Icon name="chevR" size={13} style={{ transform: 'rotate(180deg)' }} /></button>
        <button onClick={() => setI((i + 1) % slides)} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, borderRadius: 99, border: 'none', background: 'rgba(0,0,0,.5)', color: 'white', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Icon name="chevR" size={13} /></button>
        <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', gap: 4, justifyContent: 'center' }}>
          {Array.from({ length: slides }).map((_, k) => (
            <span key={k} style={{ width: k === i ? 14 : 5, height: 5, borderRadius: 99, background: k === i ? 'white' : 'rgba(255,255,255,.5)', transition: 'width .15s' }} />
          ))}
        </div>
      </div>
    </div>
  );
};

// ============ Modal ============
const Modal = ({ open, onClose, title, sub, icon, iconColor = 'gold', children, footer, w = 460 }) => {
  if (!open) return null;
  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: w }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          {icon && <div className="ico" style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: `var(--${iconColor}-soft)`, color: `var(--${iconColor})`, flexShrink: 0 }}><Icon name={icon} size={19} /></div>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15.5 }}>{title}</div>
            {sub && <div className="muted" style={{ fontSize: 12.5 }}>{sub}</div>}
          </div>
          <button className="modal-x" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};

// Linha rótulo→valor para corpos de modal
const KV = ({ k, v, mono }) => (
  <div className="row spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
    <span className="dim" style={{ fontSize: 12.5 }}>{k}</span>
    <span className={mono ? 'mono' : ''} style={{ fontSize: 12.5, fontWeight: 500, textAlign: 'right', maxWidth: 260, wordBreak: 'break-word' }}>{v}</span>
  </div>
);

// ============ Paywall (módulo não contratado) ============
const PaywallBanner = ({ mod, go, onActivate }) => (
  <div className="paywall fade-in">
    <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: `var(--${mod.cor}-soft)`, color: `var(--${mod.cor})`, flexShrink: 0 }}><Icon name="lock" size={20} /></div>
    <div style={{ flex: 1, minWidth: 220 }}>
      <div className="row" style={{ gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14.5 }}>Prévia — módulo não contratado</span>
        <span className="badge gold" style={{ padding: '1px 8px', fontSize: 10.5 }}>{mod.nome}</span>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>Você está vendo dados de demonstração. Ative o módulo para usar com a sua operação · <strong style={{ color: 'var(--gold)' }}>R$ {mod.mensal}/mês</strong></p>
    </div>
    <div className="row" style={{ gap: 9, flexShrink: 0 }}>
      <button className="btn btn-ghost btn-sm" onClick={() => go('loja')}><Icon name="folder" size={13} />Ver na Loja</button>
      <button className="btn btn-primary btn-sm" onClick={onActivate}><Icon name="bolt" size={13} />Ativar teste</button>
    </div>
  </div>
);

Object.assign(window, { Badge, StatCard, Media, SectionTitle, Pill, PhonePreview, CarouselPreview, Modal, KV, PaywallBanner });


/* ===== data.jsx ===== */
/* ============ Mock data — Patrono Seller IA ============ */

const DATA = {
  user: { name: '', email: '', role: '' },

  metas: {
    seguidores: 0,
    meta1: 0, meta1Data: '',
    meta2: 0, meta2Data: '',
    crescimentoDiario: 0, crescimentoNecessario: 0,
    videosPlanejados: 0, videosPostados: 0, videosAprovados: 0,
    metaPostagens: 0,
    produtos: 0, produtosCampeoes: 0,
    cliques: 0, vendas: 0, receita: 0,
    aguardando: 0,
  },

  serie7d: [0, 0, 0, 0, 0, 0, 0],

  trends: [],
  produtos: [],
  criativos: [],
  aprovacoes: [],

  horarios: ['07:30','09:30','11:30','13:30','15:30','18:30','20:30','22:00'],
  calendario: [],

  series: [],

  relatorios: [],

  roteiros: [],
};

window.DATA = DATA;

DATA.usuarios = [];
DATA.solicitacoes = [];
window.papelMap = {
  admin:    { label:'Administrador', cls:'gold', icon:'shield' },
  operador: { label:'Operador', cls:'violet', icon:'users' },
};

DATA.conta = {
  handle: '',
  plataforma: '',
  outras: [],
};

DATA.nichos = [
  'Organização de cozinha', 'Organização de quarto', 'Organização de banheiro',
  'Lavanderia', 'Geladeira', 'Gavetas', 'Guarda-roupa', 'Casa pequena',
  'Achadinhos úteis', 'Produtos para mães', 'Decoração funcional', 'Casa organizada',
  'Produtos baratos e úteis', 'Despensa e cozinha', 'Pet', 'Beleza e autocuidado',
];
DATA.contas = [
  { id:'c1', nome:'Minha conta', handle:'', cor:'gold', atual:true, redes:[], nichos:[], seguidores:0, videos:0, plano:'' },
];
window.redeStatusMap = {
  conectada: { cls:'green', label:'Conectada' },
  pendente:  { cls:'amber', label:'Conectar' },
};
DATA.contribuintes = [];

DATA.lucro = {
  receitaBruta: 0, comissaoTotal: 0, custos: 0, lucroLiquido: 0,
  margem: 0, ticket: 0, vendas: 0, cliques: 0, conversao: 0,
  receitaPorVideo: 0, lucroPorVideo: 0, receita30d: 0,
};
DATA.lucroPlataformas = [];
DATA.produtosEscala = [];
DATA.escalaMap = {
  campeao:    { label:'Escalar já', cls:'green',  faixa:'81–100' },
  promissor:  { label:'Promissor', cls:'gold',    faixa:'61–80' },
  testar:     { label:'Testar mais', cls:'amber',  faixa:'31–60' },
  naoescalar: { label:'Não escalar', cls:'red',    faixa:'0–30' },
};
DATA.recomendacoes = [];

const statusMap = {
  campeao:   { label:'Campeão', cls:'gold', icon:'star' },
  aprovado:  { label:'Aprovado', cls:'green', icon:'check' },
  teste:     { label:'Em teste', cls:'violet', icon:'flask' },
  novo:      { label:'Novo', cls:'blue', icon:'plus' },
  pausado:   { label:'Pausado', cls:'gray', icon:'pause' },
  postado:   { label:'Postado', cls:'green', icon:'check' },
  agendado:  { label:'Agendado', cls:'violet', icon:'clock' },
  aguardando:{ label:'Aguardando', cls:'amber', icon:'clock' },
  roteiro:   { label:'Roteiro', cls:'blue', icon:'pencil' },
  ideia:     { label:'Ideia', cls:'gray', icon:'sparkles' },
  em_analise:{ label:'Em análise', cls:'amber', icon:'clock' },
  bloqueado: { label:'Bloqueado', cls:'red', icon:'x' },
  recebido:  { label:'Recebido', cls:'blue', icon:'download' },
  ativo:     { label:'Ativo', cls:'green', icon:'check' },
  pendente:  { label:'Pendente', cls:'amber', icon:'clock' },
  medio:     { label:'Médio', cls:'amber', icon:'trend' },
  fraco:     { label:'Fraco', cls:'red', icon:'arrow' },
};
window.statusMap = statusMap;
window.riscoMap = {
  verde:   { cls:'green', label:'Risco baixo' },
  amarelo: { cls:'amber', label:'Atenção' },
  vermelho:{ cls:'red', label:'Risco alto' },
  baixo:   { cls:'green', label:'Baixo' },
  'médio': { cls:'amber', label:'Médio' },
};


/* ===== data-saas.jsx =====/* ===== data-saas.jsx ===== */
/* ============ SaaS Modular — dados ============ */
DATA.saas = {
  planoBase: { nome:'Base Seller', preco:29, recursos:['Cadastro de usuário e marca','Dashboard simples','Cadastro básico de produtos','Geração limitada de legendas','Calendário simples','Relatórios básicos'] },

  // Módulos vendáveis (ativo = contratado pela conta atual)
  modulos: [
    { id:'m1', nome:'Conteúdo IA', icon:'sparkles', cor:'violet', mensal:47, desc:'Ideias, roteiros, ganchos, legendas, CTAs e hashtags com IA.', selo:'Mais vendido', ativo:true, uso:78, creditos:{ usado:340, total:500, label:'gerações IA' }, tela:'gerar',
      recursos:['Geração de ideias e roteiros','Legendas + CTAs + hashtags','Variações A/B','Análise de tendência','Transformar tendência em conteúdo próprio'] },
    { id:'m2', nome:'Calendário Editorial', icon:'calendar', cor:'blue', mensal:29, desc:'Organize 6 a 10 posts por dia com fila de aprovação.', ativo:true, uso:64, tela:'calendario',
      recursos:['Calendário por dia e horário','Status de postagem','Fila de aprovação','Visão semanal e mensal','Sugestão de frequência'] },
    { id:'m3', nome:'Produtos Afiliados', icon:'bag', cor:'gold', mensal:47, desc:'Produtos, links e plataformas de afiliados num só lugar.', selo:'Recomendado', ativo:true, uso:71, tela:'produtos',
      recursos:['Cadastro de produtos e links','Shopee, ML, Amazon, TikTok Shop, Renner','Status: campeão / teste / pausado','Organização por categoria'] },
    { id:'m4', nome:'Imagens e Criativos', icon:'image', cor:'pink', mensal:67, desc:'Capas, carrosséis, banners e thumbnails — com controle de autorização.', ativo:false, creditos:{ label:'imagens/mês' }, tela:'imagens',
      recursos:['Biblioteca de imagens','Capas, carrosséis e banners','Imagens geradas por IA','Controle de autorização','Vínculo com produto e campanha'] },
    { id:'m5', nome:'Vídeos Autorizados e UGC', icon:'video', cor:'blue', mensal:97, desc:'Vídeos próprios, UGC e fornecedores com status jurídico.', ativo:true, uso:52, tela:'biblioteca',
      recursos:['Biblioteca de vídeos','Cadastro de UGC e creators','Autorização de uso + status jurídico','Controle de edição','Vínculo com produto/campanha'] },
    { id:'m6', nome:'Lucro e Escala', icon:'dollar', cor:'green', mensal:97, desc:'Quanto você lucra e quais produtos escalar, com Score de Escala.', selo:'Recomendado', ativo:true, uso:88, tela:'lucro',
      recursos:['Lucro por plataforma/produto/vídeo','Custos, comissão e margem','Ranking de produtos','Score de Escala (0–100)','Recomendação automática da IA'] },
    { id:'m7', nome:'Compliance Jurídico', icon:'shield', cor:'amber', mensal:147, desc:'Reduz risco jurídico: autorizações, termos, logs e bloqueios.', ativo:false, tela:'compliance',
      recursos:['Checklist jurídico','Autorização de imagem e vídeo','Termos e políticas','Logs de aprovação','Bloqueio de conteúdo sem autorização'] },
    { id:'m8', nome:'Automação e Publicação', icon:'bolt', cor:'violet', mensal:197, desc:'Fila de publicação e integração com APIs (aprovação especial).', selo:'Premium', ativo:false, tela:'publicacao',
      recursos:['Fila de publicação','Pacote manual','TikTok Content Posting API','Histórico de publicação','Autorização inicial obrigatória'] },
    { id:'m9', nome:'Agência', icon:'users', cor:'gold', mensal:297, desc:'Gerencie múltiplas marcas e clientes com relatórios por cliente.', selo:'Premium', ativo:false, tela:'metas',
      recursos:['Múltiplas marcas e usuários','Permissões por equipe','Relatórios por cliente','Dashboard por cliente','White label futuro'] },
    { id:'m10', nome:'White Label', icon:'star', cor:'violet', mensal:null, precoLabel:'Sob consulta', desc:'Sua própria marca, cores e domínio na plataforma.', selo:'Premium', ativo:false, tela:null,
      recursos:['Logo e cores próprias','Domínio próprio','Relatórios com sua marca','Ocultar marca original','Painel personalizado'] },
  ],

  combos: [
    { id:'c1', nome:'Afiliado Iniciante', preco:97, economia:26, mods:['Conteúdo IA','Produtos Afiliados','Calendário Editorial'], cor:'blue' },
    { id:'c2', nome:'Afiliado Pro', preco:197, economia:90, selo:'Mais vendido', mods:['Conteúdo IA','Produtos Afiliados','Calendário Editorial','Imagens e Criativos','Lucro e Escala'], cor:'gold' },
    { id:'c3', nome:'Social Media', preco:247, economia:93, mods:['Conteúdo IA','Calendário Editorial','Imagens e Criativos','Agência'], cor:'violet' },
    { id:'c4', nome:'Lojista', preco:297, economia:111, mods:['Produtos Afiliados','Imagens e Criativos','Vídeos Autorizados e UGC','Lucro e Escala'], cor:'pink' },
    { id:'c5', nome:'Completo', preco:497, economia:231, selo:'Melhor valor', mods:['Todos os 8 módulos operacionais'], cor:'green' },
  ],

  // Painel da dona — métricas por módulo
  adminMetrics: {
    receitaTotal: 0, assinantes: 0, churn: 0, trial: 0,
    porModulo: [],
  },
};

window.seloMap = {
  'Mais vendido': 'gold', 'Recomendado': 'green', 'Premium': 'violet', 'Melhor valor': 'green',
};


/* ===== data-extra2.jsx ===== */
/* ============ Imagens · Fornecedores · Creators · Compliance — dados ============ */

DATA.tipoImg = {
  'Capa':       { cor:'pink',   ratio:'9 / 16',  kind:'phone' },
  'Carrossel':  { cor:'violet', ratio:'4 / 5',   kind:'carousel' },
  'Banner':     { cor:'blue',   ratio:'16 / 9',  kind:'wide' },
  'Thumbnail':  { cor:'gold',   ratio:'16 / 9',  kind:'wide' },
};
DATA.imagens = [];

DATA.tipoForn = {
  'Fornecedor de produto': { cor:'gold',   icon:'bag' },
  'Banco de imagens':      { cor:'blue',   icon:'image' },
  'Agência de UGC':        { cor:'pink',   icon:'users' },
  'Editor freelancer':     { cor:'violet', icon:'pencil' },
  'IA interna':            { cor:'green',  icon:'sparkles' },
};
DATA.fornecedores = [];
DATA.contratoMap = {
  'Ativo':    'green', 'Interno': 'green', 'Vencido': 'red', 'Pendente': 'amber',
};

DATA.creators = [];
DATA.vendedores = [];
DATA.logsAjustes = [];
DATA.logsFinanceiros = [];
DATA.ugcPipeline = [
  { fase:'Briefing',     cor:'gray',   itens:[] },
  { fase:'Em produção',  cor:'violet', itens:[] },
  { fase:'Recebido',     cor:'blue',   itens:[] },
  { fase:'Autorizado',   cor:'green',  itens:[] },
];

DATA.compliance = {
  score: 0,
  conformes: 0, bloqueados: 0, autorizacoes: 0, vencendo: 0,
  checklist: [],
  documentos: [],
  logs: [],
  bloqueios: [],
};
DATA.docMap = {
  vigente: { cls:'green', label:'Vigente' },
  revisar: { cls:'amber', label:'Revisar' },
  vencido: { cls:'red',   label:'Vencido' },
};
DATA.logMap = {
  aprovado:  { cls:'green', icon:'check' },
  bloqueado: { cls:'red',   icon:'ban' },
  risco:     { cls:'amber', icon:'alert' },
};


/* ===== data-lucro.jsx =====/* ===== data-lucro.jsx ===== */
/* ============ Painel de Lucro e Escala — dados ============ */
DATA.lucro = {
  resumo: {
    receitaBruta: 0, comissao: 0, custos: 0, lucroLiquido: 0, margem: 0,
    ticketMedio: 0, vendas: 0, cliques: 0, conversao: 0,
    receitaPorVideo: 0, lucroPorVideo: 0, previsao30d: 0,
  },
  plataformas: [],
  vendas: [],
  custos: [],
  produtos: [],
  recomendacoes: [],
  alertas: [],
};

/* ============ Sidebar ============ */
const NAV = [
  { group: 'Operação', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', ops: true, viewer: true },
    { id: 'metas', label: 'Painel de Metas', icon: 'target', tag: 'NOVO', ops: true, viewer: true },
    { id: 'radar', label: 'Radar de Tendências', icon: 'radar', tag: 'IA', ops: true },
    { id: 'gerar', label: 'Transformador IA', icon: 'sparkles', tag: 'IA', ops: true },
    { id: 'conteudos', label: 'Banco de Conteúdos', icon: 'library', ops: true },
    { id: 'aprovacao', label: 'Aprovar Agora', icon: 'checkCircle' },
    { id: 'calendario', label: 'Calendário', icon: 'calendar', ops: true, viewer: true },
  ]},
  { group: 'Acervo', items: [
    { id: 'produtos', label: 'Produtos Afiliados', icon: 'bag', ops: true },
    { id: 'biblioteca', label: 'Vídeos Autorizados', icon: 'video', tag: 'NOVO', ops: true },
    { id: 'imagens', label: 'Imagens e Criativos', icon: 'image', tag: 'NOVO', ops: true },
    { id: 'creators', label: 'Creators e UGC', icon: 'users', tag: 'NOVO', ops: true },
    { id: 'videoseller', label: 'Video Seller', icon: 'play', tag: 'IA', ops: true },
    { id: 'series', label: 'Séries Fixas', icon: 'layers', ops: true },
  ]},
  { group: 'Inteligência', items: [
    { id: 'lucro', label: 'Lucro & Escala', icon: 'dollar', tag: 'NOVO', viewer: true },
    { id: 'relatorios', label: 'Relatórios', icon: 'chart', ops: true, viewer: true },
    { id: 'decisao', label: 'Motor de Decisão', icon: 'brain', tag: 'NOVO' },
    { id: 'compliance', label: 'Compliance Jurídico', icon: 'scale', tag: 'NOVO', ops: true },
  ]},
  { group: 'Conexões', items: [
    { id: 'contas', label: 'Contas e Nichos', icon: 'users', tag: 'NOVO' },
    { id: 'fornecedores', label: 'Fornecedores', icon: 'folder', tag: 'NOVO' },
    { id: 'links', label: 'Links Dinâmicos', icon: 'link' },
    { id: 'publicacao', label: 'Publicação', icon: 'video', tag: 'NOVO' },
    { id: 'integracoes', label: 'Integrações', icon: 'plug' },
    { id: 'monetizacao', label: 'Monetização', icon: 'dollar' },
    { id: 'whatsapp', label: 'WhatsApp em Massa', icon: 'message' },
  ]},
  { group: 'Administração', admin: true, items: [
    { id: 'usuarios', label: 'Usuários', icon: 'shield' },
    { id: 'vendedores', label: 'Vendedores', icon: 'bag', tag: 'NOVO' },
    { id: 'financeiro', label: 'Financeiro', icon: 'dollar', tag: 'NOVO' },
    { id: 'historico_financeiro', label: 'Histórico Financeiro', icon: 'clock', tag: 'NOVO' },
    { id: 'loja', label: 'Loja de Módulos', icon: 'grid', tag: 'NOVO' },
    { id: 'admin_saas', label: 'Módulos & Receita', icon: 'dollar' },
    { id: 'demo', label: 'Como Funciona', icon: 'play' },
  ]},
];
window.NAV = NAV;

const Sidebar = ({ active, go, acct, accts, onSwitch, role, mobileOpen, onCloseMobile }) => {
  const [open, setOpen] = React.useState(false);
  const [pwModal, setPwModal] = React.useState(false);
  const [pwAtual, setPwAtual] = React.useState('');
  const [pwNova, setPwNova] = React.useState('');
  const [pwConfirma, setPwConfirma] = React.useState('');
  const groups = NAV
    .filter(grp => role === 'operador' ? !grp.admin : true)
    .map(grp => ({ ...grp, items: grp.items.filter(it => role === 'convidado' ? it.viewer : role === 'operador' ? it.ops : true) }))
    .filter(grp => grp.items.length);
  return (
  <React.Fragment>
  {mobileOpen && <div className="sidebar-backdrop" onClick={onCloseMobile} />}
  <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
    <div className="sidebar-head" style={{ position: 'relative', flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
      <div className="row" style={{ gap: 11 }}>
        <div className="brand-mark"><BrandMark /></div>
        <div style={{ minWidth: 0 }}>
          <div className="brand-name">Patrono Seller</div>
          <div className="brand-sub">IA · ONLINE</div>
        </div>
      </div>
      {/* Seletor de conta */}
      <button onClick={() => setOpen(o => !o)} style={{ marginTop: 14, width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 11, background: 'oklch(0 0 0 / 0.25)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text)', fontFamily: 'var(--font-body)' }}>
        <div className="avatar" style={{ width: 26, height: 26, fontSize: 11, background: `linear-gradient(140deg, var(--${acct.cor}), var(--${acct.cor}-2, var(--violet-2)))`, color: acct.cor === 'gold' ? 'oklch(0.2 0.02 70)' : 'white', flexShrink: 0 }}>{acct.nome.replace('Cliente · ','')[0]}</div>
        <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acct.nome}</div>
          <div className="dim" style={{ fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acct.handle}</div>
        </div>
        <Icon name="chevD" size={14} style={{ color: 'var(--text-dim)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 12, right: 12, zIndex: 30, marginTop: 4, padding: 6, borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
          <div className="nav-group-label" style={{ padding: '6px 8px 4px' }}>Trocar conta de trabalho</div>
          {accts.map(a => (
            <button key={a.id} onClick={() => { onSwitch(a.id); setOpen(false); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 9, background: a.id === acct.id ? 'oklch(1 0 0 / 0.05)' : 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)', fontFamily: 'var(--font-body)' }}>
              <div className="avatar" style={{ width: 26, height: 26, fontSize: 11, background: `linear-gradient(140deg, var(--${a.cor}), var(--violet-2))`, color: a.cor === 'gold' ? 'oklch(0.2 0.02 70)' : 'white', flexShrink: 0 }}>{a.nome.replace('Cliente · ','')[0]}</div>
              <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.nome}</div>
                <div className="dim" style={{ fontSize: 10.5 }}>{a.seguidores.toLocaleString('pt-BR')} seg · {a.nichos.length} nichos</div>
              </div>
              {a.id === acct.id && <Icon name="check" size={14} style={{ color: 'var(--gold)', flexShrink: 0 }} />}
            </button>
          ))}
          <div className="divider" style={{ margin: '5px 0' }} />
          <button onClick={() => { go('contas'); setOpen(false); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 9, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--gold)', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600 }}>
            <Icon name="plus" size={14} />Conectar nova conta
          </button>
        </div>
      )}
    </div>
    <nav className="nav">
      {groups.map((grp) => (
        <React.Fragment key={grp.group}>
          <div className="nav-group-label">{grp.group}</div>
          {grp.items.map((it) => (
            <div key={it.id} className={`nav-item ${active === it.id ? 'active' : ''}`} onClick={() => { go(it.id); onCloseMobile && onCloseMobile(); }}>
              <Icon name={it.icon} />
              <span>{it.label}</span>
              {it.id === 'aprovacao' && DATA.aprovacoes.length > 0 && <span className="nav-badge">{DATA.aprovacoes.length}</span>}
              {it.badge && <span className="nav-badge">{it.badge}</span>}
              {it.tag && <span className="nav-tag">{it.tag}</span>}
            </div>
          ))}
        </React.Fragment>
      ))}
    </nav>
    <div className="sidebar-foot">
      <div className="user-chip" style={{ cursor: 'pointer' }} onClick={() => { setPwAtual(''); setPwNova(''); setPwConfirma(''); setPwModal(true); }}>
        <div className="avatar">C</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{DATA.user.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{DATA.user.role}</div>
        </div>
        <Icon name="logout" size={15} style={{ color: 'var(--text-dim)' }} />
      </div>
    </div>

    <Modal open={pwModal} onClose={() => setPwModal(false)} icon="shield" iconColor="gold"
      title="Alterar senha" sub="Atualize a senha da sua conta"
      footer={<><button className="btn btn-ghost btn-sm" onClick={() => setPwModal(false)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={() => {
        if (!pwAtual || !pwNova) { window.toast && window.toast('Preencha a senha atual e a nova senha'); return; }
        if (pwNova !== pwConfirma) { window.toast && window.toast('As senhas novas não coincidem'); return; }
        setPwModal(false);
        window.toast && window.toast('Senha atualizada com sucesso');
      }}><Icon name="check" size={13} />Salvar nova senha</button></>}>
      <label className="label">Senha atual</label>
      <PasswordInput value={pwAtual} onChange={e => setPwAtual(e.target.value)} placeholder="••••••••" />
      <label className="label" style={{ marginTop: 14 }}>Nova senha</label>
      <PasswordInput value={pwNova} onChange={e => setPwNova(e.target.value)} placeholder="••••••••" />
      <label className="label" style={{ marginTop: 14 }}>Confirmar nova senha</label>
      <PasswordInput value={pwConfirma} onChange={e => setPwConfirma(e.target.value)} placeholder="••••••••" />
    </Modal>
  </aside>
  </React.Fragment>
  );
};

window.Sidebar = Sidebar;

/* ============ Painel de Metas — componentes ============ */

const Podio = ({ itens, fmt }) => {
  const top = itens.slice(0, 3);
  const order = [1, 0, 2];
  const heights = { 0: 96, 1: 72, 2: 56 };
  const medal = { 0: 'var(--gold)', 1: 'oklch(0.78 0.02 285)', 2: 'oklch(0.62 0.08 50)' };
  return (
    <div className="row" style={{ gap: 12, alignItems: 'flex-end', justifyContent: 'center', padding: '8px 0 0' }}>
      {order.map(rank => {
        const it = top[rank]; if (!it) return null;
        const pct = window.metaPct(it.realizado, it.meta);
        return (
          <div key={rank} className="col" style={{ alignItems: 'center', gap: 8, flex: 1, maxWidth: 150 }}>
            <div className="avatar" style={{ width: rank === 0 ? 46 : 38, height: rank === 0 ? 46 : 38, fontSize: rank === 0 ? 17 : 14, background: rank === 0 ? 'linear-gradient(140deg, var(--gold), var(--gold-2))' : 'linear-gradient(140deg, var(--violet), var(--violet-2))', color: rank === 0 ? 'oklch(0.2 0.02 70)' : 'white', border: `2px solid ${medal[rank]}`, boxShadow: rank === 0 ? '0 0 18px var(--gold-soft)' : 'none' }}>{it.nome[0]}</div>
            <div className="col" style={{ alignItems: 'center', gap: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'center', lineHeight: 1.1 }}>{it.nome.split(' ')[0]}</span>
              <span className="dim" style={{ fontSize: 10.5 }}>{it.time || it.nome}</span>
            </div>
            <div style={{ width: '100%', height: heights[rank], borderRadius: '10px 10px 0 0', background: rank === 0 ? 'linear-gradient(180deg, var(--gold-soft), transparent)' : 'linear-gradient(180deg, var(--violet-soft), transparent)', border: '1px solid var(--border-soft)', borderBottom: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 10, gap: 2 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: medal[rank] }}>{rank + 1}º</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: pct >= 80 ? 'var(--green)' : 'var(--text)' }}>{pct}%</span>
              <span className="dim mono" style={{ fontSize: 10 }}>{fmt(it.realizado)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const RankRow = ({ pos, nome, sub, sub2, meta, realizado, fmt, extra, voce, onClick }) => {
  const pct = window.metaPct(realizado, meta);
  const st = window.metaStatus(pct);
  return (
    <tr style={{ cursor: onClick ? 'pointer' : 'default', background: voce ? 'var(--gold-soft)' : undefined }} onClick={onClick}>
      <td style={{ width: 44 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: pos <= 3 ? 'var(--gold)' : 'var(--text-dim)' }}>{pos}º</span>
      </td>
      <td>
        <div className="row" style={{ gap: 10 }}>
          <div className="avatar" style={{ width: 30, height: 30, fontSize: 12, background: pos === 1 ? 'linear-gradient(140deg, var(--gold), var(--gold-2))' : 'linear-gradient(140deg, var(--violet), var(--violet-2))', color: pos === 1 ? 'oklch(0.2 0.02 70)' : 'white' }}>{nome[0]}</div>
          <div>
            <div className="row" style={{ gap: 6 }}><span style={{ fontWeight: 600, fontSize: 13.5 }}>{nome}</span>{voce && <span className="badge gray" style={{ padding: '0 6px', fontSize: 9.5 }}>você</span>}</div>
            {sub && <div className="dim" style={{ fontSize: 11.5 }}>{sub}{sub2 ? ' · ' + sub2 : ''}</div>}
          </div>
        </div>
      </td>
      {extra}
      <td className="right mono">{fmt(meta)}</td>
      <td className="right mono" style={{ fontWeight: 600 }}>{fmt(realizado)}</td>
      <td style={{ minWidth: 130 }}>
        <div className="row" style={{ gap: 8 }}>
          <div className="bar" style={{ flex: 1, height: 7 }}><i style={{ width: Math.min(100, pct) + '%', background: pct >= 80 ? 'linear-gradient(90deg, oklch(0.7 0.16 158), var(--green))' : pct >= 50 ? 'linear-gradient(90deg, var(--gold-2), var(--gold))' : 'linear-gradient(90deg, var(--red), oklch(0.75 0.16 30))' }} /></div>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600, width: 38, textAlign: 'right', color: `var(--${st.cls})` }}>{pct}%</span>
        </div>
      </td>
    </tr>
  );
};

window.Podio = Podio;
window.RankRow = RankRow;

window.metaPct = (realizado, meta) => meta ? Math.min(999, Math.round((realizado / meta) * 100)) : 0;
window.metaStatus = (pct) => pct >= 80 ? { cls:'green', label:'No ritmo' } : pct >= 50 ? { cls:'gold', label:'Atenção' } : { cls:'red', label:'Abaixo' };

DATA.equipes = [];
DATA.metaGeral = { mes:'', meta:0, realizado:0, anterior:0 };

const fmtR = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR');

const Metas = ({ role }) => {
  const [visao, setVisao] = useState('geral');
  const [modalMeta, setModalMeta] = useState(false);
  const [fSeg, setFSeg] = useState(DATA.metas.meta1);
  const [fVendas, setFVendas] = useState(DATA.metaGeral.meta);
  const [fPost, setFPost] = useState(DATA.metas.metaPostagens);
  const [fMes, setFMes] = useState(DATA.metaGeral.mes);
  const [, setTick] = useState(0);
  const G = DATA.metaGeral;
  const pctGeral = window.metaPct(G.realizado, G.meta);
  const cresc = G.anterior ? Math.round(((G.realizado - G.anterior) / G.anterior) * 100) : 0;

  const admins = DATA.equipes.filter(e => e.papel === 'admin');
  const operadores = DATA.equipes.filter(e => e.papel === 'operador');
  const melhorAdmin = [...admins].sort((a,b) => window.metaPct(b.realizado,b.meta) - window.metaPct(a.realizado,a.meta))[0];
  const melhorOp = [...operadores].sort((a,b) => window.metaPct(b.realizado,b.meta) - window.metaPct(a.realizado,a.meta))[0];

  const lista = visao === 'operador' ? operadores : visao === 'time' ? admins : DATA.equipes;
  const ranked = [...lista].sort((a,b) => window.metaPct(b.realizado,b.meta) - window.metaPct(a.realizado,a.meta));

  return (
    <div className="content-inner fade-in">
      <div className="row spread wrap" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="dim" style={{ fontSize: 12.5, marginRight: 4 }}>Ver como:</span>
          <div style={{ display: 'inline-flex', padding: 3, borderRadius: 99, background: 'oklch(0 0 0 / 0.3)', border: '1px solid var(--border)' }}>
            {[['geral','Admin Geral'],['time','Admin de Time'],['operador','Operador']].map(([k,l]) => (
              <button key={k} onClick={() => setVisao(k)} style={{ padding: '6px 13px', borderRadius: 99, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', flexShrink: 0, background: visao === k ? 'var(--gold)' : 'transparent', color: visao === k ? 'oklch(0.2 0.02 70)' : 'var(--text-muted)' }}>{l}</button>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="calendar" size={14} />Período: {G.mes || '—'}</button>
          <button className="btn btn-primary btn-sm" style={{ display: role === 'convidado' ? 'none' : 'inline-flex' }} onClick={() => { setFSeg(DATA.metas.meta1); setFVendas(DATA.metaGeral.meta); setFPost(DATA.metas.metaPostagens); setFMes(DATA.metaGeral.mes); setModalMeta(true); }}><Icon name="plus" size={14} />Nova meta</button>
        </div>
      </div>

      <div className="grid g2" style={{ gridTemplateColumns: '1.3fr 1fr 1fr' }}>
        <div className="goal-card">
          <div className="row spread" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="row" style={{ gap: 8 }}>
                <Icon name="target" size={16} style={{ color: 'var(--gold)' }} />
                <span className="dim mono" style={{ fontSize: 12, letterSpacing: '0.05em' }}>META GERAL DO MÊS</span>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 10 }}>{fmtR(G.realizado)}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>/ {fmtR(G.meta)}</div>
            </div>
            <span className="badge gold"><Icon name="fire" size={12} />{pctGeral}%</span>
          </div>
          <div className="bar" style={{ marginTop: 18 }}><i style={{ width: Math.min(100,pctGeral) + '%' }} /></div>
          <div className="row spread" style={{ marginTop: 14 }}>
            <span className="dim" style={{ fontSize: 12 }}>Faltam {fmtR(Math.max(0, G.meta - G.realizado))}</span>
            <span className="badge green" style={{ padding: '2px 8px' }}><Icon name="trend" size={11} />+{cresc}% vs. mês anterior</span>
          </div>
        </div>

        {[['shield','Melhor administrador', melhorAdmin],['star','Melhor operador', melhorOp]].filter(([,,p]) => p).map(([ic, label, p]) => (
          <div key={label} className="card">
            <div className="ico" style={{ background: 'var(--violet-soft)', color: 'var(--violet)', width:38, height:38, borderRadius:11, display:'grid', placeItems:'center', marginBottom: 12 }}><Icon name={ic} /></div>
            <div className="dim" style={{ fontSize: 11.5 }}>{label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, marginTop: 4 }}>{p.nome.split(' ')[0]}</div>
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <span className="badge green" style={{ padding: '1px 8px' }}>{window.metaPct(p.realizado,p.meta)}%</span>
              <span className="dim" style={{ fontSize: 11.5 }}>{p.time}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head"><Icon name="video" size={16} style={{ color: 'var(--violet)' }} /><div className="card-title" style={{ fontSize: 15 }}>Meta de postagens do mês</div></div>
        <div className="row spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700 }}>{DATA.metas.videosPostados} <span className="dim" style={{ fontSize: 16, fontWeight: 500 }}>/ {DATA.metas.metaPostagens || '—'}</span></div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>postagens realizadas no mês</div>
          </div>
          <span className="badge violet">{DATA.metas.metaPostagens ? window.metaPct(DATA.metas.videosPostados, DATA.metas.metaPostagens) : 0}%</span>
        </div>
        <div className="bar violet" style={{ marginTop: 14 }}><i style={{ width: (DATA.metas.metaPostagens ? Math.min(100, window.metaPct(DATA.metas.videosPostados, DATA.metas.metaPostagens)) : 0) + '%' }} /></div>
      </div>

      {ranked.length > 0 && (
      <div className="card">
        <div className="card-head"><Icon name="star" size={16} style={{ color: 'var(--gold)' }} /><div className="card-title" style={{ fontSize: 15 }}>Pódio da meta</div></div>
        <Podio itens={ranked} fmt={fmtR} />
      </div>
      )}

      <div className="card flush">
        <div className="row spread" style={{ padding: '16px 20px' }}>
          <div className="card-title">Ranking completo</div>
          <span className="dim" style={{ fontSize: 12 }}>{ranked.length} pessoas</span>
        </div>
        {ranked.length === 0 ? (
          <div className="dim" style={{ padding: '24px 20px', fontSize: 13 }}>Nenhuma pessoa cadastrada ainda. Adicione sua equipe para acompanhar metas.</div>
        ) : (
        <table className="tbl">
          <thead><tr><th></th><th>Pessoa</th><th className="right">Meta</th><th className="right">Realizado</th><th>Progresso</th></tr></thead>
          <tbody>
            {ranked.map((p, i) => (
              <RankRow key={p.nome} pos={i+1} nome={p.nome} sub={p.time} sub2={p.papel === 'admin' ? 'Administrador' : 'Operador'} meta={p.meta} realizado={p.realizado} fmt={fmtR} voce={p.nome === 'Cris Crabelo'} />
            ))}
          </tbody>
        </table>
        )}
      </div>

      <Modal open={modalMeta} onClose={() => setModalMeta(false)} icon="target" iconColor="gold"
        title="Definir metas do mês" sub="Seguidores, postagens e vendas"
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModalMeta(false)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={() => {
          DATA.metas.meta1 = Number(fSeg) || 0;
          DATA.metaGeral.meta = Number(fVendas) || 0;
          DATA.metas.metaPostagens = Number(fPost) || 0;
          DATA.metaGeral.mes = fMes;
          setModalMeta(false);
          setTick(t => t + 1);
          window.persistDATA && window.persistDATA();
          window.toast && window.toast('Metas do mês atualizadas');
        }}><Icon name="check" size={13} />Salvar metas</button></>}>
        <label className="label">Mês de referência</label>
        <input className="input" value={fMes} onChange={e => setFMes(e.target.value)} placeholder="Ex.: Julho" />
        <label className="label" style={{ marginTop: 14 }}>Meta de seguidores</label>
        <input className="input" type="number" value={fSeg} onChange={e => setFSeg(e.target.value)} placeholder="Ex.: 2000" />
        <label className="label" style={{ marginTop: 14 }}>Meta de postagens no mês</label>
        <input className="input" type="number" value={fPost} onChange={e => setFPost(e.target.value)} placeholder="Ex.: 60" />
        <label className="label" style={{ marginTop: 14 }}>Meta de vendas (R$)</label>
        <input className="input" type="number" value={fVendas} onChange={e => setFVendas(e.target.value)} placeholder="Ex.: 300000" />
      </Modal>
    </div>
  );
};

window.Metas = Metas;


/* ===== screens-dashboard.jsx ===== */
/* ============ Dashboard de Metas ============ */
const Sparkline = ({ data, w = 220, h = 48, color = 'var(--gold)' }) => {
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / (max - min || 1)) * (h - 6) - 3]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${d} L${w} ${h} L0 ${h} Z`;
  return (
    <svg width={w} height={h} style={{ display: 'block', width: '100%' }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      <path d={area} fill="url(#spk)" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.slice(-1).map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill={color} />)}
    </svg>
  );
};

const Dashboard = ({ go }) => {
  const m = DATA.metas;
  const pct1 = m.meta1 ? Math.min(100, (m.seguidores / m.meta1) * 100) : 0;
  const pct2 = m.meta2 ? Math.min(100, (m.seguidores / m.meta2) * 100) : 0;

  const steps = [
    { done: DATA.integracoes.some(p => p.contas.length > 0), label: 'Conecte sua 1ª conta', desc: 'Instagram, TikTok, Shopee ou outra plataforma', tela: 'integracoes', icon: 'plug' },
    { done: DATA.produtos.length > 0, label: 'Cadastre seu 1º produto', desc: 'Um produto afiliado para começar a vender', tela: 'produtos', icon: 'bag' },
    { done: DATA.usuarios.length > 1, label: 'Convide sua equipe', desc: 'Adicione administradores e operadores', tela: 'usuarios', icon: 'users' },
    { done: DATA.metaGeral.meta > 0, label: 'Defina as metas do mês', desc: 'Meta de seguidores e meta de vendas', tela: 'metas', icon: 'target' },
  ];
  const pendentes = steps.filter(s => !s.done);

  return (
    <div className="content-inner fade-in">
      {pendentes.length > 0 && (
        <div className="card" style={{ background: 'radial-gradient(600px 200px at 100% 0%, var(--gold-soft), transparent 60%), var(--surface)' }}>
          <div className="row spread" style={{ marginBottom: 6 }}>
            <div className="row" style={{ gap: 10 }}>
              <Icon name="rocket" size={17} style={{ color: 'var(--gold)' }} />
              <div className="card-title" style={{ fontSize: 15 }}>Primeiros passos</div>
            </div>
            <span className="dim" style={{ fontSize: 12 }}>{steps.length - pendentes.length}/{steps.length} concluídos</span>
          </div>
          <div className="grid g4" style={{ marginTop: 10 }}>
            {steps.map(s => (
              <div key={s.label} onClick={() => !s.done && go(s.tela)} style={{ cursor: s.done ? 'default' : 'pointer', padding: 12, borderRadius: 12, border: '1px solid var(--border-soft)', background: s.done ? 'oklch(1 0 0 / 0.02)' : 'oklch(1 0 0 / 0.03)', opacity: s.done ? 0.55 : 1 }}>
                <div className="row spread">
                  <div className="ico" style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: s.done ? 'var(--green-soft)' : 'var(--gold-soft)', color: s.done ? 'var(--green)' : 'var(--gold)' }}><Icon name={s.done ? 'check' : s.icon} size={15} /></div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, marginTop: 9 }}>{s.label}</div>
                <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Goal hero */}
      <div className="grid g2" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <div className="goal-card">
          <div className="row spread" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="row" style={{ gap: 8 }}>
                <Icon name="target" size={16} style={{ color: 'var(--gold)' }} />
                <span className="dim mono" style={{ fontSize: 12, letterSpacing: '0.05em' }}>META PRINCIPAL · {m.meta1Data}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 44, fontWeight: 700, letterSpacing: '-0.03em', marginTop: 10, lineHeight: 1 }}>
                {m.seguidores.toLocaleString('pt-BR')} <span className="dim" style={{ fontSize: 22, fontWeight: 500 }}>/ {m.meta1.toLocaleString('pt-BR')}</span>
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>seguidores · faltam {(m.meta1 - m.seguidores).toLocaleString('pt-BR')}</div>
            </div>
            <span className="badge gold"><Icon name="fire" size={12} />{pct1.toFixed(0)}%</span>
          </div>
          <div className="bar" style={{ marginTop: 18 }}><i style={{ width: pct1 + '%' }} /></div>
          <div className="row spread" style={{ marginTop: 14 }}>
            <div className="col">
              <span className="dim" style={{ fontSize: 11 }}>Meta 2 · 100k até {m.meta2Data}</span>
              <div className="bar violet" style={{ marginTop: 6, width: 200 }}><i style={{ width: pct2 + '%' }} /></div>
            </div>
            <button className="btn btn-violet btn-sm" onClick={() => go('radar')}><Icon name="rocket" size={14} />Acelerar</button>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <Icon name="trend" size={16} style={{ color: 'var(--green)' }} />
            <div className="card-title" style={{ fontSize: 14 }}>Crescimento · 7 dias</div>
          </div>
          <Sparkline data={DATA.serie7d} color="var(--gold)" />
          <div className="row spread" style={{ marginTop: 'auto', paddingTop: 12 }}>
            <div className="col"><span className="stat-value" style={{ fontSize: 22 }}>+{m.crescimentoDiario}</span><span className="dim" style={{ fontSize: 11 }}>seguidores/dia</span></div>
            <div className="col" style={{ alignItems: 'flex-end' }}><span style={{ fontSize: 22, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--amber)' }}>{m.crescimentoNecessario}</span><span className="dim" style={{ fontSize: 11 }}>meta/dia p/ 100k</span></div>
          </div>
        </div>
      </div>

      {/* Sua contribuição para a meta */}
      {DATA.contribuintes.length === 0 ? null : (() => {
        const total = DATA.contribuintes.reduce((s, c) => s + c.seguidores, 0);
        const eu = DATA.contribuintes.find(c => c.voce) || DATA.contribuintes[0];
        const meuPct = total ? Math.round((eu.seguidores / total) * 100) : 0;
        const ranked = [...DATA.contribuintes].sort((a, b) => b.seguidores - a.seguidores);
        const maxc = ranked[0].seguidores;
        return (
          <div className="grid g2" style={{ gridTemplateColumns: '1fr 1.25fr', alignItems: 'stretch' }}>
            <div className="card" style={{ background: 'radial-gradient(420px 240px at 0% 0%, var(--violet-soft), transparent 60%), var(--surface)' }}>
              <div className="row" style={{ gap: 10, marginBottom: 6 }}>
                <div className="avatar" style={{ width: 30, height: 30, fontSize: 12, background: 'linear-gradient(140deg, var(--gold), var(--gold-2))', color: 'oklch(0.2 0.02 70)' }}>{eu.nome[0]}</div>
                <div><div style={{ fontSize: 13.5, fontWeight: 600 }}>Olá, {eu.nome.split(' ')[0]} 👋</div><div className="dim" style={{ fontSize: 11.5 }}>Sua contribuição para a meta</div></div>
              </div>
              <div className="row" style={{ alignItems: 'flex-end', gap: 8, marginTop: 12 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 38, lineHeight: 1, color: 'var(--gold)' }}>{eu.seguidores}</span>
                <span className="muted" style={{ fontSize: 13, marginBottom: 4 }}>seguidores trazidos</span>
              </div>
              <div className="bar" style={{ marginTop: 12 }}><i style={{ width: meuPct + '%' }} /></div>
              <div className="dim" style={{ fontSize: 12, marginTop: 7 }}>{meuPct}% de todo o crescimento da meta veio de você</div>
              <div className="row" style={{ gap: 18, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-soft)' }}>
                <div className="col"><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{eu.videos}</span><span className="dim" style={{ fontSize: 11 }}>vídeos seus</span></div>
                <div className="col"><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--green)' }}>{eu.vendas}</span><span className="dim" style={{ fontSize: 11 }}>vendas suas</span></div>
                <div className="col"><span className="badge gold" style={{ marginBottom: 2 }}><Icon name="star" size={11} />2º lugar</span><span className="dim" style={{ fontSize: 11 }}>no ranking</span></div>
              </div>
            </div>

            <div className="card">
              <div className="row spread" style={{ marginBottom: 4 }}>
                <div className="card-title" style={{ fontSize: 14 }}>Ranking de contribuição</div>
                <span className="dim" style={{ fontSize: 11.5 }}>seguidores · {total.toLocaleString('pt-BR')} no total</span>
              </div>
              <div className="col" style={{ gap: 11, marginTop: 12 }}>
                {ranked.map((c, i) => {
                  const pm = window.papelMap[c.papel];
                  return (
                    <div key={c.nome} className="row" style={{ gap: 11 }}>
                      <span className="dim mono" style={{ fontSize: 12, width: 16 }}>{i + 1}</span>
                      <div className="avatar" style={{ width: 26, height: 26, fontSize: 11, background: c.papel === 'admin' ? 'linear-gradient(140deg, var(--gold), var(--gold-2))' : 'linear-gradient(140deg, var(--violet), var(--violet-2))', color: c.papel === 'admin' ? 'oklch(0.2 0.02 70)' : 'white' }}>{c.nome[0]}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row spread" style={{ marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: c.voce ? 700 : 500 }}>{c.nome.split(' ')[0]} {c.voce && <span className="badge gray" style={{ padding: '0 6px', fontSize: 9.5 }}>você</span>}</span>
                          <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.seguidores}</span>
                        </div>
                        <div className="bar" style={{ height: 6 }}><i style={{ width: (c.seguidores / maxc * 100) + '%', background: c.papel === 'admin' ? 'linear-gradient(90deg, var(--gold-2), var(--gold))' : 'linear-gradient(90deg, var(--violet-2), var(--violet))' }} /></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Stats */}
      <div className="grid g4">
        <StatCard icon="video" color="violet" value={`${m.videosPostados}/${m.videosPlanejados}`} label="Vídeos postados hoje" trend="6–10 por dia" trendDir="up" />
        <StatCard icon="bag" color="gold" value={m.produtos} label="Produtos cadastrados" trend={`${m.produtosCampeoes} campeões`} trendDir="up" />
        <StatCard icon="link" color="blue" value={m.cliques.toLocaleString('pt-BR')} label="Cliques no link" />
        <StatCard icon="dollar" color="green" value={`R$ ${m.receita.toLocaleString('pt-BR')}`} label="Receita estimada" trend={`${m.vendas} vendas`} trendDir="up" />
      </div>

      {/* Aprovar agora + fluxo diário */}
      <div className="grid g2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card" style={{ border: '1px solid oklch(0.80 0.15 70 / 0.3)', background: 'linear-gradient(180deg, oklch(0.22 0.04 70 / 0.4), var(--surface))' }}>
          <div className="row spread">
            <div className="row" style={{ gap: 10 }}>
              <div className="ico" style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--amber-soft)', color: 'var(--amber)' }}><Icon name="bell" size={18} /></div>
              <div>
                <div className="card-title" style={{ fontSize: 15 }}>Aprovar agora</div>
                <div className="dim" style={{ fontSize: 12.5 }}>{m.aguardando} itens precisam de você</div>
              </div>
            </div>
            <span className="nav-badge" style={{ position: 'static', background: 'var(--amber)', color: 'var(--bg)' }}>{m.aguardando}</span>
          </div>
          <div className="col" style={{ gap: 8, marginTop: 14 }}>
            {DATA.aprovacoes.slice(0, 3).map((a) => (
              <div key={a.id} className="row spread" style={{ padding: '9px 11px', borderRadius: 10, background: 'oklch(0 0 0 / 0.2)', border: '1px solid var(--border-soft)' }}>
                <div className="row" style={{ gap: 9, minWidth: 0 }}>
                  <span className={`badge ${window.riscoMap[a.risco].cls}`} style={{ padding: '2px 6px' }}><span className="dot" /></span>
                  <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.produto}</span>
                </div>
                <span className="dim" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{a.motivo}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: 12 }} onClick={() => go('aprovacao')}>Revisar fila de aprovação<Icon name="arrow" size={14} /></button>
        </div>

        <div className="card">
          <div className="card-head"><Icon name="clock" size={16} style={{ color: 'var(--violet)' }} /><div className="card-title" style={{ fontSize: 15 }}>Fluxo automático do dia</div></div>
          <div className="col" style={{ gap: 2 }}>
            {[
              { t: 'Manhã', d: 'IA busca tendências e gera ideias', icon: 'radar', done: true },
              { t: 'Meio-dia', d: 'Transforma tendências em roteiros próprios', icon: 'sparkles', done: true },
              { t: 'Tarde', d: 'Combina vídeo autorizado + produto + legenda', icon: 'layers', done: false },
              { t: 'Noite', d: 'Monta a fila do dia seguinte', icon: 'calendar', done: false },
            ].map((s, i) => (
              <div key={i} className="row" style={{ gap: 12, padding: '10px 0', borderBottom: i < 3 ? '1px solid var(--border-soft)' : 'none' }}>
                <div className="ico" style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0, background: s.done ? 'var(--green-soft)' : 'oklch(1 0 0 / 0.04)', color: s.done ? 'var(--green)' : 'var(--text-dim)' }}>
                  <Icon name={s.done ? 'check' : s.icon} size={15} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.t}</div>
                  <div className="dim" style={{ fontSize: 12 }}>{s.d}</div>
                </div>
                {s.done && <span className="badge green" style={{ padding: '2px 8px' }}>ok</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top conteúdos */}
      <div className="card flush">
        <div className="row spread" style={{ padding: '16px 20px' }}>
          <div className="card-title">Conteúdos campeões da semana</div>
          <button className="btn btn-ghost btn-sm" onClick={() => go('relatorios')}>Ver relatórios<Icon name="arrow" size={14} /></button>
        </div>
        <table className="tbl">
          <thead><tr><th>Produto</th><th>Série</th><th>Rede</th><th className="right">Views</th><th className="right">Vendas</th><th className="right">Status</th></tr></thead>
          <tbody>
            {DATA.relatorios.slice(0, 4).map((r, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{r.produto}</td>
                <td className="muted">{r.serie}</td>
                <td className="muted">{r.rede}</td>
                <td className="right mono">{r.views}</td>
                <td className="right mono">{r.vendas}</td>
                <td className="right"><Badge status={r.veredito} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

window.Dashboard = Dashboard;


/* ===== screens-content.jsx ===== */
/* ============ Radar de Tendências + Analisador ============ */
const cats = ['Todas','Cozinha','Geladeira','Banheiro','Guarda-roupa','Lavanderia','Gavetas'];

const Radar = ({ go }) => {
  const [cat, setCat] = useState('Todas');
  const [sel, setSel] = useState(DATA.trends[0] || null);
  const list = cat === 'Todas' ? DATA.trends : DATA.trends.filter(t => t.cat === cat);
  if (!sel) return (
    <div className="content-inner fade-in">
      <div className="card" style={{ padding: 40, textAlign: 'center' }}>
        <Icon name="radar" size={28} style={{ color: 'var(--violet)', marginBottom: 10 }} />
        <h2 style={{ fontSize: 17 }}>Nenhuma tendência ainda</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>Quando o radar varrer as redes, as tendências aparecem aqui.</p>
      </div>
    </div>
  );
  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 100% 0%, var(--violet-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--violet-soft)', color: 'var(--violet)' }}><Icon name="radar" size={22} /></div>
            <div>
              <h2 style={{ fontSize: 18 }}>Radar de Tendências Virais</h2>
              <p className="muted" style={{ fontSize: 13 }}>Apenas inspiração estratégica · nada é copiado ou repostado automaticamente</p>
            </div>
          </div>
          <button className="btn btn-violet" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="refresh" size={15} />Varrer agora</button>
        </div>
        <div className="chips" style={{ marginTop: 16 }}>
          {cats.map(c => <div key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</div>)}
        </div>
      </div>

      <div className="grid g2" style={{ gridTemplateColumns: '1.05fr 0.95fr', alignItems: 'start' }}>
        {/* Lista */}
        <div className="col" style={{ gap: 12 }}>
          {list.map(t => (
            <div key={t.id} className="card" onClick={() => setSel(t)}
              style={{ cursor: 'pointer', padding: 16, borderColor: sel.id === t.id ? 'oklch(0.68 0.195 295 / 0.45)' : 'var(--border-soft)', boxShadow: sel.id === t.id ? '0 0 0 3px var(--violet-soft)' : 'none' }}>
              <div className="row spread" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 7, marginBottom: 6 }}>
                    <span className="badge gray" style={{ padding: '2px 7px' }}>{t.cat}</span>
                    <span className="dim" style={{ fontSize: 11.5 }}>{t.plataforma} · {t.views} views</span>
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t.tema}</div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{t.gancho}</div>
                </div>
                <div className="col" style={{ alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: t.score >= 90 ? 'var(--gold)' : 'var(--text)' }}>{t.score}</div>
                  <span className="dim" style={{ fontSize: 9.5, letterSpacing: '0.05em' }}>SCORE</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Analisador */}
        <div className="card" style={{ position: 'sticky', top: 0 }}>
          <div className="row spread" style={{ marginBottom: 14 }}>
            <div className="card-title">Analisador de Tendência</div>
            <span className={`badge ${window.riscoMap[sel.risco].cls}`}><span className="dot" />{window.riscoMap[sel.risco].label}</span>
          </div>
          <div className="row" style={{ gap: 14, marginBottom: 16 }}>
            <PhonePreview w={108} label={`referência\n(somente análise)`} badge={<span className="badge violet" style={{ padding: '2px 7px', background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)' }}>{sel.views}</span>} />
            <div className="col" style={{ gap: 9, flex: 1 }}>
              {[['Gancho', sel.gancho],['Dor do público', sel.dor],['Formato', sel.formato],['Duração', sel.dur],['Tipo de CTA', sel.cta]].map(([k,v]) => (
                <div key={k} className="col" style={{ gap: 1 }}>
                  <span className="dim" style={{ fontSize: 10.5, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{k}</span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: 12, borderRadius: 11, background: 'var(--violet-soft)', border: '1px solid oklch(0.68 0.195 295 / 0.25)' }}>
            <div className="row" style={{ gap: 7, marginBottom: 5 }}><Icon name="brain" size={14} style={{ color: 'var(--violet)' }} /><span style={{ fontSize: 12, fontWeight: 700, color: 'var(--violet)' }}>Por que viralizou (IA)</span></div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Gancho de dor universal nos 2s + transformação visual satisfatória + produto demonstrável e barato. Alta chance de venda por impulso.</p>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={() => go('gerar')}>
            <Icon name="sparkles" size={15} />Transformar em conteúdo próprio
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============ Transformador IA (Gerar Conteúdo) ============ */
const Gerar = ({ go }) => {
  const [done, setDone] = useState(true);
  return (
    <div className="content-inner fade-in">
      <div className="grid g2" style={{ gridTemplateColumns: '320px 1fr', alignItems: 'start' }}>
        <div className="card" style={{ position: 'sticky', top: 0 }}>
          <div className="row" style={{ gap: 10, marginBottom: 16 }}>
            <div className="ico" style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--gold-soft)', color: 'var(--gold)' }}><Icon name="sparkles" /></div>
            <div className="card-title">Transformador IA</div>
          </div>
          <label className="label">Tendência base</label>
          <div className="select" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>Gaveta da cozinha <Icon name="chevD" size={15} /></div>
          <label className="label" style={{ marginTop: 14 }}>Produto sugerido</label>
          <div className="select" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>Talheres Expansível <Icon name="chevD" size={15} /></div>
          <label className="label" style={{ marginTop: 14 }}>Série</label>
          <div className="chips">
            {['Achadinhos','Antes/depois','Bobos que resolvem'].map((s,i) => <div key={s} className={`chip ${i===0?'active':''}`}>{s}</div>)}
          </div>
          <label className="label" style={{ marginTop: 14 }}>Duração</label>
          <div className="chips">{['15s','25s','35s'].map((d,i) => <div key={d} className={`chip ${i===0?'active':''}`}>{d}</div>)}</div>
          <div className="divider" style={{ margin: '16px 0' }} />
          <div className="col" style={{ gap: 6, fontSize: 12.5 }} >
            {['5 ganchos originais','5 roteiros próprios','5 legendas A/B','5 CTAs de seguir','5 CTAs de compra','3 produtos compatíveis'].map(x => (
              <div key={x} className="row" style={{ gap: 8 }}><Icon name="check" size={13} style={{ color: 'var(--green)' }} /><span className="muted">{x}</span></div>
            ))}
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={() => setDone(true)}><Icon name="bolt" size={15} />Gerar versão própria</button>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="row spread">
            <SectionTitle>5 roteiros próprios gerados</SectionTitle>
            <span className="badge violet"><Icon name="shield" size={12} />100% original · sem cópia</span>
          </div>
          {DATA.roteiros.map((r, i) => (
            <div key={i} className="card">
              <div className="row spread" style={{ marginBottom: 12 }}>
                <div className="row" style={{ gap: 9 }}>
                  <span className="badge gold" style={{ padding: '3px 8px' }}>#{i+1}</span>
                  <span style={{ fontWeight: 600, fontSize: 14.5 }}>{r.titulo}</span>
                </div>
                <span className="badge gray">{r.dur}</span>
              </div>
              <div className="grid g2" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="col" style={{ gap: 10 }}>
                  {[['Gancho (2s)', r.gancho],['Problema', r.problema],['Solução', r.solucao]].map(([k,v]) => (
                    <div key={k}><span className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</span><div style={{ fontSize: 13, marginTop: 2 }}>{v}</div></div>
                  ))}
                </div>
                <div className="col" style={{ gap: 10 }}>
                  <div><span className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Texto na tela</span><div style={{ fontSize: 13, marginTop: 2, fontWeight: 600, color: 'var(--gold)' }}>{r.tela}</div></div>
                  <div><span className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>CTA</span><div style={{ fontSize: 13, marginTop: 2 }}>{r.cta}</div></div>
                  <div className="row" style={{ gap: 8, marginTop: 'auto' }}>
                    <button className="btn btn-ghost btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="copy" size={13} />Copiar</button>
                    <button className="btn btn-violet btn-sm" onClick={() => go('biblioteca')}><Icon name="video" size={13} />Vincular vídeo</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

window.Radar = Radar;
window.Gerar = Gerar;


/* ===== screens-acervo.jsx ===== */
/* ============ Produtos Afiliados ============ */
const platColor = { 'Shopee':'amber', 'Mercado Livre':'gold', 'Amazon':'blue', 'TikTok Shop':'pink', 'Renner':'violet' };

const Produtos = () => {
  const [modal, setModal] = useState(false);
  const [, setTick] = useState(0);
  const [pNome, setPNome] = useState('');
  const [pDor, setPDor] = useState('');
  const [pPlat, setPPlat] = useState(Object.keys(platColor)[0]);
  const [pCat, setPCat] = useState('');
  const [pPreco, setPPreco] = useState('');
  const [pComissao, setPComissao] = useState('');
  const [pDono, setPDono] = useState('');
  const [editId, setEditId] = useState(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState('Todos');
  const bump = () => { setTick(t => t + 1); window.persistDATA && window.persistDATA(); };
  const filtros = ['Todos','campeao','teste','novo','pausado'];
  const filtroLabel = { Todos:'Todos', campeao:'Campeões', teste:'Em teste', novo:'Novos', pausado:'Pausados' };
  const openEdit = (p) => {
    setEditId(p.id); setPNome(p.nome); setPDor(p.dor); setPPlat(p.plat); setPCat(p.cat); setPPreco(p.preco); setPComissao(p.comissao);
    setPDono((DATA.vendedores.find(v => v.id === p.donoId) || {}).nome || '');
    setModal(true);
  };
  const openNew = () => { setEditId(null); setPNome(''); setPDor(''); setPPlat(Object.keys(platColor)[0]); setPCat(''); setPPreco(''); setPComissao(''); setModal(true); };
  const excluir = (p) => { if (window.confirm(`Excluir "${p.nome}"?`)) { DATA.produtos = DATA.produtos.filter(x => x.id !== p.id); bump(); window.toast && window.toast('Produto excluído'); } };
  const visiveis = DATA.produtos
    .filter(p => filtro === 'Todos' || p.status === filtro)
    .filter(p => !busca.trim() || p.nome.toLowerCase().includes(busca.toLowerCase()) || p.cat.toLowerCase().includes(busca.toLowerCase()));
  return (
  <div className="content-inner fade-in">
    <div className="row spread wrap" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10, flex: 1, maxWidth: 360 }}>
        <div className="input" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="search" size={15} style={{ color: 'var(--text-dim)' }} />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto..." style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 13.5, width: '100%', fontFamily: 'var(--font-body)' }} />
        </div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <button className="btn btn-primary btn-sm" onClick={openNew}><Icon name="plus" size={14} />Novo produto</button>
      </div>
    </div>

    <div className="chips">{filtros.map(f => <div key={f} className={`chip ${filtro===f?'active':''}`} onClick={() => setFiltro(f)}>{filtroLabel[f]}</div>)}</div>

    <div className="grid g4">
      {[['bag','gold', DATA.produtos.length,'Cadastrados'],['star','green', DATA.produtos.filter(p=>p.status==='campeao').length,'Campeões'],['flask','violet', DATA.produtos.filter(p=>p.status==='teste').length,'Em teste'],['pause','amber', DATA.produtos.filter(p=>p.status==='pausado').length,'Pausados']].map(([ic,co,v,l]) => (
        <StatCard key={l} icon={ic} color={co} value={v} label={l} />
      ))}
    </div>

    <div className="card flush">
      {visiveis.length === 0 ? (
        <div className="dim" style={{ padding: '24px 20px', fontSize: 13 }}>Nenhum produto encontrado.</div>
      ) : (
      <table className="tbl">
        <thead><tr><th>Produto</th><th>Plataforma</th><th>Categoria</th><th>Dono</th><th className="right">Preço</th><th className="right">Comissão</th><th className="right">Nota</th><th className="right">Vendas</th><th className="right">Status</th><th className="right">Ações</th></tr></thead>
        <tbody>
          {visiveis.map(p => (
            <tr key={p.id}>
              <td style={{ maxWidth: 230 }}>
                <div style={{ fontWeight: 600 }}>{p.nome}</div>
                <div className="dim" style={{ fontSize: 11.5 }}>Resolve: {p.dor}</div>
              </td>
              <td><span className={`badge ${platColor[p.plat]||'gray'}`} style={{ padding: '2px 8px' }}>{p.plat}</span></td>
              <td className="muted">{p.cat}</td>
              <td className="muted" style={{ fontSize: 12 }}>{(DATA.vendedores.find(v => v.id === p.donoId) || {}).nome || <span className="dim">Casa</span>}</td>
              <td className="right mono">{p.preco}</td>
              <td className="right mono" style={{ color: 'var(--green)' }}>{p.comissao}</td>
              <td className="right"><span className="row" style={{ gap: 3, justifyContent: 'flex-end' }}><Icon name="star" size={12} style={{ color: 'var(--gold)' }} />{p.nota}</span></td>
              <td className="right mono">{p.vendas}</td>
              <td className="right"><Badge status={p.status} /></td>
              <td className="right">
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost btn-sm" style={{ padding: '5px 8px' }} onClick={() => openEdit(p)} title="Editar"><Icon name="pencil" size={13} /></button>
                  <button className="btn btn-danger btn-sm" style={{ padding: '5px 8px' }} onClick={() => excluir(p)} title="Excluir"><Icon name="x" size={13} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </div>

    <Modal open={modal} onClose={() => setModal(false)} icon={editId ? 'pencil' : 'plus'} iconColor="gold"
      title={editId ? 'Editar produto' : 'Novo produto'} sub="Cadastro de produto afiliado"
      footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(false)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={() => {
        if (!pNome.trim()) return;
        let donoId = null;
        if (pDono.trim()) {
          const existente = DATA.vendedores.find(v => v.nome.toLowerCase() === pDono.trim().toLowerCase());
          donoId = existente ? existente.id : (() => { const nv = { id: 'v' + Date.now(), nome: pDono.trim(), limiteConvites: 3 }; DATA.vendedores.push(nv); return nv.id; })();
        }
        if (editId) {
          const p = DATA.produtos.find(x => x.id === editId);
          Object.assign(p, { nome: pNome.trim(), dor: pDor.trim(), plat: pPlat, cat: pCat.trim(), preco: pPreco, comissao: pComissao, donoId });
        } else {
          DATA.produtos.push({ id: 'p' + Date.now(), nome: pNome.trim(), dor: pDor.trim(), plat: pPlat, cat: pCat.trim(), preco: pPreco, comissao: pComissao, nota: 0, vendas: 0, status: 'novo', donoId });
        }
        setPNome(''); setPDor(''); setPCat(''); setPPreco(''); setPComissao(''); setPDono(''); setEditId(null);
        setModal(false);
        bump();
        window.toast && window.toast(editId ? 'Produto atualizado' : 'Produto cadastrado');
      }}><Icon name="check" size={13} />{editId ? 'Salvar' : 'Cadastrar'}</button></>}>
      <label className="label">Nome do produto</label>
      <input className="input" value={pNome} onChange={e => setPNome(e.target.value)} placeholder="Ex.: Organizador de gavetas" />
      <label className="label" style={{ marginTop: 14 }}>Dor que resolve</label>
      <input className="input" value={pDor} onChange={e => setPDor(e.target.value)} placeholder="Ex.: Bagunça na gaveta" />
      <label className="label" style={{ marginTop: 14 }}>Plataforma</label>
      <select className="input" value={pPlat} onChange={e => setPPlat(e.target.value)}>{Object.keys(platColor).map(k => <option key={k}>{k}</option>)}</select>
      <label className="label" style={{ marginTop: 14 }}>Categoria</label>
      <input className="input" value={pCat} onChange={e => setPCat(e.target.value)} placeholder="Ex.: Organização" />
      <div className="row" style={{ gap: 10, marginTop: 14 }}>
        <div style={{ flex: 1 }}><label className="label">Preço</label><input className="input" value={pPreco} onChange={e => setPPreco(e.target.value)} placeholder="R$ 39,90" /></div>
        <div style={{ flex: 1 }}><label className="label">Comissão</label><input className="input" value={pComissao} onChange={e => setPComissao(e.target.value)} placeholder="R$ 8,00" /></div>
      </div>
      <label className="label" style={{ marginTop: 14 }}>Dono / vendedor (opcional)</label>
      <input className="input" value={pDono} onChange={e => setPDono(e.target.value)} placeholder="Ex.: Marina Duarte — vazio = produto da casa" />
    </Modal>
  </div>
  );
};

/* ============ Biblioteca de Vídeos Autorizados (NOVO) ============ */
const permRow = (ok) => ok
  ? <span className="row" style={{ gap: 4, color: 'var(--green)', fontSize: 12, fontWeight: 600 }}><Icon name="check" size={13} />Sim</span>
  : <span className="row" style={{ gap: 4, color: 'var(--red)', fontSize: 12, fontWeight: 600 }}><Icon name="x" size={13} />Não</span>;

const Biblioteca = () => {
  const [sel, setSel] = useState(DATA.criativos[0] || null);
  if (!sel) return (
    <div className="content-inner fade-in">
      <div className="card" style={{ padding: 40, textAlign: 'center' }}>
        <Icon name="shield" size={28} style={{ color: 'var(--green)', marginBottom: 10 }} />
        <h2 style={{ fontSize: 17 }}>Nenhum vídeo cadastrado ainda</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>Adicione um criativo autorizado para começar.</p>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="plus" size={15} />Adicionar criativo</button>
      </div>
    </div>
  );
  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 0% 0%, var(--green-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--green-soft)', color: 'var(--green)' }}><Icon name="shield" size={22} /></div>
            <div>
              <h2 style={{ fontSize: 18 }}>Biblioteca de Vídeos Autorizados</h2>
              <p className="muted" style={{ fontSize: 13 }}>Só entra na fila vídeo com <strong style={{ color: 'var(--green)' }}>"pode postar: sim"</strong> · nada de terceiros</p>
            </div>
          </div>
          <button className="btn btn-primary" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="plus" size={15} />Adicionar criativo</button>
        </div>
      </div>

      <div className="grid g2" style={{ gridTemplateColumns: '1fr 320px', alignItems: 'start' }}>
        <div className="card flush">
          <table className="tbl">
            <thead><tr><th>Arquivo</th><th>Origem</th><th>Categoria</th><th>Postar</th><th className="right">Status</th></tr></thead>
            <tbody>
              {DATA.criativos.map(c => (
                <tr key={c.id} onClick={() => setSel(c)} style={{ cursor: 'pointer', background: sel.id === c.id ? 'oklch(1 0 0 / 0.03)' : undefined }}>
                  <td><span className="mono" style={{ fontSize: 12.5 }}>{c.nome}</span></td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{c.origem}</td>
                  <td className="muted">{c.cat}</td>
                  <td>{permRow(c.postar)}</td>
                  <td className="right"><Badge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ position: 'sticky', top: 0 }}>
          <PhonePreview w="100%" label={sel.nome} badge={<Badge status={sel.status} />} />
          <div className="col" style={{ gap: 9, marginTop: 16 }}>
            {[['Origem', sel.origem],['Fornecedor', sel.fornecedor],['Categoria', sel.cat],['Validade', sel.validade]].map(([k,v]) => (
              <div key={k} className="row spread"><span className="dim" style={{ fontSize: 12 }}>{k}</span><span style={{ fontSize: 12.5, fontWeight: 500 }}>{v}</span></div>
            ))}
          </div>
          <div className="divider" style={{ margin: '14px 0' }} />
          <div className="col" style={{ gap: 8 }}>
            {[['Autorização confirmada', sel.autorizado],['Pode postar', sel.postar],['Pode editar', sel.editar]].map(([k,v]) => (
              <div key={k} className="row spread"><span style={{ fontSize: 12.5 }}>{k}</span>{permRow(v)}</div>
            ))}
          </div>
          {sel.postar
            ? <button className="btn btn-violet" style={{ width: '100%', marginTop: 14 }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="calendar" size={15} />Enviar para a fila</button>
            : <div style={{ marginTop: 14, padding: 10, borderRadius: 10, background: 'var(--red-soft)', color: 'var(--red)', fontSize: 12, textAlign: 'center' }}>🔒 Bloqueado — sem autorização para postar</div>}
        </div>
      </div>
    </div>
  );
};

/* ============ Séries Fixas ============ */
const Series = () => {
  const [modal, setModal] = useState(false);
  const [, setTick] = useState(0);
  const [sNome, setSNome] = useState('');
  const bump = () => { setTick(t => t + 1); window.persistDATA && window.persistDATA(); };
  const cores = ['gold','violet','blue','green','pink','amber','red'];
  return (
  <div className="content-inner fade-in">
    <div className="row spread wrap" style={{ gap: 12 }}>
      <div><h2 style={{ fontSize: 18 }}>Séries Fixas</h2><p className="muted" style={{ fontSize: 13 }}>Linhas editoriais que a IA alimenta automaticamente</p></div>
      <button className="btn btn-primary btn-sm" onClick={() => { setSNome(''); setModal(true); }}><Icon name="plus" size={14} />Nova série</button>
    </div>
    <div className="grid g3">
      {DATA.series.map(s => (
        <div key={s.id} className="card" style={{ position: 'relative', overflow: 'hidden', opacity: s.ativa ? 1 : 0.6 }}>
          <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(300px 120px at 100% 0%, var(--${s.cor}-soft), transparent 70%)`, pointerEvents: 'none' }} />
          <div className="row spread" style={{ position: 'relative' }}>
            <div className="ico" style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: `var(--${s.cor}-soft)`, color: `var(--${s.cor})` }}><Icon name={s.icon} size={20} /></div>
            <div className="row" style={{ gap: 6 }}>
              {s.ativa ? <span className="badge green" style={{ padding: '2px 8px' }}><span className="dot" />Ativa</span> : <span className="badge gray" style={{ padding: '2px 8px' }}>Pausada</span>}
            </div>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 14, position: 'relative' }}>{s.nome}</div>
          <div className="row spread" style={{ marginTop: 14, position: 'relative' }}>
            <div className="col"><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19 }}>{s.videos}</span><span className="dim" style={{ fontSize: 11 }}>vídeos</span></div>
            <div className="col" style={{ alignItems: 'flex-end' }}><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, color: `var(--${s.cor})` }}>{s.seguidores}</span><span className="dim" style={{ fontSize: 11 }}>seguidores</span></div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 14, position: 'relative' }}>
            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => { s.ativa = !s.ativa; bump(); }}>{s.ativa ? 'Pausar' : 'Ativar'}</button>
            <button className="btn btn-danger btn-sm" style={{ padding: '5px 8px' }} onClick={() => { if (window.confirm(`Excluir a série "${s.nome}"?`)) { DATA.series = DATA.series.filter(x => x.id !== s.id); bump(); window.toast && window.toast('Série excluída'); } }}><Icon name="x" size={13} /></button>
          </div>
        </div>
      ))}
    </div>

    <Modal open={modal} onClose={() => setModal(false)} icon="plus" iconColor="gold"
      title="Nova série" sub="Linha editorial fixa"
      footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(false)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={() => {
        if (!sNome.trim()) return;
        DATA.series.push({ id: 's' + Date.now(), nome: sNome.trim(), cor: cores[DATA.series.length % cores.length], videos: 0, seguidores: '+0', icon: 'layers', ativa: true });
        setSNome(''); setModal(false); bump();
        window.toast && window.toast('Série criada');
      }}><Icon name="check" size={13} />Criar</button></>}>
      <label className="label">Nome da série</label>
      <input className="input" value={sNome} onChange={e => setSNome(e.target.value)} placeholder="Ex.: Achadinhos de cozinha" />
    </Modal>
  </div>
  );
};

window.Produtos = Produtos;
window.Biblioteca = Biblioteca;
window.Series = Series;


/* ===== screens-extra.jsx ===== */
/* ============ Patrono Video Seller (geração de vídeo por IA) ============ */
const VideoSeller = () => {
  const fila = [
    { nome:'talheres_pov_v1.mp4', prod:'Talheres Expansível', st:'pronto', prog:100, dur:'18s' },
    { nome:'geladeira_transform.mp4', prod:'Potes Geladeira', st:'renderizando', prog:64, dur:'25s' },
    { nome:'cabide_demo.mp4', prod:'Cabide Mágico', st:'fila', prog:0, dur:'15s' },
  ];
  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 220px at 80% 0%, var(--violet-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--violet-soft)', color: 'var(--violet)' }}><Icon name="video" size={22} /></div>
            <div><h2 style={{ fontSize: 18 }}>Patrono Video Seller</h2><p className="muted" style={{ fontSize: 13 }}>A IA monta o vídeo a partir do roteiro + criativo autorizado</p></div>
          </div>
          <span className="badge violet"><Icon name="sparkles" size={12} />Geração por IA</span>
        </div>
      </div>

      <div className="grid g2" style={{ gridTemplateColumns: '1fr 280px', alignItems: 'start' }}>
        <div className="card">
          <div className="card-title" style={{ fontSize: 14, marginBottom: 16 }}>Briefing do vídeo</div>
          <div className="grid g2" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div><label className="label">Produto</label><div className="select row spread">Talheres Expansível <Icon name="chevD" size={15} /></div></div>
            <div><label className="label">Criativo base (autorizado)</label><div className="select row spread">ugc_talheres_v3.mp4 <Icon name="chevD" size={15} /></div></div>
          </div>
          <label className="label" style={{ marginTop: 14 }}>Roteiro</label>
          <div className="textarea" style={{ minHeight: 84, lineHeight: 1.6, fontSize: 13.5 }}>Gancho: "Você ainda guarda talher amontoado?"{'\n'}Solução: organizador expansível · Texto na tela: CABE EM QUALQUER GAVETA ✨ · CTA: link na bio</div>
          <div className="grid g3" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginTop: 14 }}>
            <div><label className="label">Voz (narração)</label><div className="select row spread" style={{ fontSize: 13 }}>Feminina BR <Icon name="chevD" size={14} /></div></div>
            <div><label className="label">Trilha</label><div className="select row spread" style={{ fontSize: 13 }}>Trend leve <Icon name="chevD" size={14} /></div></div>
            <div><label className="label">Formato</label><div className="select row spread" style={{ fontSize: 13 }}>9:16 · 18s <Icon name="chevD" size={14} /></div></div>
          </div>
          <div className="row" style={{ gap: 10, marginTop: 18 }}>
            <button className="btn btn-violet" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="bolt" size={15} />Renderizar vídeo</button>
            <button className="btn btn-ghost" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="eye" size={15} />Pré-visualizar</button>
            <span className="badge gray" style={{ marginLeft: 'auto' }}><Icon name="clock" size={11} />~2 min</span>
          </div>
        </div>

        <PhonePreview w="100%" label={`prévia do vídeo\ngerado por IA`} badge={<span className="badge violet" style={{ padding: '2px 7px', background: 'rgba(0,0,0,.5)' }}><Icon name="play" size={10} />18s</span>}>
          <div style={{ position: 'absolute', left: 10, bottom: 12, right: 44 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'white', textShadow: '0 1px 4px black' }}>CABE EM QUALQUER GAVETA ✨</div>
          </div>
        </PhonePreview>
      </div>

      <div className="card flush">
        <div className="row spread" style={{ padding: '14px 20px' }}><div className="card-title">Fila de renderização</div><span className="badge violet">{fila.length} na fila</span></div>
        <table className="tbl">
          <thead><tr><th>Arquivo</th><th>Produto</th><th>Duração</th><th>Progresso</th><th className="right">Status</th></tr></thead>
          <tbody>
            {fila.map((f, i) => (
              <tr key={i}>
                <td className="mono" style={{ fontSize: 12.5 }}>{f.nome}</td>
                <td style={{ fontWeight: 500 }}>{f.prod}</td>
                <td className="muted">{f.dur}</td>
                <td style={{ minWidth: 160 }}><div className="bar violet" style={{ height: 7 }}><i style={{ width: f.prog + '%' }} /></div></td>
                <td className="right">{f.st === 'pronto' ? <Badge status="aprovado" /> : f.st === 'renderizando' ? <span className="badge violet"><Icon name="refresh" size={11} />Renderizando</span> : <span className="badge gray"><Icon name="clock" size={11} />Na fila</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ============ Links Dinâmicos ============ */
const genCupom = (base) => (base || 'PROMO').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
const Links = () => {
  const [, setTick] = useState(0);
  const [qr, setQr] = useState(null);
  const bump = () => { setTick(t => t + 1); window.persistDATA && window.persistDATA(); };
  const links = DATA.linksDinamicos || (DATA.linksDinamicos = [
    { slug:'patrono.link/talheres', prod:'Talheres Expansível', plat:'Shopee', cliques:1820, vendas:58, ativo:true, cupom:'TALHERES10' },
    { slug:'patrono.link/cabide', prod:'Cabide Mágico', plat:'Shopee', cliques:1240, vendas:41, ativo:true, cupom:'CABIDE10' },
    { slug:'patrono.link/potes', prod:'Potes Geladeira', plat:'Mercado Livre', cliques:940, vendas:31, ativo:true, cupom:'POTES10' },
    { slug:'patrono.link/nicho', prod:'Nicho de Canto', plat:'Amazon', cliques:320, vendas:8, ativo:true, cupom:'NICHO10' },
    { slug:'patrono.link/varal', prod:'Varal Retrátil', plat:'TikTok Shop', cliques:88, vendas:1, ativo:false, cupom:'VARAL10' },
  ]);
  return (
    <div className="content-inner fade-in">
      <div className="row spread wrap" style={{ gap: 12 }}>
        <div><h2 style={{ fontSize: 18 }}>Links Dinâmicos</h2><p className="muted" style={{ fontSize: 13 }}>Um link curto por produto, com rastreamento de cliques e vendas</p></div>
        <button className="btn btn-primary btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="plus" size={14} />Novo link</button>
      </div>
      <div className="grid g4">
        <StatCard icon="link" color="blue" value="4.408" label="Cliques totais" trend="+14%" trendDir="up" />
        <StatCard icon="bag" color="gold" value="139" label="Vendas atribuídas" trend="+9%" trendDir="up" />
        <StatCard icon="trend" color="green" value="3,2%" label="Conversão média" trend="+0,3pp" trendDir="up" />
        <StatCard icon="tag" color="violet" value="5" label="Links ativos" />
      </div>
      <div className="card flush">
        <table className="tbl">
          <thead><tr><th>Link curto</th><th>Cupom</th><th>Produto</th><th>Plataforma</th><th className="right">Cliques</th><th className="right">Vendas</th><th className="right">Conversão</th><th className="right">Status</th><th className="right"></th></tr></thead>
          <tbody>
            {links.map((l, i) => (
              <tr key={i}>
                <td><span className="row" style={{ gap: 7 }}><Icon name="link" size={13} style={{ color: 'var(--blue)' }} /><span className="mono" style={{ fontSize: 12.5, color: 'var(--blue)' }}>{l.slug}</span><Icon name="copy" size={12} style={{ color: 'var(--text-dim)', cursor: 'pointer' }} /></span></td>
                <td><span className="badge violet mono" style={{ padding: '2px 8px' }}>{l.cupom || genCupom(l.prod)}</span></td>
                <td style={{ fontWeight: 500 }}>{l.prod}</td>
                <td><span className={`badge ${platColor[l.plat]||'gray'}`} style={{ padding: '2px 8px' }}>{l.plat}</span></td>
                <td className="right mono">{l.cliques.toLocaleString('pt-BR')}</td>
                <td className="right mono">{l.vendas}</td>
                <td className="right mono">{((l.vendas/l.cliques)*100).toFixed(1)}%</td>
                <td className="right">{l.ativo ? <span className="badge green" style={{ padding: '2px 8px' }}><span className="dot" />Ativo</span> : <span className="badge gray" style={{ padding: '2px 8px' }}>Pausado</span>}</td>
                <td className="right"><button className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }} onClick={() => setQr(l)}><Icon name="grid" size={13} />QR</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!qr} onClose={() => setQr(null)} icon="link" iconColor="blue" title="QR code do link" sub={qr?.slug}
        footer={<button className="btn btn-ghost btn-sm" onClick={() => setQr(null)}>Fechar</button>}>
        {qr && (<div style={{ textAlign: 'center' }}>
          <img alt={`QR ${qr.slug}`} width={220} height={220} style={{ borderRadius: 12, background: 'white', padding: 10 }}
            src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent('https://' + qr.slug)}`} />
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Cupom associado: <strong className="mono" style={{ color: 'var(--violet)' }}>{qr.cupom || genCupom(qr.prod)}</strong></p>
          <p className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>Use em lives, embalagens e stories — rastreia vendas mesmo sem clique no link.</p>
        </div>)}
      </Modal>
    </div>
  );
};

window.VideoSeller = VideoSeller;
window.Links = Links;


/* ===== screens-intel.jsx ===== */
/* ============ Relatórios ============ */
const Bars = ({ data, color = 'var(--gold)' }) => {
  const max = Math.max(...data);
  return (
    <div className="row" style={{ gap: 6, alignItems: 'flex-end', height: 90 }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, height: (v / max * 100) + '%', minHeight: 4, borderRadius: '5px 5px 0 0', background: i === data.length - 1 ? color : 'oklch(1 0 0 / 0.12)' }} />
      ))}
    </div>
  );
};

const Relatorios = () => (
  <div className="content-inner fade-in">
    <div className="grid g4">
      <StatCard icon="eye" color="violet" value="935k" label="Views (7 dias)" trend="+24%" trendDir="up" />
      <StatCard icon="link" color="blue" value="996" label="Cliques no link" trend="+12%" trendDir="up" />
      <StatCard icon="dollar" color="green" value="R$ 423" label="Receita (7 dias)" trend="+31%" trendDir="up" />
      <StatCard icon="users" color="gold" value="+620" label="Seguidores ganhos" trend="meta: +287" trendDir="up" />
    </div>

    <div className="grid g2" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="card">
        <div className="card-head"><div className="card-title" style={{ fontSize: 14 }}>Views por dia</div></div>
        <Bars data={[62,74,81,90,98,110,124]} color="var(--violet)" />
        <div className="row" style={{ gap: 6, marginTop: 8 }}>{['S','T','Q','Q','S','S','D'].map((d,i) => <span key={i} className="dim" style={{ flex: 1, textAlign: 'center', fontSize: 10.5 }}>{d}</span>)}</div>
      </div>
      <div className="card">
        <div className="card-head"><div className="card-title" style={{ fontSize: 14 }}>Receita por dia</div></div>
        <Bars data={[28,35,41,38,52,68,82]} color="var(--green)" />
        <div className="row" style={{ gap: 6, marginTop: 8 }}>{['S','T','Q','Q','S','S','D'].map((d,i) => <span key={i} className="dim" style={{ flex: 1, textAlign: 'center', fontSize: 10.5 }}>{d}</span>)}</div>
      </div>
    </div>

    <div className="card flush">
      <div className="row spread" style={{ padding: '14px 20px' }}><div className="card-title">Desempenho por conteúdo</div><button className="btn btn-ghost btn-sm" onClick={() => window.exportCSV('desempenho-conteudo', ['Produto','Série','Rede','Views','Likes','Cliques','Vendas','Receita','Veredito'], DATA.relatorios.map(r => [r.produto,r.serie,r.rede,r.views,r.likes,r.cliques,r.vendas,r.receita,r.veredito]))}><Icon name="download" size={14} />Exportar</button></div>
      <table className="tbl">
        <thead><tr><th>Produto</th><th>Série</th><th>Rede</th><th className="right">Views</th><th className="right">Likes</th><th className="right">Cliques</th><th className="right">Vendas</th><th className="right">Receita</th><th className="right">Veredito</th></tr></thead>
        <tbody>
          {DATA.relatorios.map((r, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{r.produto}</td>
              <td className="muted">{r.serie}</td>
              <td className="muted">{r.rede}</td>
              <td className="right mono">{r.views}</td>
              <td className="right mono">{r.likes}</td>
              <td className="right mono">{r.cliques}</td>
              <td className="right mono">{r.vendas}</td>
              <td className="right mono" style={{ color: 'var(--green)' }}>{r.receita}</td>
              <td className="right"><Badge status={r.veredito} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

/* ============ Motor de Decisão (NOVO) ============ */
const Decisao = () => {
  const lanes = [
    { key:'campeao', title:'Campeões', desc:'Performou muito bem', color:'gold', icon:'star',
      acoes:['Criar 5 variações','Repetir produto','Testar novo gancho','Priorizar produto'],
      items:[{p:'Cabide Mágico', m:'412k views · 28 vendas'},{p:'Talheres Expansível', m:'287k views · 19 vendas'}] },
    { key:'medio', title:'Medianos', desc:'Resultado intermediário', color:'amber', icon:'trend',
      acoes:['Alterar legenda','Testar novo CTA','Mudar horário'],
      items:[{p:'Potes Geladeira', m:'156k views · 11 vendas'},{p:'Nicho de Canto', m:'62k views · 3 vendas'}] },
    { key:'fraco', title:'Fracos', desc:'Performou mal', color:'red', icon:'pause',
      acoes:['Pausar formato','Não repetir agora','Arquivar aprendizado'],
      items:[{p:'Varal Retrátil', m:'18k views · 1 venda'}] },
  ];
  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 50% 0%, var(--violet-soft), transparent 60%), var(--surface)' }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--violet-soft)', color: 'var(--violet)' }}><Icon name="brain" size={22} /></div>
          <div><h2 style={{ fontSize: 18 }}>Motor de Decisão</h2><p className="muted" style={{ fontSize: 13 }}>A IA classifica cada vídeo e decide o próximo passo automaticamente</p></div>
        </div>
      </div>
      <div className="grid g3" style={{ alignItems: 'start' }}>
        {lanes.map(l => (
          <div key={l.key} className="card" style={{ borderTop: `3px solid var(--${l.color})` }}>
            <div className="row spread">
              <div className="row" style={{ gap: 9 }}>
                <div className="ico" style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: `var(--${l.color}-soft)`, color: `var(--${l.color})` }}><Icon name={l.icon} size={16} /></div>
                <div><div style={{ fontWeight: 600 }}>{l.title}</div><div className="dim" style={{ fontSize: 11.5 }}>{l.desc}</div></div>
              </div>
              <span className={`badge ${l.color}`} style={{ padding: '2px 8px' }}>{l.items.length}</span>
            </div>
            <div className="col" style={{ gap: 8, margin: '14px 0' }}>
              {l.items.map((it, i) => (
                <div key={i} style={{ padding: '9px 11px', borderRadius: 10, background: 'oklch(0 0 0 / 0.2)', border: '1px solid var(--border-soft)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{it.p}</div>
                  <div className="dim mono" style={{ fontSize: 11 }}>{it.m}</div>
                </div>
              ))}
            </div>
            <div className="divider" />
            <div className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '10px 0 7px' }}>Ações automáticas</div>
            <div className="col" style={{ gap: 6 }}>
              {l.acoes.map(a => <div key={a} className="row" style={{ gap: 7 }}><Icon name="arrow" size={12} style={{ color: `var(--${l.color})` }} /><span style={{ fontSize: 12.5 }}>{a}</span></div>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ============ Integrações (Conexões multi-conta) ============ */
DATA.integracoes = [
  { id:'instagram', nome:'Instagram', cat:'Redes sociais', icon:'image', co:'pink', desc:'Publicação de Reels, posts e stories', contas:[] },
  { id:'tiktok', nome:'TikTok', cat:'Redes sociais', icon:'video', co:'violet', desc:'Publicação automática via Content API', contas:[] },
  { id:'facebook', nome:'Facebook', cat:'Redes sociais', icon:'users', co:'blue', desc:'Páginas e grupos de venda', contas:[] },
  { id:'whatsapp', nome:'WhatsApp', cat:'Redes sociais', icon:'message', co:'green', desc:'Disparo de mensagens e catálogo', contas:[] },
  { id:'tiktokshop', nome:'TikTok Shop', cat:'Marketplaces', icon:'bag', co:'violet', desc:'Catálogo, checkout e comissões de afiliado', contas:[] },
  { id:'shopee', nome:'Shopee', cat:'Marketplaces', icon:'bag', co:'amber', desc:'Catálogo, checkout e comissões de afiliado', contas:[] },
  { id:'mercadolivre', nome:'Mercado Livre', cat:'Marketplaces', icon:'tag', co:'gold', desc:'Catálogo e afiliados', contas:[] },
  { id:'amazon', nome:'Amazon', cat:'Marketplaces', icon:'tag', co:'blue', desc:'Associados Amazon', contas:[] },
  { id:'shein', nome:'Shein', cat:'Marketplaces', icon:'bag', co:'pink', desc:'Catálogo e afiliados', contas:[] },
  { id:'aliexpress', nome:'AliExpress', cat:'Marketplaces', icon:'tag', co:'amber', desc:'Programa de afiliados', contas:[] },
  { id:'magalu', nome:'Magalu', cat:'Marketplaces', icon:'bag', co:'blue', desc:'Parceiro Magalu (afiliados)', contas:[] },
  { id:'hotmart', nome:'Hotmart', cat:'Afiliados e infoprodutos', icon:'tag', co:'gold', desc:'Vendas e comissões de infoprodutos', contas:[] },
  { id:'monetizze', nome:'Monetizze', cat:'Afiliados e infoprodutos', icon:'tag', co:'green', desc:'Vendas e comissões de infoprodutos', contas:[] },
  { id:'eduzz', nome:'Eduzz', cat:'Afiliados e infoprodutos', icon:'tag', co:'blue', desc:'Vendas e comissões de infoprodutos', contas:[] },
  { id:'kiwify', nome:'Kiwify', cat:'Afiliados e infoprodutos', icon:'tag', co:'violet', desc:'Vendas e comissões de infoprodutos', contas:[] },
  { id:'lomadee', nome:'Lomadee', cat:'Afiliados e infoprodutos', icon:'tag', co:'amber', desc:'Rede de afiliados multi-loja', contas:[] },
  { id:'awin', nome:'Awin', cat:'Afiliados e infoprodutos', icon:'tag', co:'gold', desc:'Rede de afiliados internacional', contas:[] },
  { id:'veo', nome:'Veo (Gemini)', cat:'IA de vídeo', icon:'sparkles', co:'violet', desc:'Geração de vídeo por IA para o Video Seller', contas:[] },
  { id:'capcut', nome:'CapCut', cat:'IA de vídeo', icon:'bolt', co:'green', desc:'Edição e templates de vídeo', contas:[] },
];

const Integracoes = () => {
  const [modal, setModal] = useState(null); // plataforma id em conexão
  const [handle, setHandle] = useState('');
  const [, setTick] = useState(0);
  const bump = () => setTick(t => t + 1);
  const cats = [...new Set(DATA.integracoes.map(p => p.cat))];

  const conectar = () => {
    const plat = DATA.integracoes.find(p => p.id === modal);
    if (!plat || !handle.trim()) return;
    plat.contas.push({ id: 'a' + Date.now(), handle: handle.trim(), status: 'conectada', desde: 'agora' });
    setHandle('');
    setModal(null);
    bump();
    window.persistDATA && window.persistDATA();
    window.toast && window.toast(`${plat.nome}: conta conectada`);
  };
  const remover = (plat, contaId) => {
    const c = plat.contas.find(x => x.id === contaId);
    if (!window.confirm(`Desconectar ${c?.handle} de ${plat.nome}?`)) return;
    plat.contas = plat.contas.filter(x => x.id !== contaId);
    bump();
    window.persistDATA && window.persistDATA();
  };

  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 0% 0%, var(--violet-soft), transparent 60%), var(--surface)' }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--violet-soft)', color: 'var(--violet)' }}><Icon name="plug" size={22} /></div>
          <div>
            <h2 style={{ fontSize: 18 }}>Integrações</h2>
            <p className="muted" style={{ fontSize: 13 }}>Conecte redes sociais, marketplaces e ferramentas de IA · várias contas por plataforma</p>
          </div>
        </div>
      </div>

      {cats.map(cat => (
        <div key={cat} className="col" style={{ gap: 12 }}>
          <div className="dim" style={{ fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 4 }}>{cat}</div>
          <div className="grid g3">
            {DATA.integracoes.filter(p => p.cat === cat).map(p => (
              <div key={p.id} className="card">
                <div className="row spread">
                  <div className="ico" style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: `var(--${p.co}-soft)`, color: `var(--${p.co})` }}><Icon name={p.icon} size={20} /></div>
                  {p.contas.length > 0
                    ? <span className="badge green" style={{ padding: '2px 8px' }}><span className="dot" />{p.contas.length} {p.contas.length === 1 ? 'conta' : 'contas'}</span>
                    : <span className="badge gray" style={{ padding: '2px 8px' }}>Não conectado</span>}
                </div>
                <div style={{ fontWeight: 600, fontSize: 15, marginTop: 12 }}>{p.nome}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{p.desc}</div>

                {p.contas.length > 0 && (
                  <div className="col" style={{ gap: 6, marginTop: 12 }}>
                    {p.contas.map(c => (
                      <div key={c.id} className="row spread" style={{ padding: '7px 10px', borderRadius: 9, background: 'oklch(1 0 0 / 0.03)', border: '1px solid var(--border-soft)' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.handle}</span>
                        <button className="btn btn-ghost btn-sm" style={{ padding: '3px 7px' }} onClick={() => remover(p, c.id)}><Icon name="x" size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}

                <button className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: 14 }} onClick={() => { setModal(p.id); setHandle(''); }}>
                  <Icon name="plus" size={14} />Adicionar conta
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <Modal open={!!modal} onClose={() => setModal(null)} icon="plug" iconColor="violet"
        title={modal ? `Conectar ${DATA.integracoes.find(p => p.id === modal)?.nome}` : ''}
        sub="Autorização simulada para esta demonstração"
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={conectar}><Icon name="check" size={13} />Conectar conta</button></>}>
        <label className="label">@handle ou nome da loja</label>
        <input className="input" value={handle} onChange={e => setHandle(e.target.value)} placeholder="@minhaconta" autoFocus />
        <div className="row" style={{ gap: 8, marginTop: 14, padding: '9px 11px', borderRadius: 10, background: 'var(--violet-soft)', border: '1px solid oklch(0.68 0.195 295 / 0.25)' }}>
          <Icon name="shield" size={14} style={{ color: 'var(--violet)', flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: 'var(--violet)' }}>Você pode conectar quantas contas quiser nesta plataforma.</span>
        </div>
      </Modal>
    </div>
  );
};

const Simple = ({ icon, color, title, desc, children }) => (
  <div className="content-inner fade-in">
    <div className="card" style={{ background: `radial-gradient(600px 200px at 0% 0%, var(--${color}-soft), transparent 60%), var(--surface)` }}>
      <div className="row" style={{ gap: 12 }}>
        <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: `var(--${color}-soft)`, color: `var(--${color})` }}><Icon name={icon} size={22} /></div>
        <div><h2 style={{ fontSize: 18 }}>{title}</h2><p className="muted" style={{ fontSize: 13 }}>{desc}</p></div>
      </div>
    </div>
    {children}
  </div>
);

const Monetizacao = () => (
  <Simple icon="dollar" color="green" title="Monetização" desc="Receita por plataforma, produto e série">
    <div className="grid g4">
      <StatCard icon="dollar" color="green" value="R$ 2.840" label="Receita do mês" trend="+31%" trendDir="up" />
      <StatCard icon="bag" color="gold" value="112" label="Vendas" trend="+18%" trendDir="up" />
      <StatCard icon="link" color="blue" value="2,9%" label="Conversão clique→venda" trend="+0,4pp" trendDir="up" />
      <StatCard icon="star" color="violet" value="R$ 25,40" label="Ticket médio" />
    </div>
    <div className="card flush">
      <table className="tbl">
        <thead><tr><th>Plataforma</th><th className="right">Cliques</th><th className="right">Vendas</th><th className="right">Comissão média</th><th className="right">Receita</th></tr></thead>
        <tbody>
          {[['Shopee',1820,58,'18%','R$ 1.240','amber'],['Mercado Livre',940,31,'12%','R$ 820','gold'],['Amazon',620,15,'9%','R$ 410','blue'],['TikTok Shop',440,8,'15%','R$ 370','pink']].map((r,i) => (
            <tr key={i}><td><span className={`badge ${r[5]}`} style={{ padding: '2px 8px' }}>{r[0]}</span></td><td className="right mono">{r[1]}</td><td className="right mono">{r[2]}</td><td className="right mono">{r[3]}</td><td className="right mono" style={{ color: 'var(--green)' }}>{r[4]}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  </Simple>
);

const WhatsApp = () => (
  <Simple icon="message" color="green" title="WhatsApp em Massa" desc="Disparo de achadinhos para listas e grupos">
    <div className="grid g2" style={{ gridTemplateColumns: '1fr 320px', alignItems: 'start' }}>
      <div className="card">
        <label className="label">Mensagem</label>
        <div className="textarea" style={{ minHeight: 120, lineHeight: 1.6 }}>🔥 Achadinho do dia: Organizador de Talheres Expansível por R$ 29,90!{'\n\n'}Cabe em qualquer gaveta e acaba com a bagunça 😍{'\n\n'}👉 Link: patrono.link/talheres</div>
        <div className="row" style={{ gap: 10, marginTop: 14 }}>
          <button className="btn btn-ghost btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="sparkles" size={14} />Gerar com IA</button>
          <button className="btn btn-ghost btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="image" size={14} />Anexar mídia</button>
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="message" size={14} />Disparar para 3 listas</button>
        </div>
      </div>
      <div className="card">
        <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Listas</div>
        {[['Clientes VIP',342,'green'],['Grupo Organiza Casa',198,'gold'],['Leads novos',1240,'violet']].map((l,i) => (
          <div key={i} className="row spread" style={{ padding: '10px 0', borderBottom: i < 2 ? '1px solid var(--border-soft)' : 'none' }}>
            <div className="row" style={{ gap: 9 }}><span className="dot badge" style={{ width: 8, height: 8, padding: 0, background: `var(--${l[2]})` }} /><span style={{ fontSize: 13, fontWeight: 500 }}>{l[0]}</span></div>
            <span className="dim mono" style={{ fontSize: 12 }}>{l[1]}</span>
          </div>
        ))}
      </div>
    </div>
  </Simple>
);

Object.assign(window, { Relatorios, Decisao, Integracoes, Monetizacao, WhatsApp });


/* ===== screens-admin.jsx ===== */
/* ============ Administração — Usuários ============ */
const Usuarios = () => {
  const [papel, setPapel] = useState('operador'); // papel do novo usuário
  const [uNome, setUNome] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [, setTick] = useState(0);
  const bump = () => { setTick(t => t + 1); window.persistDATA && window.persistDATA(); };
  const us = DATA.usuarios;
  const admins = us.filter(u => u.papel === 'admin').length;
  const ops = us.filter(u => u.papel === 'operador').length;

  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 220px at 0% 0%, var(--gold-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--gold-soft)', color: 'var(--gold)' }}><Icon name="shield" size={22} /></div>
            <div><h2 style={{ fontSize: 18 }}>Usuários &amp; permissões</h2><p className="muted" style={{ fontSize: 13 }}>Cadastre administradores e operadores · só admins veem esta área</p></div>
          </div>
          <span className="badge gold"><Icon name="shield" size={12} />Você é Administradora</span>
        </div>
      </div>

      <div className="grid g4">
        <StatCard icon="users" color="blue" value={us.length} label="Usuários no total" />
        <StatCard icon="shield" color="gold" value={admins} label="Administradores" />
        <StatCard icon="users" color="violet" value={ops} label="Operadores" />
        <StatCard icon="bell" color="amber" value={DATA.solicitacoes.length} label="Solicitações pendentes" />
      </div>

      <div className="grid g2" style={{ gridTemplateColumns: '1fr 340px', alignItems: 'start' }}>
        {/* Lista de usuários */}
        <div className="card flush">
          <div className="row spread" style={{ padding: '14px 20px' }}>
            <div className="card-title">Usuários ativos</div>
            <div className="chips"><div className="chip active">Todos</div><div className="chip">Admins</div><div className="chip">Operadores</div></div>
          </div>
          <table className="tbl">
            <thead><tr><th>Usuário</th><th>Função</th><th>Status</th><th>Último acesso</th><th className="right">Ações</th></tr></thead>
            <tbody>
              {us.map(u => {
                const pm = window.papelMap[u.papel];
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <div className="avatar" style={{ width: 32, height: 32, fontSize: 12, background: u.papel === 'admin' ? 'linear-gradient(140deg, var(--gold), var(--gold-2))' : 'linear-gradient(140deg, var(--violet), var(--violet-2))', color: u.papel === 'admin' ? 'oklch(0.2 0.02 70)' : 'white' }}>{u.nome[0]}</div>
                        <div style={{ minWidth: 0 }}>
                          <div className="row" style={{ gap: 6 }}><span style={{ fontWeight: 600 }}>{u.nome}</span>{u.voce && <span className="badge gray" style={{ padding: '1px 6px', fontSize: 10 }}>você</span>}</div>
                          <div className="dim" style={{ fontSize: 11.5 }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className={`badge ${pm.cls}`}><Icon name={pm.icon} size={11} />{pm.label}</span></td>
                    <td><Badge status={u.status} /></td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{u.acesso}</td>
                    <td className="right">
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" style={{ padding: '5px 8px' }} title="Mudar função" onClick={() => { u.papel = u.papel === 'admin' ? 'operador' : 'admin'; bump(); window.toast && window.toast('Função de ' + u.nome + ' atualizada'); }}><Icon name="refresh" size={13} /></button>
                        {!u.voce && <button className="btn btn-ghost btn-sm" style={{ padding: '5px 8px' }} title={u.status === 'bloqueado' ? 'Desbloquear' : 'Bloquear'} onClick={() => { u.status = u.status === 'bloqueado' ? 'ativo' : 'bloqueado'; bump(); window.toast && window.toast(u.nome + (u.status === 'bloqueado' ? ' bloqueado' : ' desbloqueado')); }}><Icon name={u.status === 'bloqueado' ? 'check' : 'pause'} size={13} /></button>}
                        {!u.voce && <button className="btn btn-danger btn-sm" style={{ padding: '5px 8px' }} onClick={() => { if (window.confirm(`Remover ${u.nome}?`)) { DATA.usuarios = DATA.usuarios.filter(x => x.id !== u.id); bump(); window.toast && window.toast(u.nome + ' removido'); } }} title="Remover"><Icon name="x" size={13} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Cadastrar novo */}
        <div className="card" style={{ position: 'sticky', top: 0 }}>
          <div className="row" style={{ gap: 9, marginBottom: 14 }}>
            <div className="ico" style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--gold-soft)', color: 'var(--gold)' }}><Icon name="plus" size={17} /></div>
            <div className="card-title">Cadastrar usuário</div>
          </div>
          <label className="label">Nome completo</label>
          <input className="input" value={uNome} onChange={e => setUNome(e.target.value)} placeholder="Nome da pessoa" />
          <label className="label" style={{ marginTop: 13 }}>Email</label>
          <input className="input" value={uEmail} onChange={e => setUEmail(e.target.value)} placeholder="email@grupopatrono.com.br" />
          <label className="label" style={{ marginTop: 13 }}>Função</label>
          <div className="col" style={{ gap: 8 }}>
            <div onClick={() => setPapel('operador')} style={{ cursor: 'pointer', padding: '11px 13px', borderRadius: 11, border: `1px solid ${papel==='operador'?'oklch(0.68 0.195 295 / 0.45)':'var(--border-soft)'}`, background: papel==='operador'?'var(--violet-soft)':'oklch(0 0 0 / 0.15)' }}>
              <div className="row spread"><div className="row" style={{ gap: 8 }}><Icon name="users" size={15} style={{ color: 'var(--violet)' }} /><span style={{ fontWeight: 600, fontSize: 13.5 }}>Operador</span></div>{papel==='operador' && <Icon name="checkCircle" size={15} style={{ color: 'var(--violet)' }} />}</div>
              <p className="dim" style={{ fontSize: 11.5, marginTop: 5 }}>Cria, agenda e gerencia conteúdo. Não gerencia usuários nem integrações.</p>
            </div>
            <div onClick={() => setPapel('admin')} style={{ cursor: 'pointer', padding: '11px 13px', borderRadius: 11, border: `1px solid ${papel==='admin'?'oklch(0.84 0.155 86 / 0.45)':'var(--border-soft)'}`, background: papel==='admin'?'var(--gold-soft)':'oklch(0 0 0 / 0.15)' }}>
              <div className="row spread"><div className="row" style={{ gap: 8 }}><Icon name="shield" size={15} style={{ color: 'var(--gold)' }} /><span style={{ fontWeight: 600, fontSize: 13.5 }}>Administrador</span></div>{papel==='admin' && <Icon name="checkCircle" size={15} style={{ color: 'var(--gold)' }} />}</div>
              <p className="dim" style={{ fontSize: 11.5, marginTop: 5 }}>Acesso total: usuários, integrações, aprovações e configurações.</p>
            </div>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={() => {
            if (!uNome.trim() || !uEmail.trim()) { window.toast && window.toast('Preencha nome e email'); return; }
            DATA.usuarios.push({ id: 'u' + Date.now(), nome: uNome.trim(), email: uEmail.trim(), papel, status: 'ativo', acesso: 'convite enviado' });
            setUNome(''); setUEmail('');
            bump();
            window.toast && window.toast('Convite enviado para ' + uEmail);
          }}><Icon name="plus" size={15} />Criar e enviar convite</button>
          <p className="dim" style={{ fontSize: 11, textAlign: 'center', marginTop: 10 }}>A pessoa recebe um email para definir a senha.</p>
        </div>
      </div>

      {/* Solicitações de cadastro */}
      {DATA.solicitacoes.length > 0 && (
        <div className="card" style={{ borderColor: 'oklch(0.80 0.15 70 / 0.3)' }}>
          <div className="row" style={{ gap: 9, marginBottom: 14 }}>
            <Icon name="bell" size={16} style={{ color: 'var(--amber)' }} />
            <div className="card-title" style={{ fontSize: 15 }}>Solicitações de cadastro</div>
            <span className="badge amber" style={{ marginLeft: 'auto' }}>{DATA.solicitacoes.length} aguardando</span>
          </div>
          <div className="col" style={{ gap: 10 }}>
            {DATA.solicitacoes.map(s => (
              <div key={s.id} className="row spread wrap" style={{ gap: 12, padding: '11px 13px', borderRadius: 11, background: 'oklch(0 0 0 / 0.2)', border: '1px solid var(--border-soft)' }}>
                <div className="row" style={{ gap: 10 }}>
                  <div className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>{s.nome[0]}</div>
                  <div>
                    <div className="row" style={{ gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{s.nome}</span>
                      {s.tipo === 'upgrade' && <span className="badge gold" style={{ padding: '1px 7px', fontSize: 9.5 }}><Icon name="arrow" size={10} />Upgrade de plano</span>}
                    </div>
                    <div className="dim" style={{ fontSize: 11.5 }}>{s.email} · {s.quando}</div>
                  </div>
                </div>
                {s.tipo === 'upgrade' ? (
                  <div className="row wrap" style={{ gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => { DATA.solicitacoes = DATA.solicitacoes.filter(x => x.id !== s.id); bump(); window.toast && window.toast('Marcado como resolvido'); }}><Icon name="check" size={13} />Marcar resolvido</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { DATA.solicitacoes = DATA.solicitacoes.filter(x => x.id !== s.id); bump(); }}><Icon name="x" size={13} />Descartar</button>
                  </div>
                ) : (
                <div className="row wrap" style={{ gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => { DATA.usuarios.push({ id: 'u' + Date.now(), nome: s.nome, email: s.email, papel: 'operador', status: 'ativo', acesso: 'agora' }); DATA.solicitacoes = DATA.solicitacoes.filter(x => x.id !== s.id); bump(); window.toast && window.toast(s.nome + ' aprovado como Operador'); }}><Icon name="users" size={13} />Aprovar como Operador</button>
                  <button className="btn btn-primary btn-sm" onClick={() => { DATA.usuarios.push({ id: 'u' + Date.now(), nome: s.nome, email: s.email, papel: 'admin', status: 'ativo', acesso: 'agora' }); DATA.solicitacoes = DATA.solicitacoes.filter(x => x.id !== s.id); bump(); window.toast && window.toast(s.nome + ' aprovado como Admin'); }}><Icon name="shield" size={13} />Como Admin</button>
                  <button className="btn btn-danger btn-sm" onClick={() => { DATA.solicitacoes = DATA.solicitacoes.filter(x => x.id !== s.id); bump(); window.toast && window.toast(s.nome + ' recusado'); }}><Icon name="x" size={13} />Recusar</button>
                </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

window.Usuarios = Usuarios;

/* ============ Vendedores (admin) ============ */
const PLANOS_VENDEDOR = [
  { nome: 'Básico', mensalidade: 47, limiteConvites: 2 },
  { nome: 'Pro', mensalidade: 97, limiteConvites: 5 },
  { nome: 'Enterprise', mensalidade: 197, limiteConvites: 15 },
];
const custosTotal = (v) => (v.custos||[]).reduce((s,c)=>s+(Number(c.valor)||0),0) + (Number(v.custosExtras)||0);
const logFinanceiro = (tipo, texto) => { DATA.logsFinanceiros = DATA.logsFinanceiros || []; DATA.logsFinanceiros.push({ data: new Date().toLocaleDateString('pt-BR'), hora: new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}), tipo, texto, ts: Date.now() }); };
const Vendedores = () => {
  const [, setTick] = useState(0);
  const bump = () => { setTick(t => t + 1); window.persistDATA && window.persistDATA(); };
  const [modal, setModal] = useState(false);
  const [editVendId, setEditVendId] = useState(null);
  const [vNome, setVNome] = useState('');
  const [vMensal, setVMensal] = useState('');
  const [vLimite, setVLimite] = useState('3');
  const [vCustos, setVCustos] = useState('');
  const [vCustosLista, setVCustosLista] = useState([]);
  const [vPeriodo, setVPeriodo] = useState('mensal');
  const [vPlano, setVPlano] = useState(null);
  const [busca, setBusca] = useState('');
  const produtosDe = (v) => DATA.produtos.filter(p => p.donoId === v.id);
  const excluir = (v) => {
    if (!window.confirm(`Excluir vendedor "${v.nome}"? Os produtos dele ficam sem dono.`)) return;
    DATA.produtos.forEach(p => { if (p.donoId === v.id) p.donoId = null; });
    DATA.vendedores = DATA.vendedores.filter(x => x.id !== v.id);
    bump();
    window.toast && window.toast('Vendedor removido');
  };
  const receitaTotal = DATA.vendedores.reduce((s, v) => s + (Number(v.mensalidade) || 0), 0);
  const marcarMensalidade = (v) => { v.mensalidadePaga = !v.mensalidadePaga; if (v.mensalidadePaga) { v.proximoVencimento = Date.now() + 30*86400000; logFinanceiro('mensalidade', `Mensalidade de ${v.nome} marcada como paga (R$ ${v.mensalidade})`); } bump(); window.toast && window.toast(v.mensalidadePaga ? 'Mensalidade marcada como paga' : 'Mensalidade marcada como pendente'); };
  const abrirEdicaoPlano = (v) => { setEditVendId(v.id); setVNome(v.nome); setVMensal(String(v.mensalidade||'')); setVLimite(String(v.limiteConvites||'')); setVPlano(v.plano||null); setVCustos(String(v.custosExtras||'')); setVCustosLista(v.custos||[]); setVPeriodo(v.periodicidade||'mensal'); setModal(true); };
  const exportConsolidado = () => {
    const rows = [];
    DATA.vendedores.forEach(v => {
      const prods = produtosDe(v);
      const afiliados = DATA.creators.filter(c => c.convidadoPor === v.nome);
      if (afiliados.length === 0) { rows.push([v.nome, v.plano||'—', v.mensalidade||0, v.mensalidadePaga?'Em dia':'Pendente', prods.length, '—', '—', 0]); }
      afiliados.forEach(c => {
        const pago = (c.pagamentos||[]).reduce((s,pg)=>s+(pg.valor||0),0);
        const saldo = Math.max(0, creatorGanho(c) - pago);
        rows.push([v.nome, v.plano||'—', v.mensalidade||0, v.mensalidadePaga?'Em dia':'Pendente', prods.length, c.nome, c.recusado?'Recusou':c.conviteRespondido?'Aceito':'Aguardando', saldo]);
      });
    });
    window.exportCSV('relatorio-consolidado', ['Vendedor','Plano','Mensalidade','Status mensalidade','Produtos','Afiliado','Status convite','Saldo a pagar'], rows);
  };
  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 0% 0%, var(--gold-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--gold-soft)', color: 'var(--gold)' }}><Icon name="bag" size={22} /></div>
            <div><h2 style={{ fontSize: 18 }}>Vendedores</h2><p className="muted" style={{ fontSize: 13 }}>Quem cadastra e vende os produtos afiliados na plataforma</p></div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditVendId(null); setVNome(''); setVMensal(''); setVLimite('3'); setVPlano(null); setModal(true); }}><Icon name="plus" size={14} />Novo vendedor</button>
          <button className="btn btn-ghost btn-sm" onClick={() => window.exportCSV('vendedores', ['Nome','Produtos','Mensalidade','Limite de convites'], DATA.vendedores.map(v => [v.nome, produtosDe(v).length, v.mensalidade||0, v.limiteConvites||0]))}><Icon name="download" size={14} />Exportar CSV</button>
          <button className="btn btn-ghost btn-sm" onClick={exportConsolidado}><Icon name="download" size={14} />Relatório consolidado</button>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14, maxWidth: 320 }}>
          <div className="input" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="search" size={15} style={{ color: 'var(--text-dim)' }} />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar vendedor..." style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 13.5, width: '100%', fontFamily: 'var(--font-body)' }} />
          </div>
        </div>
      </div>

      <div className="grid g4">
        <StatCard icon="bag" color="gold" value={DATA.vendedores.length} label="Vendedores" />
        <StatCard icon="tag" color="violet" value={DATA.produtos.filter(p=>p.donoId).length} label="Produtos vinculados" />
        <StatCard icon="alert" color="amber" value={DATA.produtos.filter(p=>!p.donoId).length} label="Sem dono" />
        <StatCard icon="dollar" color="green" value={'R$ ' + receitaTotal.toLocaleString('pt-BR')} label="Receita de mensalidades" />
      </div>

      <div className="card flush">
        {(() => {
          const filtrados = DATA.vendedores.filter(v => !busca.trim() || v.nome.toLowerCase().includes(busca.toLowerCase()));
          if (filtrados.length === 0) return <div className="dim" style={{ padding: '24px 20px', fontSize: 13 }}>Nenhum vendedor encontrado.</div>;
          return (
        <table className="tbl">
          <thead><tr><th>Vendedor</th><th className="right">Produtos</th><th className="right">Mensalidade</th><th>Status</th><th className="right">Ações</th></tr></thead>
          <tbody>
            {filtrados.map(v => (
              <tr key={v.id}>
                <td><div className="row" style={{ gap: 10 }}><div className="avatar" style={{ width: 30, height: 30, fontSize: 12 }}>{v.nome[0]}</div><span style={{ fontWeight: 600 }}>{v.nome}</span></div></td>
                <td className="right mono">{produtosDe(v).length}</td>
                <td className="right mono">{v.mensalidade ? 'R$ ' + Number(v.mensalidade).toLocaleString('pt-BR') : '—'}</td>
                <td>{!v.mensalidade ? <span className="dim" style={{ fontSize: 12 }}>—</span> : (!v.mensalidadePaga && v.proximoVencimento && Date.now() > v.proximoVencimento) ? <span className="badge red" style={{ padding: '2px 8px' }}><Icon name="alert" size={11} />Atrasado</span> : v.mensalidadePaga ? <span className="badge green" style={{ padding: '2px 8px' }}><Icon name="check" size={11} />Em dia</span> : <span className="badge amber" style={{ padding: '2px 8px' }}><Icon name="clock" size={11} />Pendente</span>}</td>
                <td className="right">
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost btn-sm" style={{ padding: '5px 8px' }} onClick={() => abrirEdicaoPlano(v)}><Icon name="pencil" size={12} /></button>
                    {v.mensalidade > 0 && <button className="btn btn-ghost btn-sm" style={{ padding: '5px 8px' }} onClick={() => marcarMensalidade(v)}><Icon name="dollar" size={12} />{v.mensalidadePaga ? 'Marcar pendente' : 'Marcar pago'}</button>}
                    <button className="btn btn-danger btn-sm" style={{ padding: '5px 8px' }} onClick={() => excluir(v)}><Icon name="x" size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
          );
        })()}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} icon={editVendId ? 'pencil' : 'plus'} iconColor="gold"
        title={editVendId ? 'Editar vendedor' : 'Novo vendedor'} sub="Cadastro de dono de produto"
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(false)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={() => {
          if (!vNome.trim()) return;
          if (editVendId) {
            const v = DATA.vendedores.find(x => x.id === editVendId);
            const planoAntigo = v.plano;
            Object.assign(v, { nome: vNome.trim(), mensalidade: Number(vMensal) || 0, limiteConvites: Number(vLimite) || 0, plano: vPlano, custosExtras: Number(vCustos) || 0, custos: vCustosLista, periodicidade: vPeriodo });
            if (planoAntigo !== vPlano) {
              v.historicoPlano = v.historicoPlano || [];
              v.historicoPlano.push({ de: planoAntigo || '—', para: vPlano || '—', data: new Date().toLocaleDateString('pt-BR') });
            }
            window.toast && window.toast('Vendedor atualizado');
          } else {
            DATA.vendedores.push({ id: 'v' + Date.now(), nome: vNome.trim(), mensalidade: Number(vMensal) || 0, limiteConvites: Number(vLimite) || 0, plano: vPlano, custosExtras: Number(vCustos) || 0, custos: vCustosLista, periodicidade: vPeriodo, criadoEm: Date.now() });
            window.toast && window.toast('Vendedor cadastrado');
          }
          setModal(false); bump();
        }}><Icon name="check" size={13} />{editVendId ? 'Salvar' : 'Cadastrar'}</button></>}>
        <label className="label">Nome / loja</label>
        <input className="input" value={vNome} onChange={e => setVNome(e.target.value)} placeholder="Ex.: Marina Duarte" />
        <label className="label" style={{ marginTop: 14 }}>Plano</label>
        <div className="row" style={{ gap: 8 }}>
          {PLANOS_VENDEDOR.map(p => (
            <div key={p.nome} onClick={() => { setVPlano(p.nome); setVMensal(String(p.mensalidade)); setVLimite(String(p.limiteConvites)); }} style={{ flex: 1, cursor: 'pointer', padding: '9px 8px', borderRadius: 10, textAlign: 'center', border: `1px solid ${vPlano===p.nome?'oklch(0.84 0.155 86 / 0.5)':'var(--border-soft)'}`, background: vPlano===p.nome?'var(--gold-soft)':'transparent' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{p.nome}</div>
              <div className="dim" style={{ fontSize: 10.5 }}>R$ {p.mensalidade} · {p.limiteConvites} conv.</div>
            </div>
          ))}
        </div>
        <label className="label" style={{ marginTop: 14 }}>Mensalidade da plataforma (R$)</label>
        <input className="input" type="number" value={vMensal} onChange={e => { setVMensal(e.target.value); setVPlano(null); }} placeholder="Ex.: 97" />
        <label className="label" style={{ marginTop: 14 }}>Limite de convites de afiliado (plano)</label>
        <input className="input" type="number" value={vLimite} onChange={e => { setVLimite(e.target.value); setVPlano(null); }} placeholder="Ex.: 3" />
        <label className="label" style={{ marginTop: 14 }}>Periodicidade de cobrança</label>
        <div className="row" style={{ gap: 8 }}>
          {[['mensal','Mensal'],['anual','Anual (15% off)']].map(([k,l]) => (
            <div key={k} onClick={() => setVPeriodo(k)} style={{ flex: 1, cursor: 'pointer', padding: '9px 8px', borderRadius: 10, textAlign: 'center', fontSize: 12.5, fontWeight: 600, border: `1px solid ${vPeriodo===k?'oklch(0.84 0.155 86 / 0.5)':'var(--border-soft)'}`, background: vPeriodo===k?'var(--gold-soft)':'transparent' }}>{l}</div>
          ))}
        </div>
        {vPeriodo === 'anual' && Number(vMensal) > 0 && (
          <div className="dim" style={{ fontSize: 11.5, marginTop: 6 }}>Cobrança anual: R$ {Math.round(Number(vMensal)*12*0.85).toLocaleString('pt-BR')} (equivalente a R$ {Math.round(Number(vMensal)*0.85)}/mês)</div>
        )}
        <label className="label" style={{ marginTop: 14 }}>Custos extras mensais (R$) — frete, produção, ferramentas</label>
        <input className="input" type="number" value={vCustos} onChange={e => setVCustos(e.target.value)} placeholder="Ex.: 50" />
        <label className="label" style={{ marginTop: 14 }}>Custos por categoria (opcional)</label>
        <div className="col" style={{ gap: 6 }}>
          {vCustosLista.map((c, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <input className="input" value={c.categoria} onChange={e => setVCustosLista(lst => lst.map((x,xi)=>xi===i?{...x,categoria:e.target.value}:x))} placeholder="Categoria (ex.: Frete)" style={{ flex: 1 }} />
              <input className="input" type="number" value={c.valor} onChange={e => setVCustosLista(lst => lst.map((x,xi)=>xi===i?{...x,valor:e.target.value}:x))} placeholder="R$" style={{ width: 80 }} />
              <button className="btn btn-danger btn-sm" style={{ padding: '5px 8px' }} onClick={() => setVCustosLista(lst => lst.filter((_,xi)=>xi!==i))}><Icon name="x" size={12} /></button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setVCustosLista(lst => [...lst, { categoria:'', valor:'' }])}><Icon name="plus" size={12} />Adicionar categoria de custo</button>
        </div>
      </Modal>
    </div>
  );
};
window.Vendedores = Vendedores;

/* ============ Financeiro (admin) ============ */
const Financeiro = () => {
  const [, setTick] = useState(0);
  const bump = () => { setTick(t => t + 1); window.persistDATA && window.persistDATA(); };
  const [expandido, setExpandido] = useState(null);
  const marcarMensalidade = (v) => { v.mensalidadePaga = !v.mensalidadePaga; if (v.mensalidadePaga) { v.proximoVencimento = Date.now() + 30*86400000; logFinanceiro('mensalidade', `Mensalidade de ${v.nome} marcada como paga (R$ ${v.mensalidade})`); } bump(); window.toast && window.toast(v.mensalidadePaga ? 'Mensalidade marcada como paga' : 'Mensalidade marcada como pendente'); };
  const marcarComissao = (c) => { if (!c.termo) { window.toast && window.toast('Cessão de uso pendente — aprove antes de pagar'); return; } const pago = (c.pagamentos||[]).reduce((s,pg)=>s+(pg.valor||0),0); const saldo = creatorGanho(c) - pago; if (saldo <= 0) return; c.pagamentos = c.pagamentos || []; c.pagamentos.push({ data: new Date().toLocaleDateString('pt-BR'), valor: saldo }); logFinanceiro('comissao', `Comissão de ${c.nome} marcada como paga (R$ ${saldo})`); bump(); window.toast && window.toast('Comissão de ' + c.nome + ' marcada como paga'); };
  DATA.config = DATA.config || { taxaPlataforma: 5 };
  const [editTaxa, setEditTaxa] = useState(false);
  const [taxaInput, setTaxaInput] = useState(String(DATA.config.taxaPlataforma));
  const totalComissaoPagar = DATA.creators.reduce((s,c) => s + Math.max(0, creatorGanho(c) - (c.pagamentos||[]).reduce((s2,pg)=>s2+(pg.valor||0),0)), 0);
  const totalComissaoPaga = DATA.creators.reduce((s,c) => s + (c.pagamentos||[]).reduce((s2,pg)=>s2+(pg.valor||0),0), 0);
  const TAXA_PLATAFORMA_PCT = DATA.config.taxaPlataforma;
  const salvarTaxa = () => { const v = Math.min(30, Math.max(0, Number(taxaInput) || 0)); DATA.config.taxaPlataforma = v; setTaxaInput(String(v)); setEditTaxa(false); bump(); window.toast && window.toast('Taxa da plataforma atualizada'); };
  const receitaPlataforma = Math.round((totalComissaoPaga + totalComissaoPagar) * (TAXA_PLATAFORMA_PCT/100));
  const exportarExtrato = () => {
    const rows = [];
    DATA.vendedores.forEach(v => {
      const afiliados = DATA.creators.filter(c => c.convidadoPor === v.nome);
      const saldoAfiliados = afiliados.reduce((s,c) => s + Math.max(0, creatorGanho(c) - (c.pagamentos||[]).reduce((s2,pg)=>s2+(pg.valor||0),0)), 0);
      const totalPago = afiliados.reduce((s,c) => s + creatorGanho(c), 0);
      const taxa = Math.round(totalPago * (TAXA_PLATAFORMA_PCT/100));
      const receita = DATA.produtos.filter(p => p.donoId === v.id).reduce((s,p) => s + (parseFloat(String(p.comissao).replace(/[^0-9,.-]/g,'').replace(',','.')) || 0) * (p.vendas||0), 0);
      const margem = Math.round(receita - totalPago - taxa - custosTotal(v));
      rows.push([v.nome, v.mensalidade||0, v.mensalidadePaga?'Em dia':'Pendente', afiliados.length, saldoAfiliados, custosTotal(v), margem]);
    });
    window.exportCSV('extrato-financeiro', ['Vendedor','Mensalidade','Status mensalidade','Afiliados','Comissão a pagar dos afiliados','Custos extras','Margem estimada'], rows);
  };
  const mensalidadesEmDia = DATA.vendedores.filter(v => v.mensalidade > 0 && v.mensalidadePaga).reduce((s,v)=>s+Number(v.mensalidade),0);
  const mensalidadesPendentes = DATA.vendedores.filter(v => v.mensalidade > 0 && !v.mensalidadePaga).reduce((s,v)=>s+Number(v.mensalidade),0);
  const atrasados = DATA.vendedores.filter(v => v.mensalidade > 0 && !v.mensalidadePaga && v.proximoVencimento && Date.now() > v.proximoVencimento);
  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 0% 0%, var(--green-soft), transparent 60%), var(--surface)' }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--green-soft)', color: 'var(--green)' }}><Icon name="dollar" size={22} /></div>
          <div><h2 style={{ fontSize: 18 }}>Financeiro</h2><p className="muted" style={{ fontSize: 13 }}>Visão consolidada de mensalidades de vendedores e comissões de afiliados</p></div>
        </div>
      </div>

      <div className="grid g4">
        <StatCard icon="dollar" color="green" value={'R$ ' + mensalidadesEmDia.toLocaleString('pt-BR')} label="Mensalidades em dia" />
        <StatCard icon="clock" color="amber" value={'R$ ' + mensalidadesPendentes.toLocaleString('pt-BR')} label="Mensalidades pendentes" />
        <StatCard icon="check" color="blue" value={'R$ ' + totalComissaoPaga.toLocaleString('pt-BR')} label="Comissão já paga" />
        <StatCard icon="alert" color="red" value={'R$ ' + totalComissaoPagar.toLocaleString('pt-BR')} label="Comissão a pagar" />
      </div>

      <div className="card" style={{ background: 'var(--gold-soft)', borderColor: 'var(--gold)' }}>
        <div className="row spread">
          <div>
            <div className="dim" style={{ fontSize: 11.5 }}>RECEITA DA PLATAFORMA (TAXA DE {TAXA_PLATAFORMA_PCT}% SOBRE COMISSÕES)</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, marginTop: 6 }}>R$ {receitaPlataforma.toLocaleString('pt-BR')}</div>
          </div>
          {editTaxa ? (
            <div className="row" style={{ gap: 8 }}>
              <input className="input" type="number" min={0} max={30} value={taxaInput} onChange={e => setTaxaInput(e.target.value)} style={{ width: 80 }} />
              <button className="btn btn-primary btn-sm" onClick={salvarTaxa}><Icon name="check" size={13} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditTaxa(false)}><Icon name="x" size={13} /></button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => { setTaxaInput(String(TAXA_PLATAFORMA_PCT)); setEditTaxa(true); }}><Icon name="pencil" size={13} />Alterar taxa</button>
          )}
        </div>
      </div>

      {atrasados.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--red)', background: 'var(--red-soft)' }}>
          <div className="row" style={{ gap: 9, marginBottom: 10 }}><Icon name="alert" size={16} style={{ color: 'var(--red)' }} /><div className="card-title" style={{ fontSize: 14 }}>Vendedores com mensalidade atrasada</div></div>
          <div className="col" style={{ gap: 8 }}>
            {atrasados.map(v => (
              <div key={v.id} className="row spread" style={{ padding: '9px 11px', borderRadius: 10, background: 'oklch(1 0 0 / 0.04)' }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{v.nome}</span>
                <div className="row" style={{ gap: 8 }}>
                  <span className="mono" style={{ fontSize: 12.5, color: 'var(--red)' }}>R$ {Number(v.mensalidade).toLocaleString('pt-BR')}</span>
                  <button className="btn btn-primary btn-sm" style={{ padding: '3px 8px' }} onClick={() => marcarMensalidade(v)}><Icon name="check" size={11} />Marcar pago</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card flush">
        <div className="row spread" style={{ padding: '14px 20px' }}><div className="card-title">Extrato por vendedor</div><button className="btn btn-ghost btn-sm" onClick={exportarExtrato}><Icon name="download" size={13} />Exportar CSV</button></div>
        {DATA.vendedores.length === 0 ? <div className="dim" style={{ padding: '20px' }}>Nenhum vendedor cadastrado.</div> : (
        <table className="tbl">
          <thead><tr><th></th><th>Vendedor</th><th className="right">Mensalidade</th><th>Status</th><th className="right">Comissão a pagar dos afiliados</th><th className="right">Margem estimada</th></tr></thead>
          <tbody>
            {DATA.vendedores.map(v => {
              const afiliados = DATA.creators.filter(c => c.convidadoPor === v.nome);
              const saldoAfiliados = afiliados.reduce((s,c) => s + Math.max(0, creatorGanho(c) - (c.pagamentos||[]).reduce((s2,pg)=>s2+(pg.valor||0),0)), 0);
              const totalPagoAfiliados = afiliados.reduce((s,c) => s + creatorGanho(c), 0);
              const taxaSobreAfiliados = Math.round(totalPagoAfiliados * (TAXA_PLATAFORMA_PCT/100));
              const receitaComissaoProdutos = DATA.produtos.filter(p => p.donoId === v.id).reduce((s,p) => s + (parseFloat(String(p.comissao).replace(/[^0-9,.-]/g,'').replace(',','.')) || 0) * (p.vendas||0), 0);
              const margemEstimada = Math.round(receitaComissaoProdutos - totalPagoAfiliados - taxaSobreAfiliados - custosTotal(v));
              const open = expandido === v.id;
              return (
                <React.Fragment key={v.id}>
                <tr style={{ cursor: 'pointer' }} onClick={() => setExpandido(open ? null : v.id)}>
                  <td style={{ width: 24 }}><Icon name={open ? 'chevD' : 'chevR'} size={13} /></td>
                  <td style={{ fontWeight: 500 }}>{v.nome}</td>
                  <td className="right mono">{v.mensalidade ? 'R$ ' + Number(v.mensalidade).toLocaleString('pt-BR') : '—'}</td>
                  <td>{!v.mensalidade ? <span className="dim" style={{ fontSize: 12 }}>—</span> : v.mensalidadePaga ? <span className="badge green" style={{ padding: '2px 8px' }}>Em dia</span> : <span className="badge amber" style={{ padding: '2px 8px' }}>Pendente</span>}</td>
                  <td className="right mono" style={{ color: saldoAfiliados > 0 ? 'var(--red)' : 'var(--text-dim)' }}>R$ {saldoAfiliados.toLocaleString('pt-BR')}</td>
                  <td className="right mono" style={{ color: margemEstimada >= 0 ? 'var(--green)' : 'var(--red)' }}>{receitaComissaoProdutos === 0 && DATA.produtos.some(p=>p.donoId===v.id) ? <span className="dim" style={{ fontSize: 11.5 }}>Sem vendas ainda</span> : 'R$ ' + margemEstimada.toLocaleString('pt-BR')}</td>
                </tr>
                {open && (
                  <tr><td colSpan={5} style={{ padding: '0 20px 16px' }}>
                    <div className="col" style={{ gap: 8 }}>
                      {v.mensalidade > 0 && (
                        <div className="row spread" style={{ padding: '8px 10px', borderRadius: 9, background: 'oklch(1 0 0 / 0.03)' }}>
                          <span style={{ fontSize: 12.5 }}>Mensalidade do plano</span>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '3px 8px' }} onClick={(e) => { e.stopPropagation(); marcarMensalidade(v); }}><Icon name="dollar" size={11} />{v.mensalidadePaga ? 'Marcar pendente' : 'Marcar pago'}</button>
                        </div>
                      )}
                      {afiliados.length === 0 ? <span className="dim" style={{ fontSize: 12 }}>Nenhum afiliado convidado por este vendedor.</span> : afiliados.map(c => {
                        const pago = (c.pagamentos||[]).reduce((s,pg)=>s+(pg.valor||0),0);
                        const saldo = Math.max(0, creatorGanho(c) - pago);
                        return (
                          <div key={c.id} className="row spread" style={{ padding: '8px 10px', borderRadius: 9, background: 'oklch(1 0 0 / 0.03)' }}>
                            <span style={{ fontSize: 12.5 }}>{c.nome} · a pagar R$ {saldo.toLocaleString('pt-BR')}</span>
                            {saldo > 0 && <button className="btn btn-ghost btn-sm" style={{ padding: '3px 8px' }} onClick={(e) => { e.stopPropagation(); marcarComissao(c); }}><Icon name="check" size={11} />Marcar pago</button>}
                          </div>
                        );
                      })}
                    </div>
                  </td></tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        )}
      </div>

      <div className="card flush">
        <div className="row spread" style={{ padding: '14px 20px' }}><div className="card-title">Comissão pendente por afiliado</div></div>
        {DATA.creators.filter(c => Math.max(0, creatorGanho(c) - (c.pagamentos||[]).reduce((s,pg)=>s+(pg.valor||0),0)) > 0).length === 0 ? (
          <div className="dim" style={{ padding: '20px' }}>Nenhuma comissão pendente.</div>
        ) : (
        <table className="tbl">
          <thead><tr><th>Afiliado</th><th className="right">Entregas</th><th className="right">Cachê</th><th className="right">Já pago</th><th className="right">A pagar</th><th className="right">Ações</th></tr></thead>
          <tbody>
            {DATA.creators.map(c => {
              const pago = (c.pagamentos||[]).reduce((s,pg)=>s+(pg.valor||0),0);
              const saldo = Math.max(0, creatorGanho(c) - pago);
              if (saldo <= 0) return null;
              return (
                <tr key={c.id}><td style={{ fontWeight: 500 }}>{c.nome}</td><td className="right mono">{c.entregas}</td><td className="right mono">R$ {c.cache}</td><td className="right mono" style={{ color: 'var(--green)' }}>R$ {pago.toLocaleString('pt-BR')}</td><td className="right mono" style={{ color: 'var(--red)' }}>R$ {saldo.toLocaleString('pt-BR')}</td><td className="right"><button className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }} onClick={() => marcarComissao(c)}><Icon name="dollar" size={12} />Marcar pago</button></td></tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
};
window.Financeiro = Financeiro;

/* ============ Histórico Financeiro (admin) ============ */
const HistoricoFinanceiro = () => {
  const [filtro, setFiltro] = useState('todos');
  const [periodo, setPeriodo] = useState('tudo');
  const logs = [...(DATA.logsFinanceiros||[])].reverse();
  const tiposIcon = { mensalidade:'dollar', comissao:'check', reajuste:'users', custos:'alert' };
  const tiposLabel = { mensalidade:'Mensalidade', comissao:'Comissão', reajuste:'Reajuste em lote', custos:'Custos' };
  const limiteDias = periodo === '7d' ? 7 : periodo === '30d' ? 30 : null;
  const filtrados = logs
    .filter(l => filtro === 'todos' || l.tipo === filtro)
    .filter(l => !limiteDias || !l.ts || (Date.now() - l.ts) < limiteDias*86400000);
  const exportarHistorico = () => {
    window.exportCSV('historico-financeiro', ['Tipo','Descrição','Data','Hora'], filtrados.map(l => [tiposLabel[l.tipo]||l.tipo, l.texto, l.data, l.hora]));
  };
  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 0% 0%, var(--blue-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--blue-soft)', color: 'var(--blue)' }}><Icon name="clock" size={22} /></div>
            <div><h2 style={{ fontSize: 18 }}>Histórico Financeiro</h2><p className="muted" style={{ fontSize: 13 }}>Mensalidades pagas, comissões pagas, reajustes e custos — tudo num só lugar</p></div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={exportarHistorico}><Icon name="download" size={13} />Exportar CSV</button>
        </div>
        <div className="row spread wrap" style={{ gap: 12, marginTop: 16 }}>
          <div className="chips">
            {['todos','mensalidade','comissao','reajuste','custos'].map(t => (
              <div key={t} className={`chip ${filtro === t ? 'active' : ''}`} onClick={() => setFiltro(t)}>{t === 'todos' ? 'Todos' : tiposLabel[t]}</div>
            ))}
          </div>
          <div className="chips">
            {[['tudo','Tudo'],['7d','7 dias'],['30d','30 dias']].map(([k,l]) => (
              <div key={k} className={`chip ${periodo === k ? 'active' : ''}`} onClick={() => setPeriodo(k)}>{l}</div>
            ))}
          </div>
        </div>
      </div>

      <div className="card flush">
        {filtrados.length === 0 ? (
          <div className="dim" style={{ padding: '24px 20px', fontSize: 13 }}>Nenhuma ação financeira registrada ainda.</div>
        ) : (
        <table className="tbl">
          <thead><tr><th></th><th>Tipo</th><th>Descrição</th><th className="right">Quando</th></tr></thead>
          <tbody>
            {filtrados.map((l, i) => (
              <tr key={i}>
                <td style={{ width: 30 }}><div className="ico" style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--blue-soft)', color: 'var(--blue)' }}><Icon name={tiposIcon[l.tipo] || 'dollar'} size={13} /></div></td>
                <td><span className="badge blue" style={{ padding: '2px 8px' }}>{tiposLabel[l.tipo] || l.tipo}</span></td>
                <td style={{ fontSize: 13 }}>{l.texto}</td>
                <td className="right dim" style={{ fontSize: 12 }}>{l.data} {l.hora}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
};
window.HistoricoFinanceiro = HistoricoFinanceiro;


/* ===== screens-lucro-parts.jsx ===== */
/* ============ Painel de Lucro e Escala — helpers ============ */
const brl = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });

const ScoreRing = ({ score, size = 64 }) => {
  const f = window.scoreFaixa(score);
  const r = (size - 8) / 2, c = 2 * Math.PI * r;
  const col = `var(--${f.cls})`;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="oklch(0 0 0 / 0.3)" strokeWidth="6" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score/100)} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', flexDirection: 'column' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: size > 50 ? 20 : 15, color: col, lineHeight: 1 }}>{score}</span>
      </div>
    </div>
  );
};

/* ============ Drill-down de produto ============ */
const ProdutoDetalhe = ({ p, onClose }) => {
  const f = window.scoreFaixa(p.score);
  const rec = window.recTipoMap[p.recTipo];
  const metric = (label, val, color) => (
    <div className="col" style={{ gap: 2, padding: '11px 13px', borderRadius: 11, background: 'oklch(0 0 0 / 0.2)', border: '1px solid var(--border-soft)' }}>
      <span className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: color || 'var(--text)' }}>{val}</span>
    </div>
  );
  return ReactDOM.createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'oklch(0 0 0 / 0.6)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 'min(680px, 100%)', maxHeight: '88vh', overflowY: 'auto', padding: 0 }}>
        <div className="row spread" style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-soft)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <div className="row" style={{ gap: 12 }}>
            <ScoreRing score={p.score} size={48} />
            <div>
              <h2 style={{ fontSize: 17 }}>{p.nome}</h2>
              <div className="row" style={{ gap: 7, marginTop: 3 }}>
                <span className={`badge ${platColor[p.plat]||'gray'}`} style={{ padding: '2px 8px' }}>{p.plat}</span>
                <span className="badge gray" style={{ padding: '2px 8px' }}>{p.cat}</span>
                <span className={`badge ${f.cls}`} style={{ padding: '2px 8px' }}>{f.label}</span>
              </div>
            </div>
          </div>
          <button className="btn btn-icon btn-ghost" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div style={{ padding: 22 }}>
          <div className="grid g4" style={{ gap: 10 }}>
            {metric('Preço', brl(p.preco))}
            {metric('Comissão', p.pct + '%')}
            {metric('Cliques', p.cliques.toLocaleString('pt-BR'))}
            {metric('Vendas', p.vendas)}
            {metric('Comissão ganha', brl(p.comissao), 'var(--blue)')}
            {metric('Custos', brl(p.custos), 'var(--amber)')}
            {metric('Lucro líquido', brl(p.lucro), p.lucro >= 0 ? 'var(--green)' : 'var(--red)')}
            {metric('Margem', p.margem + '%', p.margem >= 0 ? 'var(--green)' : 'var(--red)')}
          </div>
          <div className="grid g3" style={{ gap: 10, marginTop: 10 }}>
            {metric('Conversão', p.conversao + '%')}
            {metric('Vídeos', p.videos)}
            {metric('Cresc. 7d', (p.cresc7d >= 0 ? '+' : '') + p.cresc7d + '%', p.cresc7d >= 0 ? 'var(--green)' : 'var(--red)')}
          </div>

          <div style={{ marginTop: 18, padding: 16, borderRadius: 13, background: `var(--${rec.cls}-soft)`, border: `1px solid oklch(0.7 0.1 285 / 0.2)` }}>
            <div className="row spread" style={{ marginBottom: 7 }}>
              <div className="row" style={{ gap: 7 }}><Icon name="brain" size={15} style={{ color: `var(--${rec.cls})` }} /><span style={{ fontSize: 12.5, fontWeight: 700, color: `var(--${rec.cls})` }}>Recomendação da IA</span></div>
              <span className={`badge ${rec.cls}`}><Icon name={rec.icon} size={11} />{rec.label}</span>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--text)' }}>{p.rec}</p>
            <div className="row" style={{ gap: 9, marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="check" size={13} />Aprovar ação</button>
              <button className="btn btn-ghost btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="sparkles" size={13} />Gerar 5 variações</button>
              <button className="btn btn-ghost btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="x" size={13} />Ignorar</button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

window.brl = brl;
window.ScoreRing = ScoreRing;
window.ProdutoDetalhe = ProdutoDetalhe;


/* ===== screens-lucro.jsx ===== */
/* ============ Painel de Lucro e Escala — tela ============ */
const PERIODOS = ['Hoje','7 dias','15 dias','30 dias','Mês atual','Mês anterior','Personalizado'];

const Lucro = () => {
  const L = DATA.lucro;
  const R = L.resumo;
  const [periodo, setPeriodo] = useState('Mês atual');
  const [sel, setSel] = useState(null);
  const maxLucro = L.plataformas.length ? Math.max(...L.plataformas.map(p => p.lucro)) : 0;

  const big = (label, val, sub, color, icon) => (
    <div className="stat-card">
      <div className="row spread">
        <div className="ico" style={{ background: `var(--${color}-soft)`, color: `var(--${color})`, marginBottom: 0 }}><Icon name={icon} /></div>
      </div>
      <div className="stat-value" style={{ marginTop: 14, color: color === 'green' ? 'var(--green)' : undefined }}>{val}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>{sub}</div>}
    </div>
  );

  return (
    <div className="content-inner fade-in">
      {sel && <ProdutoDetalhe p={sel} onClose={() => setSel(null)} />}

      {/* Filtro de período */}
      <div className="row spread wrap" style={{ gap: 12 }}>
        <div className="chips">{PERIODOS.map(p => <div key={p} className={`chip ${periodo === p ? 'active' : ''}`} onClick={() => setPeriodo(p)}>{p}</div>)}</div>
        <button className="btn btn-ghost btn-sm" onClick={() => window.exportCSV('lucro-produtos', ['Produto','Plataforma','Categoria','Preço','Vendas','Comissão','Custos','Lucro','Margem','Score'], L.produtos.map(p => [p.nome,p.plat,p.cat,p.preco,p.vendas,p.comissao,p.custos,p.lucro,p.margem,p.score]))}><Icon name="download" size={14} />Exportar CSV</button>
      </div>

      {/* Respostas rápidas — 4 cards de impacto */}
      <div className="grid g4">
        <div className="goal-card" style={{ padding: 20, borderRadius: 16 }}>
          <div className="row" style={{ gap: 7 }}><Icon name="dollar" size={15} style={{ color: 'var(--gold)' }} /><span className="dim" style={{ fontSize: 11.5, letterSpacing: '0.04em' }}>LUCRO LÍQUIDO · {periodo.toUpperCase()}</span></div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 36, letterSpacing: '-0.02em', marginTop: 10, color: 'var(--green)' }}>{brl(R.lucroLiquido)}</div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}><span className="badge green" style={{ padding: '2px 8px' }}><Icon name="trend" size={11} />margem {R.margem}%</span><span className="dim" style={{ fontSize: 11.5 }}>de {brl(R.comissao)} em comissão</span></div>
        </div>
        {big('Plataforma mais lucrativa', 'Shopee', brl(820) + ' de lucro', 'amber', 'star')}
        {big('Produto mais escalável', 'Cabide Mágico', 'score 92 · campeão', 'violet', 'rocket')}
        {big('Previsão próx. 30 dias', brl(R.previsao30d), 'no ritmo atual', 'blue', 'chart')}
      </div>

      {/* Resumo financeiro completo */}
      <div className="card">
        <div className="card-head"><Icon name="dollar" size={16} style={{ color: 'var(--gold)' }} /><div className="card-title">Resumo financeiro · {periodo}</div></div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: 'var(--border-soft)', borderRadius: 12, overflow: 'hidden' }}>
          {[
            ['Receita bruta', brl(R.receitaBruta), 'text'],
            ['Comissão', brl(R.comissao), 'blue'],
            ['Custos', brl(R.custos), 'amber'],
            ['Lucro líquido', brl(R.lucroLiquido), 'green'],
            ['Margem', R.margem + '%', 'green'],
            ['Ticket médio', brl(R.ticketMedio), 'text'],
            ['Vendas', R.vendas, 'text'],
            ['Cliques', R.cliques.toLocaleString('pt-BR'), 'text'],
            ['Conversão', R.conversao + '%', 'text'],
            ['Receita / vídeo', brl(R.receitaPorVideo), 'text'],
            ['Lucro / vídeo', brl(R.lucroPorVideo), 'green'],
            ['Prev. 30 dias', brl(R.previsao30d), 'blue'],
          ].map(([l, v, c]) => (
            <div key={l} style={{ background: 'var(--surface)', padding: '14px 13px' }}>
              <div className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{l}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginTop: 5, color: c === 'text' ? 'var(--text)' : `var(--${c})` }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Lucro por plataforma */}
      <div className="card flush">
        <div className="row spread" style={{ padding: '16px 20px' }}>
          <div className="card-title">Lucro por plataforma</div>
          <span className="dim" style={{ fontSize: 12 }}>clique para ver detalhe</span>
        </div>
        <table className="tbl">
          <thead><tr><th>Plataforma</th><th className="right">Prod.</th><th className="right">Vídeos</th><th className="right">Cliques</th><th className="right">Vendas</th><th className="right">Comissão</th><th className="right">Custos</th><th className="right">Lucro</th><th className="right">Conv.</th><th>Lucro</th></tr></thead>
          <tbody>
            {L.plataformas.map(p => (
              <tr key={p.nome} style={{ cursor: 'pointer' }}>
                <td><span className={`badge ${p.cor}`} style={{ padding: '2px 9px' }}>{p.nome}</span></td>
                <td className="right mono">{p.produtos}</td>
                <td className="right mono">{p.videos}</td>
                <td className="right mono">{p.cliques.toLocaleString('pt-BR')}</td>
                <td className="right mono">{p.vendas}</td>
                <td className="right mono" style={{ color: 'var(--blue)' }}>{brl(p.comissao)}</td>
                <td className="right mono" style={{ color: 'var(--amber)' }}>{brl(p.custos)}</td>
                <td className="right mono" style={{ color: 'var(--green)', fontWeight: 600 }}>{brl(p.lucro)}</td>
                <td className="right mono">{p.conversao}%</td>
                <td style={{ minWidth: 90 }}><div className="bar green" style={{ height: 7 }}><i style={{ width: (p.lucro/maxLucro*100) + '%' }} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Ranking + Score de escala */}
      <div className="grid g2" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
        <div className="card flush">
          <div className="row spread" style={{ padding: '16px 20px' }}>
            <div className="card-title">Ranking por Score de Escala</div>
            <span className="badge gray"><Icon name="brain" size={11} />0–100</span>
          </div>
          <div className="col" style={{ padding: '0 20px 16px', gap: 10 }}>
            {[...L.produtos].sort((a,b) => b.score - a.score).map((p, i) => {
              const f = window.scoreFaixa(p.score);
              return (
                <div key={p.nome} className="row" style={{ gap: 13, padding: '11px 13px', borderRadius: 12, background: 'oklch(0 0 0 / 0.18)', border: '1px solid var(--border-soft)', cursor: 'pointer' }} onClick={() => setSel(p)}>
                  <span className="dim mono" style={{ fontSize: 13, width: 14 }}>{i+1}</span>
                  <ScoreRing score={p.score} size={46} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nome}</div>
                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
                      <span className={`badge ${f.cls}`} style={{ padding: '1px 7px', fontSize: 10.5 }}>{f.label}</span>
                      <span className="dim" style={{ fontSize: 11.5 }}>{brl(p.lucro)} lucro · {p.conversao}%</span>
                    </div>
                  </div>
                  <Icon name="chevR" size={15} style={{ color: 'var(--text-dim)' }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Faixas do score + custos */}
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Faixas do Score de Escala</div>
            <div className="col" style={{ gap: 9 }}>
              {[['81–100','Campeão · escalar já','gold'],['61–80','Promissor','blue'],['31–60','Testar mais','amber'],['0–30','Não escalar','red']].map(([r,l,c]) => (
                <div key={r} className="row spread" style={{ padding: '8px 11px', borderRadius: 10, background: `var(--${c}-soft)`, border: `1px solid oklch(0.7 0.12 285 / 0.15)` }}>
                  <div className="row" style={{ gap: 8 }}><span className="dot badge" style={{ width: 8, height: 8, padding: 0, background: `var(--${c})` }} /><span style={{ fontSize: 12.5, fontWeight: 600 }}>{l}</span></div>
                  <span className="mono dim" style={{ fontSize: 11.5 }}>{r}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card flush">
            <div className="row spread" style={{ padding: '14px 18px' }}><div className="card-title" style={{ fontSize: 14 }}>Custos do período</div><button className="btn btn-ghost btn-sm" style={{ padding: '4px 9px' }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="plus" size={13} /></button></div>
            <table className="tbl"><tbody>
              {L.custos.map((c, i) => (
                <tr key={i}><td style={{ fontSize: 12.5, fontWeight: 500 }}>{c.tipo}<div className="dim" style={{ fontSize: 11 }}>{c.vinculo}</div></td><td className="right mono" style={{ color: 'var(--amber)' }}>{brl(c.valor)}</td></tr>
              ))}
              <tr><td style={{ fontWeight: 700 }}>Total</td><td className="right mono" style={{ fontWeight: 700, color: 'var(--amber)' }}>{brl(L.custos.reduce((s,c)=>s+c.valor,0))}</td></tr>
            </tbody></table>
          </div>
        </div>
      </div>

      {/* Recomendações da IA */}
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 100% 0%, var(--violet-soft), transparent 60%), var(--surface)' }}>
        <div className="card-head"><Icon name="brain" size={16} style={{ color: 'var(--violet)' }} /><div className="card-title">Recomendações da IA</div><span className="badge violet" style={{ marginLeft: 'auto' }}>{L.recomendacoes.length} · pedem sua aprovação</span></div>
        <div className="col" style={{ gap: 10 }}>
          {L.recomendacoes.map((r, i) => {
            const m = window.recTipoMap[r.tipo]; const rk = window.riscoMap[r.risco];
            return (
              <div key={i} className="row spread wrap" style={{ gap: 12, padding: '12px 14px', borderRadius: 12, background: 'oklch(0 0 0 / 0.2)', border: `1px solid ${r.risco==='vermelho'?'oklch(0.70 0.19 22 / 0.3)':'var(--border-soft)'}` }}>
                <div className="row" style={{ gap: 11, minWidth: 0, flex: 1 }}>
                  <div className="ico" style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0, background: `var(--${m.cls}-soft)`, color: `var(--${m.cls})` }}><Icon name={m.icon} size={15} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6, marginBottom: 3 }}><span className={`badge ${m.cls}`} style={{ padding: '1px 7px', fontSize: 10 }}>{m.label}</span><span className="dim" style={{ fontSize: 11 }}>{r.alvo}</span></div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{r.txt}</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 7, flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" style={{ padding: '5px 9px' }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="x" size={13} /></button>
                  <button className="btn btn-primary btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="check" size={13} />Aprovar</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Alertas + Banco de vendas */}
      <div className="grid g2" style={{ gridTemplateColumns: '0.85fr 1.15fr', alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><Icon name="bell" size={16} style={{ color: 'var(--amber)' }} /><div className="card-title" style={{ fontSize: 14 }}>Alertas automáticos</div></div>
          <div className="col" style={{ gap: 8 }}>
            {L.alertas.map((a, i) => (
              <div key={i} className="row" style={{ gap: 10, padding: '9px 11px', borderRadius: 10, background: `var(--${a.cls}-soft)` }}>
                <Icon name={a.icon} size={15} style={{ color: `var(--${a.cls})`, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{a.txt}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card flush">
          <div className="row spread" style={{ padding: '14px 18px' }}><div className="card-title" style={{ fontSize: 14 }}>Banco de vendas</div><button className="btn btn-ghost btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="plus" size={13} />Registrar venda</button></div>
          <table className="tbl">
            <thead><tr><th>Data</th><th>Produto</th><th>Plat.</th><th className="right">Comissão</th><th className="right">Status</th></tr></thead>
            <tbody>
              {L.vendas.map((v, i) => {
                const st = window.vendaStatusMap[v.status];
                return (
                  <tr key={i}>
                    <td className="mono" style={{ fontSize: 12 }}>{v.data}</td>
                    <td style={{ fontSize: 12.5, fontWeight: 500, maxWidth: 150, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.produto}</td>
                    <td><span className={`badge ${platColor[v.plat]||'gray'}`} style={{ padding: '1px 7px', fontSize: 10.5 }}>{v.plat}</span></td>
                    <td className="right mono" style={{ color: 'var(--blue)' }}>{brl(v.comissao)}</td>
                    <td className="right"><span className={`badge ${st.cls}`} style={{ padding: '1px 8px' }}>{st.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

window.Lucro = Lucro;


/* ===== screens-ops.jsx ===== */
/* ============ Banco de Conteúdos ============ */
const Conteudos = ({ go }) => {
  const [fmt, setFmt] = useState('Todos');
  const items = [
    { p:'Talheres Expansível', s:'Achadinhos de cozinha', rede:'TikTok', st:'aprovado', tipo:'video' },
    { p:'Cabide Mágico', s:'Guarda-roupa inteligente', rede:'Reels', st:'aguardando', tipo:'video' },
    { p:'5 achadinhos de geladeira', s:'Antes e depois', rede:'Instagram', st:'aprovado', tipo:'carrossel', slides:5 },
    { p:'Potes Geladeira', s:'Antes e depois', rede:'TikTok', st:'postado', tipo:'video' },
    { p:'Banheiro: 4 soluções', s:'Banheiro pequeno', rede:'Instagram', st:'campeao', tipo:'carrossel', slides:4 },
    { p:'Nicho de Canto', s:'Banheiro pequeno', rede:'TikTok', st:'roteiro', tipo:'video' },
    { p:'Divisória de Gaveta', s:'Bobos que resolvem', rede:'Reels', st:'campeao', tipo:'video' },
    { p:'Guarda-roupa: passo a passo', s:'Guarda-roupa inteligente', rede:'Instagram', st:'aguardando', tipo:'carrossel', slides:6 },
    { p:'Varal Retrátil', s:'Lavanderia funcional', rede:'Facebook', st:'ideia', tipo:'video' },
    { p:'Organizador Suspenso', s:'Casa sem gastar', rede:'TikTok', st:'agendado', tipo:'video' },
    { p:'Despensa dos sonhos', s:'Despensa dos sonhos', rede:'Instagram', st:'aprovado', tipo:'carrossel', slides:5 },
    { p:'Potes Geladeira', s:'3 que valem a pena', rede:'TikTok', st:'aprovado', tipo:'video' },
  ];
  const filtered = fmt === 'Vídeos' ? items.filter(i => i.tipo === 'video') : fmt === 'Carrosséis' ? items.filter(i => i.tipo === 'carrossel') : items;
  return (
    <div className="content-inner fade-in">
      <div className="row spread wrap" style={{ gap: 12 }}>
        <div className="chips">{['Todos','Vídeos','Carrosséis'].map((c) => <div key={c} className={`chip ${fmt===c?'active':''}`} onClick={() => setFmt(c)}>{c}</div>)}</div>
        <button className="btn btn-primary btn-sm" onClick={() => go('gerar')}><Icon name="sparkles" size={14} />Gerar conteúdo</button>
      </div>
      <div className="grid g4">
        {filtered.map((it, i) => (
          <div key={i} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {it.tipo === 'carrossel'
              ? <CarouselPreview w="100%" slides={it.slides} label={`${it.p}\n${it.rede}`} badge={<Badge status={it.st} />} />
              : <PhonePreview w="100%" label={`${it.p}\n${it.rede}`} badge={<Badge status={it.st} />} />}
            <div style={{ padding: '12px 13px' }}>
              <div className="row" style={{ gap: 6, marginBottom: 3 }}>
                <span className={`badge ${it.tipo === 'carrossel' ? 'violet' : 'gray'}`} style={{ padding: '1px 7px', fontSize: 9.5 }}><Icon name={it.tipo === 'carrossel' ? 'layers' : 'video'} size={9} />{it.tipo === 'carrossel' ? `Carrossel · ${it.slides}` : 'Vídeo'}</span>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.p}</div>
              <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{it.s}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ============ Aprovar Agora ============ */
const Aprovacao = () => {
  const [exp, setExp] = useState('a1');
  const [, setTick] = useState(0);
  const bump = () => { setTick(t => t + 1); window.persistDATA && window.persistDATA(); };
  const aprovar = (a) => { DATA.aprovacoes = DATA.aprovacoes.filter(x => x.id !== a.id); DATA.calendario.push({ h: 'agora', produto: a.produto, rede: a.rede, serie: a.estilo, status: 'agendado', aprov: false }); bump(); window.toast && window.toast(a.produto + ' aprovado e agendado'); };
  const rejeitar = (a) => { if (!window.confirm(`Rejeitar "${a.produto}"?`)) return; DATA.aprovacoes = DATA.aprovacoes.filter(x => x.id !== a.id); bump(); window.toast && window.toast(a.produto + ' rejeitado'); };
  const adiar = (a) => { DATA.aprovacoes = DATA.aprovacoes.filter(x => x.id !== a.id); DATA.aprovacoes.push(a); bump(); window.toast && window.toast(a.produto + ' adiado para o fim da fila'); };
  return (
    <div className="content-inner fade-in" style={{ maxWidth: 920 }}>
      <div className="row spread">
        <div><h2 style={{ fontSize: 18 }}>Aprovar agora</h2><p className="muted" style={{ fontSize: 13 }}>Você só é chamada quando algo precisa de decisão · {DATA.aprovacoes.length} pendentes</p></div>
        <span className="badge amber"><Icon name="bell" size={12} />{DATA.aprovacoes.length} na fila</span>
      </div>
      {DATA.aprovacoes.map(a => {
        const r = window.riscoMap[a.risco];
        const open = exp === a.id;
        const red = a.risco === 'vermelho';
        return (
          <div key={a.id} className="card" style={{ borderColor: red ? 'oklch(0.70 0.19 22 / 0.4)' : 'var(--border-soft)' }}>
            <div className="row spread wrap" style={{ gap: 12 }}>
              <div className="row" style={{ gap: 12, minWidth: 0 }}>
                <PhonePreview w={64} label={a.rede} badge={null} />
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 7, marginBottom: 4 }}>
                    <span className={`badge ${r.cls}`}><span className="dot" />{r.label}</span>
                    <span className="badge gray" style={{ padding: '2px 7px' }}><Icon name="star" size={10} />{a.nota}/10</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{a.produto}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{a.rede} · {a.estilo} · {a.dur}</div>
                  <div className="row" style={{ gap: 6, marginTop: 6 }}><Icon name="alert" size={12} style={{ color: `var(--${r.cls})` }} /><span style={{ fontSize: 12, color: `var(--${r.cls})`, fontWeight: 600 }}>Motivo: {a.motivo}</span></div>
                </div>
              </div>
              <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                <button className="btn btn-danger btn-sm" onClick={() => rejeitar(a)}><Icon name="x" size={14} />Rejeitar</button>
                <button className="btn btn-ghost btn-sm" onClick={() => adiar(a)}><Icon name="clock" size={14} />Adiar</button>
                <button className="btn btn-primary btn-sm" onClick={() => aprovar(a)}><Icon name="check" size={14} />Aprovar</button>
              </div>
            </div>
            {red && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 11, background: 'var(--red-soft)', border: '1px solid oklch(0.70 0.19 22 / 0.3)' }}>
                <div className="row" style={{ gap: 7 }}><Icon name="shield" size={14} style={{ color: 'var(--red)' }} /><span style={{ fontSize: 12.5, color: 'var(--red)' }}>A legenda contém promessas absolutas ("garantido", "prometo"). Risco jurídico — edite antes de aprovar.</span></div>
              </div>
            )}
            <button onClick={() => setExp(open ? null : a.id)} className="row" style={{ gap: 6, marginTop: 12, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--font-body)' }}>
              <Icon name={open ? 'chevD' : 'chevR'} size={14} />{open ? 'Ocultar' : 'Ver roteiro, legenda e hashtags'}
            </button>
            {open && (
              <div className="col" style={{ gap: 12, marginTop: 12, paddingTop: 14, borderTop: '1px solid var(--border-soft)' }}>
                <div><span className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Gancho</span><div style={{ fontSize: 13.5, marginTop: 3 }}>{a.gancho}</div></div>
                <div>
                  <div className="row spread"><span className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Legenda</span>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn btn-ghost btn-sm" style={{ padding: '3px 9px' }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="pencil" size={12} />Editar</button>
                      <button className="btn btn-ghost btn-sm" style={{ padding: '3px 9px' }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="refresh" size={12} />Nova IA</button>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 6, padding: 12, borderRadius: 10, background: 'oklch(0 0 0 / 0.25)', border: '1px solid var(--border-soft)', lineHeight: 1.55 }}>{a.legenda}</div>
                </div>
                <div className="row wrap" style={{ gap: 6 }}>{a.hashtags.map(h => <span key={h} className="badge violet" style={{ padding: '2px 8px' }}>{h}</span>)}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ============ Calendário ============ */
const statusColorBar = { postado:'green', agendado:'violet', aguardando:'amber', aprovado:'green', roteiro:'blue', ideia:'gray' };
const statusCycle = ['ideia','roteiro','aguardando','aprovado','agendado','postado'];
const Calendario = ({ role }) => {
  const dias = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  const [, setTick] = useState(0);
  const [modal, setModal] = useState(false);
  const [cHora, setCHora] = useState('');
  const [cProduto, setCProduto] = useState('');
  const [cRede, setCRede] = useState('TikTok');
  const bump = () => { setTick(t => t + 1); window.persistDATA && window.persistDATA(); };
  const cicloStatus = (c) => { if (role === 'convidado') return; const i = statusCycle.indexOf(c.status); c.status = statusCycle[(i + 1) % statusCycle.length]; bump(); };
  return (
    <div className="content-inner fade-in">
      <div className="row spread wrap" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-icon btn-ghost" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="chevR" size={16} style={{ transform: 'rotate(180deg)' }} /></button>
          <h2 style={{ fontSize: 18 }}>Semana de 8–14 jun</h2>
          <button className="btn btn-icon btn-ghost" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="chevR" size={16} /></button>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className="badge violet"><Icon name="bolt" size={12} />8 vídeos/dia · automático</span>
          {role !== 'convidado' && <button className="btn btn-ghost btn-sm" onClick={() => { setCHora(''); setCProduto(''); setCRede('TikTok'); setModal(true); }}><Icon name="plus" size={14} />Slot manual</button>}
        </div>
      </div>

      {/* week strip */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
        {dias.map((d, i) => (
          <div key={d} className="card" style={{ padding: '12px 10px', textAlign: 'center', borderColor: i === 3 ? 'oklch(0.84 0.155 86 / 0.4)' : 'var(--border-soft)', background: i === 3 ? 'var(--gold-soft)' : undefined }}>
            <div className="dim" style={{ fontSize: 11 }}>{d}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: i === 3 ? 'var(--gold)' : 'var(--text)' }}>{8 + i}</div>
            <div className="dim" style={{ fontSize: 10.5, marginTop: 2 }}>8 vídeos</div>
          </div>
        ))}
      </div>

      {/* day detail */}
      <div className="card flush">
        <div className="row spread" style={{ padding: '14px 20px' }}>
          <div className="card-title">Quinta · 11 jun — fila do dia</div>
          <span className="dim" style={{ fontSize: 11.5 }}>clique no status para avançar a etapa</span>
        </div>
        {DATA.calendario.length === 0 ? (
          <div className="dim" style={{ padding: '24px 20px', fontSize: 13 }}>Nenhum slot agendado. Use "Slot manual" para adicionar.</div>
        ) : (
        <table className="tbl">
          <thead><tr><th>Horário</th><th>Produto</th><th>Série</th><th>Rede</th><th>Status</th><th className="right">Aprovação</th><th className="right"></th></tr></thead>
          <tbody>
            {DATA.calendario.map((c, i) => (
              <tr key={i}>
                <td><span className="mono" style={{ fontWeight: 600 }}>{c.h}</span></td>
                <td style={{ fontWeight: 500 }}>{c.produto}</td>
                <td className="muted">{c.serie}</td>
                <td className="muted">{c.rede}</td>
                <td onClick={() => cicloStatus(c)} style={{ cursor: role === 'convidado' ? 'default' : 'pointer' }}><Badge status={c.status} /></td>
                <td className="right">{c.aprov ? <span className="badge amber"><Icon name="bell" size={11} />Precisa</span> : <span className="dim" style={{ fontSize: 12 }}>—</span>}</td>
                <td className="right">{role !== 'convidado' && <button className="btn btn-ghost btn-sm" style={{ padding: '4px 7px' }} onClick={() => { DATA.calendario = DATA.calendario.filter((x,xi) => xi !== i); bump(); }}><Icon name="x" size={12} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} icon="plus" iconColor="gold"
        title="Novo slot manual" sub="Adicionar item à fila do dia"
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(false)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={() => {
          if (!cProduto.trim() || !cHora.trim()) return;
          DATA.calendario.push({ h: cHora.trim(), produto: cProduto.trim(), serie: '—', rede: cRede, status: 'ideia', aprov: false });
          setModal(false); bump();
          window.toast && window.toast('Slot adicionado');
        }}><Icon name="check" size={13} />Adicionar</button></>}>
        <label className="label">Horário</label>
        <input className="input" value={cHora} onChange={e => setCHora(e.target.value)} placeholder="Ex.: 14:00" />
        <label className="label" style={{ marginTop: 14 }}>Produto</label>
        <input className="input" value={cProduto} onChange={e => setCProduto(e.target.value)} placeholder="Ex.: Organizador de gavetas" />
        <label className="label" style={{ marginTop: 14 }}>Rede</label>
        <select className="input" value={cRede} onChange={e => setCRede(e.target.value)}>{['TikTok','Instagram','Reels','Facebook'].map(r => <option key={r}>{r}</option>)}</select>
      </Modal>
    </div>
  );
};

window.Conteudos = Conteudos;
window.Aprovacao = Aprovacao;
window.Calendario = Calendario;


/* ===== screens-demo.jsx ===== */
/* ============ Como Funciona — demonstração animada ============ */
const { useEffect, useRef } = React;

const FLUXO = [
  { ic:'radar',     cor:'violet', t:'1 · Radar de Tendências', d:'A IA varre o que está viralizando nas categorias de organização e casa — só como inspiração, nunca cópia.', tela:'radar' },
  { ic:'brain',     cor:'violet', t:'2 · IA analisa', d:'Gancho, dor do público, formato e por que viralizou. Avalia o risco de cópia antes de qualquer coisa.', tela:'radar' },
  { ic:'sparkles',  cor:'gold',   t:'3 · Cria versão própria', d:'Gera 5 ganchos, 5 roteiros, 5 legendas e CTAs — 100% originais, sem copiar ninguém.', tela:'gerar' },
  { ic:'shield',    cor:'green',  d:'Vincula um vídeo ou carrossel da Biblioteca de Autorizados. Só entra o que tem "pode postar: sim".', t:'4 · Criativo autorizado', tela:'biblioteca' },
  { ic:'bag',       cor:'gold',   t:'5 · Produto + link', d:'Combina o criativo com o produto afiliado certo, link rastreável e aviso de afiliado na legenda.', tela:'produtos' },
  { ic:'calendar',  cor:'blue',   t:'6 · Agenda e publica', d:'Monta a fila de 6 a 10 posts por dia. Você só é chamada para aprovar o que precisa de decisão.', tela:'calendario' },
  { ic:'dollar',    cor:'green',  t:'7 · Mede e escala', d:'Mostra lucro por plataforma e o Score de Escala. Produto campeão vira campanha automaticamente.', tela:'lucro' },
];

const ComoFunciona = ({ go }) => {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timer = useRef(null);

  useEffect(() => {
    if (!playing) return;
    timer.current = setTimeout(() => setStep(s => (s + 1) % FLUXO.length), 2600);
    return () => clearTimeout(timer.current);
  }, [step, playing]);

  const cur = FLUXO[step];

  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(700px 240px at 50% 0%, var(--violet-soft), transparent 60%), var(--surface)', textAlign: 'center', padding: '28px 24px' }}>
        <span className="badge violet" style={{ margin: '0 auto' }}><Icon name="play" size={12} />Demonstração</span>
        <h2 style={{ fontSize: 24, marginTop: 14 }}>Como o Patrono Seller trabalha por você</h2>
        <p className="muted" style={{ fontSize: 14, maxWidth: 520, margin: '8px auto 0' }}>Da tendência ao lucro, no automático — com aprovação sua nos pontos que importam e zero conteúdo copiado.</p>
      </div>

      {/* Player */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="grid g2" style={{ gridTemplateColumns: '1fr 1fr', gap: 0, alignItems: 'stretch' }}>
          {/* Visual à esquerda */}
          <div style={{ position: 'relative', minHeight: 320, display: 'grid', placeItems: 'center', padding: 30, background: `radial-gradient(400px 300px at 50% 40%, var(--${cur.cor}-soft), transparent 70%)`, borderRight: '1px solid var(--border-soft)' }}>
            <div key={step} className="fade-in col" style={{ alignItems: 'center', gap: 18 }}>
              <div style={{ width: 96, height: 96, borderRadius: 26, display: 'grid', placeItems: 'center', background: `var(--${cur.cor}-soft)`, color: `var(--${cur.cor})`, border: `1px solid oklch(0.7 0.12 285 / 0.25)`, boxShadow: `0 0 40px var(--${cur.cor}-soft)` }}>
                <Icon name={cur.ic} size={44} />
              </div>
              <div className="row" style={{ gap: 8 }}>
                {FLUXO.map((f, i) => (
                  <div key={i} onClick={() => { setStep(i); setPlaying(false); }} style={{ width: i === step ? 28 : 9, height: 9, borderRadius: 99, cursor: 'pointer', background: i === step ? `var(--${cur.cor})` : 'var(--surface-3)', transition: 'all .2s' }} />
                ))}
              </div>
            </div>
            <button className="btn btn-icon btn-ghost" onClick={() => setPlaying(p => !p)} style={{ position: 'absolute', bottom: 16, right: 16 }}>
              <Icon name={playing ? 'pause' : 'play'} size={16} />
            </button>
          </div>

          {/* Texto à direita */}
          <div style={{ padding: 30, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div key={step} className="fade-in">
              <span className="dim mono" style={{ fontSize: 12 }}>PASSO {step + 1} DE {FLUXO.length}</span>
              <h3 style={{ fontSize: 22, marginTop: 8 }}>{cur.t}</h3>
              <p className="muted" style={{ fontSize: 15, marginTop: 10, lineHeight: 1.6 }}>{cur.d}</p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 18 }} onClick={() => go(cur.tela)}>Abrir esta tela<Icon name="arrow" size={14} /></button>
            </div>
          </div>
        </div>
      </div>

      {/* Passos como trilha */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
        {FLUXO.map((f, i) => (
          <div key={i} onClick={() => { setStep(i); setPlaying(false); }} className="card" style={{ padding: '14px 10px', textAlign: 'center', cursor: 'pointer', borderColor: i === step ? `oklch(0.7 0.15 285 / 0.4)` : 'var(--border-soft)', background: i === step ? `var(--${f.cor}-soft)` : undefined, transition: 'all .15s' }}>
            <div className="ico" style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center', margin: '0 auto 8px', background: `var(--${f.cor}-soft)`, color: `var(--${f.cor})` }}><Icon name={f.ic} size={17} /></div>
            <div style={{ fontSize: 10.5, fontWeight: 600, lineHeight: 1.2 }}>{f.t.split(' · ')[1]}</div>
          </div>
        ))}
      </div>

      {/* Regras de ouro */}
      <div className="card" style={{ borderColor: 'oklch(0.80 0.16 158 / 0.25)' }}>
        <div className="card-head"><Icon name="shield" size={16} style={{ color: 'var(--green)' }} /><div className="card-title" style={{ fontSize: 14 }}>As regras de ouro da plataforma</div></div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {['Sem autorização, não publica','Sem link válido, não agenda','Sem aprovação inicial, não automatiza','Sem lucro ou escala, não insiste','Produto campeão vira campanha'].map(r => (
            <div key={r} className="row" style={{ gap: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--green-soft)' }}>
              <Icon name="check" size={14} style={{ color: 'var(--green)', flexShrink: 0 }} /><span style={{ fontSize: 12.5, fontWeight: 500 }}>{r}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

window.ComoFunciona = ComoFunciona;


/* ===== screens-admin-saas.jsx ===== */
/* ============ Painel da Dona — Módulos & Receita (SaaS admin) ============ */
const AdminSaas = () => {
  const S = DATA.saas;
  const A = S.adminMetrics;
  const fmt = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR');
  const maxRec = A.porModulo.length ? Math.max(...A.porModulo.map(m => m.receita)) : 0;

  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 0% 0%, var(--green-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--green-soft)', color: 'var(--green)' }}><Icon name="dollar" size={22} /></div>
            <div><h2 style={{ fontSize: 18 }}>Módulos e Receita</h2><p className="muted" style={{ fontSize: 13 }}>Painel da dona da plataforma · venda modular e acompanhe o desempenho</p></div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="tag" size={14} />Criar cupom</button>
            <button className="btn btn-primary btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="plus" size={14} />Novo módulo</button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid g4">
        <StatCard icon="dollar" color="green" value={fmt(A.receitaTotal)} label="MRR (receita recorrente)" trend="+12% mês" trendDir="up" />
        <StatCard icon="users" color="violet" value={A.assinantes} label="Assinantes ativos" trend="+18 este mês" trendDir="up" />
        <StatCard icon="flask" color="amber" value={A.trial} label="Em trial agora" />
        <StatCard icon="bag" color="gold" value={fmt(DATA.vendedores.reduce((s,v)=>s+(Number(v.mensalidade)||0),0))} label="Receita de vendedores" trend={`${DATA.vendedores.length} vendedores`} trendDir="up" />
        <StatCard icon="arrow" color="red" value={A.churn + '%'} label="Churn mensal" trend="-0,6pp" trendDir="up" />
      </div>

      {/* Receita por módulo */}
      <div className="card flush">
        <div className="row spread" style={{ padding: '16px 20px' }}>
          <div className="card-title">Desempenho por módulo</div>
          <button className="btn btn-ghost btn-sm" onClick={() => window.exportCSV('modulos-receita', ['Módulo','Assinantes','Receita/mês','Churn','Uso médio'], A.porModulo.map(m => [m.nome,m.assinantes,m.receita,m.churn,m.uso]))}><Icon name="download" size={14} />Exportar</button>
        </div>
        <table className="tbl">
          <thead><tr><th>Módulo</th><th className="right">Assinantes</th><th className="right">Receita/mês</th><th className="right">Churn</th><th className="right">Uso médio</th><th>Receita</th></tr></thead>
          <tbody>
            {[...A.porModulo].sort((a,b)=>b.receita-a.receita).map((m, i) => (
              <tr key={m.nome}>
                <td><div className="row" style={{ gap: 8 }}>{i === 0 && <Icon name="star" size={13} style={{ color: 'var(--gold)' }} />}<span style={{ fontWeight: 600 }}>{m.nome}</span></div></td>
                <td className="right mono">{m.assinantes}</td>
                <td className="right mono" style={{ color: 'var(--green)', fontWeight: 600 }}>{fmt(m.receita)}</td>
                <td className="right mono" style={{ color: m.churn > 5 ? 'var(--red)' : 'var(--text-muted)' }}>{m.churn}%</td>
                <td className="right mono">{m.uso}%</td>
                <td style={{ minWidth: 110 }}><div className="bar green" style={{ height: 7 }}><i style={{ width: (m.receita/maxRec*100) + '%' }} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Gestão de módulos */}
      <div className="card flush">
        <div className="row spread" style={{ padding: '16px 20px' }}>
          <div className="card-title">Catálogo de módulos</div>
          <span className="dim" style={{ fontSize: 12 }}>ative, desative e ajuste preços</span>
        </div>
        <table className="tbl">
          <thead><tr><th>Módulo</th><th className="right">Preço/mês</th><th>Selo</th><th className="right">Status</th><th className="right">Ação</th></tr></thead>
          <tbody>
            {S.modulos.map(m => (
              <tr key={m.id}>
                <td><div className="row" style={{ gap: 9 }}><div className="ico" style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: `var(--${m.cor}-soft)`, color: `var(--${m.cor})` }}><Icon name={m.icon} size={14} /></div><span style={{ fontWeight: 500, fontSize: 13 }}>{m.nome}</span></div></td>
                <td className="right mono">{m.precoLabel || ('R$ ' + m.mensal)}</td>
                <td>{m.selo ? <span className={`badge ${window.seloMap[m.selo]}`} style={{ padding: '1px 7px' }}>{m.selo}</span> : <span className="dim">—</span>}</td>
                <td className="right"><span className="badge green" style={{ padding: '1px 8px' }}><span className="dot" />Ativo</span></td>
                <td className="right"><div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><button className="btn btn-ghost btn-sm" style={{ padding: '5px 8px' }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="pencil" size={13} /></button><button className="btn btn-ghost btn-sm" style={{ padding: '5px 8px' }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="pause" size={13} /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Combos */}
      <div className="card">
        <div className="card-head"><Icon name="layers" size={16} style={{ color: 'var(--gold)' }} /><div className="card-title" style={{ fontSize: 14 }}>Combos publicados</div><button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="plus" size={13} />Novo combo</button></div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {S.combos.map(c => (
            <div key={c.id} className="col" style={{ gap: 4, padding: '12px 14px', borderRadius: 11, background: 'oklch(0 0 0 / 0.2)', border: '1px solid var(--border-soft)' }}>
              <div className="row spread"><span style={{ fontSize: 13, fontWeight: 600 }}>{c.nome}</span>{c.selo && <span className={`badge ${window.seloMap[c.selo]}`} style={{ padding: '0 6px', fontSize: 9.5 }}>{c.selo}</span>}</div>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>R$ {c.preco}<span className="dim" style={{ fontSize: 11, fontWeight: 500 }}>/mês</span></span>
              <span className="dim" style={{ fontSize: 11 }}>{c.mods.length} {c.mods.length === 1 ? 'item' : 'itens'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

window.AdminSaas = AdminSaas;


/* ===== screens-contas.jsx ===== */
/* ============ Contas e Nichos ============ */
const Contas = ({ acct, onSwitch }) => {
  const [sel, setSel] = useState(acct ? acct.id : DATA.contas[0].id);
  const conta = DATA.contas.find(c => c.id === sel) || DATA.contas[0];
  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 100% 0%, var(--gold-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--gold-soft)', color: 'var(--gold)' }}><Icon name="users" size={22} /></div>
            <div><h2 style={{ fontSize: 18 }}>Contas e Nichos</h2><p className="muted" style={{ fontSize: 13 }}>Conecte várias contas e escolha os nichos de cada uma · alterne a conta de trabalho quando quiser</p></div>
          </div>
          <button className="btn btn-primary" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="plus" size={15} />Conectar nova conta</button>
        </div>
      </div>

      <div className="grid g4">
        <StatCard icon="users" color="gold" value={DATA.contas.length} label="Contas conectadas" />
        <StatCard icon="video" color="violet" value={DATA.contas.reduce((s,c)=>s+c.redes.length,0)} label="Redes vinculadas" />
        <StatCard icon="grid" color="blue" value={new Set(DATA.contas.flatMap(c=>c.nichos)).size} label="Nichos em uso" />
        <StatCard icon="trend" color="green" value={DATA.contas.reduce((s,c)=>s+c.seguidores,0).toLocaleString('pt-BR')} label="Seguidores somados" />
      </div>

      <div className="grid g2" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        {/* lista de contas */}
        <div className="col" style={{ gap: 12 }}>
          {DATA.contas.map(c => (
            <div key={c.id} className="card" onClick={() => setSel(c.id)} style={{ cursor: 'pointer', padding: 16, borderColor: sel === c.id ? `oklch(0.7 0.13 285 / 0.4)` : 'var(--border-soft)', boxShadow: sel === c.id ? '0 0 0 3px var(--violet-soft)' : 'none' }}>
              <div className="row spread">
                <div className="row" style={{ gap: 11, minWidth: 0 }}>
                  <div className="avatar" style={{ width: 38, height: 38, fontSize: 15, background: `linear-gradient(140deg, var(--${c.cor}), var(--violet-2))`, color: c.cor === 'gold' ? 'oklch(0.2 0.02 70)' : 'white', flexShrink: 0 }}>{c.nome.replace('Cliente · ','')[0]}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6 }}><span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nome}</span>{c.atual && <span className="badge green" style={{ padding: '0 6px', fontSize: 9.5 }}>ativa</span>}{c.cliente && <span className="badge violet" style={{ padding: '0 6px', fontSize: 9.5 }}>cliente</span>}</div>
                    <div className="dim" style={{ fontSize: 12 }}>{c.handle} · {c.seguidores.toLocaleString('pt-BR')} seguidores</div>
                  </div>
                </div>
                {onSwitch && !c.atual && <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onSwitch(c.id); }}>Trabalhar</button>}
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
                {c.redes.map(r => <span key={r.p} className={`badge ${window.redeStatusMap[r.st].cls}`} style={{ padding: '2px 8px' }}><span className="dot" />{r.p}</span>)}
                <span className="badge gray" style={{ padding: '2px 8px' }}>{c.plano}</span>
              </div>
              <div className="row wrap" style={{ gap: 5, marginTop: 9 }}>
                {c.nichos.map(n => <span key={n} className="chip" style={{ padding: '3px 9px', fontSize: 11, cursor: 'default' }}>{n}</span>)}
              </div>
            </div>
          ))}
        </div>

        {/* editor de nichos da conta selecionada */}
        <div className="card" style={{ position: 'sticky', top: 0 }}>
          <div className="row" style={{ gap: 10, marginBottom: 4 }}>
            <div className="avatar" style={{ width: 32, height: 32, fontSize: 13, background: `linear-gradient(140deg, var(--${conta.cor}), var(--violet-2))`, color: conta.cor === 'gold' ? 'oklch(0.2 0.02 70)' : 'white' }}>{conta.nome.replace('Cliente · ','')[0]}</div>
            <div><div className="card-title" style={{ fontSize: 14 }}>{conta.nome}</div><div className="dim" style={{ fontSize: 11.5 }}>{conta.handle}</div></div>
          </div>
          <label className="label" style={{ marginTop: 14 }}>Nichos desta conta</label>
          <p className="dim" style={{ fontSize: 12, marginBottom: 10 }}>O Radar e a IA usam os nichos escolhidos para buscar tendências e gerar conteúdo só do que importa para esta conta.</p>
          <div className="row wrap" style={{ gap: 7 }}>
            {DATA.nichos.map(n => {
              const on = conta.nichos.includes(n);
              return <span key={n} className={`chip ${on ? 'active' : ''}`} style={{ padding: '6px 12px' }}>{on && <Icon name="check" size={11} style={{ marginRight: 4 }} />}{n}</span>;
            })}
          </div>
          <div className="divider" style={{ margin: '16px 0' }} />
          <label className="label">Redes desta conta</label>
          <div className="col" style={{ gap: 8 }}>
            {conta.redes.map(r => (
              <div key={r.p} className="row spread" style={{ padding: '9px 11px', borderRadius: 10, background: 'oklch(0 0 0 / 0.2)', border: '1px solid var(--border-soft)' }}>
                <div className="row" style={{ gap: 8 }}><Icon name="video" size={14} style={{ color: 'var(--text-muted)' }} /><span style={{ fontSize: 13, fontWeight: 500 }}>{r.p}</span></div>
                {r.st === 'conectada' ? <span className="badge green" style={{ padding: '1px 8px' }}><Icon name="check" size={11} />Conectada</span> : <button className="btn btn-primary btn-sm" style={{ padding: '4px 10px' }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}>Conectar</button>}
              </div>
            ))}
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 2 }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="plus" size={13} />Adicionar rede</button>
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="check" size={15} />Salvar nichos e redes</button>
        </div>
      </div>
    </div>
  );
};

window.Contas = Contas;


/* ===== screens-publish.jsx ===== */
/* ============ Publicação — todas as redes ============ */
const REDES_PUB = [
  { nome:'TikTok', icon:'video', cor:'pink', sub:'Content Posting API', conta:'@patrono.organiza', conectada:true, escopos:'video.publish · video.upload' },
  { nome:'Instagram', icon:'image', cor:'pink', sub:'Reels + Carrossel (Graph API)', conta:'@patrono.organiza', conectada:true, escopos:'content_publish' },
  { nome:'YouTube', icon:'play', cor:'red', sub:'Shorts (Data API)', conta:'@patronoorganiza', conectada:false },
  { nome:'Kwai', icon:'video', cor:'gold', sub:'Open API', conta:'@patrono.organiza', conectada:false },
  { nome:'Facebook', icon:'message', cor:'blue', sub:'Pages + Reels', conta:'Página BoraComprar', conectada:true, escopos:'pages_manage_posts' },
  { nome:'TikTok Shop', icon:'bag', cor:'pink', sub:'Catálogo + checkout', conta:'Loja BoraComprar', conectada:false, loja:true },
  { nome:'Hotmart', icon:'dollar', cor:'red', sub:'Checkout + comissões de infoproduto', conta:'', conectada:false, loja:true },
  { nome:'WhatsApp', icon:'message', cor:'green', sub:'Disparo de mensagens e catálogo', conta:'', conectada:false },
];

const REDES_INTEGRACAO_ID = { 'TikTok':'tiktok', 'Instagram':'instagram', 'Facebook':'facebook', 'TikTok Shop':'tiktokshop', 'Hotmart':'hotmart', 'WhatsApp':'whatsapp' };
const Publicacao = ({ go }) => {
  const [redes, setRedes] = useState(() => Object.fromEntries(REDES_PUB.filter(r => !REDES_INTEGRACAO_ID[r.nome]).map(r => [r.nome, r.conectada])));
  const [, setTick] = useState(0);
  const [modo, setModo] = useState('manual'); // manual | auto
  const toggle = (n) => setRedes(s => ({ ...s, [n]: !s[n] }));
  const contaConectada = (nome) => { const iid = REDES_INTEGRACAO_ID[nome]; if (!iid) return null; const p = DATA.integracoes.find(x => x.id === iid); return p && p.contas[0] ? p.contas[0] : null; };
  const isOn = (r) => REDES_INTEGRACAO_ID[r.nome] ? !!contaConectada(r.nome) : !!redes[r.nome];
  const tt = isOn(REDES_PUB.find(r => r.nome === 'TikTok'));
  const nConectadas = REDES_PUB.filter(isOn).length;

  const proximo = {
    arquivo: 'talheres_pov_v1.mp4', produto: 'Organizador de Talheres Expansível',
    legenda: 'Essa gaveta vivia um caos até eu achar esse organizador 😮‍💨 Agora cada talher tem seu lugar. Link na bio! #organizacao #cozinha #achadinhos #casaorganizada',
    hashtags: ['#organizacao','#cozinha','#achadinhos','#casaorganizada'],
    horario: 'Hoje · 18:30', link: 'patrono.link/talheres',
  };

  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 220px at 100% 0%, var(--pink-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--pink-soft)', color: 'var(--pink)' }}><Icon name="share" size={22} /></div>
            <div><h2 style={{ fontSize: 18 }}>Publicação nas redes</h2><p className="muted" style={{ fontSize: 13 }}>Conecte cada rede e escolha como os conteúdos vão ao ar · um post pode sair em várias ao mesmo tempo</p></div>
          </div>
          <span className={`badge ${nConectadas ? 'green' : 'gray'}`}><span className="dot" />{nConectadas} de {REDES_PUB.length} conectadas</span>
        </div>
      </div>

      {/* Conexões — todas as redes */}
      <div className="grid g3">
        {REDES_PUB.map(r => {
          const on = isOn(r);
          const conta = contaConectada(r.nome);
          return (
            <div key={r.nome} className="card" style={{ borderColor: on ? 'oklch(0.80 0.16 158 / 0.3)' : 'var(--border-soft)' }}>
              <div className="row spread">
                <div className="row" style={{ gap: 11, minWidth: 0 }}>
                  <div className="ico" style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: `var(--${r.cor}-soft)`, color: `var(--${r.cor})`, flexShrink: 0 }}><Icon name={r.icon} size={19} /></div>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{r.nome}{r.loja && <span className="badge gray" style={{ padding: '0 6px', fontSize: 9.5, marginLeft: 6 }}>loja</span>}</div><div className="dim" style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</div></div>
                </div>
                {on && <span className="badge green" style={{ padding: '1px 8px' }}><Icon name="check" size={11} />OK</span>}
              </div>
              {on ? (
                <div className="col" style={{ gap: 7, marginTop: 13 }}>
                  <div className="row spread"><span className="dim" style={{ fontSize: 11.5 }}>Conta</span><span style={{ fontSize: 12.5, fontWeight: 600 }}>{conta ? conta.handle : r.conta}</span></div>
                  {r.escopos && <div className="row spread"><span className="dim" style={{ fontSize: 11.5 }}>Escopos</span><span className="mono" style={{ fontSize: 10.5 }}>{r.escopos}</span></div>}
                  {REDES_INTEGRACAO_ID[r.nome]
                    ? <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => go && go('integracoes')}><Icon name="plug" size={12} />Gerenciar em Integrações</button>
                    : <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => toggle(r.nome)}><Icon name="x" size={12} />Desconectar</button>}
                </div>
              ) : (
                <div className="col" style={{ gap: 9, marginTop: 13 }}>
                  <p className="muted" style={{ fontSize: 12 }}>{r.loja ? 'Vincule produtos aos vídeos com checkout nativo.' : 'Autorize para publicar direto no horário agendado.'}</p>
                  <button className="btn btn-primary btn-sm" style={{ background: `var(--${r.cor})`, color: r.cor === 'gold' ? 'oklch(0.2 0.02 70)' : 'white', boxShadow: 'none' }} onClick={() => REDES_INTEGRACAO_ID[r.nome] ? (go && go('integracoes')) : toggle(r.nome)}><Icon name="link" size={13} />Conectar</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modo de publicação */}
      <div className="card">
        <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Modo de publicação</div>
        <div className="grid g2" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div onClick={() => setModo('manual')} style={{ cursor: 'pointer', padding: 16, borderRadius: 13, border: `1px solid ${modo==='manual'?'oklch(0.84 0.155 86 / 0.45)':'var(--border-soft)'}`, background: modo==='manual'?'var(--gold-soft)':'oklch(0 0 0 / 0.15)' }}>
            <div className="row spread"><div className="row" style={{ gap: 8 }}><Icon name="download" size={16} style={{ color: 'var(--gold)' }} /><span style={{ fontWeight: 600, fontSize: 14 }}>Pacote manual</span></div>{modo==='manual' && <Icon name="checkCircle" size={16} style={{ color: 'var(--gold)' }} />}</div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>A IA monta tudo; você baixa o pacote e posta na mão. Funciona já, sem aprovação da API.</p>
            <span className="badge green" style={{ marginTop: 10 }}><span className="dot" />Disponível agora</span>
          </div>
          <div onClick={() => tt && setModo('auto')} style={{ cursor: tt?'pointer':'not-allowed', opacity: tt?1:0.55, padding: 16, borderRadius: 13, border: `1px solid ${modo==='auto'?'oklch(0.68 0.195 295 / 0.45)':'var(--border-soft)'}`, background: modo==='auto'?'var(--violet-soft)':'oklch(0 0 0 / 0.15)' }}>
            <div className="row spread"><div className="row" style={{ gap: 8 }}><Icon name="bolt" size={16} style={{ color: 'var(--violet)' }} /><span style={{ fontWeight: 600, fontSize: 14 }}>Automático</span></div>{modo==='auto' && <Icon name="checkCircle" size={16} style={{ color: 'var(--violet)' }} />}</div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Publica direto pela API no horário agendado. A 1ª campanha sempre passa por aprovação.</p>
            <span className="badge amber" style={{ marginTop: 10 }}><Icon name="bell" size={11} />Requer app aprovado</span>
          </div>
        </div>
      </div>

      {/* Pacote de postagem do próximo vídeo */}
      <div className="card flush">
        <div className="row spread" style={{ padding: '16px 20px' }}>
          <div className="card-title">Próximo na fila · pacote pronto</div>
          <span className="badge gray"><Icon name="clock" size={11} />{proximo.horario}</span>
        </div>
        <div className="grid g2" style={{ gridTemplateColumns: '160px 1fr', gap: 18, padding: '0 20px 20px', alignItems: 'start' }}>
          <PhonePreview w="100%" label={`${proximo.produto}\nTikTok 9:16`} badge={<span className="badge green" style={{ padding: '2px 7px' }}><Icon name="check" size={10} />Autorizado</span>} />
          <div className="col" style={{ gap: 14 }}>
            <div>
              <div className="row spread" style={{ marginBottom: 6 }}><span className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Legenda</span><button className="btn btn-ghost btn-sm" style={{ padding: '3px 9px' }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="copy" size={12} />Copiar</button></div>
              <div style={{ fontSize: 13, padding: 12, borderRadius: 10, background: 'oklch(0 0 0 / 0.25)', border: '1px solid var(--border-soft)', lineHeight: 1.55 }}>{proximo.legenda}</div>
            </div>
            <div className="grid g2" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><span className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Link de afiliado</span><div className="row" style={{ gap: 6, marginTop: 4 }}><span className="mono" style={{ fontSize: 12.5, color: 'var(--blue)' }}>{proximo.link}</span><Icon name="copy" size={12} style={{ color: 'var(--text-dim)', cursor: 'pointer' }} /></div></div>
              <div><span className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Horário recomendado</span><div style={{ fontSize: 13, marginTop: 4, fontWeight: 600 }}>{proximo.horario}</div></div>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>{proximo.hashtags.map(h => <span key={h} className="badge violet" style={{ padding: '2px 8px' }}>{h}</span>)}</div>
            <div className="row" style={{ gap: 10, marginTop: 2 }}>
              <button className="btn btn-primary btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="download" size={14} />Baixar pacote (.zip)</button>
              <button className="btn btn-ghost btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="copy" size={14} />Copiar tudo</button>
              {modo === 'auto' && tt && <button className="btn btn-violet btn-sm" style={{ marginLeft: 'auto' }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="bolt" size={14} />Publicar via API</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

window.Publicacao = Publicacao;


/* ===== screens-imagens.jsx ===== */
/* ============ Imagens e Criativos + Fornecedores ============ */

/* ---------- Imagens e Criativos ---------- */
const imgFiltros = ['Todas','Capa','Carrossel','Banner','Thumbnail'];

const ImgCard = ({ im, onClick, onDelete }) => {
  const t = DATA.tipoImg[im.tipo];
  const blocked = !im.autorizado;
  return (
    <div className="card" onClick={onClick} style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 0, position: 'relative', cursor: 'pointer', borderColor: blocked ? 'oklch(0.70 0.19 22 / 0.35)' : 'var(--border-soft)' }}>
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
        <Media label={`${im.tipo.toLowerCase()}\n${im.produto}`} ratio={t.ratio} style={{ borderRadius: 12 }} />
        {/* tipo badge */}
        <span className={`badge ${t.cor}`} style={{ position: 'absolute', top: 8, left: 8, padding: '2px 8px', background: 'rgba(0,0,0,.5)', backdropFilter: 'blur(4px)' }}>{im.tipo}</span>
        <button className="btn btn-icon btn-ghost btn-sm" style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,.55)', padding: 5 }} onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Excluir"><Icon name="x" size={12} /></button>
        {/* carrossel slides */}
        {im.slides && (
          <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.6)', borderRadius: 99, padding: '2px 7px', fontSize: 10, fontWeight: 700, color: 'white', display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="layers" size={10} />{im.slides}</span>
        )}
        {/* lock overlay */}
        {blocked && (
          <div style={{ position: 'absolute', inset: 0, background: 'oklch(0.16 0.02 22 / 0.55)', display: 'grid', placeItems: 'center', backdropFilter: 'blur(1px)' }}>
            <div className="col" style={{ alignItems: 'center', gap: 6, color: 'var(--red)' }}><Icon name="lock" size={22} /><span style={{ fontSize: 11, fontWeight: 700 }}>Bloqueado</span></div>
          </div>
        )}
      </div>
      <div className="col" style={{ gap: 8, padding: '12px 4px 4px' }}>
        <div className="row spread" style={{ alignItems: 'flex-start' }}>
          <span className="mono" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{im.nome}</span>
          <Badge status={im.status} />
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Icon name="bag" size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <span className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{im.produto}</span>
        </div>
        <div className="row spread" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 9, marginTop: 2 }}>
          {im.autorizado
            ? <span className="row" style={{ gap: 4, fontSize: 11.5, color: 'var(--green)', fontWeight: 600 }}><Icon name="shield" size={12} />Autorizada</span>
            : <span className="row" style={{ gap: 4, fontSize: 11.5, color: 'var(--red)', fontWeight: 600 }}><Icon name="x" size={12} />Sem licença</span>}
          <span className="dim" style={{ fontSize: 11 }}>{im.usos} usos</span>
        </div>
      </div>
    </div>
  );
};

const Imagens = ({ go, locked }) => {
  const [f, setF] = useState('Todas');
  const [sel, setSel] = useState(null);
  const list = f === 'Todas' ? DATA.imagens : DATA.imagens.filter(i => i.tipo === f);
  const stats = [
    ['image','pink', DATA.imagens.length, 'No banco'],
    ['shield','green', DATA.imagens.filter(i => i.autorizado).length, 'Autorizadas'],
    ['sparkles','violet', DATA.imagens.filter(i => i.origem === 'Gerado por IA').length, 'Geradas por IA'],
    ['lock','red', DATA.imagens.filter(i => !i.autorizado).length, 'Bloqueadas'],
  ];
  return (
    <div className="content-inner fade-in">
      {locked && <PaywallBanner mod={locked} go={go} onActivate={() => { locked.ativo = true; window.__rerender(); }} />}
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 0% 0%, var(--pink-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--pink-soft)', color: 'var(--pink)' }}><Icon name="image" size={22} /></div>
            <div>
              <h2 style={{ fontSize: 18 }}>Imagens e Criativos</h2>
              <p className="muted" style={{ fontSize: 13 }}>Capas, carrosséis, banners e thumbnails · cada arte com <strong style={{ color: 'var(--pink)' }}>controle de autorização</strong></p>
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="upload" size={14} />Enviar arte</button>
            <button className="btn btn-primary btn-sm" onClick={() => go && go('gerar')}><Icon name="sparkles" size={14} />Gerar com IA</button>
          </div>
        </div>
      </div>

      <div className="grid g4">
        {stats.map(([ic,co,v,l]) => <StatCard key={l} icon={ic} color={co} value={v} label={l} />)}
      </div>

      <div className="row spread wrap" style={{ gap: 12 }}>
        <div className="chips">
          {imgFiltros.map(c => <div key={c} className={`chip ${f === c ? 'active' : ''}`} onClick={() => setF(c)}>{c}</div>)}
        </div>
        <span className="dim" style={{ fontSize: 12.5 }}>{list.length} criativos · vinculados a produto e campanha</span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', alignItems: 'start' }}>
        {list.map(im => <ImgCard key={im.id} im={im} onClick={() => setSel(im)} onDelete={() => { if (window.confirm(`Excluir "${im.nome}"?`)) { DATA.imagens = DATA.imagens.filter(x => x.id !== im.id); setSel(null); window.persistDATA && window.persistDATA(); window.toast && window.toast('Imagem excluída'); window.__rerender && window.__rerender(); } }} />)}
      </div>

      {/* Detalhe da arte */}
      <Modal open={!!sel} onClose={() => setSel(null)} w={440}
        icon={sel ? DATA.tipoImg[sel.tipo].kind === 'wide' ? 'image' : 'image' : 'image'}
        iconColor={sel ? DATA.tipoImg[sel.tipo].cor : 'pink'}
        title={sel?.nome} sub={sel ? `${sel.tipo} · ${sel.produto}` : ''}
        footer={sel && (sel.autorizado
          ? <><button className="btn btn-ghost btn-sm" onClick={() => setSel(null)}>Fechar</button><button className="btn btn-primary btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="calendar" size={13} />Usar em campanha</button></>
          : <><button className="btn btn-ghost btn-sm" onClick={() => setSel(null)}>Fechar</button><button className="btn btn-primary btn-sm" onClick={() => { setSel(null); go && go('fornecedores'); }}><Icon name="folder" size={13} />Resolver licença</button></>)}>
        {sel && (<>
          <div style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 16, maxWidth: 220, margin: '0 auto 16px' }}>
            <Media label={`${sel.tipo.toLowerCase()}\n${sel.produto}`} ratio={DATA.tipoImg[sel.tipo].ratio} style={{ borderRadius: 12 }} />
          </div>
          {!sel.autorizado && (
            <div className="row" style={{ gap: 9, padding: '10px 12px', borderRadius: 11, background: 'var(--red-soft)', border: '1px solid oklch(0.70 0.19 22 / 0.25)', marginBottom: 12 }}>
              <Icon name="lock" size={15} style={{ color: 'var(--red)', flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: 'var(--red)' }}>Arte sem licença de uso — bloqueada para publicação até regularizar o fornecedor.</span>
            </div>
          )}
          <KV k="Tipo" v={sel.tipo} />
          <KV k="Origem" v={sel.origem} />
          {sel.slides && <KV k="Slides" v={`${sel.slides} imagens`} />}
          <KV k="Produto" v={sel.produto} />
          <KV k="Campanha" v={sel.campanha} />
          <KV k="Validade da licença" v={sel.validade} />
          <KV k="Usos na operação" v={`${sel.usos} posts`} />
          <div className="row spread" style={{ paddingTop: 10 }}>
            <span className="dim" style={{ fontSize: 12.5 }}>Autorização</span>
            {sel.autorizado
              ? <span className="row" style={{ gap: 4, fontSize: 12.5, color: 'var(--green)', fontWeight: 600 }}><Icon name="shield" size={13} />Autorizada</span>
              : <span className="row" style={{ gap: 4, fontSize: 12.5, color: 'var(--red)', fontWeight: 600 }}><Icon name="x" size={13} />Sem licença</span>}
          </div>
        </>)}
      </Modal>
    </div>
  );
};

/* ---------- Fornecedores ---------- */
const Fornecedores = ({ go }) => {
  const [sel, setSel] = useState(DATA.fornecedores[0] || null);
  const [modal, setModal] = useState(null); // 'renovar' | 'contrato' | 'assinatura' | 'novo'
  const [, setTick] = useState(0);
  const [fNome, setFNome] = useState('');
  const [fTipo, setFTipo] = useState(Object.keys(DATA.tipoForn)[0]);
  const [fContato, setFContato] = useState('');
  const t = sel ? DATA.tipoForn[sel.tipo] : null;
  const stats = [
    ['folder','blue', DATA.fornecedores.length, 'Fornecedores'],
    ['check','green', DATA.fornecedores.filter(f => f.contrato === 'Ativo' || f.contrato === 'Interno').length, 'Contratos vigentes'],
    ['doc','gold', DATA.fornecedores.filter(f => f.termo).length, 'Termos assinados'],
    ['alert','red', DATA.fornecedores.filter(f => f.status !== 'vigente').length, 'Exigem atenção'],
  ];
  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 0% 0%, var(--blue-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--blue-soft)', color: 'var(--blue)' }}><Icon name="folder" size={22} /></div>
            <div>
              <h2 style={{ fontSize: 18 }}>Fornecedores</h2>
              <p className="muted" style={{ fontSize: 13 }}>Quem fornece produtos e criativos · só entra na operação com <strong style={{ color: 'var(--blue)' }}>contrato e termo válidos</strong></p>
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setModal('novo')}><Icon name="plus" size={15} />Novo fornecedor</button>
        </div>
      </div>

      <div className="grid g4">
        {stats.map(([ic,co,v,l]) => <StatCard key={l} icon={ic} color={co} value={v} label={l} />)}
      </div>

      <div className="grid g2" style={{ gridTemplateColumns: '1fr 320px', alignItems: 'start' }}>
        <div className="card flush">
          <table className="tbl">
            <thead><tr><th>Fornecedor</th><th>Tipo</th><th className="right">Criativos</th><th>Termo</th><th className="right">Status</th></tr></thead>
            <tbody>
              {DATA.fornecedores.map(f => {
                const ft = DATA.tipoForn[f.tipo];
                return (
                  <tr key={f.id} onClick={() => setSel(f)} style={{ cursor: 'pointer', background: sel && sel.id === f.id ? 'oklch(1 0 0 / 0.03)' : undefined }}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <div className="ico" style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: `var(--${ft.cor}-soft)`, color: `var(--${ft.cor})`, flexShrink: 0 }}><Icon name={ft.icon} size={15} /></div>
                        <div style={{ fontWeight: 600 }}>{f.nome}</div>
                      </div>
                    </td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{f.tipo}</td>
                    <td className="right mono">{f.criativos}</td>
                    <td>{f.termo
                      ? <span className="row" style={{ gap: 4, color: 'var(--green)', fontSize: 12, fontWeight: 600 }}><Icon name="check" size={13} />Assinado</span>
                      : <span className="row" style={{ gap: 4, color: 'var(--amber)', fontSize: 12, fontWeight: 600 }}><Icon name="clock" size={13} />Pendente</span>}</td>
                    <td className="right"><span className={`badge ${DATA.contratoMap[f.contrato]}`} style={{ padding: '2px 8px' }}><span className="dot" />{f.contrato}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ position: 'sticky', top: 0 }}>
          {!sel ? (
            <div style={{ padding: '24px 4px', textAlign: 'center' }}>
              <Icon name="folder" size={24} style={{ color: 'var(--text-dim)', marginBottom: 8 }} />
              <p className="muted" style={{ fontSize: 13 }}>Nenhum fornecedor cadastrado ainda.</p>
            </div>
          ) : (
          <React.Fragment>
          <div className="row" style={{ gap: 11, marginBottom: 16 }}>
            <div className="ico" style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', background: `var(--${t.cor}-soft)`, color: `var(--${t.cor})`, flexShrink: 0 }}><Icon name={t.icon} size={22} /></div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15.5 }}>{sel.nome}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{sel.tipo}</div>
            </div>
          </div>
          <div className="col" style={{ gap: 9 }}>
            {[['Contato', sel.contato],['Criativos fornecidos', sel.criativos],['Validade do contrato', sel.validade]].map(([k,v]) => (
              <div key={k} className="row spread"><span className="dim" style={{ fontSize: 12 }}>{k}</span><span style={{ fontSize: 12.5, fontWeight: 500, textAlign: 'right', maxWidth: 170, wordBreak: 'break-word' }}>{v}</span></div>
            ))}
          </div>
          <div className="divider" style={{ margin: '14px 0' }} />
          <div className="dim" style={{ fontSize: 10.5, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>Nichos atendidos</div>
          <div className="chips">{sel.nichos.map(n => <span key={n} className="badge gray" style={{ padding: '2px 9px' }}>{n}</span>)}</div>
          <div className="divider" style={{ margin: '14px 0' }} />
          <div className="col" style={{ gap: 8 }}>
            <div className="row spread"><span style={{ fontSize: 12.5 }}>Contrato</span><span className={`badge ${DATA.contratoMap[sel.contrato]}`} style={{ padding: '2px 8px' }}>{sel.contrato}</span></div>
            <div className="row spread"><span style={{ fontSize: 12.5 }}>Termo de cessão</span>{sel.termo
              ? <span className="row" style={{ gap: 4, color: 'var(--green)', fontSize: 12, fontWeight: 600 }}><Icon name="check" size={13} />Assinado</span>
              : <span className="row" style={{ gap: 4, color: 'var(--amber)', fontSize: 12, fontWeight: 600 }}><Icon name="clock" size={13} />Pendente</span>}</div>
          </div>
          {sel.status === 'vencido' && (
            <div className="row" style={{ gap: 8, marginTop: 14, padding: '9px 11px', borderRadius: 10, background: 'var(--red-soft)', border: '1px solid oklch(0.70 0.19 22 / 0.25)', cursor: 'pointer' }} onClick={() => go && go('compliance')}>
              <Icon name="scale" size={14} style={{ color: 'var(--red)', flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: 'var(--red)', flex: 1 }}>Gera pendência no Compliance — 60 criativos bloqueados</span>
              <Icon name="arrow" size={13} style={{ color: 'var(--red)' }} />
            </div>
          )}
          {sel.status === 'vencido'
            ? <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={() => setModal('renovar')}><Icon name="refresh" size={15} />Renovar contrato</button>
            : sel.termo
              ? <button className="btn btn-ghost" style={{ width: '100%', marginTop: 14 }} onClick={() => setModal('contrato')}><Icon name="doc" size={15} />Ver contrato</button>
              : <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={() => setModal('assinatura')}><Icon name="pencil" size={15} />Coletar assinatura</button>}
          <button className="btn btn-danger" style={{ width: '100%', marginTop: 8 }} onClick={() => { if (window.confirm(`Excluir fornecedor "${sel.nome}"?`)) { DATA.fornecedores = DATA.fornecedores.filter(x => x.id !== sel.id); setSel(DATA.fornecedores[0] || null); window.persistDATA && window.persistDATA(); window.toast && window.toast('Fornecedor excluído'); } }}><Icon name="x" size={15} />Excluir fornecedor</button>
          </React.Fragment>
          )}
        </div>
      </div>

      {/* Renovar contrato */}
      <Modal open={modal === 'renovar' && !!sel} onClose={() => setModal(null)} icon="refresh" iconColor="gold"
        title="Renovar contrato" sub={sel?.nome}
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={() => { sel.contrato = 'Ativo'; sel.status = 'vigente'; sel.termo = true; sel.validade = '06/2027'; setModal(null); window.persistDATA && window.persistDATA(); }}><Icon name="check" size={13} />Confirmar renovação</button></>}>
        {sel && <><p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>O contrato com <strong style={{ color: 'var(--text)' }}>{sel.nome}</strong> está vencido desde {sel.validade}. Renovar libera os criativos bloqueados no Compliance.</p>
        <KV k="Tipo de parceria" v={sel.tipo} />
        <KV k="Criativos fornecidos" v={sel.criativos} />
        <KV k="Nova validade" v="06/2027 (12 meses)" />
        <KV k="Termo de cessão" v="Será reemitido para assinatura" /></>}
      </Modal>

      {/* Ver contrato */}
      <Modal open={modal === 'contrato' && !!sel} onClose={() => setModal(null)} icon="doc" iconColor="blue"
        title="Contrato e termo de cessão" sub={sel?.nome}
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Fechar</button><button className="btn btn-primary btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="download" size={13} />Baixar PDF</button></>}>
        <div className="row" style={{ gap: 9, padding: '10px 12px', borderRadius: 11, background: 'var(--green-soft)', border: '1px solid oklch(0.72 0.16 158 / 0.25)', marginBottom: 14 }}>
          <Icon name="shield" size={15} style={{ color: 'var(--green)', flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: 'var(--green)' }}>Termo de cessão vigente — criativos liberados para publicação.</span>
        </div>
        <KV k="Status do contrato" v={sel?.contrato} />
        <KV k="Validade" v={sel?.validade} />
        <KV k="Criativos cobertos" v={sel?.criativos} />
        <KV k="Nichos" v={sel?.nichos.join(', ')} />
        <KV k="Contato" v={sel?.contato} mono />
      </Modal>

      {/* Coletar assinatura */}
      <Modal open={modal === 'assinatura' && !!sel} onClose={() => setModal(null)} icon="pencil" iconColor="amber"
        title="Coletar assinatura digital" sub={sel?.nome}
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={() => { sel.termo = true; sel.contrato = 'Ativo'; sel.status = 'vigente'; sel.validade = '06/2027'; setModal(null); window.persistDATA && window.persistDATA(); }}><Icon name="arrow" size={13} />Enviar termo</button></>}>
        <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>Enviar o termo de cessão de direitos para assinatura digital. Enquanto pendente, os criativos deste fornecedor não entram na fila.</p>
        <label className="label">Enviar para</label>
        <input className="input" defaultValue={sel?.contato} />
        <label className="label" style={{ marginTop: 14 }}>Documento</label>
        <input className="input" defaultValue="Termo de Cessão de Imagem e Voz v3.2" readOnly />
      </Modal>

      {/* Novo fornecedor */}
      <Modal open={modal === 'novo'} onClose={() => setModal(null)} icon="plus" iconColor="blue"
        title="Novo fornecedor" sub="Cadastro com contrato e termo"
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={() => {
          if (!fNome.trim()) return;
          const novo = { id: 'f' + Date.now(), nome: fNome.trim(), tipo: fTipo, contato: fContato.trim(), criativos: 0, validade: '—', nichos: [], contrato: 'Pendente', status: 'revisar', termo: false };
          DATA.fornecedores.push(novo);
          setSel(novo);
          setFNome(''); setFContato('');
          setModal(null);
          setTick(t => t + 1);
          window.persistDATA && window.persistDATA();
          window.toast && window.toast('Fornecedor cadastrado');
        }}><Icon name="check" size={13} />Cadastrar</button></>}>
        <label className="label">Nome / Razão social</label>
        <input className="input" value={fNome} onChange={e => setFNome(e.target.value)} placeholder="Ex.: OrganizaJá Ltda" />
        <label className="label" style={{ marginTop: 14 }}>Tipo de fornecedor</label>
        <select className="input" value={fTipo} onChange={e => setFTipo(e.target.value)}>{Object.keys(DATA.tipoForn).map(k => <option key={k}>{k}</option>)}</select>
        <label className="label" style={{ marginTop: 14 }}>E-mail de contato</label>
        <input className="input" value={fContato} onChange={e => setFContato(e.target.value)} placeholder="comercial@fornecedor.com" />
        <div className="row" style={{ gap: 8, marginTop: 14, padding: '9px 11px', borderRadius: 10, background: 'var(--amber-soft)', border: '1px solid oklch(0.80 0.15 70 / 0.25)' }}>
          <Icon name="clock" size={14} style={{ color: 'var(--amber)', flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: 'var(--amber)' }}>O fornecedor só fornece criativos após contrato e termo assinados.</span>
        </div>
      </Modal>
    </div>
  );
};

window.Imagens = Imagens;
window.Fornecedores = Fornecedores;


/* ===== screens-creators.jsx ===== */
/* ============ Creators / UGC ============ */

const creatorHealth = (c) => {
  if (!c.termo && c.entregas > 0) return { ok: false, label: 'Cessão pendente com entregas ativas', cls: 'red' };
  if (c.nota < 4.3) return { ok: false, label: 'Nota abaixo do esperado — revisar qualidade', cls: 'amber' };
  if (c.producao === 0 && c.entregas === 0) return { ok: false, label: 'Sem atividade registrada ainda', cls: 'gray' };
  return { ok: true };
};

const CreatorCard = ({ c, onBriefing, onDelete }) => { const h = creatorHealth(c); return (
  <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(300px 130px at 100% 0%, var(--${c.cor}-soft), transparent 70%)`, pointerEvents: 'none' }} />
    <div className="row spread" style={{ position: 'relative' }}>
      <div className="row" style={{ gap: 11 }}>
        <div className="avatar" style={{ width: 44, height: 44, fontSize: 17, background: `linear-gradient(140deg, var(--${c.cor}), var(--violet-2))`, color: c.cor === 'gold' ? 'oklch(0.2 0.02 70)' : 'white' }}>{c.nome[0]}</div>
        <div>
          <div className="row" style={{ gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 14.5 }}>{c.nome}</span>
            {c.exclusivo && <span className="badge gold" style={{ padding: '1px 7px', fontSize: 9.5 }}><Icon name="crown" size={10} />Exclusivo</span>}
            <span className={`badge ${c.modoColab === 'direcionada' ? 'violet' : 'blue'}`} style={{ padding: '1px 7px', fontSize: 9.5 }}>{c.modoColab === 'direcionada' ? 'Direcionada' : 'Aberta'}</span>
          </div>
          <div className="dim" style={{ fontSize: 12 }}>{c.handle}</div>
        </div>
      </div>
      <span className="row" style={{ gap: 3, fontSize: 12.5, fontWeight: 700, color: 'var(--gold)' }}><Icon name="star" size={13} />{c.nota}</span>
    </div>

    <div className="chips" style={{ position: 'relative', marginTop: 13 }}>
      {c.nicho.map(n => <span key={n} className="badge gray" style={{ padding: '2px 9px' }}>{n}</span>)}
      <span className="badge violet mono" style={{ padding: '2px 9px' }}><Icon name="tag" size={10} />{c.cupom || genCupom(c.handle)}</span>
    </div>

    {!h.ok && (
      <div className="row" style={{ gap: 7, marginTop: 12, padding: '8px 10px', borderRadius: 10, background: `var(--${h.cls}-soft)`, border: `1px solid var(--${h.cls})`, position: 'relative' }}>
        <Icon name="alert" size={13} style={{ color: `var(--${h.cls})`, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, color: `var(--${h.cls})` }}>{h.label}</span>
      </div>
    )}
    {c.recusado && (
      <div className="row" style={{ gap: 7, marginTop: 12, padding: '8px 10px', borderRadius: 10, background: 'var(--red-soft)', border: '1px solid var(--red)', position: 'relative' }}>
        <Icon name="x" size={13} style={{ color: 'var(--red)', flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, color: 'var(--red)' }}>Recusou o convite — não está divulgando</span>
      </div>
    )}

    <div className="row" style={{ position: 'relative', marginTop: 15, gap: 0, borderTop: '1px solid var(--border-soft)', paddingTop: 14 }}>
      {[['Entregas', c.entregas],['Em produção', c.producao],['Cachê', 'R$ ' + c.cache]].map(([k,v], i) => (
        <div key={k} className="col" style={{ flex: 1, alignItems: i === 0 ? 'flex-start' : 'center', borderLeft: i ? '1px solid var(--border-soft)' : 'none', paddingLeft: i ? 12 : 0 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>{v}</span>
          <span className="dim" style={{ fontSize: 11 }}>{k}</span>
        </div>
      ))}
    </div>

    <div className="row spread" style={{ position: 'relative', marginTop: 14 }}>
      {c.termo
        ? <span className="row" style={{ gap: 5, fontSize: 12, color: 'var(--green)', fontWeight: 600 }}><Icon name="shield" size={13} />Cessão até {c.validade}</span>
        : <span className="row" style={{ gap: 5, fontSize: 12, color: 'var(--amber)', fontWeight: 600 }}><Icon name="clock" size={13} />Cessão pendente</span>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-danger btn-sm" style={{ padding: '5px 8px' }} onClick={onDelete} title="Remover"><Icon name="x" size={13} /></button>
        <button className="btn btn-ghost btn-sm" onClick={onBriefing}>Briefing<Icon name="arrow" size={13} /></button>
      </div>
    </div>
  </div>
  );};

const Creators = ({ go }) => {
  const [modal, setModal] = useState(null); // 'contratar' | creator obj para briefing
  const [, setTick] = useState(0);
  const [cNome, setCNome] = useState('');
  const [cHandle, setCHandle] = useState('');
  const [cCache, setCCache] = useState('');
  const [cModo, setCModo] = useState('aberta');
  const [cCupom, setCCupom] = useState('');
  const [loteModal, setLoteModal] = useState(false);
  const [loteModo, setLoteModo] = useState('pct');
  const [loteValor, setLoteValor] = useState('');
  const [lotePreview, setLotePreview] = useState(false);
  const calcNovoCache = (c) => { const v = Number(loteValor) || 0; return loteModo === 'pct' ? Math.round(c.cache * (1 + v/100)) : Math.max(0, c.cache + v); };
  const aplicarLote = () => {
    const n = DATA.creators.filter(c => !c.recusado).length;
    DATA.creators.filter(c => !c.recusado).forEach(c => { c.cache = calcNovoCache(c); });
    DATA.logsAjustes = DATA.logsAjustes || [];
    DATA.logsAjustes.push({ data: new Date().toLocaleDateString('pt-BR'), texto: `Reajuste em lote de cachê (${loteModo === 'pct' ? loteValor + '%' : 'R$ ' + loteValor}) aplicado em ${n} creators` });
    logFinanceiro('reajuste', `Reajuste em lote de cachê (${loteModo === 'pct' ? loteValor + '%' : 'R$ ' + loteValor}) aplicado em ${n} creators`);
    setLoteModal(false);
    setLotePreview(false);
    setTick(t => t + 1);
    window.persistDATA && window.persistDATA();
    window.toast && window.toast('Cachê reajustado para todos os creators ativos');
  };
  const stats = [
    ['users','violet', DATA.creators.length, 'Creators ativos'],
    ['video','blue', DATA.creators.reduce((s,c) => s + c.entregas, 0), 'Entregas no total'],
    ['shield','green', DATA.creators.filter(c => c.termo).length, 'Cessões vigentes'],
    ['dollar','gold', 'R$ ' + DATA.creators.reduce((s,c) => s + Math.max(0, creatorGanho(c) - (c.pagamentos||[]).reduce((s2,pg)=>s2+(pg.valor||0),0)), 0).toLocaleString('pt-BR'), 'A pagar em comissão'],
  ];
  const convitesVendedor = DATA.creators.filter(c => c.convidadoPor && !c.conviteRespondido);
  return (
    <div className="content-inner fade-in">
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 0% 0%, var(--violet-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--violet-soft)', color: 'var(--violet)' }}><Icon name="users" size={22} /></div>
            <div>
              <h2 style={{ fontSize: 18 }}>Creators e UGC</h2>
              <p className="muted" style={{ fontSize: 13 }}>Conteúdo de pessoas reais · todo vídeo entra com <strong style={{ color: 'var(--violet)' }}>cessão de uso assinada</strong></p>
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => { setLoteModo('pct'); setLoteValor(''); setLoteModal(true); }}><Icon name="dollar" size={15} />Reajustar cachê em lote</button>
            <button className="btn btn-violet" onClick={() => setModal('contratar')}><Icon name="plus" size={15} />Contratar creator</button>
          </div>
        </div>
      </div>

      <div className="grid g4">
        {stats.map(([ic,co,v,l]) => <StatCard key={l} icon={ic} color={co} value={v} label={l} />)}
      </div>

      {convitesVendedor.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--gold)', background: 'var(--gold-soft)' }}>
          <div className="row" style={{ gap: 9, marginBottom: 10 }}><Icon name="bag" size={16} style={{ color: 'var(--gold)' }} /><div className="card-title" style={{ fontSize: 14 }}>Convites enviados por vendedores</div></div>
          <div className="col" style={{ gap: 8 }}>
            {convitesVendedor.map(c => (
              <div key={c.id} className="row spread" style={{ padding: '9px 11px', borderRadius: 10, background: 'oklch(1 0 0 / 0.04)' }}>
                <span style={{ fontSize: 13 }}><strong>{c.nome}</strong> — convidado por <strong>{c.convidadoPor}</strong>{c.convidadoPara ? ` para divulgar ${(DATA.produtos.find(p=>p.id===c.convidadoPara)||{}).nome || 'um produto'}` : ''}</span>
                <span className="badge amber" style={{ padding: '2px 8px' }}><Icon name="clock" size={11} />Aguardando aceite do creator</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <SectionTitle action={<button className="btn btn-ghost btn-sm" onClick={() => window.exportCSV('creators', ['Nome','Handle','Cupom','Cach\u00ea','Entregas','Nota','Cess\u00e3o','Colabora\u00e7\u00e3o'], DATA.creators.map(c => [c.nome,c.handle,c.cupom||genCupom(c.handle),c.cache,c.entregas,c.nota,c.termo?'Assinada':'Pendente',c.modoColab]))}><Icon name="download" size={13} />Exportar CSV</button>}>Roster de creators <span className="dim" style={{ fontSize: 12.5, fontWeight: 400 }}>· {DATA.creators.filter(c=>!c.recusado).length} ativos{DATA.creators.some(c=>c.recusado) ? ` · ${DATA.creators.filter(c=>c.recusado).length} recusaram` : ''}</span></SectionTitle>
      <div className="grid g2">
        {DATA.creators.filter(c => !c.recusado).map(c => <CreatorCard key={c.id} c={c} onBriefing={() => setModal(c)} onDelete={() => { if (window.confirm(`Remover ${c.nome} do roster?`)) { DATA.creators = DATA.creators.filter(x => x.id !== c.id); setTick(t => t + 1); window.persistDATA && window.persistDATA(); window.toast && window.toast(c.nome + ' removido'); } }} />)}
      </div>

      {/* Pipeline de produção UGC */}
      <SectionTitle action={<button className="btn btn-ghost btn-sm" onClick={() => go && go('biblioteca')}><Icon name="video" size={13} />Ver acervo</button>}>Pipeline de produção</SectionTitle>
      <div className="grid g4" style={{ alignItems: 'start' }}>
        {DATA.ugcPipeline.map(col => (
          <div key={col.fase} className="col" style={{ gap: 10 }}>
            <div className="row spread" style={{ padding: '0 2px' }}>
              <span className="row" style={{ gap: 7, fontSize: 12.5, fontWeight: 700 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: `var(--${col.cor === 'gray' ? 'text-dim' : col.cor})` }} />{col.fase}
              </span>
              <span className="dim mono" style={{ fontSize: 11.5 }}>{col.itens.length}</span>
            </div>
            {col.itens.map((it, i) => (
              <div key={i} className="card" style={{ padding: 13, borderColor: `oklch(0.5 0.1 285 / 0.2)`, borderLeft: `3px solid var(--${col.cor === 'gray' ? 'border-strong' : col.cor})` }}>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{it.produto}</div>
                <div className="row spread" style={{ marginTop: 10 }}>
                  <span className="row" style={{ gap: 5, fontSize: 11.5 }}>
                    <span className="avatar" style={{ width: 18, height: 18, fontSize: 9 }}>{it.creator[0]}</span>
                    <span className="muted">{it.creator.split(' ')[0]}</span>
                  </span>
                  <span className="dim" style={{ fontSize: 11 }}>{it.prazo}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Briefing de creator */}
      <Modal open={!!modal && typeof modal === 'object'} onClose={() => setModal(null)} icon="video" iconColor="violet" w={480}
        title={`Briefing · ${modal && modal.nome ? modal.nome : ''}`} sub={modal && modal.handle ? modal.handle : ''}
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-violet btn-sm" onClick={() => setModal(null)}><Icon name="arrow" size={13} />Enviar briefing</button></>}>
        {modal && typeof modal === 'object' && (<>
          {!modal.termo && (
            <div className="row" style={{ gap: 9, padding: '10px 12px', borderRadius: 11, background: 'var(--amber-soft)', border: '1px solid oklch(0.80 0.15 70 / 0.25)', marginBottom: 14 }}>
              <Icon name="clock" size={15} style={{ color: 'var(--amber)', flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: 'var(--amber)' }}>Cessão de uso pendente — será coletada junto com o briefing.</span>
            </div>
          )}
          <label className="label">Produto</label>
          <select className="input">{DATA.imagens.map(i => i.produto).filter((v,i,a) => a.indexOf(v) === i).map(p => <option key={p}>{p}</option>)}</select>
          <label className="label" style={{ marginTop: 14 }}>Formato</label>
          <select className="input"><option>Vídeo vertical (UGC)</option><option>Carrossel</option><option>Review unboxing</option></select>
          <label className="label" style={{ marginTop: 14 }}>Orientação</label>
          <textarea className="input" rows={3} placeholder="Tom, ganchos, pontos obrigatórios..." style={{ resize: 'vertical', fontFamily: 'var(--font-body)' }} />
          <div className="row spread" style={{ marginTop: 14, alignItems: 'center' }}>
            <span className="dim" style={{ fontSize: 12 }}>Cachê por entrega</span>
            <div className="row" style={{ gap: 6 }}>
              <span className="mono" style={{ fontSize: 13 }}>R$</span>
              <input className="input" type="number" defaultValue={modal.cache} style={{ width: 90, padding: '5px 8px' }}
                onBlur={e => { modal.cache = Number(e.target.value) || 0; window.persistDATA && window.persistDATA(); setTick(t => t + 1); window.toast && window.toast('Cachê atualizado'); }} />
            </div>
          </div>
          {(() => {
            const produtosVinculados = [modal.convidadoPara, ...(modal.interesses||[])].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).map(id => DATA.produtos.find(p=>p.id===id)).filter(Boolean);
            if (produtosVinculados.length === 0) return null;
            modal.comissoesPersonalizadas = modal.comissoesPersonalizadas || {};
            return (
              <div style={{ marginTop: 16 }}>
                <div className="dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Cachê personalizado por produto (opcional)</div>
                <div className="dim" style={{ fontSize: 11, marginBottom: 8, lineHeight: 1.4 }}>O ganho total usa a média dos valores abaixo, já que as entregas não são contadas por produto individualmente.</div>
                <div className="col" style={{ gap: 7 }}>
                  {produtosVinculados.map(p => (
                    <div key={p.id} className="row spread" style={{ gap: 8 }}>
                      <span style={{ fontSize: 12.5 }}>{p.nome}</span>
                      <div className="row" style={{ gap: 6 }}>
                        <span className="mono" style={{ fontSize: 12.5 }}>R$</span>
                        <input className="input" type="number" defaultValue={modal.comissoesPersonalizadas[p.id] ?? ''} placeholder={String(modal.cache)} style={{ width: 80, padding: '4px 7px' }}
                          onBlur={e => { const v = e.target.value; if (v === '') { delete modal.comissoesPersonalizadas[p.id]; } else { modal.comissoesPersonalizadas[p.id] = Number(v) || 0; } window.persistDATA && window.persistDATA(); setTick(t => t + 1); }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </>)}
      </Modal>

      {/* Contratar creator */}
      <Modal open={modal === 'contratar'} onClose={() => setModal(null)} icon="users" iconColor="violet"
        title="Contratar creator" sub="Cadastro com cessão de uso"
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-violet btn-sm" onClick={() => {
          if (!cNome.trim()) return;
          DATA.creators.push({ id: 'cr' + Date.now(), nome: cNome.trim(), handle: cHandle.trim(), cache: Number(cCache) || 0, entregas: 0, producao: 0, termo: false, cor: 'violet', nicho: [], nota: 0, modoColab: cModo, cupom: cCupom.trim() ? genCupom(cCupom) : genCupom(cHandle) });
          setCNome(''); setCHandle(''); setCCache(''); setCCupom(''); setCModo('aberta');
          setModal(null);
          setTick(t => t + 1);
          window.persistDATA && window.persistDATA();
          window.toast && window.toast('Creator cadastrado');
        }}><Icon name="check" size={13} />Cadastrar</button></>}>
        <label className="label">Nome</label>
        <input className="input" value={cNome} onChange={e => setCNome(e.target.value)} placeholder="Nome do creator" />
        <label className="label" style={{ marginTop: 14 }}>@ do perfil</label>
        <input className="input" value={cHandle} onChange={e => setCHandle(e.target.value)} placeholder="@usuario" />
        <label className="label" style={{ marginTop: 14 }}>Cachê por entrega (R$)</label>
        <input className="input" type="number" value={cCache} onChange={e => setCCache(e.target.value)} placeholder="300" />
        <label className="label" style={{ marginTop: 14 }}>Código de cupom (opcional)</label>
        <input className="input" value={cCupom} onChange={e => setCCupom(e.target.value)} placeholder="Ex.: MARINA10 — gerado automático se vazio" />
        <label className="label" style={{ marginTop: 14 }}>Tipo de colaboração</label>
        <div className="row" style={{ gap: 8 }}>
          {[['aberta','Aberta — qualquer creator se aplica'],['direcionada','Direcionada — só convite']].map(([k,l]) => (
            <div key={k} onClick={() => setCModo(k)} style={{ flex: 1, cursor: 'pointer', padding: '9px 11px', borderRadius: 10, fontSize: 12, fontWeight: 600, textAlign: 'center', border: `1px solid ${cModo===k?'oklch(0.68 0.195 295 / 0.5)':'var(--border-soft)'}`, background: cModo===k?'var(--violet-soft)':'transparent', color: cModo===k?'var(--violet)':'var(--text-muted)' }}>{l}</div>
          ))}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 14, padding: '9px 11px', borderRadius: 10, background: 'var(--violet-soft)', border: '1px solid oklch(0.62 0.18 295 / 0.25)' }}>
          <Icon name="shield" size={14} style={{ color: 'var(--violet)', flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: 'var(--violet)' }}>O termo de cessão de imagem e voz é enviado automaticamente para assinatura digital.</span>
        </div>
      </Modal>

      <Modal open={loteModal} onClose={() => { setLoteModal(false); setLotePreview(false); }} icon="dollar" iconColor="green"
        title="Reajustar cachê em lote" sub="Aplica a todos os creators ativos"
        footer={!lotePreview
          ? <><button className="btn btn-ghost btn-sm" onClick={() => setLoteModal(false)}>Cancelar</button><button className="btn btn-primary btn-sm" disabled={!Number(loteValor)} onClick={() => setLotePreview(true)}><Icon name="eye" size={13} />Ver prévia</button></>
          : <><button className="btn btn-ghost btn-sm" onClick={() => setLotePreview(false)}>Voltar</button><button className="btn btn-primary btn-sm" onClick={aplicarLote}><Icon name="check" size={13} />Confirmar reajuste</button></>}>
        {!lotePreview ? (<>
        <label className="label">Tipo de ajuste</label>
        <div className="row" style={{ gap: 8 }}>
          {[['pct','% sobre o valor atual'],['fixo','Valor fixo (R$)']].map(([k,l]) => (
            <div key={k} onClick={() => setLoteModo(k)} style={{ flex: 1, cursor: 'pointer', padding: '9px 8px', borderRadius: 10, textAlign: 'center', fontSize: 12.5, fontWeight: 600, border: `1px solid ${loteModo===k?'oklch(0.72 0.16 158 / 0.5)':'var(--border-soft)'}`, background: loteModo===k?'var(--green-soft)':'transparent' }}>{l}</div>
          ))}
        </div>
        <label className="label" style={{ marginTop: 14 }}>{loteModo === 'pct' ? 'Percentual (ex.: 10 para +10%, -10 para -10%)' : 'Valor a somar (R$, negativo para reduzir)'}</label>
        <input className="input" type="number" value={loteValor} onChange={e => setLoteValor(e.target.value)} placeholder={loteModo === 'pct' ? 'Ex.: 10' : 'Ex.: 20'} />
        <div className="dim" style={{ fontSize: 11.5, marginTop: 10 }}>Afeta {DATA.creators.filter(c=>!c.recusado).length} creators ativos.</div>
        </>) : (
        <div className="col" style={{ gap: 8 }}>
          <div className="dim" style={{ fontSize: 11.5, marginBottom: 4 }}>Confira antes de aplicar:</div>
          {DATA.creators.filter(c=>!c.recusado).map(c => {
            const novo = calcNovoCache(c);
            return (
              <div key={c.id} className="row spread" style={{ padding: '8px 10px', borderRadius: 9, background: 'oklch(1 0 0 / 0.03)' }}>
                <span style={{ fontSize: 12.5 }}>{c.nome}</span>
                <span className="mono" style={{ fontSize: 12.5 }}>R$ {c.cache} <Icon name="arrow" size={11} style={{ verticalAlign: 'middle' }} /> <strong style={{ color: novo >= c.cache ? 'var(--green)' : 'var(--red)' }}>R$ {novo}</strong></span>
              </div>
            );
          })}
        </div>
        )}
      </Modal>
    </div>
  );
};

window.Creators = Creators;


/* ===== screens-loja.jsx ===== */
/* ============ Loja de Módulos (cliente) ============ */
const Loja = ({ go }) => {
  const S = DATA.saas;
  const [ciclo, setCiclo] = useState('mensal'); // mensal | anual (2 meses grátis)
  const [aba, setAba] = useState('modulos');     // modulos | combos
  const fmt = (v) => v == null ? '' : 'R$ ' + v;
  const precoCiclo = (m) => m == null ? null : ciclo === 'anual' ? Math.round(m * 10) : m;

  const ativos = S.modulos.filter(m => m.ativo);
  const totalMensal = ativos.reduce((s, m) => s + (m.mensal || 0), 0) + S.planoBase.preco;

  return (
    <div className="content-inner fade-in">
      {/* Resumo da assinatura atual */}
      <div className="goal-card" style={{ padding: 22, borderRadius: 18 }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div>
            <span className="dim mono" style={{ fontSize: 12, letterSpacing: '0.04em' }}>SUA ASSINATURA · {ativos.length} módulos + Base</span>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32, marginTop: 8 }}>R$ {totalMensal}<span className="dim" style={{ fontSize: 16, fontWeight: 500 }}>/mês</span></div>
            <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
              <span className="badge gray" style={{ padding: '2px 8px' }}>{S.planoBase.nome}</span>
              {ativos.map(m => <span key={m.id} className={`badge ${m.cor}`} style={{ padding: '2px 8px' }}>{m.nome}</span>)}
            </div>
          </div>
          <div className="col" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div style={{ display: 'inline-flex', padding: 3, borderRadius: 99, background: 'oklch(0 0 0 / 0.3)', border: '1px solid var(--border)' }}>
              {['mensal','anual'].map(c => (
                <button key={c} onClick={() => setCiclo(c)} style={{ padding: '6px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--font-body)', background: ciclo === c ? 'var(--gold)' : 'transparent', color: ciclo === c ? 'oklch(0.2 0.02 70)' : 'var(--text-muted)' }}>{c === 'mensal' ? 'Mensal' : 'Anual'}</button>
              ))}
            </div>
            {ciclo === 'anual' && <span className="badge green" style={{ padding: '2px 8px' }}><Icon name="bolt" size={11} />2 meses grátis</span>}
          </div>
        </div>
      </div>

      <div className="row spread wrap" style={{ gap: 12 }}>
        <div className="chips">
          <div className={`chip ${aba === 'modulos' ? 'active' : ''}`} onClick={() => setAba('modulos')}>Módulos avulsos</div>
          <div className={`chip ${aba === 'combos' ? 'active' : ''}`} onClick={() => setAba('combos')}>Combos</div>
        </div>
        <span className="dim" style={{ fontSize: 12.5 }}>Pague só pelo que usar · ative ou cancele quando quiser</span>
      </div>

      {/* Módulos avulsos */}
      {aba === 'modulos' && (
        <div className="grid g3">
          {S.modulos.map(m => {
            const preco = precoCiclo(m.mensal);
            return (
              <div key={m.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative', borderColor: m.ativo ? `oklch(0.7 0.13 285 / 0.35)` : 'var(--border-soft)' }}>
                {m.selo && <span className={`badge ${window.seloMap[m.selo]}`} style={{ position: 'absolute', top: -10, right: 14, padding: '2px 9px' }}>{m.selo}</span>}
                <div className="row" style={{ gap: 10, marginBottom: 12 }}>
                  <div className="ico" style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: `var(--${m.cor}-soft)`, color: `var(--${m.cor})` }}><Icon name={m.icon} size={20} /></div>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 14.5 }}>{m.nome}</div>{m.ativo && <span className="badge green" style={{ padding: '1px 7px', fontSize: 10, marginTop: 2 }}><span className="dot" />Ativo</span>}</div>
                </div>
                <p className="muted" style={{ fontSize: 12.5, minHeight: 34 }}>{m.desc}</p>
                <div className="col" style={{ gap: 6, margin: '12px 0', flex: 1 }}>
                  {m.recursos.slice(0, 4).map(r => <div key={r} className="row" style={{ gap: 7 }}><Icon name="check" size={12} style={{ color: `var(--${m.cor})`, flexShrink: 0 }} /><span className="muted" style={{ fontSize: 12 }}>{r}</span></div>)}
                </div>
                {/* créditos se houver e ativo */}
                {m.ativo && m.creditos && m.creditos.usado != null && (
                  <div style={{ marginBottom: 12 }}>
                    <div className="row spread" style={{ marginBottom: 5 }}><span className="dim" style={{ fontSize: 11 }}>{m.creditos.label}</span><span className="mono" style={{ fontSize: 11 }}>{m.creditos.usado}/{m.creditos.total}</span></div>
                    <div className="bar violet" style={{ height: 6 }}><i style={{ width: (m.creditos.usado / m.creditos.total * 100) + '%' }} /></div>
                  </div>
                )}
                <div className="divider" style={{ margin: '4px 0 12px' }} />
                <div className="row spread">
                  <div><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>{m.precoLabel || fmt(preco)}</span>{preco != null && <span className="dim" style={{ fontSize: 12 }}>/{ciclo === 'anual' ? 'ano' : 'mês'}</span>}</div>
                  {m.ativo
                    ? <button className="btn btn-ghost btn-sm" onClick={() => m.tela && go(m.tela)}>Abrir<Icon name="arrow" size={13} /></button>
                    : m.precoLabel
                      ? <button className="btn btn-ghost btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="message" size={13} />Falar</button>
                      : <div className="row" style={{ gap: 7 }}>
                          {m.tela && <button className="btn btn-ghost btn-sm" onClick={() => go(m.tela)}><Icon name="eye" size={13} />Prévia</button>}
                          <button className="btn btn-primary btn-sm" onClick={() => { m.ativo = true; window.__rerender(); }}><Icon name="plus" size={13} />Ativar</button>
                        </div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Combos */}
      {aba === 'combos' && (
        <div className="grid g3">
          {S.combos.map(c => {
            const preco = precoCiclo(c.preco);
            return (
              <div key={c.id} className="card" style={{ position: 'relative', borderColor: c.selo ? `oklch(0.84 0.155 86 / 0.4)` : 'var(--border-soft)', background: c.selo ? 'radial-gradient(400px 160px at 50% 0%, var(--gold-soft), transparent 65%), var(--surface)' : undefined }}>
                {c.selo && <span className={`badge ${window.seloMap[c.selo]}`} style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', padding: '2px 10px' }}>{c.selo}</span>}
                <div className="ico" style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: `var(--${c.cor}-soft)`, color: `var(--${c.cor})`, margin: '4px 0 12px' }}><Icon name="layers" size={20} /></div>
                <div style={{ fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-display)' }}>Combo {c.nome}</div>
                <div className="row" style={{ alignItems: 'flex-end', gap: 6, marginTop: 10 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28 }}>{fmt(preco)}</span>
                  <span className="dim" style={{ fontSize: 13, marginBottom: 4 }}>/{ciclo === 'anual' ? 'ano' : 'mês'}</span>
                </div>
                <span className="badge green" style={{ padding: '2px 8px', marginTop: 8 }}><Icon name="dollar" size={11} />Economia de R$ {c.economia}/mês</span>
                <div className="col" style={{ gap: 7, margin: '14px 0' }}>
                  {c.mods.map(r => <div key={r} className="row" style={{ gap: 7 }}><Icon name="check" size={13} style={{ color: `var(--${c.cor})`, flexShrink: 0 }} /><span style={{ fontSize: 12.5 }}>{r}</span></div>)}
                </div>
                <button className={`btn ${c.selo ? 'btn-primary' : 'btn-ghost'}`} style={{ width: '100%', marginTop: 'auto' }} onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="rocket" size={14} />Assinar combo</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="dim" style={{ fontSize: 12, textAlign: 'center' }}>Upgrade, downgrade ou cancelamento a qualquer momento · créditos extras de IA, usuários e marcas adicionais sob demanda</div>
    </div>
  );
};

window.Loja = Loja;


/* ===== screens-compliance.jsx ===== */
/* ============ Compliance Jurídico ============ */

const Compliance = ({ go, role, locked }) => {
  const C = DATA.compliance;
  const ro = role === 'operador'; // somente leitura
  const [modal, setModal] = useState(null);
  const ring = `conic-gradient(var(--amber) ${C.score * 3.6}deg, oklch(0 0 0 / 0.35) 0deg)`;
  // roteia a ação de "Resolver" do checklist
  const resolverItem = (item) => {
    if (item.includes('banco de imagens')) return go && go('fornecedores');
    if (item.includes('claims')) return setModal('claims');
    return setModal('generico');
  };
  // roteia a ação de cada bloqueio
  const resolverBloqueio = (b) => {
    if (b.acao === 'Solicitar licença') return go && go('fornecedores');
    if (b.acao === 'Substituir') return go && go('imagens');
    return setModal('reescrever');
  };
  return (
    <div className={`content-inner fade-in${ro ? ' preview-locked' : ''}`}>
      {locked && !ro && <PaywallBanner mod={locked} go={go} onActivate={() => { locked.ativo = true; window.__rerender(); }} />}
      {ro && (
        <div className="row" style={{ gap: 10, padding: '11px 16px', borderRadius: 12, background: 'var(--violet-soft)', border: '1px solid oklch(0.62 0.18 295 / 0.28)' }}>
          <Icon name="lock" size={15} style={{ color: 'var(--violet)', flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: 'var(--violet)' }}>Modo <strong>operador</strong> · visualização somente leitura. Resolver pendências e assinar termos é ação do administrador.</span>
        </div>
      )}
      <div className="card" style={{ background: 'radial-gradient(600px 200px at 0% 0%, var(--amber-soft), transparent 60%), var(--surface)' }}>
        <div className="row spread wrap" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="ico" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--amber-soft)', color: 'var(--amber)' }}><Icon name="scale" size={22} /></div>
            <div>
              <h2 style={{ fontSize: 18 }}>Compliance Jurídico</h2>
              <p className="muted" style={{ fontSize: 13 }}>Autorizações, termos, logs e bloqueios · nada é publicado <strong style={{ color: 'var(--amber)' }}>sem respaldo jurídico</strong></p>
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => setModal('relatorio')}><Icon name="download" size={15} />Exportar relatório</button>
        </div>
      </div>

      {/* Score + checklist */}
      <div className="grid g2" style={{ gridTemplateColumns: '0.85fr 1.15fr', alignItems: 'start' }}>
        {/* Score hero */}
        <div className="goal-card" style={{ padding: 22 }}>
          <div className="row" style={{ gap: 18 }}>
            <div style={{ position: 'relative', width: 112, height: 112, borderRadius: 99, background: ring, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <div style={{ position: 'absolute', inset: 9, borderRadius: 99, background: 'oklch(0.18 0.02 285)', display: 'grid', placeItems: 'center' }}>
                <div className="col" style={{ alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30, lineHeight: 1, color: 'var(--amber)' }}>{C.score}</span>
                  <span className="dim" style={{ fontSize: 9.5, letterSpacing: '0.08em' }}>/ 100</span>
                </div>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <span className="dim mono" style={{ fontSize: 11, letterSpacing: '0.05em' }}>ÍNDICE DE CONFORMIDADE</span>
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6, lineHeight: 1.3 }}>Operação em conformidade, com pendências pontuais</div>
              <span className="badge amber" style={{ marginTop: 10 }}><Icon name="alert" size={11} />2 itens exigem ação</span>
            </div>
          </div>
          <div className="grid g2" style={{ gap: 10, marginTop: 18 }}>
            {[['check','green', C.conformes,'Conteúdos conformes'],['ban','red', C.bloqueados,'Bloqueados'],['shield','blue', C.autorizacoes,'Autorizações vigentes'],['clock','amber', C.vencendo,'Vencendo em 30d']].map(([ic,co,v,l]) => (
              <div key={l} className="row" style={{ gap: 10, padding: '11px 12px', borderRadius: 12, background: 'oklch(0 0 0 / 0.22)', border: '1px solid var(--border-soft)' }}>
                <div className="ico" style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: `var(--${co}-soft)`, color: `var(--${co})`, flexShrink: 0 }}><Icon name={ic} size={16} /></div>
                <div className="col"><span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, lineHeight: 1 }}>{v}</span><span className="dim" style={{ fontSize: 10.5 }}>{l}</span></div>
              </div>
            ))}
          </div>
        </div>

        {/* Checklist */}
        <div className="card">
          <div className="card-head" style={{ marginBottom: 14 }}>
            <div className="ico" style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--amber-soft)', color: 'var(--amber)' }}><Icon name="checkCircle" size={18} /></div>
            <div><div className="card-title">Checklist jurídico</div><div className="card-desc">Verificações automáticas da conta</div></div>
          </div>
          <div className="col" style={{ gap: 2 }}>
            {C.checklist.map((c, i) => (
              <div key={i} className="row" style={{ gap: 12, padding: '11px 4px', borderBottom: i < C.checklist.length - 1 ? '1px solid var(--border-soft)' : 'none' }}>
                <div className="ico" style={{ width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', background: c.ok ? 'var(--green-soft)' : 'var(--red-soft)', color: c.ok ? 'var(--green)' : 'var(--red)', flexShrink: 0 }}><Icon name={c.ok ? 'check' : 'x'} size={14} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.item}</div>
                  <div className="dim" style={{ fontSize: 11.5 }}>{c.det}</div>
                </div>
                {!c.ok && !ro && <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={() => resolverItem(c.item)}>Resolver</button>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Documentos + Logs */}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card flush">
          <div className="row spread" style={{ padding: '16px 18px 12px' }}>
            <div className="row" style={{ gap: 10 }}><Icon name="doc" size={17} style={{ color: 'var(--text-muted)' }} /><span className="card-title">Termos e políticas</span></div>
            <button className="btn btn-ghost btn-sm" onClick={(e) => window.toast && window.toast(e.currentTarget.textContent.trim() || 'Ação registrada')}><Icon name="plus" size={13} />Novo</button>
          </div>
          <table className="tbl">
            <thead><tr><th>Documento</th><th>Versão</th><th>Atualizado</th><th className="right">Status</th></tr></thead>
            <tbody>
              {C.documentos.map((d, i) => {
                const m = DATA.docMap[d.status];
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{d.nome}</td>
                    <td className="mono muted" style={{ fontSize: 12.5 }}>{d.versao}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>{d.atualizado}</td>
                    <td className="right"><span className={`badge ${m.cls}`} style={{ padding: '2px 8px' }}>{m.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="row spread" style={{ marginBottom: 16 }}>
            <div className="row" style={{ gap: 10 }}><Icon name="clock" size={17} style={{ color: 'var(--text-muted)' }} /><span className="card-title">Logs de aprovação</span></div>
            <span className="badge gray" style={{ padding: '2px 8px' }}>Auditável</span>
          </div>
          <div className="col" style={{ gap: 0 }}>
            {C.logs.map((l, i) => {
              const m = DATA.logMap[l.tipo];
              return (
                <div key={i} className="row" style={{ gap: 12, alignItems: 'flex-start', paddingBottom: i < C.logs.length - 1 ? 16 : 0 }}>
                  <div className="col" style={{ alignItems: 'center', alignSelf: 'stretch' }}>
                    <div className="ico" style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: `var(--${m.cls}-soft)`, color: `var(--${m.cls})`, flexShrink: 0 }}><Icon name={m.icon} size={14} /></div>
                    {i < C.logs.length - 1 && <div style={{ width: 1, flex: 1, background: 'var(--border-soft)', marginTop: 4 }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
                    <div className="row spread"><span style={{ fontSize: 13, fontWeight: 600 }}>{l.acao}</span><span className="dim" style={{ fontSize: 11 }}>{l.quando}</span></div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 1 }}><span className="mono">{l.alvo}</span></div>
                    {l.motivo && <div style={{ fontSize: 11.5, color: `var(--${m.cls})`, marginTop: 3 }}>{l.motivo}</div>}
                    <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>por {l.quem}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bloqueios ativos */}
      <div className="card flush" style={{ borderColor: 'oklch(0.70 0.19 22 / 0.3)' }}>
        <div className="row spread" style={{ padding: '16px 18px 12px' }}>
          <div className="row" style={{ gap: 10 }}>
            <div className="ico" style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--red-soft)', color: 'var(--red)' }}><Icon name="lock" size={17} /></div>
            <div><div className="card-title">Conteúdos bloqueados</div><div className="card-desc">Não vão para a fila enquanto a pendência existir</div></div>
          </div>
          <span className="badge red" style={{ padding: '3px 9px' }}>{C.bloqueios.length} ativos</span>
        </div>
        <table className="tbl">
          <thead><tr><th>Conteúdo</th><th>Tipo</th><th>Motivo do bloqueio</th><th>Desde</th><th className="right">Ação</th></tr></thead>
          <tbody>
            {C.bloqueios.map((b, i) => (
              <tr key={i}>
                <td className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{b.conteudo}</td>
                <td><span className="badge gray" style={{ padding: '2px 8px' }}>{b.tipo}</span></td>
                <td className="muted" style={{ fontSize: 12.5, maxWidth: 320 }}>{b.motivo}</td>
                <td className="dim" style={{ fontSize: 12 }}>{b.desde}</td>
                <td className="right">{ro
                  ? <span className="dim" style={{ fontSize: 11.5 }}>somente leitura</span>
                  : <button className="btn btn-danger btn-sm" onClick={() => resolverBloqueio(b)}>{b.acao}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Reescrever legenda (claim de risco) */}
      <Modal open={modal === 'reescrever' || modal === 'claims'} onClose={() => setModal(null)} icon="pencil" iconColor="amber" w={500}
        title="Reescrever legenda" sub="Varal Retrátil · Lavanderia funcional"
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={() => setModal(null)}><Icon name="check" size={13} />Aprovar reescrita</button></>}>
        <div className="row" style={{ gap: 9, padding: '10px 12px', borderRadius: 11, background: 'var(--red-soft)', border: '1px solid oklch(0.70 0.19 22 / 0.25)', marginBottom: 14 }}>
          <Icon name="alert" size={15} style={{ color: 'var(--red)', flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: 'var(--red)' }}>Promessa de resultado garantido viola a política de publicidade.</span>
        </div>
        <div className="dim" style={{ fontSize: 10.5, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>Original (bloqueado)</div>
        <div style={{ fontSize: 13, padding: '10px 12px', borderRadius: 10, background: 'oklch(0 0 0 / 0.2)', border: '1px solid var(--border-soft)', marginBottom: 14, lineHeight: 1.5 }}>"Esse varal <mark style={{ background: 'var(--red-soft)', color: 'var(--red)', padding: '0 3px', borderRadius: 3 }}>PROMETO</mark> que vai resolver sua lavanderia e <mark style={{ background: 'var(--red-soft)', color: 'var(--red)', padding: '0 3px', borderRadius: 3 }}>GARANTIDO</mark> deixar tudo seco em 1h!"</div>
        <div className="dim" style={{ fontSize: 10.5, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>Sugestão da IA (conforme)</div>
        <div style={{ fontSize: 13, padding: '10px 12px', borderRadius: 10, background: 'var(--green-soft)', border: '1px solid oklch(0.72 0.16 158 / 0.25)', lineHeight: 1.5 }}>"Esse varal retrátil ajuda a organizar a lavanderia e aproveita melhor o espaço pra secar as roupas. Resultados podem variar. #publi"</div>
      </Modal>

      {/* Resolver genérico */}
      <Modal open={modal === 'generico'} onClose={() => setModal(null)} icon="checkCircle" iconColor="amber"
        title="Resolver pendência" sub="Política de publicidade e claims"
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Fechar</button><button className="btn btn-primary btn-sm" onClick={() => setModal(null)}><Icon name="check" size={13} />Marcar como resolvido</button></>}>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>Revise o item sinalizado e tome a ação recomendada. Ao marcar como resolvido, o índice de conformidade é recalculado e o histórico fica registrado nos logs auditáveis.</p>
      </Modal>

      {/* Exportar relatório */}
      <Modal open={modal === 'relatorio'} onClose={() => setModal(null)} icon="download" iconColor="amber"
        title="Exportar relatório jurídico" sub="Conformidade da conta · BoraComprar"
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Cancelar</button><button className="btn btn-primary btn-sm" onClick={() => setModal(null)}><Icon name="download" size={13} />Gerar PDF</button></>}>
        <KV k="Índice de conformidade" v={`${C.score} / 100`} />
        <KV k="Conteúdos conformes" v={C.conformes} />
        <KV k="Bloqueios ativos" v={C.bloqueios.length} />
        <KV k="Autorizações vigentes" v={C.autorizacoes} />
        <KV k="Período" v="Últimos 90 dias" />
        <div className="row" style={{ gap: 8, marginTop: 14, padding: '9px 11px', borderRadius: 10, background: 'oklch(0 0 0 / 0.18)', border: '1px solid var(--border-soft)' }}>
          <Icon name="doc" size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span style={{ fontSize: 11.5 }} className="muted">Inclui termos, logs de aprovação e trilha de auditoria assinada digitalmente.</span>
        </div>
      </Modal>
    </div>
  );
};

window.Compliance = Compliance;


/* ===== app.jsx ===== */
/* ============ Login + App Router ============ */
const TITLES = {
  dashboard: ['Dashboard', 'Visão geral das suas metas e operação'],
  metas: ['Painel de Metas', 'Metas por equipe, rankings e desempenho'],
  radar: ['Radar de Tendências', 'Inspiração viral — sem copiar ninguém'],
  gerar: ['Transformador IA', 'Tendência → conteúdo 100% próprio'],
  conteudos: ['Banco de Conteúdos', 'Todos os criativos da operação'],
  aprovacao: ['Aprovar Agora', 'Você só decide o que importa'],
  calendario: ['Calendário Editorial', '6 a 10 vídeos por dia, no automático'],
  produtos: ['Produtos Afiliados', 'Seu catálogo de achadinhos'],
  biblioteca: ['Vídeos Autorizados', 'Acervo seguro — só o que pode postar'],
  videoseller: ['Patrono Video Seller', 'A IA monta o vídeo do roteiro ao render'],
  series: ['Séries Fixas', 'Linhas editoriais recorrentes'],
  lucro: ['Lucro e Escala', 'Quanto você lucra e o que escalar'],
  relatorios: ['Relatórios', 'O que está dando resultado'],
  lucro: ['Painel de Lucro e Escala', 'Quanto você lucra e o que vale escalar'],
  decisao: ['Motor de Decisão', 'Campeão, variação ou pausa — automático'],
  links: ['Links Dinâmicos', 'Rastreamento de cliques e vendas'],
  publicacao: ['Publicação', 'Conecte suas redes e publique no automático ou manual'],
  contas: ['Contas e Nichos', 'Várias contas, cada uma com seus nichos · alterne a conta de trabalho'],
  usuarios: ['Usuários e permissões', 'Administradores e operadores'],
  vendedores: ['Vendedores', 'Quem cadastra e vende os produtos afiliados'],
  financeiro: ['Financeiro', 'Visão consolidada de mensalidades e comissões'],
  historico_financeiro: ['Histórico Financeiro', 'Todas as ações financeiras registradas'],
  demo: ['Como Funciona', 'Demonstração do fluxo completo da plataforma'],
  loja: ['Loja de Módulos', 'Contrate só o que precisar · módulos e combos'],
  admin_saas: ['Módulos e Receita', 'Painel da dona — vendas, uso e churn por módulo'],
  integracoes: ['Integrações', 'Publicação e plataformas de afiliados'],
  monetizacao: ['Monetização', 'Receita por plataforma e produto'],
  whatsapp: ['WhatsApp em Massa', 'Disparo de achadinhos'],
  imagens: ['Imagens e Criativos', 'Capas, carrosséis, banners e thumbnails — com autorização'],
  fornecedores: ['Fornecedores', 'Quem fornece produtos e criativos · contratos e termos'],
  creators: ['Creators e UGC', 'Creators contratados, entregas e cessão de uso'],
  compliance: ['Compliance Jurídico', 'Autorizações, termos, logs e bloqueios — risco sob controle'],
};

const SCREENS = {
  dashboard: 'Dashboard', radar: 'Radar', gerar: 'Gerar', conteudos: 'Conteudos',
  aprovacao: 'Aprovacao', calendario: 'Calendario', produtos: 'Produtos',
  biblioteca: 'Biblioteca', series: 'Series', relatorios: 'Relatorios',
  decisao: 'Decisao', integracoes: 'Integracoes', monetizacao: 'Monetizacao', whatsapp: 'WhatsApp',
  videoseller: 'VideoSeller', links: 'Links', publicacao: 'Publicacao', usuarios: 'Usuarios', vendedores: 'Vendedores', financeiro: 'Financeiro', historico_financeiro: 'HistoricoFinanceiro', lucro: 'Lucro', metas: 'Metas', demo: 'ComoFunciona', loja: 'Loja', admin_saas: 'AdminSaas', contas: 'Contas',
  imagens: 'Imagens', fornecedores: 'Fornecedores', creators: 'Creators', compliance: 'Compliance',
};

const PasswordInput = ({ value, onChange, placeholder }) => {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input className="input" type={show ? 'text' : 'password'} value={value} onChange={onChange} placeholder={placeholder} style={{ paddingRight: 40 }} />
      <button type="button" onClick={() => setShow(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4, display: 'flex' }} title={show ? 'Ocultar senha' : 'Mostrar senha'}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={16} />
      </button>
    </div>
  );
};

const Login = ({ onEnter }) => {
  const [mode, setMode] = useState('login');
  const [pw, setPw] = useState('');
  const [rpw, setRpw] = useState('');
  const [fEmail, setFEmail] = useState('');
  return (
  <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
    {/* brand panel */}
    <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 48,
      '--text': 'oklch(0.975 0.008 90)', '--text-muted': 'oklch(0.70 0.020 285)', '--text-dim': 'oklch(0.56 0.020 285)', color: 'oklch(0.975 0.008 90)',
      background: 'radial-gradient(700px 500px at 20% 10%, var(--violet-soft), transparent 55%), radial-gradient(600px 400px at 90% 90%, var(--gold-soft), transparent 55%), linear-gradient(160deg, oklch(0.2 0.03 290), oklch(0.14 0.016 285))' }}>
      <div className="row" style={{ gap: 12 }}>
        <div className="brand-mark" style={{ width: 44, height: 44 }}><BrandMark /></div>
        <div><div className="brand-name" style={{ fontSize: 18 }}>Patrono Seller</div><div className="brand-sub">IA</div></div>
      </div>
      <div>
        <div className="badge violet" style={{ marginBottom: 20 }}><Icon name="rocket" size={12} />Fábrica de conteúdo próprio</div>
        <h1 style={{ fontSize: 42, lineHeight: 1.08, letterSpacing: '-0.03em', maxWidth: 460 }}>
          Cresça nas <span style={{ background: 'linear-gradient(100deg, var(--gold), var(--gold-2))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Redes Sociais</span>, no automático.
        </h1>
        <p className="muted" style={{ fontSize: 15, marginTop: 16, maxWidth: 420 }}>
          Tendências viram roteiros próprios; vídeos e carrosséis autorizados entram na fila e a IA posta de 6 a 10 vezes por dia. Você só aprova o que importa.
        </p>
      </div>
      <div className="dim" style={{ fontSize: 12 }}>Grupo Patrono · 2026</div>
    </div>
    {/* form */}
    <div style={{ display: 'grid', placeItems: 'center', padding: 32, background: 'var(--bg)' }}>
      {mode === 'login' ? (
      <div key="login-form" style={{ width: '100%', maxWidth: 360 }}>
        <h2 style={{ fontSize: 24 }}>Entrar na plataforma</h2>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 4, marginBottom: 26 }}>Seu assistente de vendas inteligente</p>
        <label className="label">Email</label>
        <input className="input" placeholder="voce@email.com" />
        <div className="row spread" style={{ marginTop: 16 }}>
          <label className="label" style={{ margin: 0 }}>Senha</label>
          <a style={{ fontSize: 11.5, color: 'var(--gold)', fontWeight: 600, cursor: 'pointer' }} onClick={() => { setFEmail(''); setMode('forgot'); }}>Esqueci minha senha</a>
        </div>
        <PasswordInput value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••" />
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 24, padding: '12px' }} onClick={onEnter}>Entrar<Icon name="arrow" size={16} /></button>
        <div className="row" style={{ gap: 8, justifyContent: 'center', marginTop: 18 }}>
          <span className="dim" style={{ fontSize: 12.5 }}>Não tem acesso?</span>
          <a style={{ fontSize: 12.5, color: 'var(--gold)', fontWeight: 600, cursor: 'pointer' }} onClick={() => setMode('register')}>Solicitar cadastro</a>
        </div>
      </div>
      ) : mode === 'forgot' ? (
      <div key="forgot-form" style={{ width: '100%', maxWidth: 360 }}>
        <h2 style={{ fontSize: 24 }}>Recuperar senha</h2>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 4, marginBottom: 26 }}>Enviamos um link de redefinição para o seu email</p>
        <label className="label">Email</label>
        <input className="input" value={fEmail} onChange={e => setFEmail(e.target.value)} placeholder="voce@email.com" />
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 20, padding: '12px' }} onClick={() => { if (!fEmail.trim()) return; window.toast && window.toast('Link de recuperação enviado para ' + fEmail); setMode('login'); }}>Enviar link de recuperação<Icon name="arrow" size={16} /></button>
        <div className="row" style={{ gap: 8, justifyContent: 'center', marginTop: 18 }}>
          <a style={{ fontSize: 12.5, color: 'var(--gold)', fontWeight: 600, cursor: 'pointer' }} onClick={() => setMode('login')}>Voltar para o login</a>
        </div>
      </div>
      ) : (
      <div key="register-form" style={{ width: '100%', maxWidth: 360 }}>
        <h2 style={{ fontSize: 24 }}>Solicitar cadastro</h2>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 4, marginBottom: 26 }}>Sua conta passa por aprovação do administrador</p>
        <label className="label">Nome completo</label>
        <input className="input" placeholder="Seu nome" />
        <label className="label" style={{ marginTop: 16 }}>Email</label>
        <input className="input" placeholder="voce@email.com" />
        <label className="label" style={{ marginTop: 16 }}>Senha</label>
        <PasswordInput value={rpw} onChange={e => setRpw(e.target.value)} placeholder="••••••••" />
        <div className="row" style={{ gap: 8, marginTop: 14, padding: '10px 12px', borderRadius: 11, background: 'var(--amber-soft)', border: '1px solid oklch(0.80 0.15 70 / 0.25)' }}>
          <Icon name="clock" size={14} style={{ color: 'var(--amber)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--amber)' }}>Após enviar, aguarde a liberação no painel de aprovações.</span>
        </div>
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, padding: '12px' }} onClick={onEnter}>Enviar solicitação<Icon name="arrow" size={16} /></button>
        <div className="row" style={{ gap: 8, justifyContent: 'center', marginTop: 18 }}>
          <span className="dim" style={{ fontSize: 12.5 }}>Já tem conta?</span>
          <a style={{ fontSize: 12.5, color: 'var(--gold)', fontWeight: 600, cursor: 'pointer' }} onClick={() => setMode('login')}>Entrar</a>
        </div>
      </div>
      )}
    </div>
  </div>
  );
};

/* ============ Sino de notificações reutilizável (portais) ============ */
const getDismissed = () => { try { const raw = JSON.parse(localStorage.getItem('patrono_notifs_lidas') || '[]'); const now = Date.now(); const fresh = raw.filter(e => now - e.ts < 86400000); if (fresh.length !== raw.length) localStorage.setItem('patrono_notifs_lidas', JSON.stringify(fresh)); return new Set(fresh.map(e => e.text)); } catch (e) { return new Set(); } };
const dismissNotif = (text) => { try { const raw = JSON.parse(localStorage.getItem('patrono_notifs_lidas') || '[]'); raw.push({ text, ts: Date.now() }); localStorage.setItem('patrono_notifs_lidas', JSON.stringify(raw)); } catch (e) {} };

/* ============ Sino de notificações reutilizável (portais) ============ */
const PortalBell = ({ notifs }) => {
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const dismissed = getDismissed();
  const visiveis = notifs.filter(n => !dismissed.has(n.text));
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-icon btn-ghost" style={{ position: 'relative' }} onClick={() => setOpen(o => !o)}>
        <Icon name="bell" size={16} />
        {visiveis.length > 0 && <span style={{ position: 'absolute', top: 5, right: 6, width: 7, height: 7, borderRadius: 99, background: 'var(--amber)', border: '2px solid var(--surface)' }} />}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 100, width: 300, maxHeight: 320, overflowY: 'auto', marginTop: 6, borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: 6 }}>
          <div className="nav-group-label" style={{ padding: '6px 8px 4px' }}>Notificações</div>
          {visiveis.length === 0 ? (
            <div className="dim" style={{ padding: '14px 10px', fontSize: 12.5 }}>Nenhuma pendência agora.</div>
          ) : visiveis.map((n, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 9px', borderRadius: 9 }}>
              <Icon name={n.icon} size={14} style={{ color: `var(--${n.co})`, flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 12.5, lineHeight: 1.4, flex: 1 }}>{n.text}</span>
              <button onClick={() => { dismissNotif(n.text); setTick(t => t + 1); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', flexShrink: 0, padding: 2 }} title="Marcar como lido"><Icon name="x" size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ============ Portal do Afiliado (creator) ============ */
const AfiliadoPortal = ({ role, setRole }) => {
  const [, setTick] = useState(0);
  const bump = () => { setTick(t => t + 1); window.persistDATA && window.persistDATA(); };
  const [meuId, setMeuId] = useState(() => localStorage.getItem('patrono_meu_creator') || (DATA.creators[0] && DATA.creators[0].id) || null);
  React.useEffect(() => { if (meuId) localStorage.setItem('patrono_meu_creator', meuId); }, [meuId]);
  const eu = DATA.creators.find(c => c.id === meuId) || DATA.creators[0] || null;
  const disponiveis = DATA.produtos.filter(p => p.status !== 'pausado');
  const ganhoTotal = eu ? creatorGanho(eu) : 0;
  const meuCupom = eu ? (eu.cupom || genCupom(eu.handle)) : '';
  const meuStats = eu ? linkStatsForCupom(meuCupom) : { cliques: 0, vendas: 0 };
  const pedirAcesso = () => {
    DATA.solicitacoes.push({ id: 's' + Date.now(), nome: 'Novo afiliado (portal)', email: '—', quando: 'agora' });
    window.persistDATA && window.persistDATA();
    window.toast && window.toast('Solicitação enviada ao administrador');
  };
  const [recusaModal, setRecusaModal] = useState(false);
  const [motivoRecusa, setMotivoRecusa] = useState('');
  const confirmarRecusa = () => {
    eu.conviteRespondido = true; eu.recusado = true; eu.motivoRecusa = motivoRecusa.trim() || 'Não informado';
    setRecusaModal(false); setMotivoRecusa('');
    bump();
    window.toast && window.toast('Convite recusado');
  };
  const meusNotifs = [
    ...(eu && !eu.termo ? [{ icon:'clock', co:'amber', text:'Sua cessão de imagem e voz está pendente de assinatura' }] : []),
    ...disponiveis.filter(p => p.status === 'novo').map(p => ({ icon:'sparkles', co:'violet', text:`Novo produto disponível para divulgar: ${p.nome}` })),
  ];
  const [buscaProd, setBuscaProd] = useState('');
  const disponiveisFiltrados = disponiveis.filter(p => !buscaProd.trim() || p.nome.toLowerCase().includes(buscaProd.toLowerCase()) || (p.cat||'').toLowerCase().includes(buscaProd.toLowerCase()));
  const totalPago = eu ? (eu.pagamentos||[]).reduce((s,pg) => s + (pg.valor||0), 0) : 0;
  const saldoPendente = Math.max(0, ganhoTotal - totalPago);
  const solicitarDivulgacao = (p) => {
    if (!eu) return;
    eu.interesses = eu.interesses || [];
    if (eu.interesses.includes(p.id)) return;
    eu.interesses.push(p.id);
    bump();
    window.toast && window.toast('Solicitação enviada para divulgar ' + p.nome);
  };

  return (
    <div className="app" style={{ gridTemplateColumns: '1fr' }}>
      <div className="main">
        <div className="topbar" style={{ flexWrap: 'wrap', height: 'auto', rowGap: 8 }}>
          <div className="row" style={{ gap: 10 }}><div className="brand-mark" style={{ width: 32, height: 32 }}><BrandMark /></div><h1 style={{ fontSize: 17 }}>Portal do Afiliado</h1></div>
          <div className="topbar-spacer" />
          {DATA.creators.length > 1 && (
            <select className="input" style={{ width: 200 }} value={meuId || ''} onChange={e => setMeuId(e.target.value)}>
              {DATA.creators.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          )}
          <div style={{ display: 'inline-flex', padding: 3, borderRadius: 99, background: 'oklch(0 0 0 / 0.3)', border: '1px solid var(--border)' }}>
            {[['admin','Admin'],['afiliado','Afiliado'],['vendedor','Vendedor']].map(([k,l]) => (
              <button key={k} onClick={() => setRole(k)} style={{ padding: '5px 12px', borderRadius: 99, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', background: role === k ? 'var(--violet)' : 'transparent', color: role === k ? 'white' : 'var(--text-muted)' }}>{l}</button>
            ))}
          </div>
          <PortalBell notifs={meusNotifs} />
          {eu && <button className="btn btn-ghost btn-sm" onClick={() => window.exportCSV('meus-ganhos', ['Campo','Valor'], [['Nome',eu.nome],['Handle',eu.handle],['Cupom',meuCupom],['Entregas',eu.entregas],['Ganho total','R$ '+ganhoTotal],['Cliques',meuStats.cliques],['Vendas',meuStats.vendas]])}><Icon name="download" size={13} />Exportar meus dados</button>}
        </div>
        <div className="content">
          <div className="content-inner fade-in">
            {!eu ? (
              <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                <Icon name="users" size={28} style={{ color: 'var(--violet)', marginBottom: 10 }} />
                <h2 style={{ fontSize: 17 }}>Nenhum creator cadastrado ainda</h2>
                <p className="muted" style={{ fontSize: 13, marginTop: 6, marginBottom: 14 }}>Peça para o administrador te contratar em Creators e UGC.</p>
                <button className="btn btn-primary btn-sm" onClick={pedirAcesso}><Icon name="arrow" size={13} />Solicitar acesso agora</button>
              </div>
            ) : eu.convidadoPor && !eu.conviteRespondido ? (
              <div className="card" style={{ padding: 32, textAlign: 'center', maxWidth: 460, margin: '0 auto', borderColor: 'var(--violet)', background: 'var(--violet-soft)' }}>
                <Icon name="users" size={28} style={{ color: 'var(--violet)', marginBottom: 10 }} />
                <h2 style={{ fontSize: 17 }}>Você foi convidado por {eu.convidadoPor}</h2>
                <p className="muted" style={{ fontSize: 13, marginTop: 6, marginBottom: 18 }}>
                  {eu.convidadoPara ? `Para divulgar: ${(DATA.produtos.find(p=>p.id===eu.convidadoPara)||{}).nome || 'um produto'}` : 'Para divulgar produtos da loja.'}
                </p>
                <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
                  <button className="btn btn-danger btn-sm" onClick={() => setRecusaModal(true)}><Icon name="x" size={14} />Recusar</button>
                  <button className="btn btn-primary btn-sm" onClick={() => { eu.conviteRespondido = true; bump(); window.toast && window.toast('Convite aceito! Bem-vindo(a)'); }}><Icon name="check" size={14} />Aceitar convite</button>
                </div>
              </div>
            ) : (<>
              {!eu.termo && (
                <div className="card" style={{ borderColor: 'var(--amber)', background: 'var(--amber-soft)' }}>
                  <div className="row spread wrap" style={{ gap: 12 }}>
                    <div className="row" style={{ gap: 10 }}><Icon name="clock" size={18} style={{ color: 'var(--amber)' }} /><div><div style={{ fontWeight: 600 }}>Cessão de imagem e voz pendente</div><div className="muted" style={{ fontSize: 12.5 }}>Assine para liberar suas entregas e receber comissão.</div></div></div>
                    <button className="btn btn-primary btn-sm" onClick={() => { eu.termo = true; eu.validade = '12 meses'; bump(); window.toast && window.toast('Termo assinado'); }}><Icon name="check" size={13} />Assinar termo</button>
                  </div>
                </div>
              )}
              <div className="grid g3">
                <div className="goal-card">
                  <div className="dim mono" style={{ fontSize: 11.5 }}>GANHOS TOTAIS</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, marginTop: 8 }}>R$ {ganhoTotal.toLocaleString('pt-BR')}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{eu.entregas} entregas · R$ {eu.cache}/entrega</div>
                  <div className="row" style={{ gap: 10, marginTop: 8 }}>
                    <span className="badge green" style={{ padding: '2px 8px' }}>R$ {totalPago.toLocaleString('pt-BR')} pago</span>
                    <span className="badge amber" style={{ padding: '2px 8px' }}>R$ {saldoPendente.toLocaleString('pt-BR')} a receber</span>
                  </div>
                </div>
                <div className="card">
                  <div className="dim" style={{ fontSize: 11.5 }}>SEU LINK E CUPOM</div>
                  <div className="mono" style={{ fontWeight: 700, fontSize: 15, color: 'var(--blue)', marginTop: 8 }}>patrono.link/{(eu.handle||'voce').replace('@','')}</div>
                  <span className="badge violet mono" style={{ marginTop: 8 }}><Icon name="tag" size={11} />{meuCupom}</span>
                  <div className="row" style={{ gap: 14, marginTop: 10 }}>
                    <span className="dim" style={{ fontSize: 11.5 }}>{meuStats.cliques.toLocaleString('pt-BR')} cliques</span>
                    <span className="dim" style={{ fontSize: 11.5, color: 'var(--green)' }}>{meuStats.vendas} vendas</span>
                  </div>
                </div>
                <div className="card">
                  <div className="dim" style={{ fontSize: 11.5 }}>STATUS</div>
                  <div style={{ marginTop: 8 }}>
                    <span className={`badge ${eu.modoColab === 'direcionada' ? 'violet' : 'blue'}`}>{eu.modoColab === 'direcionada' ? 'Colaboração direcionada' : 'Colaboração aberta'}</span>
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 10 }}><Icon name="star" size={13} style={{ color: 'var(--gold)' }} /><span style={{ fontWeight: 600 }}>{eu.nota || '—'}</span><span className="dim" style={{ fontSize: 11.5 }}>nota média</span></div>
                </div>
              </div>

              <div className="card flush">
                <div className="row spread wrap" style={{ padding: '14px 20px', gap: 10 }}>
                  <div className="card-title">Produtos disponíveis para divulgar</div>
                  <div className="input" style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 240 }}>
                    <Icon name="search" size={14} style={{ color: 'var(--text-dim)' }} />
                    <input value={buscaProd} onChange={e => setBuscaProd(e.target.value)} placeholder="Buscar produto..." style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 13, width: '100%', fontFamily: 'var(--font-body)' }} />
                  </div>
                </div>
                {disponiveisFiltrados.length === 0 ? <div className="dim" style={{ padding: '20px' }}>Nenhum produto encontrado.</div> : (
                <table className="tbl">
                  <thead><tr><th>Produto</th><th>Categoria</th><th className="right">Comissão</th><th className="right">Status</th><th className="right">Ação</th></tr></thead>
                  <tbody>
                    {disponiveisFiltrados.map(p => {
                      const solicitado = (eu.interesses||[]).includes(p.id);
                      return (
                      <tr key={p.id}><td style={{ fontWeight: 500 }}>{p.nome}</td><td className="muted">{p.cat}</td><td className="right mono" style={{ color: 'var(--green)' }}>{p.comissao}</td><td className="right"><Badge status={p.status} /></td>
                        <td className="right">{solicitado ? <span className="badge gray" style={{ padding: '2px 8px' }}><Icon name="check" size={11} />Solicitado</span> : <button className="btn btn-primary btn-sm" style={{ padding: '4px 9px' }} onClick={() => solicitarDivulgacao(p)}>Quero divulgar</button>}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                )}
              </div>

              <div className="card flush">
                <div className="row spread" style={{ padding: '14px 20px' }}><div className="card-title">Histórico de pagamento</div></div>
                {(eu.pagamentos||[]).length === 0 ? <div className="dim" style={{ padding: '20px' }}>Nenhum pagamento registrado ainda.</div> : (
                <table className="tbl">
                  <thead><tr><th>Data</th><th className="right">Valor</th><th className="right">Status</th></tr></thead>
                  <tbody>
                    {eu.pagamentos.map((pg,i) => (
                      <tr key={i}><td className="muted">{pg.data}</td><td className="right mono" style={{ color: 'var(--green)' }}>R$ {pg.valor.toLocaleString('pt-BR')}</td><td className="right"><span className="badge green" style={{ padding: '2px 8px' }}><Icon name="check" size={11} />Pago</span></td></tr>
                    ))}
                  </tbody>
                </table>
                )}
              </div>
            </>)}
          </div>
        </div>
      </div>
      <Modal open={recusaModal} onClose={() => setRecusaModal(false)} icon="x" iconColor="red"
        title="Recusar convite" sub="Diga rapidamente o motivo (ajuda o vendedor a ajustar a próxima oferta)"
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setRecusaModal(false)}>Cancelar</button><button className="btn btn-danger btn-sm" onClick={confirmarRecusa}><Icon name="x" size={13} />Confirmar recusa</button></>}>
        <label className="label">Motivo (opcional)</label>
        <textarea className="textarea" value={motivoRecusa} onChange={e => setMotivoRecusa(e.target.value)} placeholder="Ex.: cachê muito baixo, produto não combina com meu público..." style={{ minHeight: 90 }} />
      </Modal>
    </div>
  );
};
window.AfiliadoPortal = AfiliadoPortal;

const creatorCacheEfetivo = (c) => {
  const overrides = c.comissoesPersonalizadas ? Object.values(c.comissoesPersonalizadas) : [];
  if (!overrides.length) return c.cache;
  const media = overrides.reduce((s,v) => s + v, 0) / overrides.length;
  return Math.round(media);
};
const creatorGanho = (c) => creatorCacheEfetivo(c) * c.entregas;
const creatorSaldoPendente = (c) => Math.max(0, creatorGanho(c) - (c.pagamentos||[]).reduce((s,pg)=>s+(pg.valor||0),0));

/* ============ Portal do Vendedor ============ */
const linkStatsForCupom = (cupom) => {
  const links = (DATA.linksDinamicos || []).filter(l => l.cupom === cupom);
  return { cliques: links.reduce((s,l) => s + (l.cliques||0), 0), vendas: links.reduce((s,l) => s + (l.vendas||0), 0) };
};

const VendedorPortal = ({ role, setRole }) => {
  const [, setTick] = useState(0);
  const bump = () => { setTick(t => t + 1); window.persistDATA && window.persistDATA(); };
  const [meuId, setMeuId] = useState(() => localStorage.getItem('patrono_meu_vendedor') || (DATA.vendedores[0] && DATA.vendedores[0].id) || null);
  React.useEffect(() => { if (meuId) localStorage.setItem('patrono_meu_vendedor', meuId); }, [meuId]);
  const eu = DATA.vendedores.find(v => v.id === meuId) || null;
  const meusProdutos = eu ? DATA.produtos.filter(p => p.donoId === eu.id) : [];
  const semDono = DATA.produtos.filter(p => !p.donoId);
  const aprovarCreator = (c) => { c.termo = true; bump(); window.toast && window.toast(c.nome + ' aprovado'); };
  const meusNotifs = [
    ...DATA.creators.filter(c => !c.termo).map(c => ({ icon:'clock', co:'amber', text:`Cessão pendente: ${c.nome}` })),
    ...DATA.creators.filter(c => c.recusado && c.convidadoPor === (eu && eu.nome)).map(c => ({ icon:'x', co:'red', text:`${c.nome} recusou seu convite${c.motivoRecusa ? ': ' + c.motivoRecusa : ''}` })),
    ...semDono.slice(0,5).map(p => ({ icon:'alert', co:'gray', text:`Produto sem dono: ${p.nome}` })),
    ...meusProdutos.filter(p => (DATA.lucro.produtos.find(lp => lp.nome === p.nome) || {}).lucro < 0).map(p => ({ icon:'alert', co:'red', text:`${p.nome} está com lucro negativo — considere revisar ou pausar` })),
  ];
  const [novoNome, setNovoNome] = useState('');
  const criarPerfil = () => {
    if (!novoNome.trim()) return;
    const nv = { id: 'v' + Date.now(), nome: novoNome.trim(), limiteConvites: 3 };
    DATA.vendedores.push(nv);
    setMeuId(nv.id);
    setNovoNome('');
    bump();
    window.toast && window.toast('Perfil de vendedor criado');
  };
  const assumir = (p) => { p.donoId = eu.id; bump(); window.toast && window.toast(p.nome + ' vinculado ao seu perfil'); };
  const pedirAcesso = () => {
    DATA.solicitacoes.push({ id: 's' + Date.now(), nome: 'Novo vendedor (portal)', email: '—', quando: 'agora' });
    window.persistDATA && window.persistDATA();
    window.toast && window.toast('Solicitação enviada ao administrador');
  };
  const pedirUpgrade = () => {
    DATA.solicitacoes.push({ id: 's' + Date.now(), nome: `${eu.nome} pediu upgrade de plano`, email: '—', quando: 'agora', tipo: 'upgrade' });
    window.persistDATA && window.persistDATA();
    window.toast && window.toast('Pedido de upgrade enviado ao administrador');
  };
  const [buscaProd, setBuscaProd] = useState('');
  const [buscaAf, setBuscaAf] = useState('');
  const [convModal, setConvModal] = useState(false);
  const [cvNome, setCvNome] = useState('');
  const [cvHandle, setCvHandle] = useState('');
  const [cvProdutoId, setCvProdutoId] = useState('');
  const [cvCache, setCvCache] = useState('');
  const convitesUsados = DATA.creators.filter(c => c.convidadoPor === (eu && eu.nome) && !c.recusado).length;
  const limiteConvites = eu ? (eu.limiteConvites ?? 3) : 0;
  const convidarAfiliado = () => {
    if (!cvNome.trim()) return;
    if (convitesUsados >= limiteConvites) { window.toast && window.toast('Limite de convites do seu plano atingido'); return; }
    DATA.creators.push({ id: 'cr' + Date.now(), nome: cvNome.trim(), handle: cvHandle.trim(), cache: Number(cvCache) || 0, entregas: 0, producao: 0, termo: false, cor: 'gold', nicho: [], nota: 0, modoColab: 'direcionada', cupom: genCupom(cvHandle || cvNome), convidadoPara: cvProdutoId || null, convidadoPor: eu.nome, conviteRespondido: false });
    setCvNome(''); setCvHandle(''); setCvProdutoId(''); setCvCache(''); setConvModal(false);
    bump();
    window.toast && window.toast('Convite enviado — aguardando o administrador aprovar');
  };
  const marcarPago = (c) => {
    if (!c.termo) { window.toast && window.toast('Cessão de uso pendente — aprove antes de pagar'); return; }
    const ganho = creatorGanho(c);
    const pago = (c.pagamentos||[]).reduce((s,pg)=>s+(pg.valor||0),0);
    const saldo = ganho - pago;
    if (saldo <= 0) { window.toast && window.toast('Nenhum saldo pendente'); return; }
    c.pagamentos = c.pagamentos || [];
    c.pagamentos.push({ data: new Date().toLocaleDateString('pt-BR'), valor: saldo });
    logFinanceiro('comissao', `Comissão de ${c.nome} marcada como paga (R$ ${saldo})`);
    bump();
    window.toast && window.toast('Comissão de ' + c.nome + ' marcada como paga');
  };
  const meusProdutosFiltrados = meusProdutos.filter(p => !buscaProd.trim() || p.nome.toLowerCase().includes(buscaProd.toLowerCase()));
  const creatorsFiltrados = DATA.creators.filter(c => !buscaAf.trim() || c.nome.toLowerCase().includes(buscaAf.toLowerCase()));
  const meusAfiliados = DATA.creators.filter(c => c.convidadoPor === (eu && eu.nome));
  const totalPagoMeusAfiliados = meusAfiliados.reduce((s,c) => s + creatorGanho(c), 0);
  const taxaSobreMeusAfiliados = Math.round(totalPagoMeusAfiliados * ((DATA.config?.taxaPlataforma ?? 5)/100));
  const receitaMeusProdutos = meusProdutos.reduce((s,p) => s + (parseFloat(String(p.comissao).replace(/[^0-9,.-]/g,'').replace(',','.')) || 0) * (p.vendas||0), 0);
  const minhaMargemEstimada = Math.round(receitaMeusProdutos - totalPagoMeusAfiliados - taxaSobreMeusAfiliados - (eu ? custosTotal(eu) : 0));

  return (
    <div className="app" style={{ gridTemplateColumns: '1fr' }}>
      <div className="main">
        <div className="topbar" style={{ flexWrap: 'wrap', height: 'auto', rowGap: 8 }}>
          <div className="row" style={{ gap: 10 }}><div className="brand-mark" style={{ width: 32, height: 32 }}><BrandMark /></div><h1 style={{ fontSize: 17 }}>Portal do Vendedor</h1></div>
          <div className="topbar-spacer" />
          {DATA.vendedores.length > 1 && (
            <select className="input" style={{ width: 200 }} value={meuId || ''} onChange={e => setMeuId(e.target.value)}>
              {DATA.vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
            </select>
          )}
          <div style={{ display: 'inline-flex', padding: 3, borderRadius: 99, background: 'oklch(0 0 0 / 0.3)', border: '1px solid var(--border)' }}>
            {[['admin','Admin'],['afiliado','Afiliado'],['vendedor','Vendedor']].map(([k,l]) => (
              <button key={k} onClick={() => setRole(k)} style={{ padding: '5px 12px', borderRadius: 99, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', background: role === k ? 'var(--gold)' : 'transparent', color: role === k ? 'oklch(0.2 0.02 70)' : 'var(--text-muted)' }}>{l}</button>
            ))}
          </div>
          <PortalBell notifs={meusNotifs} />
          {eu && convitesUsados === limiteConvites - 1 && limiteConvites > 0 && (
            <span className="badge amber" style={{ padding: '2px 8px' }}><Icon name="alert" size={11} />Último convite disponível</span>
          )}
          {eu && <button className="btn btn-violet btn-sm" disabled={convitesUsados >= limiteConvites} onClick={() => { setCvNome(''); setCvHandle(''); setCvProdutoId(meusProdutos[0]?.id || ''); setConvModal(true); }}><Icon name="plus" size={13} />Convidar afiliado ({convitesUsados}/{limiteConvites})</button>}
          {eu && <button className="btn btn-ghost btn-sm" onClick={() => window.exportCSV('meus-produtos', ['Produto','Plataforma','Preço','Comissão','Vendas','Status'], meusProdutos.map(p => [p.nome,p.plat,p.preco,p.comissao,p.vendas,p.status]))}><Icon name="download" size={13} />Exportar meus dados</button>}
        </div>
        <div className="content">
          <div className="content-inner fade-in">
            {!eu ? (
              <div className="card" style={{ padding: 32, textAlign: 'center', maxWidth: 420, margin: '0 auto' }}>
                <Icon name="bag" size={28} style={{ color: 'var(--gold)', marginBottom: 10 }} />
                <h2 style={{ fontSize: 17 }}>Crie seu perfil de vendedor</h2>
                <p className="muted" style={{ fontSize: 13, marginTop: 6, marginBottom: 16 }}>Assim você pode vincular seus produtos e acompanhar seus afiliados.</p>
                <input className="input" value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Seu nome ou nome da loja" />
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={criarPerfil}><Icon name="plus" size={14} />Criar perfil</button>
                <a style={{ display: 'block', marginTop: 14, fontSize: 12.5, color: 'var(--gold)', fontWeight: 600, cursor: 'pointer' }} onClick={pedirAcesso}>Prefiro pedir para o administrador criar meu acesso</a>
              </div>
            ) : (<>
              <div className="grid g4">
                <StatCard icon="bag" color="gold" value={meusProdutos.length} label="Meus produtos" />
                <StatCard icon="star" color="green" value={meusProdutos.filter(p=>p.status==='campeao').length} label="Campeões" />
                <StatCard icon="users" color="violet" value={DATA.creators.length} label="Afiliados divulgando" />
                <StatCard icon="clock" color="amber" value={DATA.creators.filter(c=>!c.termo).length} label="Cessões pendentes" />
                <StatCard icon="dollar" color={minhaMargemEstimada >= 0 ? 'green' : 'red'} value={receitaMeusProdutos === 0 && meusProdutos.length > 0 ? 'Sem vendas' : 'R$ ' + minhaMargemEstimada.toLocaleString('pt-BR')} label="Margem estimada" />
              </div>

              <div className="card" style={{ borderColor: 'var(--gold)' }}>
                <div className="row spread wrap" style={{ gap: 12 }}>
                  <div>
                    <div className="dim" style={{ fontSize: 11.5 }}>MEU PLANO</div>
                    <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>{eu.plano || 'Sem plano definido'}</div>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{eu.mensalidade ? `R$ ${eu.mensalidade}/mês` : 'Grátis'} · {limiteConvites} convites de afiliado</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={pedirUpgrade}><Icon name="arrow" size={13} />Pedir upgrade de plano</button>
                </div>
              </div>

              <div className="card flush">
                <div className="row spread wrap" style={{ padding: '14px 20px', gap: 10 }}>
                  <div className="card-title">Meus produtos</div>
                  <div className="input" style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 220 }}>
                    <Icon name="search" size={14} style={{ color: 'var(--text-dim)' }} />
                    <input value={buscaProd} onChange={e => setBuscaProd(e.target.value)} placeholder="Buscar..." style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 13, width: '100%', fontFamily: 'var(--font-body)' }} />
                  </div>
                </div>
                {meusProdutosFiltrados.length === 0 ? <div className="dim" style={{ padding: '20px' }}>Nenhum produto encontrado.</div> : (
                <table className="tbl">
                  <thead><tr><th>Produto</th><th>Plataforma</th><th className="right">Preço</th><th className="right">Comissão</th><th className="right">Vendas</th><th className="right">Status</th></tr></thead>
                  <tbody>
                    {meusProdutosFiltrados.map(p => (
                      <tr key={p.id}><td style={{ fontWeight: 500 }}>{p.nome}</td><td><span className={`badge ${platColor[p.plat]||'gray'}`} style={{ padding: '2px 8px' }}>{p.plat}</span></td><td className="right mono">{p.preco}</td><td className="right mono" style={{ color: 'var(--green)' }}>{p.comissao}</td><td className="right mono">{p.vendas}</td><td className="right"><Badge status={p.status} /></td></tr>
                    ))}
                  </tbody>
                </table>
                )}
              </div>

              {semDono.length > 0 && (
                <div className="card flush">
                  <div className="row spread" style={{ padding: '14px 20px' }}><div className="card-title">Produtos sem dono no catálogo</div><span className="dim" style={{ fontSize: 12 }}>vincule os que forem seus</span></div>
                  <table className="tbl">
                    <thead><tr><th>Produto</th><th>Plataforma</th><th className="right">Ações</th></tr></thead>
                    <tbody>
                      {semDono.map(p => (
                        <tr key={p.id}><td style={{ fontWeight: 500 }}>{p.nome}</td><td><span className={`badge ${platColor[p.plat]||'gray'}`} style={{ padding: '2px 8px' }}>{p.plat}</span></td><td className="right"><button className="btn btn-ghost btn-sm" onClick={() => assumir(p)}><Icon name="check" size={12} />É meu produto</button></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="card flush">
                <div className="row spread wrap" style={{ padding: '14px 20px', gap: 10 }}>
                  <div className="card-title">Afiliados divulgando meus produtos</div>
                  <div className="input" style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 220 }}>
                    <Icon name="search" size={14} style={{ color: 'var(--text-dim)' }} />
                    <input value={buscaAf} onChange={e => setBuscaAf(e.target.value)} placeholder="Buscar afiliado..." style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text)', fontSize: 13, width: '100%', fontFamily: 'var(--font-body)' }} />
                  </div>
                </div>
                {creatorsFiltrados.length === 0 ? <div className="dim" style={{ padding: '20px' }}>Nenhum afiliado encontrado.</div> : (
                <table className="tbl">
                  <thead><tr><th>Creator</th><th>Cupom</th><th className="right">Cliques</th><th className="right">Vendas</th><th>Colaboração</th><th>Cessão</th><th>Convite</th><th className="right">Ações</th></tr></thead>
                  <tbody>
                    {creatorsFiltrados.map(c => {
                      const cupom = c.cupom || genCupom(c.handle);
                      const stats = linkStatsForCupom(cupom);
                      const pago = (c.pagamentos||[]).reduce((s,pg)=>s+(pg.valor||0),0);
                      const saldo = Math.max(0, creatorGanho(c) - pago);
                      const conviteMeu = c.convidadoPor === (eu && eu.nome);
                      return (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 500 }}>{c.nome}<div className="dim" style={{ fontSize: 11.5 }}>{c.handle}</div></td>
                        <td><span className="badge violet mono" style={{ padding: '2px 8px' }}>{cupom}</span></td>
                        <td className="right mono">{stats.cliques.toLocaleString('pt-BR')}</td>
                        <td className="right mono" style={{ color: 'var(--green)' }}>{stats.vendas}</td>
                        <td className="muted">{c.modoColab === 'direcionada' ? 'Direcionada' : 'Aberta'}</td>
                        <td>{c.termo ? <span className="row" style={{ gap: 4, color: 'var(--green)', fontSize: 12, fontWeight: 600 }}><Icon name="check" size={13} />Assinada</span> : <span className="row" style={{ gap: 4, color: 'var(--amber)', fontSize: 12, fontWeight: 600 }}><Icon name="clock" size={13} />Pendente</span>}</td>
                        <td>{!conviteMeu ? <span className="dim" style={{ fontSize: 12 }}>—</span> : c.recusado ? <span className="badge red" style={{ padding: '2px 8px' }}>Recusou</span> : c.conviteRespondido ? <span className="badge green" style={{ padding: '2px 8px' }}>Aceito</span> : <span className="badge amber" style={{ padding: '2px 8px' }}>Aguardando</span>}</td>
                        <td className="right">
                          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                            {!c.termo && <button className="btn btn-primary btn-sm" onClick={() => aprovarCreator(c)}><Icon name="check" size={12} />Aprovar</button>}
                            {saldo > 0 && <button className="btn btn-ghost btn-sm" onClick={() => marcarPago(c)}><Icon name="dollar" size={12} />Pagar R$ {saldo.toLocaleString('pt-BR')}</button>}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                )}
              </div>
            </>)}
          </div>
        </div>
      </div>
      <Modal open={convModal} onClose={() => setConvModal(false)} icon="users" iconColor="violet"
        title="Convidar afiliado" sub="Colaboração direcionada para um dos seus produtos"
        footer={<><button className="btn btn-ghost btn-sm" onClick={() => setConvModal(false)}>Cancelar</button><button className="btn btn-violet btn-sm" onClick={convidarAfiliado}><Icon name="check" size={13} />Enviar convite</button></>}>
        <label className="label">Nome do creator</label>
        <input className="input" value={cvNome} onChange={e => setCvNome(e.target.value)} placeholder="Ex.: Marina Duarte" />
        <label className="label" style={{ marginTop: 14 }}>@ do perfil</label>
        <input className="input" value={cvHandle} onChange={e => setCvHandle(e.target.value)} placeholder="@usuario" />
        <label className="label" style={{ marginTop: 14 }}>Produto para divulgar</label>
        <select className="input" value={cvProdutoId} onChange={e => setCvProdutoId(e.target.value)}>
          {meusProdutos.length === 0 ? <option value="">Nenhum produto seu ainda</option> : meusProdutos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <label className="label" style={{ marginTop: 14 }}>Cachê por entrega (R$)</label>
        <input className="input" type="number" value={cvCache} onChange={e => setCvCache(e.target.value)} placeholder="Ex.: 100" />
        <div className="row" style={{ gap: 8, marginTop: 14, padding: '9px 11px', borderRadius: 10, background: 'var(--violet-soft)', border: '1px solid oklch(0.62 0.18 295 / 0.25)' }}>
          <Icon name="clock" size={14} style={{ color: 'var(--violet)', flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, color: 'var(--violet)' }}>O convite fica pendente até o administrador aprovar a cessão de uso.</span>
        </div>
      </Modal>
    </div>
  );
};
window.VendedorPortal = VendedorPortal;

function App() {
  const [logged, setLogged] = useState(false);
  const [active, setActive] = useState('dashboard');
  const [acctId, setAcctId] = useState((DATA.contas.find(c => c.atual) || DATA.contas[0]).id);
  const [role, setRole] = useState('admin'); // admin | operador
  const [, setTick] = useState(0);
  const [toastMsg, setToastMsg] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  React.useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('patronoSellerData') || 'null');
      if (saved && typeof saved === 'object') {
        Object.keys(saved).forEach(k => {
          const cur = DATA[k];
          const val = saved[k];
          // só aceita se o formato bate com o esperado (evita estado corrompido/antigo quebrar a tela)
          if (Array.isArray(cur) ? Array.isArray(val) : (cur && typeof cur === 'object' ? (val && typeof val === 'object' && !Array.isArray(val)) : true)) {
            DATA[k] = val;
          }
        });
      }
    } catch (e) { try { localStorage.removeItem('patronoSellerData'); } catch (e2) {} }
    window.__rerender = () => {
      setTick(t => t + 1);
      clearTimeout(window.__saveTimer);
      window.__saveTimer = setTimeout(() => {
        try { localStorage.setItem('patronoSellerData', JSON.stringify(DATA)); } catch (e) {}
      }, 400);
    };
  }, []);
  React.useEffect(() => {
    window.toast = (msg) => {
      setToastMsg(msg);
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(() => setToastMsg(null), 2400);
    };
  }, []);
  const [theme, setTheme] = useState(() => localStorage.getItem('patrono_theme') || 'dark');
  React.useEffect(() => { document.body.setAttribute('data-theme', theme); localStorage.setItem('patrono_theme', theme); }, [theme]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const go = (id) => { setActive(id); document.querySelector('.content')?.scrollTo(0, 0); };
  const switchAcct = (id) => { setAcctId(id); go('dashboard'); };

  if (!logged) return <Login onEnter={() => setLogged(true)} />;

  if (role === 'afiliado') return <AfiliadoPortal role={role} setRole={setRole} />;
  if (role === 'vendedor') return <VendedorPortal role={role} setRole={setRole} />;

  const acct = DATA.contas.find(c => c.id === acctId) || DATA.contas[0];

  // telas que o operador NÃO acessa (Compliance fica liberado em modo somente-leitura)
  const adminOnly = ['lucro','decisao','aprovacao','contas','links','publicacao','integracoes','monetizacao','whatsapp','usuarios','vendedores','financeiro','historico_financeiro','loja','admin_saas','demo','fornecedores'];
  const viewerAllowed = ['dashboard','metas','relatorios','lucro','calendario'];
  const activeSafe = role === 'convidado' ? (viewerAllowed.includes(active) ? active : 'dashboard') : (role === 'operador' && adminOnly.includes(active)) ? 'dashboard' : active;

  const Screen = window[SCREENS[activeSafe]] || window.Dashboard;
  const [title, sub] = TITLES[activeSafe] || ['', ''];
  // módulo da Loja vinculado a esta tela, se ainda não contratado → prévia/paywall
  const lockedMod = DATA.saas.modulos.find(m => m.tela === activeSafe && !m.ativo) || null;
  const extraProps = activeSafe === 'contas' ? { acct, onSwitch: switchAcct } : {};

  const notifs = [
    ...(DATA.logsAjustes||[]).slice(-3).map(l => ({ icon:'dollar', co:'blue', text: l.texto + ' (' + l.data + ')', go:'creators' })),
    ...DATA.aprovacoes.map(a => ({ icon:'bell', co:'amber', text: `Pendente de aprovação: ${a.produto || 'item'}`, go:'aprovacao' })),
    ...DATA.creators.filter(c => c.recusado).map(c => ({ icon:'x', co:'red', text:`${c.nome} recusou o convite de ${c.convidadoPor || 'um afiliado'}${c.motivoRecusa ? ' — ' + c.motivoRecusa : ''}`, go:'creators' })),
    ...DATA.solicitacoes.map(s => ({ icon:'users', co:'violet', text: `Solicitação de cadastro: ${s.nome}`, go:'usuarios' })),
    ...DATA.fornecedores.filter(f => f.status !== 'vigente').map(f => ({ icon:'alert', co:'red', text: `Contrato de ${f.nome} precisa de atenção`, go:'fornecedores' })),
    ...(DATA.compliance.vencendo > 0 ? [{ icon:'clock', co:'amber', text: `${DATA.compliance.vencendo} autorização(ões) vencendo no Compliance`, go:'compliance' }] : []),
  ];
  const notifCount = notifs.filter(n => !getDismissed().has(n.text)).length;
  const notifsVisiveis = notifs.filter(n => !getDismissed().has(n.text));

  return (
    <div className="app">
      <Sidebar active={activeSafe} go={go} acct={acct} accts={DATA.contas} onSwitch={switchAcct} role={role} mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      <div className="main">
        <div className="topbar">
          <button className="btn btn-icon btn-ghost mobile-menu-btn" onClick={() => setMobileNavOpen(true)}><Icon name="menu" size={18} /></button>
          <div><h1>{title}</h1><div className="topbar-sub">{sub}</div></div>
          <div className="topbar-spacer" />
          {/* Seletor de visão (demo) */}
          <select className="input" style={{ width: 150, padding: '5px 10px', fontSize: 12 }} value={role} onChange={e => { setRole(e.target.value); go('dashboard'); }}>
            {[['admin','Admin'],['operador','Operador'],['convidado','Convidado'],['afiliado','Afiliado'],['vendedor','Vendedor']].map(([k,l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <button className="btn btn-icon btn-ghost" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
          <button className="btn btn-icon btn-ghost" style={{ position: 'relative' }} onClick={() => setNotifOpen(o => !o)}>
            <Icon name="bell" size={16} />
            {notifCount > 0 && <span style={{ position: 'absolute', top: 5, right: 6, width: 7, height: 7, borderRadius: 99, background: 'var(--amber)', border: '2px solid var(--surface)' }} />}
          </button>
          {notifOpen && (
            <div style={{ position: 'absolute', top: 56, right: 90, zIndex: 100, width: 320, maxHeight: 360, overflowY: 'auto', borderRadius: 13, background: 'var(--surface-2)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: 6 }}>
              <div className="nav-group-label" style={{ padding: '6px 8px 4px' }}>Notificações</div>
              {notifsVisiveis.length === 0 ? (
                <div className="dim" style={{ padding: '14px 10px', fontSize: 12.5 }}>Nenhuma pendência agora.</div>
              ) : notifsVisiveis.map((n, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '4px 4px 4px 9px', borderRadius: 9 }}>
                  <button onClick={() => { go(n.go); setNotifOpen(false); }} style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 9, padding: '5px 0', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text)', fontFamily: 'var(--font-body)', textAlign: 'left' }}>
                    <Icon name={n.icon} size={14} style={{ color: `var(--${n.co})`, flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 12.5, lineHeight: 1.4 }}>{n.text}</span>
                  </button>
                  <button onClick={() => { dismissNotif(n.text); setTick(t => t + 1); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', flexShrink: 0, padding: 6 }} title="Marcar como lido"><Icon name="x" size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => go('gerar')}><Icon name="sparkles" size={14} />Gerar</button>
        </div>
        <div className="content">
          <Screen key={activeSafe + role + acctId} go={go} role={role} locked={lockedMod} {...extraProps} />
        </div>
      </div>
      {toastMsg && (
        <div style={{ position: 'fixed', bottom: 26, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 9, padding: '11px 18px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 999, fontSize: 13, fontWeight: 600, maxWidth: 420 }}>
          <Icon name="check" size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toastMsg}</span>
        </div>
      )}
    </div>
  );
}

window.persistDATA = () => { try { localStorage.setItem('patrono_data_v1', JSON.stringify(DATA)); } catch (e) {} };
window.exportCSV = (filename, headers, rows) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  window.toast && window.toast('CSV exportado: ' + a.download);
};
(function restoreDATA() {
  try {
    const saved = JSON.parse(localStorage.getItem('patrono_data_v1') || 'null');
    if (saved && typeof saved === 'object') Object.assign(DATA, saved);
  } catch (e) {}
})();

window.App = App;

