/**
 * P2.2 — Lado da TELA dos trabalhos longos. Sem import de servidor.
 *
 * A rota responde 202 `{ processando, trabalhoId }` quando o trabalho foi
 * para o segundo plano. Esta função acompanha `/api/trabalhos/:id` até o
 * fim e devolve o que a rota antiga teria devolvido — `ok`, `status` e o
 * mesmo corpo —, para a tela continuar tratando sucesso e erro como antes.
 */
export interface RespostaFinal {
  ok: boolean
  status: number
  data: Record<string, any>
}

export const INTERVALO_DE_CONSULTA_DA_TELA_MS = 3_000
/** A tela para de esperar aqui; o trabalho continua no servidor. */
export const ESPERA_MAXIMA_DA_TELA_MS = 15 * 60_000

export async function respostaFinal(
  res: Response,
  opcoes: {
    intervaloMs?: number
    esperaMaximaMs?: number
    /** Recebe o corpo parcial (ex.: envios já feitos) a cada consulta. */
    aoAtualizar?: (parcial: Record<string, any>) => void
    buscar?: typeof fetch
    dormir?: (ms: number) => Promise<void>
  } = {}
): Promise<RespostaFinal> {
  const data = (await res.json().catch(() => ({}))) as Record<string, any>
  if (!(data?.processando && typeof data.trabalhoId === 'string')) {
    return { ok: res.ok && data?.ok !== false, status: res.status, data }
  }

  const buscar = opcoes.buscar ?? fetch
  const dormir = opcoes.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const intervalo = opcoes.intervaloMs ?? INTERVALO_DE_CONSULTA_DA_TELA_MS
  const limite = Date.now() + (opcoes.esperaMaximaMs ?? ESPERA_MAXIMA_DA_TELA_MS)
  let ultimo: Record<string, any> = data

  while (Date.now() < limite) {
    await dormir(intervalo)
    try {
      const r = await buscar(`/api/trabalhos/${encodeURIComponent(data.trabalhoId)}`)
      if (!r.ok) continue
      const s = (await r.json()) as {
        terminado: boolean
        resposta: { status: number; corpo: Record<string, any> } | null
      }
      if (s.resposta?.corpo) {
        ultimo = s.resposta.corpo
        opcoes.aoAtualizar?.(ultimo)
      }
      if (s.terminado && s.resposta) {
        return { ok: s.resposta.status < 400 && s.resposta.corpo?.ok !== false, status: s.resposta.status, data: s.resposta.corpo }
      }
    } catch {
      // Rede da tela oscilou: o trabalho segue no servidor. Tenta de novo.
    }
  }
  return {
    ok: false,
    status: 202,
    data: {
      ...ultimo,
      processando: true,
      mensagem: 'Ainda em andamento no servidor. Você pode sair desta tela: o resultado aparece quando terminar.',
    },
  }
}
