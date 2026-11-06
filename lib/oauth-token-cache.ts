/**
 * Cache de token OAuth 2.0 em memória, com TTL — genérico, reaproveitado
 * pelo AmazonCreatorsProvider (Rodada 5) e por qualquer provider futuro
 * que precise de client-credentials/token de curta duração.
 *
 * Regra: nunca solicitar token novo a cada chamada. O token é reutilizado
 * enquanto válido, com uma margem de segurança antes do vencimento real
 * (`margemSegurancaMs`) para não usar um token que expira no meio de uma
 * chamada em andamento.
 *
 * Sem dependência nova — é um Map simples com relógio injetável para
 * testes (nunca precisa esperar o tempo real passar num teste).
 */

export interface TokenCacheEntry {
  token: string
  expiresAt: number // epoch ms
}

export class OAuthTokenCache {
  private cache = new Map<string, TokenCacheEntry>()
  private relogio: () => number

  constructor(relogio: () => number = () => Date.now()) {
    this.relogio = relogio
  }

  /** Token em cache e ainda válido (com margem de segurança), ou null se precisa renovar. */
  obter(chave: string, margemSegurancaMs = 60_000): string | null {
    const entrada = this.cache.get(chave)
    if (!entrada) return null
    if (this.relogio() >= entrada.expiresAt - margemSegurancaMs) return null
    return entrada.token
  }

  guardar(chave: string, token: string, expiraEmSegundos: number) {
    this.cache.set(chave, { token, expiresAt: this.relogio() + expiraEmSegundos * 1000 })
  }

  invalidar(chave: string) {
    this.cache.delete(chave)
  }

  /**
   * Busca do cache; se não houver (ou tiver expirado), chama `buscarNovo`
   * UMA vez e guarda o resultado. Duas chamadas concorrentes para a mesma
   * chave não disparam duas renovações — a segunda espera a primeira.
   */
  private renovacoesEmAndamento = new Map<string, Promise<string>>()

  async obterOuRenovar(
    chave: string,
    buscarNovo: () => Promise<{ token: string; expiraEmSegundos: number }>,
    margemSegurancaMs = 60_000
  ): Promise<string> {
    const emCache = this.obter(chave, margemSegurancaMs)
    if (emCache) return emCache

    const emAndamento = this.renovacoesEmAndamento.get(chave)
    if (emAndamento) return emAndamento

    const promessa = (async () => {
      try {
        const { token, expiraEmSegundos } = await buscarNovo()
        this.guardar(chave, token, expiraEmSegundos)
        return token
      } finally {
        this.renovacoesEmAndamento.delete(chave)
      }
    })()

    this.renovacoesEmAndamento.set(chave, promessa)
    return promessa
  }
}
