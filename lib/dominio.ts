/**
 * P2.7 — Domínio canônico, vindo da CONFIGURAÇÃO (nunca fixo no código).
 *
 * O domínio oficial é o host de `PUBLIC_BASE_URL` (ou, na falta dela, de
 * `NEXTAUTH_URL`) — a mesma prioridade de lib/link-de-publicacao.ts. Este
 * módulo roda no middleware (runtime de borda): sem import de Node, sem
 * banco.
 *
 * Única regra: `www.<domínio>` → `<domínio>`, preservando caminho e query,
 * com 308 (permanente e mantém o método). Qualquer outro host passa
 * intocado — inclusive o `*.netlify.app` e o `*.vercel.app`, que seguem
 * úteis para teste e rollback, e as chamadas servidor-a-servidor.
 */
export function hostCanonico(env: Record<string, string | undefined>): string | null {
  const bruto = (env.PUBLIC_BASE_URL ?? '').trim() || (env.NEXTAUTH_URL ?? '').trim()
  if (!bruto) return null
  try {
    const host = new URL(bruto).hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return null
  }
}

/** URL de destino do redirecionamento, ou `null` quando não há o que fazer. */
export function urlCanonica(
  url: { pathname: string; search: string; protocol?: string },
  hostDaRequisicao: string | null | undefined,
  env: Record<string, string | undefined>
): string | null {
  const canonico = hostCanonico(env)
  if (!canonico || !hostDaRequisicao) return null
  const host = hostDaRequisicao.toLowerCase().replace(/:\d+$/, '')
  if (host !== `www.${canonico}`) return null
  return `https://${canonico}${url.pathname}${url.search}`
}
