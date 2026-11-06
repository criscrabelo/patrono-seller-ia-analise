/**
 * P2.14.5.6 — A tela de cadastro nunca pode ficar presa em "Enviando...".
 *
 * No Preview da Netlify, a rota respondeu 500 sem JSON e a tela travou,
 * porque `res.json()` lançava e `setLoading(false)` nunca rodava. Este teste
 * confere no código-fonte que o envio trata falha de rede, resposta não-OK e
 * resposta que não é JSON, e que o estado de carregamento sempre é desligado.
 * A regra de negócio (rota e corpo enviado) continua a mesma.
 *
 * Sem banco, sem rede, sem criar usuário. Custo R$ 0,00.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGINA = readFileSync(join(__dirname, '..', 'app/(auth)/register/page.tsx'), 'utf8')
const ENVIO = PAGINA.slice(PAGINA.indexOf('async function onSubmit'), PAGINA.indexOf('const inputClass'))

describe('Cadastro — tratamento de erro do envio (P2.14.5.6)', () => {
  test('a regra de negócio não mudou: mesma rota, mesmo método e mesmo corpo', () => {
    assert.match(ENVIO, /fetch\('\/api\/auth\/register', \{/)
    assert.match(ENVIO, /method: 'POST'/)
    assert.match(ENVIO, /body: JSON\.stringify\(\{ name: data\.name, email: data\.email, password: data\.password \}\)/)
  })

  test('falha de rede vira mensagem, e o carregamento sempre é desligado', () => {
    assert.match(ENVIO, /try \{[\s\S]*\} catch \{[\s\S]*setError\('Não foi possível conectar ao servidor/)
    assert.match(ENVIO, /\} finally \{\s*setLoading\(false\)\s*\}/)
    // Nenhum setLoading(false) solto fora do finally (era o que não rodava).
    assert.equal((ENVIO.match(/setLoading\(false\)/g) ?? []).length, 1)
  })

  test('resposta que não é JSON não derruba o envio', () => {
    assert.match(ENVIO, /await res\.json\(\)\.catch\(\(\) => null\)/)
  })

  test('resposta não-OK mostra o erro da API ou uma mensagem amigável', () => {
    assert.match(ENVIO, /if \(res\.ok\) \{\s*setSuccess\(true\)/)
    assert.match(ENVIO, /typeof json\.error === 'string'/)
    assert.match(ENVIO, /setError\('Não foi possível criar a conta agora\. Tente novamente em instantes\.'\)/)
  })
})
