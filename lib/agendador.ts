/**
 * P2.2 — UM agendador por vez.
 *
 * Os crons podem ser disparados pelo workflow do GitHub Actions
 * (`.github/workflows/patrono-crons.yml`) ou pelas Scheduled Functions da
 * Netlify (`netlify/functions/rotina-*.mts`). Os dois ligados ao mesmo
 * tempo executariam cada rotina duas vezes.
 *
 * `AGENDADOR_DOS_CRONS` decide:
 *   - ausente ou `github` → as rotas aceitam o GitHub (comportamento de
 *     sempre) e as Scheduled Functions não disparam nada;
 *   - `netlify` → as Scheduled Functions disparam, e as rotas RECUSAM
 *     chamada sem o cabeçalho do agendador da Netlify — inclusive a do
 *     GitHub, se alguém esquecer o workflow ligado.
 *
 * O cabeçalho não é segredo (o segredo continua sendo o CRON_SECRET): ele
 * só diz QUEM agendou, para a duplicidade virar 409 em vez de execução.
 */
export const CABECALHO_DO_AGENDADOR = 'x-patrono-agendador'

export type Agendador = 'github' | 'netlify'

export function agendadorAtivo(env: Record<string, string | undefined> = process.env): Agendador {
  return env.AGENDADOR_DOS_CRONS === 'netlify' ? 'netlify' : 'github'
}

/** `true` quando a chamada veio de um agendador que não é o ativo. */
export function chamadaDeOutroAgendador(
  cabecalhos: { get(nome: string): string | null },
  env: Record<string, string | undefined> = process.env
): boolean {
  return agendadorAtivo(env) === 'netlify' && cabecalhos.get(CABECALHO_DO_AGENDADOR) !== 'netlify'
}

/**
 * P2.12 — Versão ESTRITA, para rotinas que apagam (limpeza de uploads
 * órfãos). Só aceita a chamada quando `AGENDADOR_DOS_CRONS` está declarado
 * explicitamente (`github` ou `netlify`) E a chamada se identifica como
 * vinda dele. Sem agendador declarado, ninguém dispara — nem o GitHub, ao
 * contrário da regra geral acima, que continua valendo para as outras rotas.
 */
export function chamadaDoAgendadorDeclarado(
  cabecalhos: { get(nome: string): string | null },
  env: Record<string, string | undefined> = process.env
): { ok: true; agendador: Agendador } | { ok: false; motivo: string } {
  const declarado = env.AGENDADOR_DOS_CRONS
  if (declarado !== 'github' && declarado !== 'netlify') {
    return { ok: false, motivo: 'AGENDADOR_DOS_CRONS não declarado (github ou netlify): nenhum agendador dispara esta rotina.' }
  }
  if (cabecalhos.get(CABECALHO_DO_AGENDADOR) !== declarado) {
    return { ok: false, motivo: `Chamada não veio do agendador ativo (${declarado}). Recusada para não executar a rotina duas vezes.` }
  }
  return { ok: true, agendador: declarado }
}

export const RESPOSTA_DE_OUTRO_AGENDADOR = {
  error: 'Outro agendador está ativo (AGENDADOR_DOS_CRONS). Esta chamada foi recusada para não executar a rotina duas vezes.',
} as const
