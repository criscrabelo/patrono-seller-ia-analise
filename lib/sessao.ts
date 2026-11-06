/**
 * P2.15.4 — Porta única de sessão + permissão de módulo das rotas de API.
 *
 *   const session = await exigirSessao()
 *   if (session instanceof NextResponse) return session
 *
 * 1. Sem sessão → 401 (como antes).
 * 2. Admin → passa (acesso a todos os módulos).
 * 3. Demais papéis → a rota (caminho + método, gravados pelo middleware e
 *    impossíveis de forjar pelo cliente) é procurada em REGRAS_DE_ROTA; se
 *    todos os módulos que a liberam estiverem bloqueados para o papel → 403.
 *    Sem o cabeçalho do middleware, falha FECHADO (403) para não-admin.
 * A regra mora em lib/modulos-rotas.ts — nenhuma rota repete regra.
 */
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getServerSession, type Session } from 'next-auth'
import { authOptions } from './auth'
import { prisma } from './prisma'
import { CABECALHO_CAMINHO, CABECALHO_METODO, regraDaRota, rotaLiberada } from './modulos-rotas'
import { registrarAuditoria } from './audit-log'

const CACHE_MS = 15_000
const cache = new Map<string, { ate: number; bloqueados: Set<string> }>()

/** Módulos bloqueados para o papel (cache curto: mudança no admin vale em até 15 s). */
export async function modulosBloqueadosDoPapel(role: string, agora = Date.now()): Promise<Set<string>> {
  if (role === 'admin') return new Set()
  const c = cache.get(role)
  if (c && c.ate > agora) return c.bloqueados
  const linhas = await prisma.moduloPermissao.findMany({ where: { role, liberado: false }, select: { modulo: true } })
  const bloqueados = new Set(linhas.map((l) => l.modulo))
  cache.set(role, { ate: agora + CACHE_MS, bloqueados })
  return bloqueados
}

/** Só para testes: esquece o cache de permissões. */
export function limparCacheDePermissoes() {
  cache.clear()
}

/** FUNÇÃO de decisão (testável sem requisição): pode usar esta rota? */
export async function podeUsarRota(p: { role: string; caminho: string | null; metodo: string | null }): Promise<boolean> {
  if (p.role === 'admin') return true
  if (!p.caminho || !p.metodo) return false // sem o carimbo do middleware: fecha
  return rotaLiberada(regraDaRota(p.caminho, p.metodo), await modulosBloqueadosDoPapel(p.role))
}

export async function exigirSessao(): Promise<Session | NextResponse> {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const h = await headers()
  const caminho = h.get(CABECALHO_CAMINHO)
  const metodo = h.get(CABECALHO_METODO)
  if (!(await podeUsarRota({ role: session.user.role, caminho, metodo }))) {
    await registrarAuditoria({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      action: 'modulo.acesso_negado',
      entityType: 'Rota',
      entityId: `${metodo ?? '?'} ${caminho ?? '?'}`,
    }).catch(() => {})
    return NextResponse.json({ error: 'Seu acesso a este módulo está bloqueado. Fale com a administradora.' }, { status: 403 })
  }
  return session
}
