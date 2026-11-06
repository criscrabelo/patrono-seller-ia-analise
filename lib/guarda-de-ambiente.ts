/**
 * P2.5/P2.6 — Preview e Test NUNCA falam com o banco de produção.
 *
 * Na Vercel, Production e Preview têm registros de variável separados
 * desde a P2.6 (Preview usa o projeto de teste). Na Netlify, o isolamento é
 * por site e por contexto (P2.4). Esta trava é a defesa em profundidade, no
 * único lugar por onde todo acesso passa (lib/prisma.ts), para o dia em que
 * alguém errar uma variável:
 *
 *   1. Quem diz se é produção é a PLATAFORMA (`VERCEL_ENV`, `CONTEXT` da
 *      Netlify). `PATRONO_AMBIENTE` só pode REBAIXAR: num deploy que a
 *      plataforma marca como não-produção, nenhuma combinação de variável
 *      promove o ambiente a produção. Sem sinal da plataforma (site de
 *      produção da Netlify em tempo de execução), vale o explícito.
 *   2. Num ambiente NÃO-produção, a ausência de
 *      `PATRONO_REF_DO_BANCO_DE_PRODUCAO` falha FECHADO: sem saber qual é o
 *      banco proibido, não há como garantir que não é ele.
 *   3. Com a referência, uma `DATABASE_URL` que a contenha só é aceita em
 *      produção.
 *
 * Sem nenhum sinal (máquina local, suítes de teste), a trava só age se a
 * referência estiver configurada. A referência vem do AMBIENTE, nunca do
 * repositório.
 */
export type ContextoDeImplantacao = 'producao' | 'nao-producao' | 'desconhecido'

function sinalDaPlataforma(env: Record<string, string | undefined>): ContextoDeImplantacao {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === 'production' ? 'producao' : 'nao-producao'
  if (env.CONTEXT) return env.CONTEXT === 'production' ? 'producao' : 'nao-producao'
  return 'desconhecido'
}

export function contextoDeImplantacao(env: Record<string, string | undefined>): ContextoDeImplantacao {
  const plataforma = sinalDaPlataforma(env)
  const explicito = (env.PATRONO_AMBIENTE ?? '').trim().toLowerCase()
  // A plataforma disse "não é produção": nada promove.
  if (plataforma === 'nao-producao') return 'nao-producao'
  // O explícito só rebaixa: "teste" num deploy de produção vira não-produção.
  if (explicito && explicito !== 'producao') return 'nao-producao'
  if (plataforma === 'producao') return 'producao'
  return explicito === 'producao' ? 'producao' : 'desconhecido'
}

export type VereditoDoBanco = { ok: true; trava: 'inerte' | 'ativa' } | { ok: false; explicacao: string }

/**
 * Uma linha de log, SEM NENHUM VALOR, que diz em que ambiente o processo
 * está e o que ele alcança. É a prova operacional do isolamento: um Preview
 * tem de mostrar `contexto=nao-producao banco=nao-producao iaPaga=sem-chave`.
 */
export function resumoDoAmbiente(env: Record<string, string | undefined>): string {
  const ref = (env.PATRONO_REF_DO_BANCO_DE_PRODUCAO ?? '').trim()
  const banco = !ref ? 'sem-referencia' : (env.DATABASE_URL ?? '').includes(ref) ? 'producao' : 'nao-producao'
  const supabase = !ref ? 'sem-referencia' : (env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes(ref) ? 'producao' : 'nao-producao'
  const iaPaga = env.ANTHROPIC_API_KEY || env.FAL_KEY ? 'chave-presente' : 'sem-chave'
  const publicacao = Object.keys(env).filter((k) => /^PUBLICACAO_REAL_/.test(k) && env[k] === 'true')
  return [
    `contexto=${contextoDeImplantacao(env)}`,
    `trava=${ref ? 'ativa' : 'inerte'}`,
    `banco=${banco}`,
    `supabase=${supabase}`,
    `iaPaga=${iaPaga}`,
    `pagoHabilitado=${env.PAID_AI_ENABLED === 'true' ? 'sim' : 'nao'}`,
    `cron=${env.CRON_SECRET ? 'segredo-presente' : 'sem-segredo'}`,
    `agendador=${env.AGENDADOR_DOS_CRONS || 'nenhum'}`,
    `publicacaoReal=${publicacao.length ? publicacao.join('+') : 'nenhuma'}`,
  ].join(' ')
}

export function bancoPermitidoNoAmbiente(env: Record<string, string | undefined>): VereditoDoBanco {
  const contexto = contextoDeImplantacao(env)
  const ref = (env.PATRONO_REF_DO_BANCO_DE_PRODUCAO ?? '').trim()

  if (!ref) {
    if (contexto === 'nao-producao') {
      return {
        ok: false,
        explicacao:
          'Ambiente não-produção sem PATRONO_REF_DO_BANCO_DE_PRODUCAO: a trava não sabe qual banco recusar, então recusa abrir qualquer um.',
      }
    }
    return { ok: true, trava: 'inerte' }
  }
  // Referência curta demais casaria com qualquer URL: configuração errada
  // não pode virar trava falsa nem passe livre.
  if (ref.length < 8) return { ok: false, explicacao: 'PATRONO_REF_DO_BANCO_DE_PRODUCAO inválida (curta demais).' }

  const url = env.DATABASE_URL ?? ''
  if (!url.includes(ref)) return { ok: true, trava: 'ativa' }
  if (contexto === 'producao') return { ok: true, trava: 'ativa' }
  return {
    ok: false,
    explicacao:
      `Banco de produção recusado: este ambiente é "${contexto}". Preview e teste usam só o banco de teste. ` +
      'Em produção a plataforma informa o ambiente; sem plataforma, declare PATRONO_AMBIENTE=producao.',
  }
}
