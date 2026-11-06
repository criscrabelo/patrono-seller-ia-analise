/**
 * P2.15.3 — Auditoria funcional: proteções que a auditoria fechou.
 *
 * Banco de TESTE: sessão revogada quando a conta é bloqueada/excluída (o JWT
 * vale 30 dias), login sem diferença de maiúsculas no e-mail.
 * Puro: as listas brancas das rotas de edição recusam campos perigosos.
 * Nada é publicado, nada é cobrado. Limpa o que cria.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.15.3 — sessão e login contra o banco de teste', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let auth: typeof import('../lib/auth').authOptions
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  const marca = `r69-${Date.now()}`
  let ws = ''
  let userId = ''
  const email = `${marca}-Auditoria@Teste.Local`

  before(async () => {
    ;[{ prisma }, { authOptions: auth }, { limparWorkspaceDeTeste: limpar }] = await Promise.all([
      import('../lib/prisma'), import('../lib/auth'), import('./_limpar-workspace-de-teste'),
    ])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}Auditoria P2.15.3`, ownerId: marca }, select: { id: true } })).id
    userId = (await prisma.user.create({ data: { email, name: 'Auditoria', password: await bcrypt.hash('Senha@123', 4), workspaceId: ws, status: 'ativo' }, select: { id: true } })).id
  })

  after(async () => {
    if (prisma && ws) await limpar(prisma, ws, PREFIXO)
    await prisma?.$disconnect()
  })

  const jwt = async (token: Record<string, unknown>) => auth.callbacks!.jwt!({ token, user: undefined as never, account: null } as never)
  const authorize = (e: string, s: string) =>
    (auth.providers[0] as unknown as { options: { authorize: (c: Record<string, string>) => Promise<unknown> } }).options.authorize({ email: e, password: s })

  test('login aceita o e-mail com outras maiúsculas/minúsculas', async () => {
    const u = (await authorize(email.toLowerCase(), 'Senha@123')) as { id: string } | null
    assert.equal(u?.id, userId)
    assert.equal(await authorize(email.toLowerCase(), 'errada'), null)
  })

  test('sessão é relida do banco: papel atualizado; bloqueada ou excluída perde o acesso', async () => {
    const recente = await jwt({ id: userId, role: 'usuario', workspaceId: ws, verificadoEm: Date.now() })
    assert.equal((recente as { role: string }).role, 'usuario') // dentro de 1 min: não relê

    await prisma.user.update({ where: { id: userId }, data: { role: 'admin' } })
    const relido = (await jwt({ id: userId, role: 'usuario', workspaceId: ws, verificadoEm: 0 })) as { role: string; verificadoEm: number }
    assert.equal(relido.role, 'admin')
    assert.ok(relido.verificadoEm > 0)

    await prisma.user.update({ where: { id: userId }, data: { status: 'bloqueado' } })
    await assert.rejects(jwt({ id: userId, role: 'admin', workspaceId: ws, verificadoEm: 0 }), /SESSAO_REVOGADA/)

    await assert.rejects(jwt({ id: 'usuario-que-nao-existe', role: 'admin', workspaceId: ws, verificadoEm: 0 }), /SESSAO_REVOGADA/)
  })
})

// ── Inventário estático: nenhum link, push ou fetch aponta para rota inexistente ──
import fs from 'node:fs'
import path from 'node:path'

function arquivos(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!['node_modules', '.next', 'api'].includes(e.name) || dir.endsWith('app')) arquivos(p, ext, out) } else if (ext.test(e.name)) out.push(p)
  }
  return out
}

/** Rotas reais: "/conteudos/[id]" etc. (grupos entre parênteses não aparecem na URL). */
function rotas(base: 'page' | 'route'): { padrao: RegExp; arquivo: string }[] {
  const todos = arquivos('app', base === 'page' ? /^page\.tsx$/ : /^route\.ts$/)
  return todos.map((f) => {
    const partes = f.split(path.sep).join('/').split('/').slice(1, -1) // tira 'app' e o nome do arquivo
    const url = '/' + partes.filter((s) => !/^\(.*\)$/.test(s)).join('/')
    const re = url.replace(/\[\.\.\.[^\]]+\]/g, '.+').replace(/\[[^\]]+\]/g, '[^/]+')
    return { padrao: new RegExp(`^${re === '/' ? '/' : re.replace(/\/$/, '')}$`), arquivo: f, peso: (url.match(/\[\.\.\./g)?.length ?? 0) * 100 + (url.match(/\[/g)?.length ?? 0) }
  })
    // Como o Next.js: rota fixa antes da dinâmica, catch-all por último. Sem isso, o `find` dependia da ordem
    // do sistema de arquivos (no Linux, /api/auth/register caía em /api/auth/[...nextauth]).
    .sort((a, b) => a.peso - b.peso)
}

describe('P2.15.3 — zero botão morto conhecido (inventário estático)', () => {
  const fontes = [...arquivos('app', /\.tsx$/), ...arquivos('components', /\.tsx$/)].filter((f) => !f.includes(`${path.sep}api${path.sep}`))
  const paginas = rotas('page')
  const apis = rotas('route')
  const normalizar = (u: string) => u.split('?')[0].split('#')[0].replace(/\$\{[^}]+\}/g, 'X').replace(/\/$/, '') || '/'

  test('todo href/push interno leva a uma página que existe', () => {
    const quebrados: string[] = []
    for (const f of fontes) {
      const src = fs.readFileSync(f, 'utf8')
      for (const m of src.matchAll(/(?:href=|router\.(?:push|replace)\()\s*\{?\s*[`'"](\/[^`'"\s]*)[`'"]/g)) {
        const u = normalizar(m[1])
        if (u.startsWith('/api/') || u.startsWith('/_next')) continue
        if (!paginas.some((p) => p.padrao.test(u))) quebrados.push(`${f}: ${m[1]}`)
      }
    }
    assert.deepEqual(quebrados, [])
  })

  test('todo fetch para /api/* chama rota e método que existem', () => {
    const quebrados: string[] = []
    for (const f of fontes) {
      const src = fs.readFileSync(f, 'utf8')
      for (const m of src.matchAll(/fetch\(\s*[`'"](\/api\/[^`'"]*)[`'"]\s*(?:,\s*\{([\s\S]{0,200}?)\})?/g)) {
        const u = normalizar(m[1])
        const metodo = (m[2]?.match(/method:\s*['"](\w+)['"]/)?.[1] ?? 'GET').toUpperCase()
        const rota = apis.find((a) => a.padrao.test(u))
        if (!rota) { quebrados.push(`${f}: ${m[1]} (rota não existe)`); continue }
        const codigo = fs.readFileSync(rota.arquivo, 'utf8')
        if (!new RegExp(`export (async )?function ${metodo}\\b|export const ${metodo}\\b`).test(codigo)) quebrados.push(`${f}: ${metodo} ${m[1]} (método não existe)`)
      }
    }
    assert.deepEqual(quebrados, [])
  })
})
