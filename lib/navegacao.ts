/**
 * P2.17.12 / P2.17.13 — A navegação do Patrono, num lugar só.
 *
 * Regra: o menu mostra OPERAÇÃO. Nove itens de primeiro nível, todos com a
 * mesma tipografia; submenus só na área aberta. Nenhuma rota foi excluída:
 * o que saiu do menu (Aprovações, Publicações assistidas, Importar Imagens,
 * Dashboard, Usuários/Permissões) continua acessível por URL, pela área a
 * que pertence (`tambem`) ou pela tela que o usa — e o estado ativo mostra
 * onde a titular está em QUALQUER rota (`estadoDaNavegacao`).
 *
 * Puro (sem React): a Sidebar, o Header, a barra do celular e os testes leem
 * daqui.
 */
import type { ModuloKey } from './modulos'

export interface ItemDeNavegacao {
  href: string
  label: string
  /** Nome do ícone lucide-react (resolvido no componente). */
  icone: string
  modulo: ModuloKey
  /** Só admin vê. */
  soAdmin?: boolean
  /** Contador do sininho. */
  badge?: boolean
  /** Rotas que acendem ESTE item sem aparecer no menu (ex.: detalhe). */
  tambem?: string[]
}

export interface AreaPrincipal extends ItemDeNavegacao {
  /** Submenus CONTEXTUAIS: só aparecem quando a área está aberta. */
  filhos: ItemDeNavegacao[]
  /**
   * Página-resumo da área (Conteúdo, Vendas & Receita, Ferramentas): aparece
   * para quem tem QUALQUER submenu liberado, e o link vai sempre para ela.
   */
  agregadora?: boolean
}

/** A Home. `/` e `/dashboard` levam para cá. */
export const HOME = '/torre'

export const MENU_PRINCIPAL: AreaPrincipal[] = [
  { href: '/torre', label: 'Torre de Controle', icone: 'RadioTower', modulo: 'dashboard', filhos: [], tambem: ['/dashboard'] },
  // P2.18.5: a operação diária acontece aqui (uma página, uma jornada, uma etapa atual).
  { href: '/operacao', label: 'Operação', icone: 'Route', modulo: 'precisa-de-voce', filhos: [] },
  {
    href: '/precisa-de-voce', label: 'Precisa de você', icone: 'BellRing', modulo: 'precisa-de-voce', badge: true, filhos: [],
    // P2.17.13: um caminho só para decidir. As telas antigas seguem por URL e acendem esta área.
    tambem: ['/aprovacao', '/publicacoes-assistidas'],
  },
  {
    href: '/oportunidades', label: 'Oportunidades', icone: 'Sparkles', modulo: 'oportunidades',
    filhos: [
      { href: '/tiktok-metas', label: 'Metas TikTok Shop', icone: 'Trophy', modulo: 'oportunidades' },
      { href: '/programas', label: 'Meus Programas', icone: 'Handshake', modulo: 'programas' },
    ],
  },
  {
    // Importar Imagens virou contingência (fica no produto e por URL).
    href: '/produtos', label: 'Produtos', icone: 'Package', modulo: 'produtos', filhos: [],
  },
  {
    href: '/conteudo', label: 'Conteúdo', icone: 'Library', modulo: 'conteudos', agregadora: true,
    filhos: [
      { href: '/conteudos', label: 'Banco de Conteúdos', icone: 'Library', modulo: 'conteudos' },
      { href: '/videos', label: 'Vídeos', icone: 'Film', modulo: 'videos' },
      // Calendário mora SÓ aqui. A Torre mostra o resumo e um atalho.
      { href: '/calendario', label: 'Calendário', icone: 'Calendar', modulo: 'calendario' },
      { href: '/conteudos/gerar', label: 'Gerar manualmente', icone: 'Zap', modulo: 'conteudos-gerar' },
    ],
  },
  {
    href: '/vendas-receita', label: 'Vendas & Receita', icone: 'Receipt', modulo: 'vendas-comissoes', agregadora: true,
    filhos: [
      { href: '/vendas-comissoes', label: 'Resultados', icone: 'Receipt', modulo: 'vendas-comissoes' },
      { href: '/monetizacao', label: 'Canais de receita', icone: 'DollarSign', modulo: 'monetizacao' },
    ],
  },
  { href: '/relatorios', label: 'Relatórios', icone: 'BarChart2', modulo: 'relatorios', filhos: [] },
  // P2.17.13: "Configurações" só tinha Integrações para a titular → item direto.
  { href: '/integracoes', label: 'Integrações', icone: 'Plug', modulo: 'integracoes', filhos: [] },
  {
    href: '/ferramentas', label: 'Ferramentas', icone: 'Wrench', modulo: 'links', agregadora: true,
    filhos: [
      { href: '/links', label: 'Links Dinâmicos', icone: 'Link2', modulo: 'links' },
      { href: '/whatsapp', label: 'WhatsApp em Massa', icone: 'MessageCircle', modulo: 'whatsapp' },
      { href: '/video-seller', label: 'Video Seller', icone: 'Video', modulo: 'video-seller' },
    ],
  },
]

/** Fora do menu operacional: aparecem em "Minha conta" só para admin. */
export const ADMINISTRACAO: ItemDeNavegacao[] = [
  { href: '/admin/usuarios', label: 'Usuários', icone: 'Users', modulo: 'dashboard', soAdmin: true },
  { href: '/admin/permissoes', label: 'Permissões', icone: 'SlidersHorizontal', modulo: 'dashboard', soAdmin: true },
  // P2.28: health check operacional (eventos presos, publicações incertas, importações incompletas, reconciliação).
  { href: '/admin/saude', label: 'Saúde do sistema', icone: 'HeartPulse', modulo: 'dashboard', soAdmin: true },
]

