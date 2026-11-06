/**
 * P2.15.4 — Quais conteúdos podem ir para o WhatsApp em massa.
 *
 * Regra (vale na tela E no servidor — a tela só esconde, quem decide é a API):
 *   1. aprovado (aprovado, agendado, publicado ou com publicação atrasada —
 *      todos passaram pela aprovação);
 *   2. liberado EXPLICITAMENTE para WhatsApp: criado para a rede "WhatsApp"
 *      e com a legenda de WhatsApp preenchida;
 *   3. sem alerta vermelho de conformidade (mesmo com risco confirmado —
 *      mensagem em massa para terceiros não leva conteúdo com alerta grave).
 * O texto enviado é SEMPRE a legenda aprovada do conteúdo, nunca texto livre.
 *
 * Função pura: sem banco, pode ser usada no navegador.
 */
export const STATUS_APROVADOS = ['aprovado', 'agendado', 'publicado', 'publicacao_atrasada'] as const

export interface ConteudoParaWhatsapp {
  status: string
  redeSocial: string | null
  legendaWhatsapp: string | null
  alertasCompliance?: unknown
}

/** null = pode enviar; texto = por que não pode (em linguagem simples). */
export function motivoParaNaoEnviar(c: ConteudoParaWhatsapp): string | null {
  if (!(STATUS_APROVADOS as readonly string[]).includes(c.status)) return 'Este conteúdo ainda não foi aprovado. Aprove em Aprovações antes de enviar.'
  if (c.redeSocial !== 'WhatsApp') return 'Este conteúdo não foi liberado para WhatsApp (foi feito para outra rede). Gere um conteúdo para WhatsApp e aprove.'
  if (!c.legendaWhatsapp?.trim()) return 'Este conteúdo não tem a mensagem de WhatsApp aprovada.'
  const alertas = Array.isArray(c.alertasCompliance) ? (c.alertasCompliance as { severidade?: string }[]) : []
  if (alertas.some((a) => a?.severidade === 'vermelho')) return 'Este conteúdo tem alerta vermelho de conformidade e não pode ir para envio em massa.'
  return null
}
