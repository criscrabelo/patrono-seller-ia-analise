/**
 * Rodada 56 — P2.11: mitigações técnicas para o go-live.
 *
 *   1. WhatsApp (dados de terceiros) FECHADO em qualquer hospedagem de
 *      produção — Netlify, Vercel ou desconhecida. Só roda em local/teste
 *      declarado, para testes controlados.
 *   2. Upload do avatar direto do navegador ao Supabase: o arquivo nunca
 *      passa pelo corpo de uma função.
 *
 * A parte de INTEGRAÇÃO roda contra o banco e o storage de TESTE e só roda
 * se souber qual é o projeto de produção (PATRONO_REF_DO_BANCO_DE_PRODUCAO)
 * para provar que não está nele. Sem a referência, é PULADA com aviso —
 * nunca roda às cegas:
 *
 *   PATRONO_REF_DO_BANCO_DE_PRODUCAO=<ref> node --env-file="$LOCALAPPDATA/PatronoSeller/teste/.env.digital-twin-test" \
 *     node_modules/tsx/dist/cli.mjs --test tests/rodada56-mitigacoes-p211.test.ts
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import {
  CODIGO_WHATSAPP_BLOQUEADO,
  MOTIVO_WHATSAPP_BLOQUEADO,
  envioDeWhatsappPermitido,
  hospedagemAtual,
} from '../lib/transferencia-internacional'
import {
  LIMITES_DO_UPLOAD_DIRETO,
  MAXIMO_CORPO_DAS_ROTAS_BYTES,
  VALIDADE_DA_INTENCAO_MS,
  assinarIntencao,
  montarCaminhoDoAsset,
  normalizarMime,
  recusaPeloCabecalho,
  uploadDiretoConfigurado,
  validarObjetoEnviado,
  validarPedidoDeEnvio,
  verificarIntencao,
  type IntencaoDeEnvio,
} from '../lib/digital-twin-upload-direto'
import { executorDoEnvio, type DependenciasDoEnvio } from '../lib/trabalhos-longos/envio-whatsapp'
import type { Execucao } from '../lib/trabalho-longo'

const RAIZ = join(__dirname, '..')

/** `duplex` é exigido pelo undici para corpo em stream, mas não está no tipo do Next. */
type InitDoNextRequest = ConstructorParameters<typeof NextRequest>[1]

