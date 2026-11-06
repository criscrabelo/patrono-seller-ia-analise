/**
 * Rate limiter local de geração do Digital Twin (Rodada 8, regra 52) —
 * mesmo padrão do `TikTokRateLimiter` (lib/tiktok-rate-limiter.ts):
 * janela deslizante em memória, por workspace, sem serviço pago. Existe
 * só para impedir loop/bug/geração infinita — nunca para cobrar a
 * usuária ou limitar por causa de custo (o custo é R$ 0,00).
 */

export interface DigitalTwinRateLimit {
  maxGeracoes: number
  janelaMs: number
}

export const LIMITE_PADRAO_GERACAO: DigitalTwinRateLimit = {
  maxGeracoes: 10,
  janelaMs: 60 * 60 * 1000, // 10 gerações por hora por workspace
}

export class DigitalTwinRateLimiter {
  private historico = new Map<string, number[]>()
  private relogio: () => number

  constructor(relogio: () => number = () => Date.now()) {
    this.relogio = relogio
  }

  podeGerar(workspaceId: string, limite: DigitalTwinRateLimit = LIMITE_PADRAO_GERACAO): boolean {
    const agora = this.relogio()
    const chamadas = (this.historico.get(workspaceId) ?? []).filter((t) => agora - t < limite.janelaMs)
    if (chamadas.length >= limite.maxGeracoes) {
      this.historico.set(workspaceId, chamadas)
      return false
    }
    chamadas.push(agora)
    this.historico.set(workspaceId, chamadas)
    return true
  }
}
