/**
 * Rate limiter local simples (Rodada 6, regra 31) — sem serviço pago,
 * sem Redis. Janela deslizante em memória, por workspace+endpoint. Só
 * evita o Patrono abusar dos limites oficiais (que a documentação do
 * TikTok já define por endpoint) — nunca um substituto para o que a
 * própria API já limita.
 */

export interface TikTokRateLimit {
  maxChamadas: number
  janelaMs: number
}

export class TikTokRateLimiter {
  private historico = new Map<string, number[]>()
  private relogio: () => number

  constructor(relogio: () => number = () => Date.now()) {
    this.relogio = relogio
  }

  /** true = pode chamar agora; false = estourou o limite da janela. */
  podeChamar(chave: string, limite: TikTokRateLimit): boolean {
    const agora = this.relogio()
    const chamadas = (this.historico.get(chave) ?? []).filter((t) => agora - t < limite.janelaMs)
    if (chamadas.length >= limite.maxChamadas) {
      this.historico.set(chave, chamadas)
      return false
    }
    chamadas.push(agora)
    this.historico.set(chave, chamadas)
    return true
  }
}
