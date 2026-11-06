/**
 * P2.7 — Domínio definitivo sem domínio no código.
 *
 *   1. O domínio canônico vem da configuração (PUBLIC_BASE_URL → NEXTAUTH_URL).
 *   2. www.<domínio> → <domínio> (308), e nada mais é redirecionado.
 *   3. O disparo da Background Function atravessa o middleware — na Netlify
 *      ele intercepta /.netlify/* (P2.1); sem a exceção exata, nenhum
 *      trabalho longo rodaria em produção.
 *   4. Nenhum domínio de produção fixo em app/, lib/, middleware ou netlify/.
 *
 * Sem banco, sem rede. Custo R$ 0,00.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { hostCanonico, urlCanonica } from '../lib/dominio'
import { CAMINHO_DA_FUNCAO } from '../lib/trabalho-longo'
import { urlRastreadaParaExibir } from '../lib/link-de-publicacao'

const RAIZ = join(__dirname, '..')
const DOMINIO = 'https://dominio-de-exemplo.ia.br'

describe('Domínio canônico pela configuração', () => {
  test('host canônico: PUBLIC_BASE_URL, depois NEXTAUTH_URL; www nunca é o canônico', () => {
    assert.equal(hostCanonico({ PUBLIC_BASE_URL: DOMINIO, NEXTAUTH_URL: 'https://outro.com.br' }), 'dominio-de-exemplo.ia.br')
    assert.equal(hostCanonico({ NEXTAUTH_URL: DOMINIO }), 'dominio-de-exemplo.ia.br')
    assert.equal(hostCanonico({ PUBLIC_BASE_URL: 'https://www.dominio-de-exemplo.ia.br' }), 'dominio-de-exemplo.ia.br')
    assert.equal(hostCanonico({}), null)
    assert.equal(hostCanonico({ PUBLIC_BASE_URL: 'não é url' }), null)
  })

  test('www → domínio, preservando caminho e query', () => {
    const env = { PUBLIC_BASE_URL: DOMINIO }
    assert.equal(urlCanonica({ pathname: '/sobre', search: '?a=1' }, 'www.dominio-de-exemplo.ia.br', env), `${DOMINIO}/sobre?a=1`)
    assert.equal(urlCanonica({ pathname: '/', search: '' }, 'WWW.Dominio-De-Exemplo.ia.br:443', env), `${DOMINIO}/`)
  })

  test('nenhum outro host é redirecionado', () => {
    const env = { PUBLIC_BASE_URL: DOMINIO }
    for (const host of ['dominio-de-exemplo.ia.br', 'seller.dominio-de-exemplo.ia.br', 'site-de-exemplo.netlify.app', 'projeto-de-exemplo.vercel.app', 'localhost:3000', 'www.outro.com.br', null]) {
      assert.equal(urlCanonica({ pathname: '/x', search: '' }, host, env), null, String(host))
    }
    // Sem domínio configurado, nada é redirecionado.
    assert.equal(urlCanonica({ pathname: '/x', search: '' }, 'www.dominio-de-exemplo.ia.br', {}), null)
  })

  test('o link rastreado usa o domínio configurado', () => {
    assert.equal(urlRastreadaParaExibir('k7x2m9', { NODE_ENV: 'production', PUBLIC_BASE_URL: DOMINIO }).url, `${DOMINIO}/api/l/k7x2m9`)
  })
})

describe('Middleware com o domínio definitivo', () => {
  process.env.NEXTAUTH_SECRET ??= 'segredo-de-teste-r53'

  const pedir = async (url: string, metodo = 'GET', env: Record<string, string> = {}) => {
    const antes = { ...process.env }
    Object.assign(process.env, env)
    try {
      const { default: middleware } = await import('../middleware')
      const r = await middleware(new NextRequest(url, { method: metodo }))
      if (r.headers.get('x-middleware-next') === '1') return { tipo: 'PASSA' as const }
      return { tipo: r.status, destino: r.headers.get('location') }
    } finally {
      for (const k of Object.keys(env)) if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]
    }
  }

  test('www redireciona com 308 para o domínio canônico', async () => {
    const r = await pedir('https://www.dominio-de-exemplo.ia.br/sobre?ref=x', 'GET', { PUBLIC_BASE_URL: DOMINIO })
    assert.deepEqual(r, { tipo: 308, destino: `${DOMINIO}/sobre?ref=x` })
  })

  test('o domínio canônico segue o fluxo normal', async () => {
    assert.deepEqual(await pedir(`${DOMINIO}/sobre`, 'GET', { PUBLIC_BASE_URL: DOMINIO }), { tipo: 'PASSA' })
    const privada = await pedir(`${DOMINIO}/dashboard`, 'GET', { PUBLIC_BASE_URL: DOMINIO })
    assert.equal(privada.tipo, 307)
  })

  test('o disparo da Background Function atravessa o middleware — só o caminho exato', async () => {
    assert.equal(CAMINHO_DA_FUNCAO, '/.netlify/functions/trabalho-longo-background')
    assert.deepEqual(await pedir(`https://patrono-seller.netlify.app${CAMINHO_DA_FUNCAO}`, 'POST'), { tipo: 'PASSA' })
    for (const c of ['/.netlify/functions/outra', `${CAMINHO_DA_FUNCAO}/x`, '/.netlify/functions/trabalho-longo-backgroundx', '/.netlify/functions/']) {
      assert.notEqual((await pedir(`https://patrono-seller.netlify.app${c}`, 'POST')).tipo, 'PASSA', c)
    }
  })
})

describe('Nenhum domínio de produção fixo no código', () => {
  test('app/, lib/, netlify/ e middleware só conhecem o domínio pela configuração', () => {
    const PROIBIDOS = /dominio-antigo-exemplo|patrono-seller-ia\.vercel\.app|patrono\.link/i
    // P2.8: única exceção — o domínio como DADO INSTITUCIONAL (o que a
    // Política de Privacidade declara), ao lado da razão social e do CNPJ.
    // A aplicação nunca o usa para montar URL.
    const EXCECAO = join(RAIZ, 'lib', 'institucional.ts')
    const achados: string[] = []
    const varrer = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) varrer(p)
        else if (p !== EXCECAO && /\.(ts|tsx|mjs|js)$/.test(n) && PROIBIDOS.test(readFileSync(p, 'utf8'))) achados.push(p.slice(RAIZ.length + 1))
      }
    }
    for (const d of ['app', 'lib', 'netlify']) varrer(join(RAIZ, d))
    if (PROIBIDOS.test(readFileSync(join(RAIZ, 'middleware.ts'), 'utf8'))) achados.push('middleware.ts')
    if (PROIBIDOS.test(readFileSync(join(RAIZ, 'netlify.toml'), 'utf8'))) achados.push('netlify.toml')
    if (PROIBIDOS.test(readFileSync(join(RAIZ, 'next.config.ts'), 'utf8'))) achados.push('next.config.ts')
    assert.deepEqual(achados, [])
  })

  test('o domínio institucional não é usado para montar URL', () => {
    // Quem importa DOMINIO_DO_SITE: só a própria fonte institucional.
    const usos: string[] = []
    const varrer = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) varrer(p)
        else if (/\.(ts|tsx)$/.test(n) && /DOMINIO_DO_SITE/.test(readFileSync(p, 'utf8'))) usos.push(n)
      }
    }
    for (const d of ['app', 'lib', 'netlify']) varrer(join(RAIZ, d))
    assert.deepEqual(usos, ['institucional.ts'])
  })
})
