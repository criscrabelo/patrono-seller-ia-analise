/**
 * P2.2 — O que toda Scheduled Function da Netlify faz: chamar a rota de
 * cron que já existe, com o CRON_SECRET no header — e nada mais.
 *
 * A lógica continua na rota (testada, idempotente, com CRON_SECRET). A
 * função agendada é só o despertador, no mesmo horário do workflow do
 * GitHub (`.github/workflows/patrono-crons.yml`), e só dispara quando
 * `AGENDADOR_DOS_CRONS=netlify` — ver `lib/agendador.ts`.
 *
 * Scheduled Function roda só em deploy de PRODUÇÃO e tem 30 s; a rota
 * chamada roda na sua própria função. Trabalho que passa disso já não
 * mora em rota de cron: vira trabalho longo em segundo plano.
 */
import { CABECALHO_DO_AGENDADOR, agendadorAtivo } from '../lib/agendador'

export interface ContextoNetlify {
  site?: { url?: string }
}

export async function dispararRotina(
  rota: 'executar-fila' | 'oportunidades' | 'sincronizar-catalogo' | 'ml-janela-observacao' | 'publicar' | 'expurgar-tarefas' | 'limpar-uploads-orfaos' | 'processar-eventos' | 'reconciliar',
  contexto: ContextoNetlify | undefined,
  env: Record<string, string | undefined> = process.env,
  enviar: typeof fetch = fetch,
  /** Ex.: `?modo=execucao` — a rota ainda decide pelo próprio interruptor. */
  consulta = ''
): Promise<{ disparou: boolean; motivo: string; status?: number }> {
  if (agendadorAtivo(env) !== 'netlify') {
    return { disparou: false, motivo: 'AGENDADOR_DOS_CRONS não é "netlify": o agendador ativo é outro.' }
  }
  // P2.9: lista opcional de rotinas permitidas. Ausente = todas (como
  // antes). Presente = só as listadas — para ligar, por exemplo, apenas o
  // expurgo, sem ligar junto a fila e o ciclo de oportunidades.
  const permitidas = (env.ROTINAS_NETLIFY_LIGADAS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (permitidas.length && !permitidas.includes(rota)) {
    return { disparou: false, motivo: `${rota} não está em ROTINAS_NETLIFY_LIGADAS.` }
  }
  // Mesmo trinco do workflow: publicar só com decisão explícita.
  if (rota === 'publicar' && env.CRON_PUBLICAR_ATIVO !== 'true') {
    return { disparou: false, motivo: 'publicar está desligado (CRON_PUBLICAR_ATIVO != true).' }
  }
  const segredo = env.CRON_SECRET
  const base = contexto?.site?.url || env.URL || env.PUBLIC_BASE_URL
  if (!segredo || !base) {
    return { disparou: false, motivo: 'Falta CRON_SECRET ou a URL do site: nada foi chamado.' }
  }
  try {
    const r = await enviar(new URL(`/api/cron/${rota}${consulta}`, base).toString(), {
      headers: { authorization: `Bearer ${segredo}`, [CABECALHO_DO_AGENDADOR]: 'netlify' },
      signal: AbortSignal.timeout(25_000),
    })
    return { disparou: true, motivo: `HTTP ${r.status}`, status: r.status }
  } catch (e) {
    return { disparou: true, motivo: `sem resposta: ${e instanceof Error ? e.message : String(e)}` }
  }
}
