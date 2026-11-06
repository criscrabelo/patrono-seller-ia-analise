/**
 * P2.18 — Limite de tentativas de acesso (força bruta) e cabeçalhos contra
 * embutir o Patrono (clickjacking). Banco de TESTE; contas descartáveis.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { criarUsuarioComWorkspace } from '../lib/workspace'
import { limparWorkspaceDeTeste } from './_limpar-workspace-de-teste'
import { authOptions } from '../lib/auth'
import { avaliar, chaveDe, ipDaRequisicao, REGRAS, MENSAGEM_DE_LIMITE } from '../lib/limite-de-tentativas'
import { CABECALHOS_DE_SEGURANCA } from '../next.config'
import { POST as cadastrar } from '../app/api/auth/register/route'
import { POST as esqueciSenha } from '../app/api/auth/esqueci-senha/route'

const prisma = new PrismaClient()
const PREFIXO = 'Conta de Teste — '
const SENHA = 'Senha-Certa-123'
const marca = Date.now()
const contaA = `limite-a-${marca}@teste.local`
const contaB = `limite-b-${marca}@teste.local`
const inexistente = `limite-ninguem-${marca}@teste.local`
const ipBase = `203.0.113.${marca % 200}`
const workspaces: string[] = []
const chavesCriadas = new Set<string>()

// O `authorize` do provedor de credenciais, como o NextAuth chama.
type Autorizar = (c: Record<string, string>, req: { headers: Record<string, string> }) => Promise<unknown>
const autorizar = (authOptions.providers[0] as unknown as { options: { authorize: Autorizar } }).options.authorize
async function entrar(email: string, password: string, ip?: string): Promise<'OK' | 'NULO' | string> {
  if (ip) chavesCriadas.add(chaveDe('ip', ip))
  chavesCriadas.add(chaveDe('conta', email))
  try {
    const r = await autorizar({ email, password }, { headers: ip ? { 'x-nf-client-connection-ip': ip } : {} })
    return r ? 'OK' : 'NULO'
  } catch (e) {
    return (e as Error).message
  }
}

before(async () => {
  const hash = await bcrypt.hash(SENHA, 4)
  for (const email of [contaA, contaB]) {
    const { workspace } = await criarUsuarioComWorkspace(prisma, { email, password: hash, name: `${PREFIXO}Limite ${email}`, status: 'ativo' })
    workspaces.push(workspace.id)
  }
})

after(async () => {
  await prisma.tentativaDeAcesso.deleteMany({ where: { chave: { in: [...chavesCriadas] } } })
  for (const w of workspaces) await limparWorkspaceDeTeste(prisma, w, PREFIXO)
  await prisma.$disconnect()
})

describe('regra pura', () => {
  const regra = { maximo: 5, janelaMs: 15 * 60_000 }
  const agora = new Date('2026-10-13T12:00:00Z')
  const antes = (min: number) => new Date(agora.getTime() - min * 60_000)

  test('4 falhas não bloqueiam; a 5ª bloqueia até a janela da falha decisiva passar', () => {
    assert.equal(avaliar([1, 2, 3, 4].map(antes), regra, agora).bloqueado, false)
    const r = avaliar([1, 2, 3, 4, 5].map(antes), regra, agora)
    assert.equal(r.bloqueado, true)
    assert.equal(r.liberaEm?.toISOString(), new Date(antes(5).getTime() + regra.janelaMs).toISOString())
  })
  test('falhas fora da janela não contam', () => {
    assert.equal(avaliar([1, 2, 3, 4, 16, 20].map(antes), regra, agora).bloqueado, false)
  })
  test('chave é hash: não guarda e-mail nem IP; e-mail sem diferença de maiúsculas', () => {
    const k = chaveDe('conta', ' Fulana@Exemplo.com ')
    assert.equal(k, chaveDe('conta', 'fulana@exemplo.com'))
    assert.match(k, /^[0-9a-f]{64}$/)
    assert.ok(!k.includes('fulana'))
    assert.notEqual(chaveDe('conta', 'x'), chaveDe('ip', 'x'))
  })
  test('IP só do cabeçalho da borda da Netlify; x-forwarded-for (forjável) é ignorado', () => {
    assert.equal(ipDaRequisicao({ 'x-nf-client-connection-ip': '198.51.100.7' }), '198.51.100.7')
    assert.equal(ipDaRequisicao(new Headers({ 'x-forwarded-for': '1.2.3.4' })), null)
    assert.equal(ipDaRequisicao(null), null)
  })
  test('regras: login 5/conta e 20/IP em 15 min; esqueci 3/conta; cadastro 5/IP', () => {
    assert.equal(REGRAS.LOGIN.conta?.maximo, 5)
    assert.equal(REGRAS.LOGIN.ip?.maximo, 20)
    assert.equal(REGRAS.ESQUECI_SENHA.conta?.maximo, 3)
    assert.equal(REGRAS.CADASTRO.ip?.maximo, 5)
  })
})

describe('força bruta no login (banco de TESTE)', () => {
  test('senha certa entra; 5 erradas bloqueiam e nem a certa entra depois', async () => {
    assert.equal(await entrar(contaA, SENHA), 'OK')
    for (let i = 0; i < 5; i++) assert.equal(await entrar(contaA, `errada-${i}`), 'NULO')
    assert.equal(await entrar(contaA, SENHA), 'LIMITE')
    assert.equal(await entrar(contaA.toUpperCase(), SENHA), 'LIMITE', 'maiúsculas não contornam')
  })
  test('outra conta não é afetada pelo bloqueio da primeira', async () => {
    assert.equal(await entrar(contaB, SENHA), 'OK')
  })
  test('sem enumeração: e-mail inexistente responde e bloqueia IGUAL a um existente', async () => {
    for (let i = 0; i < 5; i++) assert.equal(await entrar(inexistente, 'x'), 'NULO')
    assert.equal(await entrar(inexistente, 'x'), 'LIMITE')
  })
  test('login certo zera as falhas da conta', async () => {
    for (let i = 0; i < 4; i++) await entrar(contaB, 'errada')
    assert.equal(await entrar(contaB, SENHA), 'OK')
    for (let i = 0; i < 4; i++) await entrar(contaB, 'errada')
    assert.equal(await entrar(contaB, SENHA), 'OK', 'as 4 de antes não somaram com as novas')
  })
  test('força bruta espalhada: 20 falhas do mesmo IP em contas diferentes bloqueiam o IP', async () => {
    const ip = `${ipBase}1`
    for (let i = 0; i < 20; i++) assert.equal(await entrar(`spray-${marca}-${i}@teste.local`, 'x', ip), 'NULO')
    assert.equal(await entrar(contaB, SENHA, ip), 'LIMITE')
    assert.equal(await entrar(contaB, SENHA, `${ipBase}2`), 'OK', 'outro IP segue normal')
  })
  test('nada de senha, e-mail ou IP em texto na tabela', async () => {
    const linhas = await prisma.tentativaDeAcesso.findMany({ where: { chave: { in: [...chavesCriadas] } } })
    assert.ok(linhas.length > 0)
    const tudo = JSON.stringify(linhas)
    for (const proibido of [SENHA, 'errada', contaA, contaB, ipBase, '@teste.local']) assert.ok(!tudo.includes(proibido), proibido)
  })
})

describe('cadastro e "esqueci a senha"', () => {
  test('cadastro: 5 pedidos por IP por hora, depois 429 com mensagem genérica', async () => {
    const ip = `${ipBase}3`
    chavesCriadas.add(chaveDe('ip', ip))
    const pedir = () => cadastrar(new NextRequest('http://localhost/api/auth/register', { method: 'POST', headers: { 'x-nf-client-connection-ip': ip, 'content-type': 'application/json' }, body: '{}' }))
    for (let i = 0; i < 5; i++) assert.equal((await pedir()).status, 400)
    const r = await pedir()
    assert.equal(r.status, 429)
    assert.deepEqual(await r.json(), { error: MENSAGEM_DE_LIMITE })
  })
  test('esqueci a senha: resposta sempre igual; acima de 3 por conta nada mais é registrado/enviado', async () => {
    const email = `esqueci-${marca}@teste.local`
    chavesCriadas.add(chaveDe('conta', email))
    const pedir = () => esqueciSenha(new NextRequest('http://localhost/api/auth/esqueci-senha', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }))
    for (let i = 0; i < 5; i++) assert.deepEqual(await (await pedir()).json(), { ok: true })
    const n = await prisma.tentativaDeAcesso.count({ where: { chave: chaveDe('conta', email), tipo: 'ESQUECI_SENHA' } })
    assert.equal(n, 3)
  })
})

describe('cabeçalhos contra embutir o Patrono', () => {
  const mapa = Object.fromEntries(CABECALHOS_DE_SEGURANCA.map((h) => [h.key, h.value]))
  test("frame-ancestors 'none' + X-Frame-Options DENY + nosniff", () => {
    assert.equal(mapa['Content-Security-Policy'], "frame-ancestors 'none'")
    assert.equal(mapa['X-Frame-Options'], 'DENY')
    assert.equal(mapa['X-Content-Type-Options'], 'nosniff')
  })
  test('a CSP não restringe scripts/estilos/imagens (não quebra Next/Supabase/Preview)', () => {
    assert.ok(!/script-src|default-src|img-src|style-src|connect-src/.test(mapa['Content-Security-Policy']))
  })
  test('microfone liberado só para o próprio site (gravação de voz do Digital Twin)', () => {
    assert.match(mapa['Permissions-Policy'], /microphone=\(self\)/)
  })
})
