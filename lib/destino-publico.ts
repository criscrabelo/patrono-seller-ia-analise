/**
 * P2.50 — DESTINO PÚBLICO (SSRF e links de divulgação).
 *
 * Uma única régua para todo endereço que vem de fora (link do produto, imagem, destino de link rastreável):
 *  - só https (o navegador da compradora e o servidor nunca vão a http);
 *  - nada de localhost, .local/.internal, IP privado, loopback, link-local (169.254 — metadados de nuvem), CGNAT,
 *    "0.0.0.0" ou IPv6 local; nada de credenciais na URL;
 *  - nunca o próprio domínio do Patrono (evita laço de redirecionamento e redirecionamento aberto da marca).
 * O servidor, antes de BAIXAR algo (`buscarDestinoPublico`), também resolve o DNS e recusa endereço interno, e não
 * segue redirecionamento (um 302 para a rede interna não passa).
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const HOSTS_INTERNOS = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|metadata\.google\.internal)$/i

/** FUNÇÃO PURA. IP (v4 ou v6) que não é da internet pública. */
export function ipNaoPublico(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, '')
    if (s === '::' || s === '::1') return true
    if (/^(fc|fd)/.test(s) || /^fe[89ab]/.test(s)) return true
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return m ? ipNaoPublico(m[1]) : false
  }
  return false
}

export interface Destino { ok: boolean; motivo: string | null; url: URL | null }

/** FUNÇÃO PURA. A URL pode ser usada como destino público? `hostsDoApp`: domínios do próprio Patrono (recusados). */
export function destinoPublico(bruto: unknown, opcoes: { hostsDoApp?: string[] } = {}): Destino {
  if (typeof bruto !== 'string' || !bruto.trim()) return { ok: false, motivo: 'Endereço vazio.', url: null }
  let u: URL
  try { u = new URL(bruto.trim()) } catch { return { ok: false, motivo: 'Endereço inválido.', url: null } }
  if (u.protocol !== 'https:') return { ok: false, motivo: 'Use um endereço https:// (seguro).', url: u }
  if (u.username || u.password) return { ok: false, motivo: 'Endereço com usuário/senha não é aceito.', url: u }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || HOSTS_INTERNOS.test(host)) return { ok: false, motivo: 'Endereço interno não serve para divulgação.', url: u }
  if (isIP(host) && ipNaoPublico(host)) return { ok: false, motivo: 'Endereço de rede interna não é aceito.', url: u }
  if (!isIP(host) && !host.includes('.')) return { ok: false, motivo: 'Endereço sem domínio público.', url: u }
  const doApp = (opcoes.hostsDoApp ?? []).map((h) => h.toLowerCase())
  if (doApp.some((h) => host === h || host.endsWith(`.${h}`))) return { ok: false, motivo: 'O destino não pode ser o próprio Patrono.', url: u }
  return { ok: true, motivo: null, url: u }
}

/** Domínios do próprio app, pelas variáveis de ambiente (NEXTAUTH_URL, APP_URL, URL da Netlify). */
export function hostsDoApp(env: Record<string, string | undefined> = process.env): string[] {
  return [env.NEXTAUTH_URL, env.APP_URL, env.URL, env.DEPLOY_PRIME_URL, env.NEXT_PUBLIC_APP_URL]
    .map((x) => { try { return x ? new URL(x).hostname : null } catch { return null } })
    .filter((x): x is string => !!x && !/^(localhost|127\.0\.0\.1)$/.test(x))
}

/** Busca do SERVIDOR a um destino de fora: régua + DNS sem IP interno + sem seguir redirecionamento. */
export async function buscarDestinoPublico(url: string, init: RequestInit = {}): Promise<Response> {
  const d = destinoPublico(url)
  if (!d.ok || !d.url) throw new Error(`Endereço recusado: ${d.motivo}`)
  const host = d.url.hostname.replace(/^\[|\]$/g, '')
  const ips = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (!ips.length || ips.some((x) => ipNaoPublico(x.address))) throw new Error('Endereço recusado: o domínio aponta para a rede interna.')
  const res = await fetch(d.url, { ...init, redirect: 'manual' })
  if (res.status >= 300 && res.status < 400) throw new Error('Endereço recusado: redirecionamento não é seguido.')
  return res
}
