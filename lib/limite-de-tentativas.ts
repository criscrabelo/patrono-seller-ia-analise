import { createHash } from 'crypto'
import { prisma } from './prisma'
import { log } from './observabilidade'

/**
 * P2.18 — Limite de tentativas de acesso (contra força bruta e abuso).
 *
 * ── REGRAS ─────────────────────────────────────────────────────────────
 * Conta-se FALHA por chave, numa janela deslizante. A chave é o hash de
 * "conta:<e-mail normalizado>" ou de "ip:<endereço>":
 *   - LOGIN por conta: 5 falhas em 15 min → bloqueia por 15 min
 *     (a contar da falha mais antiga da janela). Login certo zera a conta.
 *   - LOGIN por IP: 20 falhas em 15 min → bloqueia o IP (força bruta
 *     espalhada por várias contas).
 *   - ESQUECI_SENHA: 3 pedidos por conta e 10 por IP por hora.
 *   - CADASTRO: 5 por IP por hora.
 *
 * ── SEM ENUMERAÇÃO ─────────────────────────────────────────────────────
 * A chave da conta vem do que foi DIGITADO, exista a conta ou não: um
 * e-mail inexistente bloqueia igual a um existente, com a MESMA resposta
 * genérica. Nada aqui diz se a conta existe.
 *
 * ── PRIVACIDADE E LOGS ─────────────────────────────────────────────────
 * Nem e-mail nem IP ficam em texto (só sha256). O log mostra só o tipo,
 * o escopo e 8 caracteres do hash — nunca senha, e-mail ou IP.
 *
 * ── FALHA DO BANCO ─────────────────────────────────────────────────────
 * Se a tabela de tentativas falhar, o acesso NÃO é bloqueado (o login já
 * depende do mesmo banco; travar todo mundo por um erro do limitador seria
 * pior). O erro vai para o log.
 */

export type TipoDeTentativa = 'LOGIN' | 'ESQUECI_SENHA' | 'CADASTRO'
export type Escopo = 'conta' | 'ip'

export interface Regra { maximo: number; janelaMs: number }

const MIN = 60_000
export const REGRAS: Record<TipoDeTentativa, Partial<Record<Escopo, Regra>>> = {
  LOGIN: { conta: { maximo: 5, janelaMs: 15 * MIN }, ip: { maximo: 20, janelaMs: 15 * MIN } },
  ESQUECI_SENHA: { conta: { maximo: 3, janelaMs: 60 * MIN }, ip: { maximo: 10, janelaMs: 60 * MIN } },
  CADASTRO: { ip: { maximo: 5, janelaMs: 60 * MIN } },
}

/** Mensagem única para qualquer bloqueio — não revela conta nem regra. */
export const MENSAGEM_DE_LIMITE = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'

const GUARDAR_POR_MS = 24 * 60 * MIN

export function chaveDe(escopo: Escopo, valor: string): string {
  const normal = escopo === 'conta' ? valor.trim().toLowerCase() : valor.trim()
  return createHash('sha256').update(`${escopo}:${normal}`).digest('hex')
}

/**
 * IP de quem pede — SÓ o `x-nf-client-connection-ip`, que a borda da
 * Netlify põe e o cliente não consegue forjar. `x-forwarded-for` é ignorado
 * de propósito: quem pede escreve o que quiser nele e trocaria de "IP" a
 * cada tentativa. Fora da Netlify (local/testes) → null: vale só o limite
 * por conta.
 */
export function ipDaRequisicao(cabecalhos: Headers | Record<string, string | string[] | undefined> | undefined | null): string | null {
  if (!cabecalhos) return null
  const n = 'x-nf-client-connection-ip'
  const v = typeof (cabecalhos as Headers).get === 'function' ? (cabecalhos as Headers).get(n) : (cabecalhos as Record<string, string | string[] | undefined>)[n]
  const ip = (Array.isArray(v) ? v[0] : v)?.trim()
  return ip || null
}

/** Decisão pura: dadas as falhas na janela (datas), está bloqueado? Até quando? */
export function avaliar(falhas: Date[], regra: Regra, agora: Date): { bloqueado: boolean; liberaEm: Date | null } {
  const inicio = agora.getTime() - regra.janelaMs
  const naJanela = falhas.map((d) => d.getTime()).filter((t) => t > inicio).sort((a, b) => a - b)
  if (naJanela.length < regra.maximo) return { bloqueado: false, liberaEm: null }
  // Libera quando a falha que completou o limite sair da janela.
  const decisiva = naJanela[naJanela.length - regra.maximo]
  return { bloqueado: true, liberaEm: new Date(decisiva + regra.janelaMs) }
}

interface Alvo { conta?: string | null; ip?: string | null }

function chaves(tipo: TipoDeTentativa, alvo: Alvo): { escopo: Escopo; chave: string; regra: Regra }[] {
  const r: { escopo: Escopo; chave: string; regra: Regra }[] = []
  const regras = REGRAS[tipo]
  if (regras.conta && alvo.conta?.trim()) r.push({ escopo: 'conta', chave: chaveDe('conta', alvo.conta), regra: regras.conta })
  if (regras.ip && alvo.ip?.trim()) r.push({ escopo: 'ip', chave: chaveDe('ip', alvo.ip), regra: regras.ip })
  return r
}

/** Está bloqueado agora? (lê só falhas; para LOGIN, sucesso zera a conta.) */
export async function estaBloqueado(tipo: TipoDeTentativa, alvo: Alvo, agora: Date = new Date()): Promise<boolean> {
  try {
    for (const { escopo, chave, regra } of chaves(tipo, alvo)) {
      const linhas = await prisma.tentativaDeAcesso.findMany({
        where: { chave, tipo, sucesso: false, criadoEm: { gt: new Date(agora.getTime() - regra.janelaMs) } },
        select: { criadoEm: true },
        orderBy: { criadoEm: 'desc' },
        take: regra.maximo,
      })
      const r = avaliar(linhas.map((l) => l.criadoEm), regra, agora)
      if (r.bloqueado) {
        log('warn', 'acesso.limite', { tipo, escopo, chave: chave.slice(0, 8), liberaEm: r.liberaEm?.toISOString() })
        return true
      }
    }
    return false
  } catch (e) {
    log('error', 'acesso.limite.falhou', { tipo, erro: e instanceof Error ? e.message : String(e) })
    return false
  }
}

/**
 * Registra uma tentativa. Em pedidos de "esqueci a senha"/cadastro, todo
 * pedido conta (sucesso=false). No LOGIN, sucesso apaga as falhas da conta.
 */
export async function registrarTentativa(tipo: TipoDeTentativa, alvo: Alvo, sucesso: boolean, agora: Date = new Date()): Promise<void> {
  try {
    const ks = chaves(tipo, alvo)
    if (!ks.length) return
    if (tipo === 'LOGIN' && sucesso) {
      const conta = ks.find((k) => k.escopo === 'conta')
      if (conta) await prisma.tentativaDeAcesso.deleteMany({ where: { chave: conta.chave, tipo, sucesso: false } })
      return
    }
    await prisma.tentativaDeAcesso.createMany({ data: ks.map((k) => ({ chave: k.chave, tipo, sucesso, criadoEm: agora })) })
    // Faxina barata: só as linhas antigas destas mesmas chaves.
    await prisma.tentativaDeAcesso.deleteMany({ where: { chave: { in: ks.map((k) => k.chave) }, criadoEm: { lt: new Date(agora.getTime() - GUARDAR_POR_MS) } } })
  } catch (e) {
    log('error', 'acesso.registro.falhou', { tipo, erro: e instanceof Error ? e.message : String(e) })
  }
}
