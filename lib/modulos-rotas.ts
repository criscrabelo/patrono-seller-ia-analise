/**
 * P2.15.4 — Qual módulo cada rota de API serve (fonte ÚNICA da regra).
 *
 * A permissão por módulo (/admin/permissoes) valia só na tela. Agora o
 * servidor confere em `exigirSessao()` (lib/sessao.ts), usando ESTA tabela.
 * Uma rota compartilhada (ex.: GET /api/produtos, que alimenta Produtos,
 * Gerar Conteúdo, Links…) fica liberada se a usuária tiver QUALQUER um dos
 * módulos que a usam; escrita exige o módulo dono.
 *
 * Rotas fora da tabela (conta, Digital Twin, auth, admin, cron, webhooks,
 * links públicos, trabalhos longos, permissões) não dependem de módulo.
 *
 * Função pura e sem dependências: roda no middleware (edge) e no servidor.
 */
import type { ModuloKey } from './modulos'

type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export interface RegraDeRota {
  /** Prefixo do caminho (sem barra final). Casa com o caminho exato ou com subcaminhos. */
  prefixo: string
  /** Métodos a que a regra se aplica (ausente = todos). */
  metodos?: Metodo[]
  /** Basta ter UM destes módulos liberado. */
  modulos: ModuloKey[]
}

const LEITURA: Metodo[] = ['GET']
const ESCRITA: Metodo[] = ['POST', 'PUT', 'PATCH', 'DELETE']

