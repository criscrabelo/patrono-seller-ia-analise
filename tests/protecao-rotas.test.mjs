/**
 * Testes de regressão — proteção de rotas e estado zerado.
 *
 * Usa o test runner nativo do Node (`node --test`): nenhuma dependência nova,
 * nenhum custo. Roda contra um servidor já em pé.
 *
 *   BASE_URL=http://localhost:3100 npm run test:rotas
 *
 * Por que existe: a versão anterior do middleware listava as telas protegidas
 * uma a uma, e sete áreas ficaram públicas sem ninguém perceber. Estes testes
 * falham se isso voltar a acontecer.
 */
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'

// Toda tela que exige sessão. Ao criar uma tela nova, acrescente aqui.
const TELAS_PROTEGIDAS = [
  '/dashboard', '/produtos', '/produtos/novo', '/produtos/imagens',
  '/conteudos', '/conteudos/gerar', '/aprovacao', '/calendario',
  '/relatorios', '/video-seller', '/links', '/monetizacao',
  '/integracoes', '/integracoes/shopee', '/whatsapp', '/videos',
  '/conta', '/admin/usuarios', '/admin/permissoes',
]

const APIS_PROTEGIDAS = [
  '/api/produtos', '/api/links', '/api/integracoes', '/api/conteudos',
  '/api/metricas', '/api/permissoes', '/api/admin/usuarios',
  '/api/admin/permissoes', '/api/video-seller',
]

const PUBLICAS = [
  '/login', '/register', '/esqueci-senha', '/redefinir-senha',
  '/api/auth/providers', '/api/auth/csrf',
]

const sem = (url) => fetch(BASE + url, { redirect: 'manual' })

before(async () => {
  const r = await fetch(BASE + '/login').catch(() => null)
  if (!r?.ok) {
    throw new Error(
      `Servidor não respondeu em ${BASE}. Suba o app antes: npm run build && npm start`
    )
  }
})

describe('Sem sessão', () => {
  for (const rota of TELAS_PROTEGIDAS) {
    test(`${rota} redireciona para /login`, async () => {
      const r = await sem(rota)
      assert.equal(r.status, 307, `${rota} deveria redirecionar`)
      const destino = r.headers.get('location') ?? ''
      assert.ok(
        destino.includes('/login'),
        `${rota} redirecionou para "${destino}" em vez de /login`
      )
    })
  }

  for (const rota of APIS_PROTEGIDAS) {
    test(`${rota} responde 401 em JSON`, async () => {
      const r = await sem(rota)
      assert.equal(r.status, 401, `${rota} deveria responder 401`)

      // Precisa ser JSON: um `fetch()` do navegador que receba HTML aqui
      // quebraria no res.json() e mostraria erro técnico para a usuária.
      const tipo = r.headers.get('content-type') ?? ''
      assert.ok(tipo.includes('application/json'), `${rota} respondeu ${tipo}`)

      const corpo = await r.json()
      assert.ok(typeof corpo.error === 'string' && corpo.error.length > 0)
      // A mensagem é lida por uma pessoa — nada de stack trace ou código cru.
      assert.ok(!/at \w+|Error:|undefined|null/.test(corpo.error), corpo.error)
    })
  }

  for (const rota of PUBLICAS) {
    test(`${rota} continua acessível`, async () => {
      const r = await fetch(BASE + rota)
      assert.equal(r.status, 200, `${rota} deveria ser pública`)
    })
  }
})

describe('Link de afiliada (/api/l/:slug)', () => {
  test('funciona sem sessão — é o link que vai para o público', async () => {
    const r = await sem('/api/l/__inexistente__')
    // O importante: NÃO cai na tela de login. Slug inválido pode dar 404 ou
    // redirecionar para a home, mas nunca exigir sessão.
    assert.notEqual(r.status, 401, 'link público não pode exigir sessão')
    const destino = r.headers.get('location') ?? ''
    assert.ok(!destino.includes('/login'), `redirecionou para login: ${destino}`)
  })
})

// ── Páginas institucionais públicas ────────────────────────────────────
//
// Existem para que parceiros e plataformas (validação do TikTok Shop
// Partner Center) identifiquem a empresa. Precisam responder 200 SEM sessão,
// SEM redirecionar, e com a razão social no HTML do servidor — um crawler
// não executa JavaScript.
describe('Institucional: /sobre, /privacidade, /termos', () => {
  const PAGINAS = {
    '/sobre': ['PATRONO INOVA SIMPLES (I.S.)', '11.222.333/0001-81', 'Patrono Seller', 'Política de Privacidade', 'Termos de Uso', 'Marketing de afiliados', 'Rastreamento de vendas e comissões'],
    '/privacidade': ['PATRONO INOVA SIMPLES (I.S.)', 'Política de Privacidade', 'LGPD'],
    '/termos': ['PATRONO INOVA SIMPLES (I.S.)', 'Termos de Uso'],
  }

  for (const [rota, textos] of Object.entries(PAGINAS)) {
    test(`${rota} responde 200 sem sessão, sem redirecionar`, async () => {
      const r = await sem(rota)
      assert.equal(r.status, 200, `${rota} respondeu ${r.status} (location: ${r.headers.get('location')})`)
      assert.ok((r.headers.get('content-type') ?? '').includes('text/html'))
    })

    test(`${rota} traz o texto no HTML do servidor`, async () => {
      const html = await (await sem(rota)).text()
      for (const t of textos) {
        // O HTML escapa "&" e acentos não; a razão social precisa aparecer literal.
        assert.ok(html.includes(t), `${rota} sem "${t}" no HTML renderizado`)
      }
    })

    test(`${rota} não vaza segredo nem dado de sessão`, async () => {
      const html = await (await sem(rota)).text()
      for (const proibido of ['REVISAR', 'NEXTAUTH_SECRET', 'SERVICE_ROLE', 'accessToken', 'refreshToken', 'appSecret', 'DATABASE_URL', 'postgres://', 'postgresql://']) {
        assert.ok(!html.includes(proibido), `${rota} contém "${proibido}"`)
      }
    })
  }

  // A liberação é por comparação EXATA: nada "parecido" fica público.
  for (const rota of ['/sobre/admin', '/sobrex', '/termos/../dashboard', '/privacidade-interna']) {
    test(`${rota} continua exigindo sessão`, async () => {
      const r = await sem(rota)
      assert.equal(r.status, 307, `${rota} respondeu ${r.status}`)
      assert.ok((r.headers.get('location') ?? '').includes('/login'))
    })
  }
})
