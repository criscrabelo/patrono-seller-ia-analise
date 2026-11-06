/**
 * P2.69 — release corretivo do Instagram (base: Production 6afc885). Testes que EXECUTAM as regras (não leem o código):
 *  - "sem prazo" só para usuário de sistema, válido, sem vencimento e sem prazo de acesso a dados;
 *  - o cron não troca token sem prazo, reconfere-o a cada 24 h, desconecta (alerta) token inválido, não decide nada
 *    sem resposta da Meta e não presume validade na renovação;
 *  - a renovação manual recusa token sem prazo e token não confirmado.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { inspecionarTokenMeta, renovarTokenInstagram, type InspecaoDeTokenMeta } from '../lib/instagram'
import { conferirERenovar, precisaConferir, decisaoDaRenovacaoManual, CAMPO_SEM_PRAZO_CONFERIDO_EM, type DependenciasDaRenovacao, type IntegracaoInstagram } from '../lib/instagram-renovacao'

const comRespostaDaMeta = async (corpo: unknown, fn: () => Promise<void>) => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify(corpo), { status: 200 })) as typeof fetch
  try { await fn() } finally { globalThis.fetch = original }
}
const params = { accessToken: 'EAAteste', appId: '1', appSecret: 's' }
const agora = new Date('2026-11-20T12:00:00Z')

describe('inspeção: quando um token é "sem prazo"', () => {
  test('usuário de sistema, válido, expires_at 0, sem data_access: sem prazo', async () => {
    await comRespostaDaMeta({ data: { is_valid: true, expires_at: 0, type: 'SYSTEM_USER' } }, async () => assert.equal((await inspecionarTokenMeta(params)).semPrazo, true))
  })
  test('token de PÁGINA/USUÁRIO com expires_at 0 NÃO é sem prazo (perde acesso a dados)', async () => {
    await comRespostaDaMeta({ data: { is_valid: true, expires_at: 0, type: 'PAGE', data_access_expires_at: 1801440000 } }, async () => {
      const r = await inspecionarTokenMeta(params)
      assert.notEqual(r.semPrazo, true); assert.equal(r.dataAccessExpiraEm?.toISOString(), new Date(1801440000 * 1000).toISOString())
    })
    await comRespostaDaMeta({ data: { is_valid: true, expires_at: 0, type: 'USER' } }, async () => assert.notEqual((await inspecionarTokenMeta(params)).semPrazo, true))
  })
  test('"não sei" nunca vira "sem prazo": inválido, sem App Secret, fluxo Instagram, rede', async () => {
    await comRespostaDaMeta({ data: { is_valid: false, expires_at: 0, type: 'SYSTEM_USER' } }, async () => { const r = await inspecionarTokenMeta(params); assert.notEqual(r.semPrazo, true); assert.equal(r.valido, false) })
    assert.notEqual((await inspecionarTokenMeta({ accessToken: 'EAAteste' })).semPrazo, true)
    assert.notEqual((await inspecionarTokenMeta({ accessToken: 'IGAAteste', appId: '1', appSecret: 's' })).semPrazo, true)
    const original = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('rede') }) as typeof fetch
    try { const r = await inspecionarTokenMeta(params); assert.notEqual(r.semPrazo, true); assert.notEqual(r.valido, true) } finally { globalThis.fetch = original }
  })
  test('renovação sem expires_in da Meta: erro (sem 60 dias presumidos)', async () => {
    await comRespostaDaMeta({ access_token: 'EAAnovo' }, async () => { await assert.rejects(renovarTokenInstagram(params), /validade/) })
  })
})

const fake = (insp: Partial<InspecaoDeTokenMeta>, renovar?: DependenciasDaRenovacao['renovar']) => {
  const atualizacoes: { id: string; dados: Record<string, unknown> }[] = []
  let renovacoes = 0
  const d: DependenciasDaRenovacao = {
    inspecionar: async () => ({ expiraEm: null, scopes: null, motivo: 'x', ...insp }),
    renovar: renovar ?? (async () => { renovacoes++; return { accessToken: 'EAAnovo', expiresIn: 5_184_000 } }),
    atualizar: async (id, dados) => { atualizacoes.push({ id, dados: dados as Record<string, unknown> }) },
  }
  return { d, atualizacoes, renovacoes: () => renovacoes }
}
const integ = (o: Partial<IntegracaoInstagram> = {}): IntegracaoInstagram => ({ id: 'i1', accessToken: 'EAAantigo', tokenExpiry: new Date('2026-12-01T02:12:22Z'), extraData: { appId: '1', appSecret: 's' }, ...o })

describe('cron: conferir e renovar', () => {
  test('caso real: data presumida 01/12 + token de sistema → data apagada, token NÃO trocado, conferência registrada', async () => {
    const f = fake({ semPrazo: true, valido: true, tipo: 'SYSTEM_USER' })
    assert.equal(await conferirERenovar(integ(), agora, f.d), 'SEM_PRAZO_CONFIRMADO')
    assert.equal(f.renovacoes(), 0)
    assert.equal(f.atualizacoes[0].dados.tokenExpiry, null)
    assert.ok(!('accessToken' in f.atualizacoes[0].dados))
    assert.ok((f.atualizacoes[0].dados.extraData as Record<string, unknown>)[CAMPO_SEM_PRAZO_CONFERIDO_EM])
  })
  test('token sem data continua sendo conferido a cada 24 h (não some do radar)', () => {
    assert.equal(precisaConferir(integ({ tokenExpiry: null, extraData: { [CAMPO_SEM_PRAZO_CONFERIDO_EM]: '2026-11-20T00:00:00Z' } }), agora), false)
    assert.equal(precisaConferir(integ({ tokenExpiry: null, extraData: { [CAMPO_SEM_PRAZO_CONFERIDO_EM]: '2026-11-19T11:00:00Z' } }), agora), true)
    assert.equal(precisaConferir(integ({ tokenExpiry: null, extraData: {} }), agora), true)
    assert.equal(precisaConferir(integ({ tokenExpiry: new Date('2027-03-01') }), agora), false)
  })
  test('token que a Meta diz INVÁLIDO: integração "desconectado" (alerta), nada renovado', async () => {
    const f = fake({ valido: false })
    assert.equal(await conferirERenovar(integ({ tokenExpiry: null }), agora, f.d), 'INVALIDO_DESCONECTADO')
    assert.equal(f.atualizacoes[0].dados.status, 'desconectado'); assert.equal(f.renovacoes(), 0)
  })
  test('Meta sem resposta: não renova às cegas nem mexe em nada', async () => {
    const f = fake({ valido: null })
    assert.equal(await conferirERenovar(integ(), agora, f.d), 'SEM_DECISAO')
    assert.equal(f.renovacoes(), 0); assert.equal(f.atualizacoes.length, 0)
  })
  test('token sem data que deixou de ser "sem prazo": grava a data REAL de acesso, para a renovação normal o pegar', async () => {
    const f = fake({ valido: true, dataAccessExpiraEm: new Date('2027-01-10') })
    await conferirERenovar(integ({ tokenExpiry: null }), agora, f.d)
    assert.equal((f.atualizacoes[0].dados.tokenExpiry as Date).toISOString().slice(0, 10), '2027-01-10')
  })
  test('token válido com prazo na janela: renova com a validade informada pela Meta', async () => {
    const f = fake({ valido: true, expiraEm: new Date('2026-12-01') })
    assert.equal(await conferirERenovar(integ(), agora, f.d), 'RENOVADO')
    assert.equal(f.atualizacoes[0].dados.accessToken, 'EAAnovo')
  })
  test('renovação que falha (ex.: sem expires_in): FALHOU e nada gravado', async () => {
    const f = fake({ valido: true }, async () => { throw new Error('sem validade') })
    assert.equal(await conferirERenovar(integ(), agora, f.d), 'FALHOU'); assert.equal(f.atualizacoes.length, 0)
  })
})

describe('renovação manual', () => {
  test('recusa token sem prazo, inválido ou não confirmado; permite token válido com prazo', () => {
    assert.equal(decisaoDaRenovacaoManual({ expiraEm: null, scopes: null, motivo: 'x', semPrazo: true, valido: true }).renovar, false)
    assert.equal(decisaoDaRenovacaoManual({ expiraEm: null, scopes: null, motivo: 'x', valido: false }).renovar, false)
    assert.equal(decisaoDaRenovacaoManual({ expiraEm: null, scopes: null, motivo: 'falhou' }).renovar, false)
    assert.equal(decisaoDaRenovacaoManual({ expiraEm: new Date(), scopes: null, motivo: 'x', valido: true }).renovar, true)
  })
})