/** Ferramentas (lidas também pela página /ferramentas). */
export const FERRAMENTAS: ItemDeNavegacao[] = MENU_PRINCIPAL.find((a) => a.href === '/ferramentas')!.filhos

/**
 * Celular: barra de baixo com o essencial; o resto fica em "Mais". O
 * contador fica SÓ no sininho do topo (Header) — um número, um lugar.
 */
export const BARRA_DO_CELULAR: ItemDeNavegacao[] = [
  { href: '/torre', label: 'Torre', icone: 'RadioTower', modulo: 'dashboard' },
  { href: '/operacao', label: 'Operação', icone: 'Route', modulo: 'precisa-de-voce' },
  { href: '/precisa-de-voce', label: 'Precisa de você', icone: 'BellRing', modulo: 'precisa-de-voce' },
  { href: '/vendas-receita', label: 'Receita', icone: 'Receipt', modulo: 'vendas-comissoes' },
]

/** Rota casa com o href (igual, ou sub-rota). */
export function casaRota(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

const rotasDoItem = (i: ItemDeNavegacao) => [i.href, ...(i.tambem ?? [])]
const todasAsRotasDaArea = (a: AreaPrincipal) => [...rotasDoItem(a), ...a.filhos.flatMap(rotasDoItem)]

/** Qual área principal está aberta (para acender o item e mostrar os submenus). */
export function areaAtiva(pathname: string): AreaPrincipal | null {
  let melhor: { area: AreaPrincipal; tamanho: number } | null = null
  for (const area of MENU_PRINCIPAL) {
    for (const h of todasAsRotasDaArea(area)) {
      if (casaRota(pathname, h) && (!melhor || h.length > melhor.tamanho)) melhor = { area, tamanho: h.length }
    }
  }
  return melhor?.area ?? null
}

/** Entre vários hrefs, só o mais específico acende (/conteudos/gerar ≠ /conteudos). */
export function itemAtivo(pathname: string, hrefs: string[]): string | null {
  return hrefs.filter((h) => casaRota(pathname, h)).sort((a, b) => b.length - a.length)[0] ?? null
}

/**
 * P2.17.13 — A REGRA ÚNICA de estado ativo: em qualquer rota, qual pai e
 * qual subitem acendem. Usada pela Sidebar (desktop e celular), pela barra
 * do celular e pelos testes.
 */
export function estadoDaNavegacao(pathname: string): { area: string | null; subitem: string | null } {
  const area = areaAtiva(pathname)
  if (!area) return { area: null, subitem: null }
  let melhor: { href: string; tamanho: number } | null = null
  for (const f of area.filhos) {
    for (const h of rotasDoItem(f)) {
      if (casaRota(pathname, h) && (!melhor || h.length > melhor.tamanho)) melhor = { href: f.href, tamanho: h.length }
    }
  }
  // A página-resumo da própria área não acende nenhum subitem.
  return { area: area.href, subitem: melhor?.href ?? null }
}

/** Itens que o usuário pode ver (permissão por módulo; admin vê os de admin). */
export function visiveis<T extends ItemDeNavegacao>(itens: T[], temAcesso: (m: ModuloKey) => boolean, admin: boolean): T[] {
  return itens.filter((i) => (i.soAdmin ? admin : temAcesso(i.modulo)))
}

/**
 * A área aparece se o usuário tem a página dela OU algum submenu. Área
 * agregadora (página-resumo) leva sempre à própria página; as outras, sem a
 * página principal, levam ao primeiro submenu liberado.
 */
export function areasVisiveis(temAcesso: (m: ModuloKey) => boolean): (AreaPrincipal & { destino: string })[] {
  const out: (AreaPrincipal & { destino: string })[] = []
  for (const a of MENU_PRINCIPAL) {
    const filhos = a.filhos.filter((f) => temAcesso(f.modulo))
    if (a.agregadora) {
      if (temAcesso(a.modulo) || filhos.length > 0) out.push({ ...a, filhos, destino: a.href })
    } else if (temAcesso(a.modulo)) out.push({ ...a, filhos, destino: a.href })
    else if (filhos.length > 0) out.push({ ...a, filhos, destino: filhos[0].href })
  }
  return out
}

/** Módulos que abrem uma página agregadora (o guarda da página usa isto). */
export function modulosDaArea(href: string): ModuloKey[] {
  const a = MENU_PRINCIPAL.find((x) => x.href === href)
  return a ? [...new Set([a.modulo, ...a.filhos.map((f) => f.modulo)])] : []
}

/**
 * Para onde mandar quem abre o app (ou cai num módulo bloqueado): a Torre;
 * sem a Torre liberada, a primeira área que o papel tem. Nunca a própria
 * página bloqueada (evita laço de redirecionamento).
 */
export function rotaInicial(temAcesso: (m: ModuloKey) => boolean): string {
  if (temAcesso('dashboard')) return HOME
  return areasVisiveis(temAcesso)[0]?.destino ?? '/conta'
}

/** Todas as rotas alcançáveis pela navegação (menu + rodapé + administração). */
export function rotasDaNavegacao(): string[] {
  return [...new Set([...MENU_PRINCIPAL.flatMap((a) => [a.href, ...a.filhos.map((f) => f.href)]), ...ADMINISTRACAO.map((i) => i.href), '/conta'])]
}

/** Rotas que saíram do menu mas continuam vivas (e acendem a área certa). */
export const ROTAS_DE_CONTINGENCIA = ['/dashboard', '/aprovacao', '/publicacoes-assistidas', '/produtos/imagens', '/integracoes/shopee']
