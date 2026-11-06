/**
 * Distinção crítica (Rodada 9, regra 1): quando o Hugging Face Hub não
 * está acessível daqui, isso é uma restrição de REDE DESTE AMBIENTE
 * específico (`CURRENT_ENVIRONMENT_NETWORK_RESTRICTION`) — nunca deve ser
 * registrado como se o modelo Chatterbox/MuseTalk estivesse indisponível
 * globalmente (`MODEL_UNAVAILABLE`, que significaria que o projeto
 * oficial saiu do ar ou não existe). O modelo é público; é o ambiente de
 * desenvolvimento atual que tem a política de rede restrita.
 *
 * Na máquina real da proprietária, este mesmo teste deve ser refeito — se
 * lá o Hugging Face responder normalmente, a classificação passa a ser
 * "disponível", nunca herdando o resultado deste sandbox.
 */

export type NetworkAccessStatus = 'AVAILABLE' | 'CURRENT_ENVIRONMENT_NETWORK_RESTRICTION' | 'MODEL_UNAVAILABLE' | 'UNKNOWN_ERROR'

export interface NetworkAccessResult {
  destino: string
  status: NetworkAccessStatus
  httpStatus: number | null
  detalhe: string
}

/**
 * Testa acesso real a uma URL (nunca assume resultado). Um 403 típico de
 * proxy corporativo/sandbox (ex.: "connect_rejected") é classificado como
 * restrição do AMBIENTE ATUAL — nunca como o modelo estar fora do ar.
 */
export async function testarAcessoDeRede(destino: string, fetcher: typeof fetch = fetch): Promise<NetworkAccessResult> {
  try {
    const res = await fetcher(destino, { method: 'HEAD' })
    if (res.ok) return { destino, status: 'AVAILABLE', httpStatus: res.status, detalhe: 'Acesso confirmado.' }
    if (res.status === 403) {
      return {
        destino,
        status: 'CURRENT_ENVIRONMENT_NETWORK_RESTRICTION',
        httpStatus: 403,
        detalhe: 'Bloqueio de rede deste ambiente específico (proxy/política de sandbox) — o recurso em si é público. Retestar na máquina real.',
      }
    }
    if (res.status === 404) {
      return { destino, status: 'MODEL_UNAVAILABLE', httpStatus: 404, detalhe: 'Recurso não encontrado no destino — possível mudança real do lado do provedor.' }
    }
    return { destino, status: 'UNKNOWN_ERROR', httpStatus: res.status, detalhe: `HTTP ${res.status} não classificado.` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha desconhecida'
    // Erros de rede (proxy CONNECT recusado, timeout) neste sandbox aparecem
    // como exceção, não como resposta HTTP — mesma classificação honesta.
    if (/403|connect_rejected|CONNECT/i.test(msg)) {
      return { destino, status: 'CURRENT_ENVIRONMENT_NETWORK_RESTRICTION', httpStatus: null, detalhe: `${msg} — restrição deste ambiente, retestar na máquina real.` }
    }
    return { destino, status: 'UNKNOWN_ERROR', httpStatus: null, detalhe: msg }
  }
}

export const HUGGING_FACE_HOST = 'https://huggingface.co'
export const SUPABASE_HOST = 'https://supabase.com'

export async function verificarAcessoHuggingFace(fetcher: typeof fetch = fetch): Promise<NetworkAccessResult> {
  return testarAcessoDeRede(HUGGING_FACE_HOST, fetcher)
}
