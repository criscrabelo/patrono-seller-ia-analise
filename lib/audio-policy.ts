/**
 * AudioUsagePolicy (Rodada 6, regra 27) — mesma lógica de `MediaUsagePolicy`
 * (lib/media-rights.ts), mas para áudio/música. Nunca insere música
 * protegida sem direito de uso confirmado. Quando a música precisaria vir
 * da biblioteca oficial do TikTok e não há API autorizada para escolher
 * uma faixa, o Autopilot gera o conteúdo SEM música em vez de arriscar.
 */

export const AUDIO_USAGE_POLICIES = ['ORIGINAL', 'GENERATED_ALLOWED', 'LICENSED', 'TIKTOK_LIBRARY_REQUIRED', 'UNKNOWN', 'PROHIBITED'] as const
export type AudioUsagePolicy = (typeof AUDIO_USAGE_POLICIES)[number]

export interface AudioDecision {
  podeUsar: boolean
  motivo: string
  acaoMinimaNecessaria: string | null
}

/**
 * Decide se um áudio pode ser usado. `TIKTOK_LIBRARY_REQUIRED` sem uma API
 * autorizada de escolha de faixa nunca é resolvido sozinho — o conteúdo
 * sai sem música (`podeUsar: false`, sem pedir nada à usuária) em vez de
 * arriscar direito autoral.
 */
export function decidirUsoDeAudio(policy: AudioUsagePolicy, params: { apiEscolhaFaixaAutorizada: boolean }): AudioDecision {
  switch (policy) {
    case 'ORIGINAL':
    case 'GENERATED_ALLOWED':
    case 'LICENSED':
      return { podeUsar: true, motivo: `Política "${policy}" permite uso.`, acaoMinimaNecessaria: null }
    case 'TIKTOK_LIBRARY_REQUIRED':
      if (params.apiEscolhaFaixaAutorizada) {
        return { podeUsar: true, motivo: 'Faixa da biblioteca do TikTok escolhida via API autorizada.', acaoMinimaNecessaria: null }
      }
      return {
        podeUsar: false,
        motivo: 'Música precisaria vir da biblioteca oficial do TikTok, mas não há API autorizada para escolher a faixa — gerando conteúdo sem música.',
        acaoMinimaNecessaria: null,
      }
    case 'UNKNOWN':
    case 'PROHIBITED':
      return { podeUsar: false, motivo: `Política "${policy}" nunca assume permissão de uso.`, acaoMinimaNecessaria: null }
  }
}
