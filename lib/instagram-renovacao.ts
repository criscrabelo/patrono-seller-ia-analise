/**
 * P2.69 — RENOVAÇÃO dos tokens do Instagram, com as regras num lugar só (cron e rota manual usam isto).
 *
 * Caso real (27/10/2026): token de USUÁRIO DE SISTEMA, que não expira, gravado com 59 dias presumidos; a partir de
 * 16/11 o cron tentaria "renová-lo". Regras:
 *  - token que a Meta confirma SEM PRAZO (usuário de sistema, válido, sem vencimento de acesso a dados): NÃO é
 *    renovado nem trocado; a data presumida é apagada; e ele é RECONFERIDO a cada 24 h (sem data, não some do radar);
 *  - token que a Meta diz INVÁLIDO: integração vira "desconectado" (gera o alerta da Central), nada é trocado;
 *  - Meta sem resposta / sem App Secret: não decide nada (nem renova, nem apaga data) — tenta na próxima rodada;
 *  - token com data dentro da janela: renova; validade só a que a Meta INFORMAR (sem presumir 60 dias).
 */
import type { InspecaoDeTokenMeta } from './instagram'

export const DIAS_DE_AVISO = 15
export const HORAS_ENTRE_CONFERENCIAS_SEM_PRAZO = 24

export interface IntegracaoInstagram { id: string; accessToken: string | null; tokenExpiry: Date | null; extraData: Record<string, unknown> | null }
export interface DependenciasDaRenovacao {
  inspecionar: (p: { accessToken: string; appId: string; appSecret: string }) => Promise<InspecaoDeTokenMeta>
  renovar: (p: { accessToken: string; appId: string; appSecret: string }) => Promise<{ accessToken: string; expiresIn: number }>
  atualizar: (id: string, dados: { accessToken?: string; tokenExpiry?: Date | null; status?: string; extraData?: Record<string, unknown>; updatedAt: Date }) => Promise<unknown>
}
export const CAMPO_SEM_PRAZO_CONFERIDO_EM = 'semPrazoConferidoEm'

/** Quem precisa ser olhado nesta rodada: data dentro da janela, OU sem data e sem conferência nas últimas 24 h. */
export function precisaConferir(i: IntegracaoInstagram, agora: Date): boolean {
  if (i.tokenExpiry) return i.tokenExpiry.getTime() <= agora.getTime() + DIAS_DE_AVISO * 86_400_000
  const ultima = Date.parse(String(i.extraData?.[CAMPO_SEM_PRAZO_CONFERIDO_EM] ?? ''))
  return !Number.isFinite(ultima) || agora.getTime() - ultima >= HORAS_ENTRE_CONFERENCIAS_SEM_PRAZO * 3_600_000
}

export type ResultadoDaRenovacao = 'SEM_PRAZO_CONFIRMADO' | 'INVALIDO_DESCONECTADO' | 'RENOVADO' | 'SEM_DECISAO' | 'FALHOU'

export async function conferirERenovar(i: IntegracaoInstagram, agora: Date, d: DependenciasDaRenovacao): Promise<ResultadoDaRenovacao> {
  const extra = (i.extraData ?? {}) as Record<string, unknown>
  const appId = typeof extra.appId === 'string' ? extra.appId : '', appSecret = typeof extra.appSecret === 'string' ? extra.appSecret : ''
  if (!i.accessToken || !appId || !appSecret) return 'SEM_DECISAO'
  const insp = await d.inspecionar({ accessToken: i.accessToken, appId, appSecret })
  if (insp.semPrazo) {
    await d.atualizar(i.id, { tokenExpiry: null, extraData: { ...extra, [CAMPO_SEM_PRAZO_CONFERIDO_EM]: agora.toISOString() }, updatedAt: agora })
    return 'SEM_PRAZO_CONFIRMADO'
  }
  if (insp.valido === false) {
    await d.atualizar(i.id, { status: 'desconectado', updatedAt: agora })
    return 'INVALIDO_DESCONECTADO'
  }
  // Sem data e não confirmado como sem prazo: grava a data REAL se a Meta deu uma; senão, não decide nada.
  if (!i.tokenExpiry) {
    if (insp.expiraEm || insp.dataAccessExpiraEm) {
      const real = [insp.expiraEm, insp.dataAccessExpiraEm].filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime())[0]
      await d.atualizar(i.id, { tokenExpiry: real, updatedAt: agora })
    }
    return 'SEM_DECISAO'
  }
  if (insp.valido !== true) return 'SEM_DECISAO' // Meta não respondeu: não renova às cegas
  try {
    const r = await d.renovar({ accessToken: i.accessToken, appId, appSecret })
    await d.atualizar(i.id, { accessToken: r.accessToken, tokenExpiry: new Date(agora.getTime() + r.expiresIn * 1000), updatedAt: agora })
    return 'RENOVADO'
  } catch { return 'FALHOU' }
}

/** Rota manual "Renovar": não troca token sem prazo nem token que a Meta não confirma como válido. */
export function decisaoDaRenovacaoManual(insp: InspecaoDeTokenMeta): { renovar: boolean; motivo: string } {
  if (insp.semPrazo) return { renovar: false, motivo: 'Este token é de usuário de sistema e não expira: não há o que renovar (renovar o trocaria por um que expira).' }
  if (insp.valido === false) return { renovar: false, motivo: 'A Meta diz que este token não é válido: reconecte a conta.' }
  if (insp.valido !== true) return { renovar: false, motivo: `Não foi possível confirmar o token com a Meta agora (${insp.motivo}): tente de novo mais tarde.` }
  return { renovar: true, motivo: 'Token válido com prazo: renovação permitida.' }
}
