export type StatusConteudo =
  | 'ideia'
  | 'produto_cadastrado'
  | 'roteiro_gerado'
  | 'aguardando_aprovacao'
  | 'aprovado'
  | 'agendado'
  | 'publicado'
  | 'publicacao_atrasada'
  | 'analisar_resultado'
  | 'reaproveitar'
  | 'descartado'

export type RedeSocial =
  | 'TikTok'
  | 'Instagram Reels'
  | 'YouTube Shorts'
  | 'WhatsApp'
  | 'Facebook'
  | 'Marketplace'
  | 'Landing Page'

export type EstiloVideo =
  // P2.17.13: nada de "Viral" como promessa.
  | 'Orientado à retenção'
  | 'Premium'
  | 'Marketplace'
  | 'Direto para venda'
  | 'Clean'
  | 'Emocional'

export type ObjetivoVideo = 'Venda' | 'Crescimento' | 'Engajamento' | 'Teste de produto'

export type SeveridadeCompliance = 'verde' | 'amarelo' | 'vermelho'

export interface AlertaCompliance {
  tipo: 'publicidade' | 'copyright' | 'ia' | 'enganoso' | 'plataforma'
  mensagem: string
  severidade: SeveridadeCompliance
  acaoRecomendada: string
}

export interface ConteudoGerado {
  roteiro: string
  legendaTiktok: string
  legendaInstagram: string
  legendaYoutube: string
  legendaWhatsapp: string
  legendaFacebook: string
  legendaMarketplace: string
  hashtags: string[]
  textoTela: string
  narracao: string
  trilhaSugerida: string
  promptVideoIA: string
  promptCurto: string
  chamadaAcao: string
  /** P2.50 (Codex 24): null = não avaliado. A IA de texto não dá nota a produto (sem evidência). */
  notaProduto: number | null
  pontosPositivos: string[]
  pontosNegativos: string[]
  veredito: string
  alertasCompliance: AlertaCompliance[]
}

export interface VideoSellerOutput {
  analiseProduto: {
    tipo: string
    publicoAlvo: string
    diferenciais: string[]
    melhorFormato: string
  }
  objetivoVideo: string
  ideaCentral: string
  roteiro: Array<{
    cena: number
    inicio: string
    fim: string
    descricaoVisual: string
    movimento: string
    textoTela: string
    som: string
    objetivo: string
  }>
  textosTela: string[]
  narracao: string
  estiloVisual: string
  sugestaoMusica: string
  promptCompleto: string
  promptCurto: string
  ctaFinal: string[]
  variacoesTeste: Array<{
    versao: string
    descricao: string
    diferencial: string
  }>
  hashtagsSugeridas: string[]
  tituloSugerido: string
}

export interface ConfiguracaoConteudo {
  redeSocial: RedeSocial
  duracao: number
  estilo: EstiloVideo
  objetivo: ObjetivoVideo
}

export interface ProdutoFormData {
  nome: string
  categoria: string
  preco: number
  linkProduto?: string
  descricao?: string
  publicoAlvo: string[]
  tipoVenda: string
  origemConteudo: string
  observacoes?: string
  beneficios: string[]
  pontosNegativos: string[]
  imagens: string[]
  videos: string[]
}

export const STATUS_LABELS: Record<StatusConteudo, string> = {
  ideia: 'Ideia',
  produto_cadastrado: 'Produto Cadastrado',
  roteiro_gerado: 'Roteiro Gerado',
  aguardando_aprovacao: 'Aguardando Aprovação',
  aprovado: 'Aprovado',
  agendado: 'Agendado',
  publicado: 'Publicado',
  publicacao_atrasada: 'Publicação atrasada',
  analisar_resultado: 'Analisar Resultado',
  reaproveitar: 'Reaproveitar',
  descartado: 'Descartado',
}

export const STATUS_COLORS: Record<StatusConteudo, string> = {
  ideia: 'bg-gray-500',
  produto_cadastrado: 'bg-blue-300',
  roteiro_gerado: 'bg-blue-500',
  aguardando_aprovacao: 'bg-yellow-500',
  aprovado: 'bg-green-400',
  agendado: 'bg-green-500',
  publicado: 'bg-green-700',
  publicacao_atrasada: 'bg-amber-600',
  analisar_resultado: 'bg-purple-500',
  reaproveitar: 'bg-orange-500',
  descartado: 'bg-red-500',
}

export const CATEGORIAS = [
  'Eletrônicos',
  'Moda',
  'Beleza',
  'Casa e Decoração',
  'Esportes',
  'Alimentação',
  'Saúde',
  'Brinquedos',
  'Pet',
  'Papelaria',
  'Outros',
]

export const TIPOS_VENDA = [
  'Próprio',
  'Afiliado',
  'Dropshipping',
  'Marketplace',
  'Teste',
]

export const ORIGENS_CONTEUDO = [
  'Próprio',
  'Licenciado',
  'De fornecedor',
  'Gerado por IA',
]

export const PUBLICOS_ALVO = [
  'Mulheres',
  'Homens',
  'Jovens 13-18',
  'Adultos 25-45',
  'Sênior 45+',
  'Profissionais',
  'Mães',
  'Estudantes',
]

export const REDES_SOCIAIS: RedeSocial[] = [
  'TikTok',
  'Instagram Reels',
  'YouTube Shorts',
  'WhatsApp',
  'Facebook',
  'Marketplace',
  'Landing Page',
]

export const DURACOES = [6, 10, 15, 20, 30, 60]

export const ESTILOS: EstiloVideo[] = [
  'Orientado à retenção',
  'Premium',
  'Marketplace',
  'Direto para venda',
  'Clean',
  'Emocional',
]

export const OBJETIVOS: ObjetivoVideo[] = [
  'Venda',
  'Crescimento',
  'Engajamento',
  'Teste de produto',
]
