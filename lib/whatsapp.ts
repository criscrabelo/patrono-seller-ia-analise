import { guardarChamadaPaga } from './cost-safety-gate'
import { envioDeWhatsappPermitido } from './transferencia-internacional'
// Integração com Z-API para envio de mensagens WhatsApp em massa.
// Docs: https://developer.z-api.io

export interface ZApiConfig {
  instanceId: string
  token: string
  clientToken?: string // security token opcional do Z-API
}

export interface EnvioTexto {
  numero: string  // formato: 5511999999999 (sem + ou espaços)
  mensagem: string
}

export interface EnvioImagem {
  numero: string
  imageUrl: string
  legenda?: string
}

export interface ResultadoEnvio {
  numero: string
  ok: boolean
  erro?: string
  /**
   * `true` quando o pedido à Z-API saiu e nenhuma resposta voltou (rede
   * caiu, timeout). A mensagem PODE ter sido entregue: reenviar às cegas
   * duplicaria para a pessoa. Resposta HTTP — de sucesso ou de erro — não
   * é incerta: a Z-API disse o que fez.
   */
  incerto?: boolean
}

function zapiBase(cfg: ZApiConfig) {
  return `https://api.z-api.io/instances/${cfg.instanceId}/token/${cfg.token}`
}

function zapiHeaders(cfg: ZApiConfig): HeadersInit {
  const h: HeadersInit = { 'Content-Type': 'application/json' }
  if (cfg.clientToken) h['client-token'] = cfg.clientToken
  return h
}

/** Normaliza número: remove tudo que não é dígito e garante código do país */
/**
 * CUSTO ZERO POR PADRÃO (Rodada 14): Z-API é serviço pago por instância.
 * Os três pontos de envio passam por aqui. Sem alternativa gratuita no
 * projeto, o envio fica PENDENTE por política — devolve resultado negativo
 * em vez de lançar, para não derrubar o fluxo que chamou.
 */
async function envioPermitidoPelaPolitica(
  operacao: string,
  workspaceId: string | null
): Promise<{ permitido: boolean; motivo: string }> {
  // `custoEstimado` NÃO é passado: a operação está deliberadamente ausente de
  // `CUSTO_ESTIMADO_BRL`, e ausência bloqueia. Publicar uma estimativa aqui
  // sugeriria que basta ligar as duas chaves para liberar — enganoso enquanto
  // os chamadores não propagarem workspace real.
  const guarda = await guardarChamadaPaga({
    provider: 'z-api',
    operacao,
    workspaceId,
  })
  if (guarda.permitido) return { permitido: true, motivo: '' }
  const motivo = `Bloqueado por política de custo: ${guarda.decisao.explicacao}`
  console.warn(`[whatsapp] ${motivo}`)
  return { permitido: false, motivo }
}

export function normalizarNumero(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  // Aceita 10-13 dígitos
  if (digits.length < 10 || digits.length > 13) return null
  // Se não começar com 55 (Brasil), adiciona
  if (!digits.startsWith('55')) return '55' + digits
  return digits
}

/** Verifica se a instância está conectada */
/**
 * FORA DO CostSafetyGate, de propósito (revisão do P0.1).
 *
 * `/status` é leitura de diagnóstico: diz se a instância está conectada. A
 * Z-API cobra por INSTÂNCIA contratada (assinatura), não por consulta de
 * status — esta chamada não gera custo incremental nem consome cota de
 * mensagens.
 *
 * Bloqueá-la seria pior do que inútil: a tela deixaria de mostrar "WhatsApp
 * desconectado" mesmo para quem tem plano ativo, escondendo um problema real
 * sem economizar nada. Os ENVIOS (`send-text`, `send-image`), que de fato
 * consomem, continuam atrás do gate.
 */
export async function verificarConexao(cfg: ZApiConfig): Promise<{ conectado: boolean; numero?: string }> {
  const res = await fetch(`${zapiBase(cfg)}/status`, { headers: zapiHeaders(cfg) })
  if (!res.ok) return { conectado: false }
  const data = await res.json() as Record<string, unknown>
  // Z-API retorna { connected: true, smartphoneConnected: true, ... }
  const conectado = !!(data.connected || data.smartphoneConnected)
  return { conectado, numero: data.phone as string | undefined }
}

