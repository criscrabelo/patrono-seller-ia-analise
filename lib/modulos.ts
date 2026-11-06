// Lista canônica de módulos/telas que podem ser liberados ou não por papel.
// A tela "Usuários" fica de fora de propósito — é sempre admin-only.
export const MODULOS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'precisa-de-voce', label: 'Precisa de você' },
  { key: 'produtos', label: 'Produtos' },
  { key: 'produtos-imagens', label: 'Importar Imagens' },
  { key: 'oportunidades', label: 'Oportunidades' },
  { key: 'conteudos-gerar', label: 'Gerar Conteúdo' },
  { key: 'conteudos', label: 'Banco de Conteúdos' },
  { key: 'videos', label: 'Vídeos' },
  { key: 'aprovacao', label: 'Aprovações' },
  { key: 'calendario', label: 'Calendário' },
  { key: 'relatorios', label: 'Relatórios' },
  { key: 'links', label: 'Links Dinâmicos' },
  { key: 'programas', label: 'Meus Programas' },
  { key: 'vendas-comissoes', label: 'Vendas e Comissões' },
  { key: 'monetizacao', label: 'Canais de receita' },
  { key: 'integracoes', label: 'Integrações' },
  { key: 'whatsapp', label: 'WhatsApp em Massa' },
  { key: 'video-seller', label: 'Video Seller' },
] as const

export type ModuloKey = (typeof MODULOS)[number]['key']
export const MODULO_KEYS = MODULOS.map((m) => m.key) as ModuloKey[]