/** Código sem comentários: as asserções olham o que EXECUTA. */
function lerCodigo(rel: string): string {
  return readFileSync(join(RAIZ, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

// ── 1. Hospedagem e WhatsApp ─────────────────────────────────────────────
//
// Regra final da P2.11: WhatsApp FECHADO em qualquer hospedagem de
// produção (Netlify, Vercel, desconhecida). Só roda em local/teste
// declarado (NODE_ENV development/test, sem nenhum sinal de nuvem).

const NETLIFY = { NETLIFY: 'true', NODE_ENV: 'production' }
const VERCEL = { VERCEL_ENV: 'production', VERCEL: '1', NODE_ENV: 'production' }
const DESCONHECIDA = { NODE_ENV: 'production' }
const LOCAL_TESTE = { NODE_ENV: 'test' }

/** Hospedagens de produção e ambíguas: todas têm de recusar. */
const PRODUCOES: [string, Record<string, string>][] = [
  ['Netlify', NETLIFY],
  ['Netlify (só TRABALHO_LONGO_MODO)', { TRABALHO_LONGO_MODO: 'segundo-plano', NODE_ENV: 'production' }],
  ['Netlify (CONTEXT)', { CONTEXT: 'production' }],
  ['Netlify (SITE_ID + DEPLOY_ID)', { SITE_ID: 's', DEPLOY_ID: 'd' }],
  ['Vercel produção', VERCEL],
  ['Vercel preview', { VERCEL_ENV: 'preview', NODE_ENV: 'production' }],
  ['Vercel só com VERCEL_URL', { VERCEL_URL: 'x.vercel.app' }],
  ['desconhecida (NODE_ENV=production)', DESCONHECIDA],
  ['desconhecida (NODE_ENV ausente)', {}],
  ['desconhecida (NODE_ENV inventado)', { NODE_ENV: 'staging' }],
  ['Lambda', { AWS_LAMBDA_FUNCTION_NAME: 'f' }],
  ['Cloud Run', { K_SERVICE: 'svc', NODE_ENV: 'production' }],
  ['Kubernetes', { KUBERNETES_SERVICE_HOST: '10.0.0.1', NODE_ENV: 'production' }],
]

describe('1. Hospedagem: quem é quem', () => {
  test('Netlify, Vercel, local e desconhecida', () => {
    assert.equal(hospedagemAtual(NETLIFY), 'netlify')
    assert.equal(hospedagemAtual(VERCEL), 'vercel')
    assert.equal(hospedagemAtual(DESCONHECIDA), 'desconhecida')
    assert.equal(hospedagemAtual(LOCAL_TESTE), 'local')
    assert.equal(hospedagemAtual({ NODE_ENV: 'development' }), 'local')
  })

  test('local só por declaração explícita: NODE_ENV ausente não é local', () => {
    assert.equal(hospedagemAtual({}), 'desconhecida')
  })
})

describe('1. WhatsApp fechado em qualquer hospedagem de produção', () => {
  for (const [nome, env] of PRODUCOES) {
    test(`${nome} → bloqueia`, () => {
      const r = envioDeWhatsappPermitido(env)
      assert.equal(r.permitido, false)
      assert.equal(r.motivo, MOTIVO_WHATSAPP_BLOQUEADO)
    })
  }

  test('local/teste controlado → executa', () => {
    assert.equal(envioDeWhatsappPermitido(LOCAL_TESTE).permitido, true)
    assert.equal(envioDeWhatsappPermitido({ NODE_ENV: 'development' }).permitido, true)
  })

  test('sinais contraditórios continuam falhando fechado', () => {
    const contraditorios: Record<string, string>[] = [
      { NODE_ENV: 'test', VERCEL_ENV: 'production' },
      { NODE_ENV: 'development', NETLIFY: 'true' },
      { NODE_ENV: 'test', TRABALHO_LONGO_MODO: 'segundo-plano' },
      { NODE_ENV: 'test', CONTEXT: 'deploy-preview' },
      { NODE_ENV: 'development', AWS_LAMBDA_FUNCTION_NAME: 'f' },
      { NODE_ENV: 'test', K_SERVICE: 'svc' },
      { NODE_ENV: 'test', VERCEL: '1', NETLIFY: 'true' },
      { NODE_ENV: 'test', PATRONO_AMBIENTE: 'teste', VERCEL_ENV: 'preview' },
    ]
    for (const env of contraditorios) {
      assert.equal(envioDeWhatsappPermitido(env).permitido, false, JSON.stringify(env))
    }
  })

  test('não existe variável de liberação em produção', () => {
    const fonte = lerCodigo('lib/transferencia-internacional.ts')
    assert.ok(!/WHATSAPP_PERMITIDO|LIBERA|OVERRIDE|FORCAR|ALLOW/i.test(fonte))
    // A lista de hospedagens com envio é só `local`, no código.
    assert.match(fonte, /const HOSPEDAGENS_COM_WHATSAPP: readonly Hospedagem\[\] = \['local'\]/)
    const tentativas = ['WHATSAPP_PERMITIDO', 'WHATSAPP_LIBERADO', 'PATRONO_AMBIENTE', 'PERMITIR_WHATSAPP', 'ALLOW_WHATSAPP']
    for (const [, base] of PRODUCOES) {
      const env: Record<string, string> = { ...base }
      for (const k of tentativas) env[k] = 'true'
      env.PATRONO_AMBIENTE = 'producao'
      assert.equal(envioDeWhatsappPermitido(env).permitido, false, JSON.stringify(base))
    }
  })

  test('biblioteca não chega à Z-API: enviarTexto e enviarImagem recusam sem fetch em toda produção', async () => {
    const { enviarTexto, enviarImagem } = await import('../lib/whatsapp')
    const fetchOriginal = globalThis.fetch
    const envOriginal = { ...process.env }
    let chamadas = 0
    globalThis.fetch = (async () => {
      chamadas++
      throw new Error('fetch não devia ser chamado')
    }) as typeof fetch
    try {
      for (const [nome, env] of PRODUCOES) {
        for (const k of Object.keys(process.env)) if (!(k in envOriginal)) delete process.env[k]
        Object.assign(process.env, envOriginal)
        for (const k of ['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'NETLIFY', 'CONTEXT']) delete process.env[k]
        Object.assign(process.env, env)
        const cfg = { instanceId: 'inst-ficticia', token: 'tok-ficticio' }
        const t = await enviarTexto(cfg, { numero: '5511999990000', mensagem: 'oi' })
        const i = await enviarImagem(cfg, { numero: '5511999990000', imageUrl: 'https://exemplo.invalido/a.png' })
        for (const r of [t, i]) {
          assert.equal(r.ok, false, nome)
          assert.equal(r.erro, MOTIVO_WHATSAPP_BLOQUEADO, nome)
          assert.ok(!r.incerto, 'nada saiu: não é incerto')
        }
      }
      assert.equal(chamadas, 0)
    } finally {
      globalThis.fetch = fetchOriginal
      for (const k of Object.keys(process.env)) if (!(k in envOriginal)) delete process.env[k]
      Object.assign(process.env, envOriginal)
    }
  })

  test('biblioteca: a trava vem antes da política de custo e do fetch nos dois envios', () => {
    const f = lerCodigo('lib/whatsapp.ts')
    for (const nome of ['enviarTexto', 'enviarImagem']) {
      const corpo = f.slice(f.indexOf(`export async function ${nome}`))
      const trava = corpo.indexOf('envioDeWhatsappPermitido()')
      assert.ok(trava > 0, `${nome} sem trava`)
      assert.ok(trava < corpo.indexOf('envioPermitidoPelaPolitica('), `${nome}: trava antes do custo`)
      assert.ok(trava < corpo.indexOf('fetch('), `${nome}: trava antes do fetch`)
    }
    // enviarEmMassa só envia por enviarTexto/enviarImagem (travados).
    const massa = f.slice(f.indexOf('export async function enviarEmMassa'))
    assert.ok(!/fetch\(/.test(massa))
  })

  test('tarefa já enfileirada não envia em nenhuma produção (executor)', async () => {
    for (const [nome, env] of PRODUCOES) {
      let enviados = 0
      let salvou = false
      const dep: DependenciasDoEnvio = {
        enviarTexto: async (_c, p) => { enviados++; return { numero: p.numero, ok: true } },
        enviarImagem: async (_c, p) => { enviados++; return { numero: p.numero, ok: true } },
      }
      const e = {
        trabalho: { id: 't', workspaceId: 'w', tipo: 'LONGO_ENVIO_WHATSAPP', entityId: 'i', contexto: { pedido: { numeros: ['5511999990000'], mensagem: 'x', delayMs: 1500 } } },
        salvar: async () => { salvou = true },
        restanteMs: () => 60_000,
        dormir: async () => {},
      } as unknown as Execucao
      const d = await executorDoEnvio(dep, env)(e)
      assert.equal(d.fim, 'falhou', nome)
      assert.equal(d.resposta.status, 403, nome)
      assert.equal(d.resposta.corpo.codigo, CODIGO_WHATSAPP_BLOQUEADO, nome)
      assert.equal(enviados, 0, nome)
      assert.equal(salvou, false, `${nome}: nada gravado`)
    }
  })

  test('o executor da fila (Background Function) usa a trava do ambiente real', () => {
    // Registrado sem `env` fixo: lê o process.env do processo que executa.
    assert.match(lerCodigo('lib/trabalhos-longos/index.ts'), /LONGO_ENVIO_WHATSAPP: executorDoEnvio\(\),/)
    const ex = lerCodigo('lib/trabalhos-longos/envio-whatsapp.ts')
    const corpo = ex.slice(ex.indexOf('return async (e: Execucao)'))
    const trava = corpo.indexOf('envioDeWhatsappPermitido(env)')
    assert.ok(trava > 0)
    for (const depois of ['e.trabalho.contexto', 'prisma.', 'e.salvar(', 'dep.enviarTexto(', 'dep.enviarImagem(']) {
      assert.ok(trava < corpo.indexOf(depois), `trava antes de ${depois}`)
    }
  })

  test('nenhuma rota lê números ou mensagem antes da trava', () => {
    // Toda rota que toca o envio de WhatsApp — e só a de envio toca.
    const rotas: string[] = []
    const varrer = (dir: string) => {
      for (const d of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
        const rel = join(dir, d.name)
        if (d.isDirectory()) varrer(rel)
        else if (d.name === 'route.ts' && /LONGO_ENVIO_WHATSAPP|executorDoEnvio|enviarTexto|enviarImagem|enviarEmMassa|normalizarNumero/.test(lerCodigo(rel))) rotas.push(rel.replace(/\\/g, '/'))
      }
    }
    varrer('app')
    assert.deepEqual(rotas, ['app/api/whatsapp/enviar/route.ts'])
    const r = lerCodigo(rotas[0])
    const trava = r.indexOf('envioDeWhatsappPermitido()')
    assert.ok(trava > r.indexOf('getServerSession('))
    for (const depois of ['req.json()', 'req.text()', 'req.formData()', 'prisma.', 'normalizarNumero(', 'iniciarTrabalhoLongo(']) {
      const i = r.indexOf(depois)
      if (i >= 0) assert.ok(trava < i, `trava antes de ${depois}`)
    }
    assert.match(r, /codigo: CODIGO_WHATSAPP_BLOQUEADO \}, \{ status: 403 \}/)
  })

  test('status informa envioPermitido e a tela desabilita o botão', () => {
    const s = lerCodigo('app/api/whatsapp/status/route.ts')
    assert.equal((s.match(/\.\.\.envio \}/g) ?? []).length, 3, 'as três respostas carregam o estado')
    const p = lerCodigo('app/(dashboard)/whatsapp/page.tsx')
    assert.match(p, /status\?\.envioPermitido === false/)
  })
})
// ── 2. Upload direto: regras puras ───────────────────────────────────────

const SEGREDO = 'segredo-de-teste-p211'

function intencaoBase(over: Partial<IntencaoDeEnvio> = {}): IntencaoDeEnvio {
  return {
    workspaceId: 'ws-a',
    profileId: 'pf-a',
    tipo: 'FACE_IMAGE',
    mime: 'image/png',
    tamanho: 1234,
    caminho: 'ws-a/pf-a/face_image-1-abc',
    purpose: null,
    expiraEm: 1_000_000 + VALIDADE_DA_INTENCAO_MS,
    ...over,
  }
}

describe('2. Tipo e tamanho', () => {
  test('aceita os três tipos da tela, nos formatos e limites deles', () => {
    assert.equal(validarPedidoDeEnvio({ type: 'FACE_IMAGE', mimeType: 'image/jpeg', size: 10 * 1024 * 1024 }).ok, true)
    assert.equal(validarPedidoDeEnvio({ type: 'REFERENCE_VIDEO', mimeType: 'video/mp4', size: 50 * 1024 * 1024 }).ok, true)
    assert.equal(validarPedidoDeEnvio({ type: 'VOICE_REFERENCE', mimeType: 'audio/webm;codecs=opus', size: 1 }).ok, true)
  })

  test('recusa tipo que não vem do navegador', () => {
    for (const type of ['GENERATED_PREVIEW', 'CONSENT_EVIDENCE', 'X', '', null, 42, '__proto__', 'constructor']) {
      assert.equal(validarPedidoDeEnvio({ type, mimeType: 'image/png', size: 10 }).ok, false, String(type))
    }
  })

  test('recusa formato inválido para o tipo', () => {
    const ruins: [string, string][] = [
      ['FACE_IMAGE', 'image/gif'], ['FACE_IMAGE', 'image/svg+xml'], ['FACE_IMAGE', 'video/mp4'], ['FACE_IMAGE', ''],
      ['REFERENCE_VIDEO', 'video/x-msvideo'], ['REFERENCE_VIDEO', 'application/octet-stream'],
      ['VOICE_REFERENCE', 'video/webm'], ['VOICE_REFERENCE', 'text/html'],
    ]
    for (const [type, mimeType] of ruins) assert.equal(validarPedidoDeEnvio({ type, mimeType, size: 10 }).ok, false, `${type} ${mimeType}`)
  })

  test('recusa tamanho acima do limite, zero, negativo, fracionado ou não numérico', () => {
    for (const [type, limite] of Object.entries(LIMITES_DO_UPLOAD_DIRETO)) {
      assert.equal(validarPedidoDeEnvio({ type, mimeType: limite.mimes[0], size: limite.maximoBytes + 1 }).ok, false, type)
    }
    for (const size of [0, -1, 1.5, '10', null, undefined, Number.NaN]) {
      assert.equal(validarPedidoDeEnvio({ type: 'FACE_IMAGE', mimeType: 'image/png', size }).ok, false, String(size))
    }
  })

  test('normalizarMime tira parâmetros e caixa', () => {
    assert.equal(normalizarMime('Audio/WEBM; codecs=opus'), 'audio/webm')
    assert.equal(normalizarMime(undefined), '')
  })

  test('objeto gravado: tamanho e formato precisam bater com o declarado', () => {
    const i = intencaoBase()
    assert.equal(validarObjetoEnviado({ tamanho: 1234, mime: 'image/png' }, i).ok, true)
    assert.equal(validarObjetoEnviado({ tamanho: 1235, mime: 'image/png' }, i).ok, false)
    assert.equal(validarObjetoEnviado({ tamanho: 1234, mime: 'image/gif' }, i).ok, false)
    assert.equal(validarObjetoEnviado({ tamanho: null, mime: 'image/png' }, i).ok, false)
    assert.equal(validarObjetoEnviado({ tamanho: 0, mime: 'image/png' }, intencaoBase({ tamanho: 0 })).ok, false)
    const grande = 10 * 1024 * 1024 + 1
    assert.equal(validarObjetoEnviado({ tamanho: grande, mime: 'image/png' }, intencaoBase({ tamanho: grande })).ok, false)
  })
})

describe('2. Intenção assinada e caminho', () => {
  test('o caminho é do workspace e do perfil da sessão', () => {
    const c = montarCaminhoDoAsset('ws-a', 'pf-a', 'VOICE_REFERENCE', new Date(5), 'abc')
    assert.equal(c, 'ws-a/pf-a/voice_reference-5-abc')
  })

  test('assinada e dentro do prazo: aceita', () => {
    const t = assinarIntencao(intencaoBase(), SEGREDO)
    const v = verificarIntencao(t, SEGREDO, 1_000_000)
    assert.ok(v.ok)
    if (v.ok) assert.deepEqual(v.intencao, intencaoBase())
  })

  test('adulterada (outro workspace, outro caminho, outro tamanho) é recusada', () => {
    const t = assinarIntencao(intencaoBase(), SEGREDO)
    const [, assinatura] = t.split('.')
    for (const over of [{ workspaceId: 'ws-b' }, { caminho: 'ws-b/pf-b/x' }, { tamanho: 1 }, { expiraEm: Number.MAX_SAFE_INTEGER }]) {
      const corpo = Buffer.from(JSON.stringify(intencaoBase(over))).toString('base64url')
      assert.deepEqual(verificarIntencao(`${corpo}.${assinatura}`, SEGREDO, 1_000_000), { ok: false, motivo: 'assinatura' })
    }
  })

  test('outro segredo, lixo e formato errado são recusados', () => {
    const t = assinarIntencao(intencaoBase(), SEGREDO)
    assert.equal(verificarIntencao(t, 'outro-segredo', 1_000_000).ok, false)
    for (const lixo of [undefined, null, 42, '', 'a.b.c', 'semponto', `${t}x`, 'x'.repeat(2000)]) {
      assert.equal(verificarIntencao(lixo, SEGREDO, 1_000_000).ok, false, String(lixo).slice(0, 20))
    }
  })

  test('vencida depois do prazo', () => {
    const t = assinarIntencao(intencaoBase(), SEGREDO)
    assert.equal(verificarIntencao(t, SEGREDO, 1_000_000 + VALIDADE_DA_INTENCAO_MS).ok, true)
    assert.deepEqual(verificarIntencao(t, SEGREDO, 1_000_000 + VALIDADE_DA_INTENCAO_MS + 1), { ok: false, motivo: 'vencida' })
    assert.equal(VALIDADE_DA_INTENCAO_MS, 10 * 60_000)
  })
})

describe('2. Fail-closed: sem configuração, não há upload', () => {
  const completo = { NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', NEXTAUTH_SECRET: 's' }
  test('configuração completa: ok', () => assert.equal(uploadDiretoConfigurado(completo).ok, true))
  test('qualquer peça faltando: recusa', () => {
    const faltas: Record<string, string | undefined>[] = [
      { ...completo, NEXT_PUBLIC_SUPABASE_URL: undefined },
      { ...completo, NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co.evil.com' },
      { ...completo, NEXT_PUBLIC_SUPABASE_URL: 'http://abcdefgh.supabase.co' },
      { ...completo, SUPABASE_SERVICE_ROLE_KEY: undefined },
      { ...completo, SUPABASE_SERVICE_ROLE_KEY: 'placeholder' },
      { ...completo, NEXTAUTH_SECRET: undefined },
    ]
    for (const env of faltas) assert.equal(uploadDiretoConfigurado(env).ok, false, JSON.stringify(env))
  })

  test('nenhum caminho alternativo pela função no código', () => {
    const servico = lerCodigo('lib/digital-twin-upload-direto-servico.ts')
    assert.ok(!/uploadBufferPrivado|uploadBuffer\(|getPublicUrl/.test(servico))
    assert.equal((servico.match(/if \(!config\.ok\)/g) ?? []).length, 2, 'os dois passos checam a configuração')
    const pagina = lerCodigo('app/(dashboard)/conta/digital-twin/page.tsx')
    const envio = pagina.slice(pagina.indexOf('async function enviarArquivo'), pagina.indexOf('async function iniciarGravacao'))
    assert.ok(!/FormData/.test(envio), 'a tela não monta multipart')
    assert.ok(!/fetch\('\/api\/digital-twin\/assets',/.test(envio), 'a tela não chama a rota antiga')
    assert.match(envio, /fetch\(dados\.uploadUrl, \{\s*method: 'PUT'/)
  })
})

// ── 2. O arquivo nunca trafega pelo corpo de uma função ──────────────────

describe('2. Avatar nunca trafega pelo corpo da Function', () => {
  const ROTAS = [
    'app/api/digital-twin/assets/route.ts',
    'app/api/digital-twin/assets/url-de-envio/route.ts',
    'app/api/digital-twin/assets/confirmar/route.ts',
  ]

  test('nenhuma rota de avatar lê arquivo (formData, arrayBuffer, blob, stream)', () => {
    for (const rel of ROTAS) {
      const src = lerCodigo(rel)
      assert.ok(!/formData\(|arrayBuffer\(|\.blob\(|req\.body|uploadBufferPrivado|Buffer\.from\(/.test(src), rel)
    }
  })

  test('as rotas novas decidem pelos cabeçalhos antes de ler o corpo', () => {
    for (const rel of ROTAS.slice(1)) {
      const src = lerCodigo(rel)
      assert.ok(src.indexOf('recusaPeloCabecalho(') < src.indexOf('req.json()'), rel)
    }
  })

  test('cabeçalhos: só JSON pequeno com tamanho declarado', () => {
    assert.equal(recusaPeloCabecalho('multipart/form-data; boundary=x', '100')?.status, 415)
    assert.equal(recusaPeloCabecalho('application/octet-stream', '100')?.status, 415)
    assert.equal(recusaPeloCabecalho(null, '100')?.status, 415)
    assert.equal(recusaPeloCabecalho('application/json', null)?.status, 411)
    assert.equal(recusaPeloCabecalho('application/json', '-1')?.status, 411)
    assert.equal(recusaPeloCabecalho('application/json', String(MAXIMO_CORPO_DAS_ROTAS_BYTES + 1))?.status, 413)
    assert.equal(recusaPeloCabecalho('application/json; charset=utf-8', '120'), null)
  })

  /** Corpo que denuncia se alguém tentar lê-lo. */
  function corpoEspiao() {
    const estado = { lido: false }
    // highWaterMark 0: sem pré-carga — `pull` só roda se alguém LER.
    const stream = new ReadableStream(
      {
        pull(c) {
          estado.lido = true
          c.enqueue(new Uint8Array(1024))
          c.close()
        },
      },
      { highWaterMark: 0 }
    )
    return { estado, stream }
  }

  test('controle: o espião acusa quando o corpo É lido', async () => {
    const { estado, stream } = corpoEspiao()
    const req = new NextRequest('http://localhost/x', { method: 'POST', body: stream, duplex: 'half' } as unknown as InitDoNextRequest)
    assert.equal(estado.lido, false)
    await req.arrayBuffer()
    assert.equal(estado.lido, true)
  })

  test('rota antiga: 410 sem ler um byte', async () => {
    const { POST } = await import('../app/api/digital-twin/assets/route')
    const res = await POST()
    assert.equal(res.status, 410)
    assert.equal((await res.json()).codigo, 'USE_UPLOAD_DIRETO')
  })

  for (const rel of ['url-de-envio', 'confirmar']) {
    test(`${rel}: multipart com arquivo é recusado (415) sem ler o corpo`, async () => {
      const { POST } = await import(`../app/api/digital-twin/assets/${rel}/route`)
      const { estado, stream } = corpoEspiao()
      const req = new NextRequest(`http://localhost/api/digital-twin/assets/${rel}`, {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '1048576' },
        body: stream,
        duplex: 'half',
      } as unknown as InitDoNextRequest)
      const res = await POST(req)
      assert.equal(res.status, 415)
      assert.equal(estado.lido, false, 'o corpo não pode ter sido lido')
    })

    test(`${rel}: JSON grande demais é recusado (413) sem ler o corpo`, async () => {
      const { POST } = await import(`../app/api/digital-twin/assets/${rel}/route`)
      const { estado, stream } = corpoEspiao()
      const req = new NextRequest(`http://localhost/api/digital-twin/assets/${rel}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(50 * 1024 * 1024) },
        body: stream,
        duplex: 'half',
      } as unknown as InitDoNextRequest)
      const res = await POST(req)
      assert.equal(res.status, 413)
      assert.equal(estado.lido, false)
    })
  }
})

// ── 3. Integração: banco e storage de TESTE ──────────────────────────────

const REF_PROD = (process.env.PATRONO_REF_DO_BANCO_DE_PRODUCAO ?? '').trim()
const TEM_AMBIENTE = !!process.env.DATABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXTAUTH_SECRET
const MOTIVO_PULO = !TEM_AMBIENTE
  ? 'ambiente de teste (banco + storage) ausente'
  : REF_PROD.length < 8
    ? 'PATRONO_REF_DO_BANCO_DE_PRODUCAO ausente — sem saber qual é a produção, a integração não roda'
    : false

function refDaChave(chave: string): string | null {
  // Chave JWT legada: o projeto vem no claim `ref`. Chaves novas não são JWT.
  const partes = chave.split('.')
  if (partes.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')).ref ?? null
  } catch {
    return null
  }
}

describe('3. Nenhuma credencial de produção em teste', { skip: MOTIVO_PULO }, () => {
  test('banco, URL e chave do storage não são da produção', () => {
    assert.ok(!(process.env.DATABASE_URL ?? '').includes(REF_PROD), 'DATABASE_URL é da produção')
    assert.ok(!(process.env.DIRECT_URL ?? '').includes(REF_PROD), 'DIRECT_URL é da produção')
    assert.ok(!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes(REF_PROD), 'Supabase é o de produção')
    const ref = refDaChave(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '')
    if (ref) assert.notEqual(ref, REF_PROD, 'service role da produção')
  })

  test('a referência de produção não aparece em nenhum teste nem no código novo', () => {
    const arquivos = [
      ...readdirSync(join(RAIZ, 'tests')).filter((f) => /\.(ts|mjs)$/.test(f)).map((f) => join('tests', f)),
      'lib/transferencia-internacional.ts',
      'lib/digital-twin-upload-direto.ts',
      'lib/digital-twin-upload-direto-servico.ts',
    ]
    for (const rel of arquivos) assert.ok(!readFileSync(join(RAIZ, rel), 'utf8').includes(REF_PROD), rel)
  })
})

describe('3. Upload direto contra o Supabase de TESTE', { skip: MOTIVO_PULO }, () => {
  // Imports tardios: só carregam com o ambiente de teste confirmado.
  let prisma: typeof import('../lib/prisma').prisma
  let svc: typeof import('../lib/digital-twin-upload-direto-servico')
  let supa: typeof import('../lib/supabase')
  let admin: import('@supabase/supabase-js').SupabaseClient
  let anon: import('@supabase/supabase-js').SupabaseClient
  const BUCKET = 'digital-twin-private'
  const marca = `r56-${Date.now()}`
  const criados: string[] = []
  let A: { workspaceId: string; userId: string; profileId: string }
  let B: { workspaceId: string; userId: string; profileId: string }
  const caminhosParaLimpar = new Set<string>()

  async function criar(sufixo: string) {
    const ws = await prisma.workspace.create({ data: { name: `R56-${sufixo}`, ownerId: `${marca}-${sufixo}` }, select: { id: true } })
    criados.push(ws.id)
    const user = await prisma.user.create({ data: { email: `${marca}-${sufixo}@teste.local`, name: 'U', password: 'x', workspaceId: ws.id }, select: { id: true } })
    const profile = await prisma.digitalTwinProfile.create({ data: { workspaceId: ws.id, ownerUserId: user.id, displayName: 'Twin' }, select: { id: true } })
    return { workspaceId: ws.id, userId: user.id, profileId: profile.id }
  }

  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201ffa50b2b0000000049454e44ae426082', 'hex')

  async function autorizar(s: typeof A, over: Record<string, unknown> = {}) {
    const r = await svc.autorizarEnvioDireto(s, { type: 'FACE_IMAGE', mimeType: 'image/png', size: PNG.length, ...over })
    assert.equal(r.status, 200, JSON.stringify(r.corpo))
    const intencao = r.corpo.intencao as string
    const caminho = JSON.parse(Buffer.from(intencao.split('.')[0], 'base64url').toString('utf8')).caminho as string
    caminhosParaLimpar.add(caminho)
    return { uploadUrl: r.corpo.uploadUrl as string, contentType: r.corpo.contentType as string, intencao, caminho }
  }

  async function enviar(uploadUrl: string, corpo: Buffer, contentType: string) {
    return fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': contentType, 'x-upsert': 'false' }, body: new Uint8Array(corpo) })
  }

  before(async () => {
    prisma = (await import('../lib/prisma')).prisma
    svc = await import('../lib/digital-twin-upload-direto-servico')
    supa = await import('../lib/supabase')
    const { createClient } = await import('@supabase/supabase-js')
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    A = await criar('a')
    B = await criar('b')
  })

  after(async () => {
    if (caminhosParaLimpar.size) await admin.storage.from(BUCKET).remove([...caminhosParaLimpar])
    for (const ws of criados) {
      await prisma.digitalTwinAsset.deleteMany({ where: { workspaceId: ws } })
      await prisma.digitalTwinProfile.deleteMany({ where: { workspaceId: ws } })
      await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
      await prisma.user.deleteMany({ where: { workspaceId: ws } })
      await prisma.workspace.deleteMany({ where: { id: ws } })
    }
    await prisma.$disconnect()
  })

  test('bucket continua privado', async () => {
    const { data, error } = await admin.storage.getBucket(BUCKET)
    assert.equal(error, null)
    assert.equal(data?.public, false)
  })

  test('fluxo completo: o arquivo vai direto ao storage e o asset só nasce na confirmação', async () => {
    const a = await autorizar(A)
    assert.ok(a.caminho.startsWith(`${A.workspaceId}/${A.profileId}/face_image-`))
    assert.ok(a.uploadUrl.startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/`))
    assert.equal(await prisma.digitalTwinAsset.count({ where: { workspaceId: A.workspaceId } }), 0, 'nada registrado antes do envio')

    const put = await enviar(a.uploadUrl, PNG, a.contentType)
    assert.equal(put.status, 200, await put.text())

    const c = await svc.confirmarEnvioDireto(A, { intencao: a.intencao })
    assert.equal(c.status, 200, JSON.stringify(c.corpo))
    const asset = await prisma.digitalTwinAsset.findUnique({ where: { id: c.corpo.id as string } })
    assert.equal(asset?.workspaceId, A.workspaceId)
    assert.equal(asset?.storagePath, a.caminho)
    assert.equal(asset?.mimeType, 'image/png')
    assert.equal(asset?.expiresAt, null)

    const de2 = await svc.confirmarEnvioDireto(A, { intencao: a.intencao })
    assert.equal(de2.corpo.id, c.corpo.id, 'confirmar de novo devolve o mesmo asset')

    const acoes = (await prisma.auditLog.findMany({ where: { workspaceId: A.workspaceId }, select: { action: true, metadata: true } }))
    assert.ok(acoes.some((x) => x.action === 'digital_twin.asset_upload_autorizado'))
    const enviado = acoes.find((x) => x.action === 'digital_twin.asset_uploaded')
    assert.deepEqual(enviado?.metadata, { type: 'FACE_IMAGE', via: 'upload-direto' })
    assert.ok(!JSON.stringify(acoes).includes(a.caminho), 'o caminho nunca vai para a auditoria')
  })

  test('workspace diferente: não confirma a intenção alheia nem lê o arquivo', async () => {
    const a = await autorizar(A)
    assert.equal((await enviar(a.uploadUrl, PNG, a.contentType)).status, 200)

    const deB = await svc.confirmarEnvioDireto({ workspaceId: B.workspaceId, userId: B.userId }, { intencao: a.intencao })
    assert.equal(deB.status, 403)
    assert.equal(await prisma.digitalTwinAsset.count({ where: { workspaceId: B.workspaceId } }), 0)
    assert.ok(await supa.infoDoObjetoPrivado(BUCKET, a.caminho), 'B não apaga nem altera o arquivo de A')

    // Sem URL assinada, ninguém lê: nem o cliente anônimo, nem a URL pública.
    const { data, error } = await anon.storage.from(BUCKET).download(a.caminho)
    assert.equal(data, null)
    assert.ok(error)
    const publica = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${a.caminho}`)
    assert.notEqual(publica.status, 200)
  })

  test('o token de envio vale só para o caminho dele', async () => {
    const a = await autorizar(A)
    const token = new URL(a.uploadUrl).searchParams.get('token')!
    const alheio = `${B.workspaceId}/${B.profileId}/face_image-intruso`
    caminhosParaLimpar.add(alheio)
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${alheio}?token=${token}`
    const res = await enviar(url, PNG, 'image/png')
    assert.notEqual(res.status, 200)
    assert.equal(await supa.infoDoObjetoPrivado(BUCKET, alheio), null)
  })

  test('tamanho diferente do declarado: recusado e arquivo apagado', async () => {
    const a = await autorizar(A, { size: 10 })
    assert.equal((await enviar(a.uploadUrl, PNG, a.contentType)).status, 200)
    const c = await svc.confirmarEnvioDireto(A, { intencao: a.intencao })
    assert.equal(c.status, 400)
    assert.equal(await supa.infoDoObjetoPrivado(BUCKET, a.caminho), null)
    const recusa = await prisma.auditLog.findFirst({ where: { workspaceId: A.workspaceId, action: 'digital_twin.asset_upload_recusado' } })
    assert.ok(recusa)
  })

  test('formato diferente do declarado: recusado e arquivo apagado', async () => {
    const a = await autorizar(A)
    assert.equal((await enviar(a.uploadUrl, PNG, 'image/gif')).status, 200)
    const c = await svc.confirmarEnvioDireto(A, { intencao: a.intencao })
    assert.equal(c.status, 400)
    assert.equal(await supa.infoDoObjetoPrivado(BUCKET, a.caminho), null)
  })

  test('tipo e tamanho inválidos nem recebem URL', async () => {
    for (const over of [{ type: 'GENERATED_PREVIEW' }, { mimeType: 'image/gif' }, { size: 10 * 1024 * 1024 + 1 }, { size: 0 }]) {
      const r = await svc.autorizarEnvioDireto(A, { type: 'FACE_IMAGE', mimeType: 'image/png', size: 100, ...over })
      assert.equal(r.status, 400, JSON.stringify(over))
      assert.equal(r.corpo.uploadUrl, undefined)
    }
  })

  test('sem envio: a confirmação não registra nada', async () => {
    const a = await autorizar(A)
    const c = await svc.confirmarEnvioDireto(A, { intencao: a.intencao })
    assert.equal(c.status, 409)
  })

  test('intenção vencida: recusada e o arquivo que chegou tarde é apagado', async () => {
    const a = await autorizar(A)
    assert.equal((await enviar(a.uploadUrl, PNG, a.contentType)).status, 200)
    const c = await svc.confirmarEnvioDireto(A, { intencao: a.intencao }, process.env, Date.now() + VALIDADE_DA_INTENCAO_MS + 1000)
    assert.equal(c.status, 410)
    assert.equal(await supa.infoDoObjetoPrivado(BUCKET, a.caminho), null)
  })

  test('URL assinada expira: a de envio tem validade; a de leitura deixa de funcionar', async () => {
    const a = await autorizar(A)
    const token = new URL(a.uploadUrl).searchParams.get('token')!
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    assert.equal(typeof payload.exp, 'number', 'token de envio sem validade')
    assert.ok(payload.exp - Math.floor(Date.now() / 1000) <= 2 * 60 * 60 + 60, 'validade do envio acima de 2 h')

    assert.equal((await enviar(a.uploadUrl, PNG, a.contentType)).status, 200)
    // Dentro da validade, a leitura funciona.
    assert.equal((await fetch(await supa.criarUrlAssinada(BUCKET, a.caminho, 60))).status, 200)

    // Validade de 1 s: o token diz isso, e depois dela a leitura para.
    // (Sem ler logo após criar: diferença de relógio com o Supabase faria a
    // URL nascer vencida e o teste oscilar.)
    const curta = await supa.criarUrlAssinada(BUCKET, a.caminho, 1)
    const t = JSON.parse(Buffer.from(new URL(curta).searchParams.get('token')!.split('.')[1], 'base64url').toString('utf8'))
    assert.equal(t.exp - t.iat, 1)
    let status = 200
    for (let i = 0; i < 10 && status === 200; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      status = (await fetch(curta)).status
    }
    assert.notEqual(status, 200, 'URL de leitura vencida ainda funciona')
  })

  test('fail-closed: sem configuração, nenhum passo fala com o storage', async () => {
    const semChave = { ...process.env, SUPABASE_SERVICE_ROLE_KEY: '' }
    const r1 = await svc.autorizarEnvioDireto(A, { type: 'FACE_IMAGE', mimeType: 'image/png', size: 10 }, semChave)
    assert.equal(r1.status, 503)
    assert.equal(r1.corpo.codigo, 'UPLOAD_DIRETO_INDISPONIVEL')
    const r2 = await svc.confirmarEnvioDireto(A, { intencao: 'x.y' }, { ...process.env, NEXTAUTH_SECRET: '' })
    assert.equal(r2.status, 503)
  })
})

describe('3. WhatsApp com trabalho real no banco de teste', { skip: MOTIVO_PULO }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  const marca = `r56wa-${Date.now()}`
  let ws = ''
  let jobId = ''
  const CONTEXTO = { pedido: { numeros: ['5511999990000', '5511999990001'], mensagem: 'x', delayMs: 1500 } }

  before(async () => {
    prisma = (await import('../lib/prisma')).prisma
    ws = (await prisma.workspace.create({ data: { name: 'R56-WA', ownerId: marca }, select: { id: true } })).id
    const user = await prisma.user.create({ data: { email: `${marca}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })
    // Credenciais FICTÍCIAS: o duble nunca fala com a Z-API.
    const integ = await prisma.integracao.create({
      data: { workspaceId: ws, userId: user.id, plataforma: 'whatsapp', status: 'conectado', accessToken: 'ZAPI-FICTICIO', accountId: 'inst-ficticia' },
      select: { id: true },
    })
    // Tarefa JÁ ENFILEIRADA, como ficaria de antes da trava.
    jobId = (
      await prisma.automationJob.create({
        data: { workspaceId: ws, tipo: 'LONGO_ENVIO_WHATSAPP', chave: `${marca}-job`, estado: 'PENDING', classe: 'AUTOMATIZAVEL', entityType: 'INTEGRACAO', entityId: integ.id, contexto: CONTEXTO },
        select: { id: true },
      })
    ).id
  })
  after(async () => {
    await prisma.automationJob.deleteMany({ where: { workspaceId: ws } })
    await prisma.integracao.deleteMany({ where: { workspaceId: ws } })
    await prisma.user.deleteMany({ where: { workspaceId: ws } })
    await prisma.workspace.deleteMany({ where: { id: ws } })
    await prisma.$disconnect()
  })

  function execucaoDoJob(contexto: Record<string, unknown>, salvos: unknown[]) {
    return {
      trabalho: { id: jobId, workspaceId: ws, tipo: 'LONGO_ENVIO_WHATSAPP', entityId: 'i', contexto },
      salvar: async (p: unknown) => { salvos.push(p) },
      restanteMs: () => 60_000,
      dormir: async () => {},
    } as unknown as Execucao
  }

  function duble(enviados: string[]): DependenciasDoEnvio {
    return {
      enviarTexto: async (_c, p) => { enviados.push(p.numero); return { numero: p.numero, ok: true } },
      enviarImagem: async (_c, p) => { enviados.push(p.numero); return { numero: p.numero, ok: true } },
    }
  }

  for (const [nome, env] of PRODUCOES) {
    test(`tarefa enfileirada em ${nome}: integração conectada, mesmo assim não envia nem toca na tarefa`, async () => {
      const job = await prisma.automationJob.findUnique({ where: { id: jobId } })
      const enviados: string[] = []
      const salvos: unknown[] = []
      const d = await executorDoEnvio(duble(enviados), env)(execucaoDoJob(job!.contexto as Record<string, unknown>, salvos))
      assert.equal(d.fim, 'falhou')
      assert.equal(d.resposta.corpo.codigo, CODIGO_WHATSAPP_BLOQUEADO)
      assert.deepEqual(enviados, [])
      assert.deepEqual(salvos, [])
      const depois = await prisma.automationJob.findUnique({ where: { id: jobId } })
      assert.deepEqual(depois?.contexto, CONTEXTO, 'contexto intacto')
    })
  }

  test('local/teste controlado: o executor envia (duble)', async () => {
    const enviados: string[] = []
    const salvos: unknown[] = []
    const d = await executorDoEnvio(duble(enviados), LOCAL_TESTE)(execucaoDoJob({ ...CONTEXTO }, salvos))
    assert.equal(d.fim, 'concluido')
    assert.deepEqual(enviados, CONTEXTO.pedido.numeros)
  })
})