/** Envia mensagem de texto para um número */
export async function enviarTexto(
  cfg: ZApiConfig,
  params: EnvioTexto,
  workspaceId: string | null = null
): Promise<ResultadoEnvio> {
  const numero = normalizarNumero(params.numero)
  if (!numero) return { numero: params.numero, ok: false, erro: 'Número inválido' }
  // P2.11: dados de terceiros sem mecanismo de transferência nesta
  // hospedagem — recusa antes de qualquer pedido à Z-API.
  const hospedagem = envioDeWhatsappPermitido()
  if (!hospedagem.permitido) return { numero: params.numero, ok: false, erro: hospedagem.motivo }
  let pedidoSaiu = false
  try {
    const permissao = await envioPermitidoPelaPolitica('enviar-whatsapp', workspaceId)
    if (!permissao.permitido) return { numero: params.numero, ok: false, erro: permissao.motivo }
    pedidoSaiu = true
    const res = await fetch(`${zapiBase(cfg)}/send-text`, {
      method: 'POST',
      headers: zapiHeaders(cfg),
      body: JSON.stringify({ phone: numero, message: params.mensagem }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return { numero, ok: false, erro: (data.error as string) || `HTTP ${res.status}` }
    }
    return { numero, ok: true }
  } catch (e) {
    return { numero, ok: false, erro: e instanceof Error ? e.message : 'Erro de conexão', ...(pedidoSaiu ? { incerto: true } : {}) }
  }
}

/** Envia imagem com legenda para um número */
export async function enviarImagem(
  cfg: ZApiConfig,
  params: EnvioImagem,
  workspaceId: string | null = null
): Promise<ResultadoEnvio> {
  const numero = normalizarNumero(params.numero)
  if (!numero) return { numero: params.numero, ok: false, erro: 'Número inválido' }
  // P2.11: dados de terceiros sem mecanismo de transferência nesta
  // hospedagem — recusa antes de qualquer pedido à Z-API.
  const hospedagem = envioDeWhatsappPermitido()
  if (!hospedagem.permitido) return { numero: params.numero, ok: false, erro: hospedagem.motivo }
  let pedidoSaiu = false
  try {
    const permissao = await envioPermitidoPelaPolitica('enviar-whatsapp', workspaceId)
    if (!permissao.permitido) return { numero: params.numero, ok: false, erro: permissao.motivo }
    pedidoSaiu = true
    const res = await fetch(`${zapiBase(cfg)}/send-image`, {
      method: 'POST',
      headers: zapiHeaders(cfg),
      body: JSON.stringify({
        phone: numero,
        image: params.imageUrl,
        caption: params.legenda ?? '',
      }),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return { numero, ok: false, erro: (data.error as string) || `HTTP ${res.status}` }
    }
    return { numero, ok: true }
  } catch (e) {
    return { numero, ok: false, erro: e instanceof Error ? e.message : 'Erro de conexão', ...(pedidoSaiu ? { incerto: true } : {}) }
  }
}

/** Envia em lote com delay entre mensagens para evitar ban */
export async function enviarEmMassa(
  cfg: ZApiConfig,
  numeros: string[],
  mensagem: string,
  imagemUrl?: string,
  onProgresso?: (atual: number, total: number, resultado: ResultadoEnvio) => void,
  delayMs = 3000,
  workspaceId: string | null = null
): Promise<ResultadoEnvio[]> {
  const resultados: ResultadoEnvio[] = []
  for (let i = 0; i < numeros.length; i++) {
    const numero = numeros[i]
    const resultado = imagemUrl
      ? await enviarImagem(cfg, { numero, imageUrl: imagemUrl, legenda: mensagem }, workspaceId)
      : await enviarTexto(cfg, { numero, mensagem }, workspaceId)
    resultados.push(resultado)
    onProgresso?.(i + 1, numeros.length, resultado)
    // Delay entre envios para não ser banido pelo WhatsApp
    if (i < numeros.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  return resultados
}