/** Do mais específico para o mais geral: a primeira que casar vale. */
export const REGRAS_DE_ROTA: RegraDeRota[] = [
  // Central (Command Center, Supervisor, Copilot) e a fila
  { prefixo: '/api/central', modulos: ['dashboard'] },
  // P2.17.10: Torre de Controle (visão consolidada).
  { prefixo: '/api/torre', modulos: ['dashboard'] },
  // P2.26: "O que eu preciso fazer agora?" (bloco HOJE da Torre).
  { prefixo: '/api/hoje', modulos: ['dashboard'] },
  { prefixo: '/api/supervisor', modulos: ['dashboard'] },
  { prefixo: '/api/copilot', modulos: ['dashboard'] },
  { prefixo: '/api/metricas', modulos: ['dashboard', 'relatorios'] },
  { prefixo: '/api/precisa-de-voce', modulos: ['precisa-de-voce'] },
  // P2.18.5: a jornada única é a experiência operacional principal (mesma permissão da central).
  { prefixo: '/api/operacao', modulos: ['precisa-de-voce'] },
  // P2.17.13: resumos das páginas-resumo (cada um com os módulos da sua área).
  { prefixo: '/api/resumos/vendas-receita', modulos: ['vendas-comissoes', 'monetizacao'] },
  { prefixo: '/api/resumos/canais', modulos: ['monetizacao', 'vendas-comissoes', 'programas'] },
  // P2.53: Painel de Afiliados, controle de gastos e calendário editorial (consolidação da proposta do Lovable).
  { prefixo: '/api/afiliados/painel', modulos: ['monetizacao', 'vendas-comissoes'] },
  { prefixo: '/api/gastos', modulos: ['monetizacao', 'dashboard'] },
  { prefixo: '/api/calendario', modulos: ['calendario'] },
  { prefixo: '/api/resumos/conteudo', modulos: ['conteudos', 'videos', 'calendario', 'conteudos-gerar'] },
  { prefixo: '/api/resumos/produtos', modulos: ['produtos'] },
  { prefixo: '/api/resumos/videos', modulos: ['videos'] },
  { prefixo: '/api/resumos/relatorio', modulos: ['relatorios'] },
  { prefixo: '/api/resumos/integracoes', modulos: ['integracoes'] },
  { prefixo: '/api/resumos/ferramentas', modulos: ['links', 'whatsapp', 'video-seller'] },
  // P2.17.12: fonte única de mídia (a titular envia a mídia autorizada pela central).
  // P2.18.6: token de envio (foto/vídeo) — quem pode subir mídia em qualquer tela.
  { prefixo: '/api/midias/envio', modulos: ['precisa-de-voce', 'produtos', 'produtos-imagens', 'conteudos'] },
  { prefixo: '/api/midias', modulos: ['precisa-de-voce', 'produtos'] },
  // Oportunidades e produtos
  { prefixo: '/api/oportunidades', modulos: ['oportunidades'] },
  { prefixo: '/api/produtos', metodos: LEITURA, modulos: ['produtos', 'produtos-imagens', 'conteudos-gerar', 'links', 'vendas-comissoes'] },
  { prefixo: '/api/produtos', metodos: ['PATCH'], modulos: ['produtos', 'produtos-imagens'] },
  { prefixo: '/api/produtos', metodos: ESCRITA, modulos: ['produtos'] },
  // Conteúdo
  { prefixo: '/api/conteudos/gerar', modulos: ['conteudos-gerar'] },
  { prefixo: '/api/conteudos', metodos: LEITURA, modulos: ['conteudos', 'aprovacao', 'calendario', 'videos', 'whatsapp', 'conteudos-gerar'] },
  { prefixo: '/api/conteudos', metodos: ['PATCH'], modulos: ['conteudos', 'aprovacao', 'conteudos-gerar'] },
  { prefixo: '/api/conteudos', metodos: ESCRITA, modulos: ['conteudos'] },
  { prefixo: '/api/video-seller', modulos: ['video-seller'] },
  // P2.17.3: metas do TikTok Shop e plano de vídeos — parte de Oportunidades.
  { prefixo: '/api/tiktok/metas', modulos: ['oportunidades'] },
  { prefixo: '/api/tiktok/videos', metodos: LEITURA, modulos: ['oportunidades', 'conteudos', 'videos'] },
  // P2.17.10: modo assistido, resultados e acompanhamento das publicações TikTok.
  // Vitrine (showcase) do TikTok Shop — fluxo automático, desligado até a API ser autorizada.
  { prefixo: '/api/tiktok/vitrine', modulos: ['oportunidades'] },
  // P2.17.17/18: amostras e evidência observada no app (operação comercial do TikTok Shop).
  { prefixo: '/api/tiktok/amostras', modulos: ['oportunidades'] },
  { prefixo: '/api/tiktok/observacoes', modulos: ['oportunidades'] },
  { prefixo: '/api/tiktok/operacao', metodos: LEITURA, modulos: ['dashboard', 'oportunidades', 'calendario', 'aprovacao'] },
  { prefixo: '/api/tiktok/assistido', modulos: ['oportunidades', 'aprovacao'] },
  { prefixo: '/api/tiktok/resultados', modulos: ['oportunidades', 'relatorios'] },
  { prefixo: '/api/tiktok/publicacoes', modulos: ['oportunidades', 'aprovacao'] },
  // P2.17: pacote do TikTok (só leitura) — quem vê/aprova conteúdo.
  { prefixo: '/api/tiktok', metodos: LEITURA, modulos: ['conteudos', 'aprovacao', 'videos'] },
  // P2.17.4 (auditoria): qualquer escrita futura em /api/tiktok exige Oportunidades (nunca "sem regra = liberado").
  { prefixo: '/api/tiktok', metodos: ESCRITA, modulos: ['oportunidades'] },
  { prefixo: '/api/whatsapp', modulos: ['whatsapp'] },
  // Resultados
  { prefixo: '/api/links', metodos: LEITURA, modulos: ['links', 'monetizacao', 'produtos'] },
  { prefixo: '/api/links', metodos: ['PATCH'], modulos: ['links', 'produtos'] },
  { prefixo: '/api/links', metodos: ESCRITA, modulos: ['links'] },
  { prefixo: '/api/programas/providers', modulos: ['programas'] },
  { prefixo: '/api/programas', metodos: LEITURA, modulos: ['programas', 'vendas-comissoes'] },
  { prefixo: '/api/programas', metodos: ESCRITA, modulos: ['programas'] },
  { prefixo: '/api/vendas', modulos: ['vendas-comissoes'] },
  { prefixo: '/api/comissoes', modulos: ['vendas-comissoes'] },
  // Configurações
  // P2.17.4 (auditoria): iniciar/concluir OAuth grava token mesmo via GET — só quem tem Integrações.
  { prefixo: '/api/integracoes/tiktok-shop/oauth', modulos: ['integracoes'] },
  { prefixo: '/api/integracoes/tiktok/oauth', modulos: ['integracoes'] },
  { prefixo: '/api/integracoes/tiktok-shop/desconectar', modulos: ['integracoes'] },
  { prefixo: '/api/integracoes', metodos: LEITURA, modulos: ['integracoes', 'conteudos'] },
  { prefixo: '/api/integracoes', metodos: ESCRITA, modulos: ['integracoes'] },
]

/** FUNÇÃO PURA: a regra que vale para este caminho e método (null = rota sem módulo). */
export function regraDaRota(caminho: string, metodo: string): RegraDeRota | null {
  const m = metodo.toUpperCase() as Metodo
  return (
    REGRAS_DE_ROTA.find(
      (r) => (caminho === r.prefixo || caminho.startsWith(r.prefixo + '/')) && (!r.metodos || r.metodos.includes(m))
    ) ?? null
  )
}

/** FUNÇÃO PURA: com estes módulos bloqueados, a rota pode ser usada? */
export function rotaLiberada(regra: RegraDeRota | null, bloqueados: ReadonlySet<string>): boolean {
  return !regra || regra.modulos.some((m) => !bloqueados.has(m))
}

/** Cabeçalhos que o middleware grava (e sobrescreve) em toda requisição autenticada. */
export const CABECALHO_CAMINHO = 'x-patrono-caminho'
export const CABECALHO_METODO = 'x-patrono-metodo'
