/**
 * P2.33.1 — SEGURANÇA DO MATERIAL BIOMÉTRICO + NARRAÇÃO NA OPERAÇÃO.
 *
 * Trava: nada de rosto/voz/prévia em bucket público; consentimento específico (da própria pessoa, vigente)
 * para enviar, confirmar, ver e usar; revogação apaga as prévias (e o material, por padrão); exclusão
 * SEGURA (registro só sai com o arquivo confirmado fora do storage); isolamento entre contas e entre
 * usuários do mesmo workspace; narração com gravação real e com voz local, a versão original intacta,
 * prévia só para a titular, escolha na aprovação, nunca aprovação/publicação automática, formato no DNA.
 *
 * NENHUM arquivo biométrico real: tudo sintético (tons gerados, imagens de cor). Banco e storage de TESTE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  consentimentosExigidos, consentimentoVigente, podeUsarMaterial, finalidadeAceita, FINALIDADES,
} from '../lib/digital-twin-consentimento'
import {
  checarAudioDaNarracao, validarTextoDaNarracao, formatoAudiovisualDa, legendaComDisclosure, narracaoUtilizavel, textoSugeridoDaNarracao,
  DISCLOSURE_DA_VOZ_SINTETICA, type NarracaoDaPublicacao,
} from '../lib/narracao'
import { extrairDna } from '../lib/dna-criativo'
// P2.45: este arquivo testa o fluxo de publicação ANTERIOR aos três controles (técnico, comercial, conformidade).
process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES = 'true'

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')
const TEM_STORAGE = !!process.env.SUPABASE_SERVICE_ROLE_KEY && (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('ref-teste-exemplo')
const RAIZ = path.join(__dirname, '..')
const ff = (): string => require('ffmpeg-static') as string
const DIA = 86_400_000

describe('P2.33.1 — puro', () => {
  const agora = new Date('2026-10-19T12:00:00Z')
  const ok = { status: 'GRANTED', subjectUserId: 'u1', revokedAt: null, expiresAt: new Date(agora.getTime() + DIA) }

  test('consentimento exigido por tipo (vídeo de referência = imagem + voz; desconhecido = os dois)', () => {
    assert.deepEqual(consentimentosExigidos('FACE_IMAGE'), ['IMAGEM'])
    assert.deepEqual(consentimentosExigidos('VOICE_REFERENCE'), ['VOZ'])
    assert.deepEqual(consentimentosExigidos('REFERENCE_VIDEO'), ['IMAGEM', 'VOZ'])
    assert.deepEqual(consentimentosExigidos('GENERATED_PREVIEW', 'voice_preview'), ['VOZ'])
    assert.deepEqual(consentimentosExigidos('GENERATED_PREVIEW', 'avatar_preview'), ['IMAGEM', 'VOZ'])
    assert.deepEqual(consentimentosExigidos('QUALQUER_COISA'), ['IMAGEM', 'VOZ'])
  })

  test('consentimento vigente = da própria pessoa, concedido, não revogado e dentro da validade', () => {
    assert.equal(consentimentoVigente(ok, 'u1', agora).ok, true)
    assert.match(consentimentoVigente(ok, 'u2', agora).motivo!, /outra pessoa/)
    assert.equal(consentimentoVigente({ ...ok, status: 'REVOKED', revokedAt: agora }, 'u1', agora).ok, false)
    assert.match(consentimentoVigente({ ...ok, expiresAt: new Date(agora.getTime() - 1) }, 'u1', agora).motivo!, /venceu/)
    assert.equal(consentimentoVigente(null, 'u1', agora).ok, false)
    assert.equal(podeUsarMaterial('REFERENCE_VIDEO', null, { userId: 'u1', imagem: ok, voz: null, agora }).ok, false, 'vídeo de referência sem voz')
    assert.equal(podeUsarMaterial('REFERENCE_VIDEO', null, { userId: 'u1', imagem: ok, voz: ok, agora }).ok, true)
  })

  test('finalidade do consentimento: só o texto exato conhecido', () => {
    assert.equal(finalidadeAceita('IMAGEM', FINALIDADES.IMAGEM[0]), true)
    assert.equal(finalidadeAceita('VOZ', 'qualquer coisa'), false)
    assert.equal(finalidadeAceita('VOZ', FINALIDADES.IMAGEM[0]), false)
  })

  test('checagem do áudio da narração: corta fala → bloqueia; silêncio → bloqueia; saturado/baixo → revisar', () => {
    assert.equal(checarAudioDaNarracao({ duracaoAudioS: 12, duracaoVideoS: 15, mediaDb: -20, picoDb: -3 }).veredito, 'APROVADO')
    assert.equal(checarAudioDaNarracao({ duracaoAudioS: 25, duracaoVideoS: 15, mediaDb: -20, picoDb: -3 }).veredito, 'BLOQUEADO')
    assert.equal(checarAudioDaNarracao({ duracaoAudioS: 10, duracaoVideoS: 15, mediaDb: -55, picoDb: -40 }).veredito, 'BLOQUEADO')
    assert.equal(checarAudioDaNarracao({ duracaoAudioS: 10, duracaoVideoS: 15, mediaDb: -20, picoDb: 0 }).veredito, 'REVISAR')
    assert.equal(checarAudioDaNarracao({ duracaoAudioS: null, duracaoVideoS: 15, mediaDb: null, picoDb: null }).veredito, 'BLOQUEADO')
  })

  test('texto da voz sintetizada: nunca depoimento fictício nem alegação sem prova; curto', () => {
    assert.equal(validarTextoDaNarracao('Seu filho consegue dizer o que sente? O Emocionário é um dicionário ilustrado de emoções.').ok, true)
    assert.equal(validarTextoDaNarracao('Eu usei e meu filho amou este livro.').ok, false)
    assert.equal(validarTextoDaNarracao('palavra '.repeat(70)).ok, false)
    assert.equal(validarTextoDaNarracao('oi').ok, false)
    assert.match(textoSugeridoDaNarracao({ gancho: 'Seu filho consegue dizer o que sente?', roteiro: [{ etapa: 'O que é', texto: 'Um dicionário de emoções' }, { etapa: 'x', texto: 'Mostre o produto' }], cta: 'Toque no produto marcado.' }, 'Livro Emocionário'), /^Seu filho consegue dizer o que sente\. Livro Emocionário\. Um dicionário de emoções\. Toque no produto marcado\.$/)
  })

  test('formato audiovisual, disclosure de IA e narração obsoleta', () => {
    const n = { modo: 'VOZ_LOCAL', estado: 'PREVIA_PRONTA', versaoDoVideo: 1, arquivoBase: 'https://x/v.mp4', videoPath: 'narracoes/a.mp4', qg: { veredito: 'APROVADO' }, expiraEm: new Date(agora.getTime() + DIA).toISOString() } as unknown as NarracaoDaPublicacao
    assert.equal(formatoAudiovisualDa('ORIGINAL', n), 'IMAGENS_SEM_VOZ')
    assert.equal(formatoAudiovisualDa('NARRADA', n), 'NARRACAO_VOZ_LOCAL')
    assert.equal(formatoAudiovisualDa('NARRADA', { ...n, modo: 'GRAVACAO_REAL' }), 'NARRACAO_GRAVADA')
    assert.ok(legendaComDisclosure('Legenda.', 'NARRACAO_VOZ_LOCAL').endsWith(DISCLOSURE_DA_VOZ_SINTETICA))
    assert.equal(legendaComDisclosure('Legenda.', 'NARRACAO_GRAVADA'), 'Legenda.', 'gravação real não é IA')
    const a = { versao: 1, apresentacao: { video: { arquivo: 'https://x/v.mp4' } } }
    assert.equal(narracaoUtilizavel(n, a, agora).ok, true)
    assert.equal(narracaoUtilizavel(n, { ...a, versao: 2 }, agora).ok, false, 'ajuste/novo render → obsoleta')
    assert.equal(narracaoUtilizavel(n, { versao: 1, apresentacao: { video: { arquivo: 'https://x/outro.mp4' } } }, agora).ok, false)
    assert.equal(narracaoUtilizavel({ ...n, expiraEm: new Date(agora.getTime() - 1).toISOString() }, a, agora).ok, false, 'vencida')
  })

  test('DNA: a narração escolhida entra como temNarracao (aprendizado do formato)', () => {
    const video = { situacao: 'GERADO', arquivo: 'x', midiaTipo: 'IMAGEM', cenas: [{}] }
    assert.equal(extrairDna({ gancho: 'g', cta: 'c', estrutura: 'PROBLEMA_SOLUCAO', video }).temNarracao, false)
    assert.equal(extrairDna({ gancho: 'g', cta: 'c', estrutura: 'PROBLEMA_SOLUCAO', video, formatoAudiovisual: 'NARRACAO_GRAVADA' }).temNarracao, true)
    assert.equal(extrairDna({ gancho: 'g', cta: 'c', estrutura: 'PROBLEMA_SOLUCAO', video, formatoAudiovisual: 'NARRACAO_VOZ_LOCAL' }).temNarracao, true)
  })

  test('nenhum código de rosto/voz/narração sobe para bucket PÚBLICO (verificação no código-fonte)', () => {
    const arquivos = [
      ...readdirSync(path.join(RAIZ, 'lib')).filter((f) => /^digital-twin-.*\.ts$/.test(f)).map((f) => path.join('lib', f)),
      'lib/narracao.ts', 'lib/chatterbox-adapter.ts', 'lib/digital-twin-consentimento.ts',
      ...readdirSync(path.join(RAIZ, 'worker')).filter((f) => f.endsWith('.ts')).map((f) => path.join('worker', f)),
    ]
    for (const f of arquivos) {
      const s = readFileSync(path.join(RAIZ, f), 'utf8')
      assert.ok(!/\buploadBuffer\(/.test(s), `${f} usa upload PÚBLICO`)
      assert.ok(!/getPublicUrl/.test(s), `${f} gera URL pública`)
      assert.ok(!/['"](creative-renders|imagens)['"]/.test(s), `${f} cita bucket público`)
    }
    const r = readFileSync(path.join(RAIZ, 'lib/renderer-ffmpeg.ts'), 'utf8')
    for (const metodo of ['renderVoiceOnlyPreview', 'renderTikTokComNarracao']) {
      const corpo = r.slice(r.indexOf(`async ${metodo}(`), r.indexOf('\n  }\n', r.indexOf(`async ${metodo}(`)))
      assert.ok(corpo.length > 100 && !/uploadBuffer/.test(corpo), `${metodo} não pode subir nada`)
    }
  })

  test('prévia "foto + voz" devolve só o arquivo LOCAL (render real, sem nenhum envio)', async () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'r122-vo-'))
    execFileSync(ff(), ['-f', 'lavfi', '-i', 'color=c=0x6a1b9a:s=720x1280', '-frames:v', '1', '-y', path.join(pasta, 'rosto.jpg')], { stdio: 'ignore' })
    execFileSync(ff(), ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-y', path.join(pasta, 'voz.wav')], { stdio: 'ignore' })
    // P2.50 (SSRF): o servidor só baixa de endereço https público. IP público literal (sem DNS) + fetch simulado.
    const bytesDoRosto = readFileSync(path.join(pasta, 'rosto.jpg'))
    const fetchReal = globalThis.fetch
    globalThis.fetch = (async () => new Response(bytesDoRosto, { status: 200 })) as typeof fetch
    try {
      const { RendererFFmpeg } = await import('../lib/renderer-ffmpeg')
      const r = await new RendererFFmpeg().renderVoiceOnlyPreview({ imagemUrl: 'https://93.184.216.34/r.jpg', audioLocalPath: path.join(pasta, 'voz.wav'), legenda: 'FIXTURE' })
      assert.ok(r.caminhoLocal && existsSync(r.caminhoLocal), 'arquivo local gerado')
      assert.ok(!('url' in r), 'sem URL nenhuma')
      rmSync(r.caminhoLocal, { force: true })
    } finally {
      globalThis.fetch = fetchReal
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})

describe('P2.33.1 — banco e storage de TESTE (só material sintético)', { skip: !TEM_BANCO || !TEM_STORAGE ? 'exige banco e storage de TESTE' : false, timeout: 900_000 }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  let sb: import('@supabase/supabase-js').SupabaseClient
  const PREFIXO = 'Conta de Teste — '
  const marca = `r122-${Date.now()}`
  const workspaces: string[] = []
  const pasta = mkdtempSync(path.join(tmpdir(), 'r122-'))
  const BUCKET = 'digital-twin-private'
  const existe = async (caminho: string) => {
    const pos = caminho.lastIndexOf('/')
    const { data } = await sb.storage.from(BUCKET).list(caminho.slice(0, pos), { search: caminho.slice(pos + 1) })
    return (data ?? []).some((o) => o.name === caminho.slice(pos + 1))
  }
  const sintetico = (nome: string, args: string[]) => { const f = path.join(pasta, nome); execFileSync(ff(), [...args, '-y', f], { stdio: 'ignore' }); return f }

  async function conta(nome: string) {
    const ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}${nome} r122`, ownerId: `${marca}-${nome}` }, select: { id: true } })).id
    workspaces.push(ws)
    const u1 = (await prisma.user.create({ data: { email: `${marca}-${nome}-a@teste.local`, name: 'Titular SINTÉTICA', password: 'x', workspaceId: ws }, select: { id: true } })).id
    const u2 = (await prisma.user.create({ data: { email: `${marca}-${nome}-b@teste.local`, name: 'Outro membro', password: 'x', workspaceId: ws }, select: { id: true } })).id
    const perfil = (await prisma.digitalTwinProfile.create({ data: { workspaceId: ws, ownerUserId: u1, displayName: 'SINTÉTICO r122' }, select: { id: true } })).id
    return { ws, u1, u2, perfil }
  }
  async function consentir(c: { ws: string; u1: string; perfil: string }, tipo: 'imagem' | 'voz', extra: Record<string, unknown> = {}) {
    const dados = { workspaceId: c.ws, subjectUserId: c.u1, purpose: tipo === 'imagem' ? FINALIDADES.IMAGEM[0] : FINALIDADES.VOZ[0], status: 'GRANTED', grantedAt: new Date(), expiresAt: new Date(Date.now() + 30 * DIA), ...extra }
    if (tipo === 'imagem') {
      const k = await prisma.identityConsent.create({ data: dados })
      await prisma.digitalTwinProfile.update({ where: { id: c.perfil }, data: { identityConsentId: k.id } })
      return k.id
    }
    const k = await prisma.voiceConsent.create({ data: dados })
    const vp = await prisma.voiceProfile.create({ data: { workspaceId: c.ws, ownerUserId: c.u1, consentId: k.id, enabled: true } })
    await prisma.digitalTwinProfile.update({ where: { id: c.perfil }, data: { voiceProfileId: vp.id } })
    return k.id
  }
  async function assetSintetico(c: { ws: string; perfil: string }, type: string, purpose: string | null, extra: Record<string, unknown> = {}) {
    const caminho = `${c.ws}/${c.perfil}/${type.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const { error } = await sb.storage.from(BUCKET).upload(caminho, Buffer.from(`SINTETICO ${type}`), { contentType: 'application/octet-stream' })
    if (error) throw error
    return (await prisma.digitalTwinAsset.create({ data: { workspaceId: c.ws, profileId: c.perfil, type, storagePath: caminho, mimeType: 'application/octet-stream', purpose, ...extra } })).id
  }

  before(async () => {
    ;[{ prisma }, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('./_limpar-workspace-de-teste')])
    const { createClient } = await import('@supabase/supabase-js')
    sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  })
  after(async () => {
    if (prisma) {
      for (const w of workspaces) {
        // Storage: tudo o que os testes deixaram sob o workspace (inclusive narrações) sai também.
        for (const pre of [w, `narracoes/${w}`]) {
          const { data: pastas } = await sb.storage.from(BUCKET).list(pre)
          for (const p of pastas ?? []) {
            const { data: objs } = await sb.storage.from(BUCKET).list(`${pre}/${p.name}`)
            if (objs?.length) await sb.storage.from(BUCKET).remove(objs.map((o) => `${pre}/${p.name}/${o.name}`))
            if (p.id) await sb.storage.from(BUCKET).remove([`${pre}/${p.name}`])
          }
        }
        // Vídeos renderizados (sintéticos) das publicações de teste.
        const { data: renders } = await sb.storage.from('videos').list(`assistidas/${w}`)
        if (renders?.length) await sb.storage.from('videos').remove(renders.map((o) => `assistidas/${w}/${o.name}`))
        await prisma.digitalTwinJob.deleteMany({ where: { workspaceId: w } }).catch(() => null)
        await prisma.digitalTwinAsset.deleteMany({ where: { workspaceId: w } }).catch(() => null)
        await prisma.digitalTwinProfile.deleteMany({ where: { workspaceId: w } }).catch(() => null)
        await prisma.voiceProfile.deleteMany({ where: { workspaceId: w } }).catch(() => null)
        await prisma.identityConsent.deleteMany({ where: { workspaceId: w } }).catch(() => null)
        await prisma.voiceConsent.deleteMany({ where: { workspaceId: w } }).catch(() => null)
        await prisma.domainEvent.deleteMany({ where: { workspaceId: w } }).catch(() => null)
        await prisma.decisionRecord.deleteMany({ where: { workspaceId: w } }).catch(() => null)
        await limpar(prisma, w, PREFIXO)
      }
      const { data: imgs } = await sb.storage.from('imagens').list(`testes/r122/${marca}`)
      if (imgs?.length) await sb.storage.from('imagens').remove(imgs.map((o) => `testes/r122/${marca}/${o.name}`))
      await prisma.$disconnect()
    }
    rmSync(pasta, { recursive: true, force: true })
  })

  test('envio direto: sem consentimento, de outra pessoa, vencido ou do tipo errado → 403; consentimento certo → 200', async () => {
    const S = await import('../lib/digital-twin-upload-direto-servico')
    const c = await conta('envio')
    const pedir = (userId: string, type: string, mimeType = 'image/jpeg') => S.autorizarEnvioDireto({ workspaceId: c.ws, userId }, { type, mimeType, size: 1000 })
    assert.equal((await pedir(c.u1, 'FACE_IMAGE')).corpo.codigo, 'CONSENTIMENTO_EXIGIDO')
    await consentir(c, 'imagem')
    assert.equal((await pedir(c.u2, 'FACE_IMAGE')).status, 403, 'outro membro do workspace nunca envia o rosto da titular')
    assert.equal((await pedir(c.u1, 'FACE_IMAGE')).status, 200)
    assert.equal((await pedir(c.u1, 'VOICE_REFERENCE', 'audio/webm')).status, 403, 'voz sem consentimento de voz')
    assert.equal((await pedir(c.u1, 'REFERENCE_VIDEO', 'video/mp4')).status, 403, 'vídeo de referência exige os dois')
    await consentir(c, 'voz', { expiresAt: new Date(Date.now() - 1000) })
    assert.equal((await pedir(c.u1, 'VOICE_REFERENCE', 'audio/webm')).status, 403, 'consentimento de voz vencido')
  })

  test('confirmação depois da revogação: recusa e o arquivo já enviado é apagado do storage', async () => {
    const S = await import('../lib/digital-twin-upload-direto-servico')
    const R = await import('../lib/digital-twin-revoke')
    const c = await conta('revoga-envio')
    const k = await consentir(c, 'imagem')
    const foto = sintetico('rosto.jpg', ['-f', 'lavfi', '-i', 'color=c=0x00838f:s=512x512', '-frames:v', '1'])
    const pedido = await S.autorizarEnvioDireto({ workspaceId: c.ws, userId: c.u1 }, { type: 'FACE_IMAGE', mimeType: 'image/jpeg', size: readFileSync(foto).length })
    assert.equal(pedido.status, 200)
    const envio = await fetch(pedido.corpo.uploadUrl as string, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }, body: readFileSync(foto) })
    assert.ok(envio.ok, `PUT ${envio.status}`)
    await R.revogarIdentityConsent(c.ws, k, c.u1)
    const conf = await S.confirmarEnvioDireto({ workspaceId: c.ws, userId: c.u1 }, { intencao: pedido.corpo.intencao })
    assert.equal(conf.status, 403)
    assert.equal(await prisma.digitalTwinAsset.count({ where: { workspaceId: c.ws } }), 0, 'nada registrado')
    const intencao = JSON.parse(Buffer.from(String(pedido.corpo.intencao).split('.')[0], 'base64url').toString('utf8')) as { caminho: string }
    assert.equal(await existe(intencao.caminho), false, 'objeto apagado do storage')
  })

  test('acesso: só a titular do perfil vê; outro membro → 403; outra conta não vê nada; voz revogada some; prévia vencida some', async () => {
    const A = await import('../lib/digital-twin-acesso')
    const c = await conta('acesso')
    const outra = await conta('acesso-outra')
    await consentir(c, 'imagem')
    const kVoz = await consentir(c, 'voz')
    await assetSintetico(c, 'FACE_IMAGE', null)
    await assetSintetico(c, 'VOICE_REFERENCE', null)
    await assetSintetico(c, 'GENERATED_PREVIEW', 'voice_preview', { expiresAt: new Date(Date.now() - 1000) })
    const assinar = async (cam: string) => `assinada:${cam}`
    const r = await A.assetsVisiveisParaATitular({ workspaceId: c.ws, userId: c.u1 }, { assinar })
    assert.equal(r.status, 200)
    assert.deepEqual(r.status === 200 && r.assets.map((x) => x.type).sort(), ['FACE_IMAGE', 'VOICE_REFERENCE'], 'prévia vencida não é servida')
    assert.equal((await A.assetsVisiveisParaATitular({ workspaceId: c.ws, userId: c.u2 }, { assinar })).status, 403)
    const o = await A.assetsVisiveisParaATitular({ workspaceId: outra.ws, userId: outra.u1 }, { assinar })
    assert.equal(o.status === 200 && o.assets.length, 0, 'isolamento entre contas')
    await prisma.voiceConsent.update({ where: { id: kVoz }, data: { status: 'REVOKED', revokedAt: new Date() } })
    const r2 = await A.assetsVisiveisParaATitular({ workspaceId: c.ws, userId: c.u1 }, { assinar })
    assert.deepEqual(r2.status === 200 && r2.assets.map((x) => x.type), ['FACE_IMAGE'], 'voz revogada não é mais servida')
  })

  test('revogação: só a própria pessoa; apaga prévias e material de origem (confirmado no storage); com apagarMateriais=false mantém a origem', async () => {
    const R = await import('../lib/digital-twin-revoke')
    const c = await conta('revoga')
    const kVoz = await consentir(c, 'voz')
    const ref = await assetSintetico(c, 'VOICE_REFERENCE', null)
    const prev = await assetSintetico(c, 'GENERATED_PREVIEW', 'voice_preview', { expiresAt: new Date(Date.now() + DIA) })
    const caminhos = (await prisma.digitalTwinAsset.findMany({ where: { id: { in: [ref, prev] } }, select: { storagePath: true } })).map((a) => a.storagePath)
    await assert.rejects(() => R.revogarVoiceConsent(c.ws, kVoz, c.u2), /própria pessoa/)
    const ex = await R.revogarVoiceConsent(c.ws, kVoz, c.u1)
    assert.deepEqual(ex, { apagados: 2, pendentes: 0 })
    for (const cam of caminhos) assert.equal(await existe(cam), false, `apagado: ${cam}`)
    assert.equal((await prisma.voiceConsent.findUniqueOrThrow({ where: { id: kVoz } })).status, 'REVOKED', 'o registro do consentimento fica (prova)')

    const c2 = await conta('revoga-mantem')
    const k2 = await consentir(c2, 'imagem')
    const rosto = await assetSintetico(c2, 'FACE_IMAGE', null)
    await assetSintetico(c2, 'GENERATED_PREVIEW', 'avatar_preview', { expiresAt: new Date(Date.now() + DIA) })
    const ex2 = await R.revogarIdentityConsent(c2.ws, k2, c2.u1, { apagarMateriais: false })
    assert.equal(ex2.apagados, 1, 'só a prévia')
    assert.ok(await prisma.digitalTwinAsset.findUnique({ where: { id: rosto } }), 'origem mantida (não é servida sem novo consentimento)')
  })

  test('exclusão segura: se o storage não confirmar a remoção, o registro fica INATIVO e a próxima rodada apaga', async () => {
    const E = await import('../lib/digital-twin-exclusao')
    const c = await conta('exclusao')
    await consentir(c, 'voz')
    const id = await assetSintetico(c, 'GENERATED_PREVIEW', 'voice_preview', { expiresAt: new Date(Date.now() - 1000) })
    const permanente = await assetSintetico(c, 'VOICE_REFERENCE', null)
    const falho = { apagar: async () => { throw new Error('storage fora') }, existe: async () => true }
    assert.deepEqual(await E.limparPreviasVencidas(new Date(), falho, c.ws), { apagados: 0, pendentes: 1 })
    const pend = await prisma.digitalTwinAsset.findUniqueOrThrow({ where: { id } })
    assert.equal(pend.active, false, 'inativo: não é mais servido nem usado')
    assert.deepEqual(await E.limparPreviasVencidas(new Date(), undefined, c.ws), { apagados: 1, pendentes: 0 })
    assert.equal(await prisma.digitalTwinAsset.findUnique({ where: { id } }), null)
    assert.ok(await prisma.digitalTwinAsset.findUnique({ where: { id: permanente } }), 'referência permanente nunca expira pela retenção')
  })

  // ── Narração: publicação real (jornada → mídias sintéticas → render → QG → APROVAR_VIDEO) ──
  async function publicacaoPronta(nome: string) {
    const c = await conta(nome)
    const J = await import('../lib/jornada')
    const M = await import('../lib/midia-do-produto')
    const A = await import('../lib/publicacao-assistida')
    const n = String(Date.now()).slice(-6) + Math.floor(Math.random() * 1000)
    const cand = (await prisma.candidatoDeProduto.create({ data: {
      workspaceId: c.ws, chaveDeOrigem: `${marca}-${nome}-${n}`, fonte: 'USER_PROVIDED', nome: 'FIXTURE Livro', categoria: 'Papelaria', providerId: 'tiktok-shop', externalId: `9000000122${n}`,
      linkProduto: `https://shop.tiktok.com/br/pdp/9000000122${n}`, score: 50, baseDeEvidencia: 40, confianca: 'SEM_HISTORICO_REAL', status: 'NOVO', coletadoEm: new Date(), validoAte: new Date('2027-06-01'),
      compradoPelaTitular: true, motivosPositivos: [], riscos: [], desconhecidos: [], porqueDestaPosicao: [], nivelDeRisco: 'BAIXO',
    }, select: { id: true } })).id
    let v = J.visaoDaOperacao(await J.escolherProduto({ workspaceId: c.ws, userId: c.u1, candidatoId: cand, emMaos: true }))
    const assistidaId = v.prioritaria!.assistida!.id
    for (const [i, cor] of ['red', 'green', 'blue'].entries()) {
      const f = sintetico(`${nome}-${i}.jpg`, ['-f', 'lavfi', '-i', `color=c=${cor}:s=900x1600`, '-frames:v', '1'])
      const cam = `testes/r122/${marca}/${nome}-${i}.jpg`
      await sb.storage.from('imagens').upload(cam, readFileSync(f), { contentType: 'image/jpeg', upsert: true })
      const url = sb.storage.from('imagens').getPublicUrl(cam).data.publicUrl
      await M.registrarMidia({ workspaceId: c.ws, candidatoId: cand, nomeProduto: 'FIXTURE Livro', declaracao: { url, tipo: 'IMAGEM', origem: 'PROPRIO', titularidade: 'Titular da conta (eu)', direitoDeUso: 'Uso nas minhas redes', descricao: 'FIXTURE', declaradoPor: c.u1, declaradoEm: new Date() } })
    }
    await A.avancarVideo(await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: assistidaId } }))
    v = J.visaoDaOperacao(await J.sincronizarOperacao({ workspaceId: c.ws, userId: c.u1 }))
    assert.equal(v.prioritaria!.acao?.tipo, 'APROVAR_VIDEO', v.prioritaria!.titulo)
    const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: assistidaId } })
    return { ...c, id: assistidaId, arquivoOriginal: (a.apresentacao as { video: { arquivo: string } }).video.arquivo }
  }
  async function enviarGravacao(p: { ws: string; u1: string; id: string }, segundos: number) {
    const N = await import('../lib/narracao')
    const audio = sintetico(`voz-${p.id}-${segundos}.wav`, ['-f', 'lavfi', '-i', `sine=frequency=220:duration=${segundos}`, '-af', 'volume=0.4'])
    const pedido = await N.pedirEnvioDaGravacao({ workspaceId: p.ws, userId: p.u1, id: p.id, mime: 'audio/wav', tamanho: readFileSync(audio).length, declaro: true })
    const envio = await fetch(pedido.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/wav', 'x-upsert': 'false' }, body: readFileSync(audio) })
    assert.ok(envio.ok, `PUT ${envio.status}`)
    return N.confirmarGravacao({ workspaceId: p.ws, userId: p.u1, id: p.id })
  }

  test('narração com GRAVAÇÃO REAL: declaração obrigatória; prévia privada só da titular; original intacta; nunca aprova sozinha; aprovar NARRADA não publica pela API', async () => {
    const N = await import('../lib/narracao')
    const A = await import('../lib/publicacao-assistida')
    const p = await publicacaoPronta('grav')
    await assert.rejects(() => N.pedirEnvioDaGravacao({ workspaceId: p.ws, userId: p.u1, id: p.id, mime: 'audio/wav', tamanho: 1000, declaro: false }), /confirme/)
    const r = await enviarGravacao(p, 8)
    assert.equal(r.estado, 'PREVIA_PRONTA')
    assert.equal(r.qg.veredito, 'APROVADO')
    const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })
    assert.equal(a.estado, 'AGUARDANDO_APROVACAO', 'a narração nunca aprova nada sozinha')
    assert.equal((a.apresentacao as { video: { arquivo: string } }).video.arquivo, p.arquivoOriginal, 'a versão original não muda')
    const n = N.narracaoDe(a.apresentacao)!
    assert.ok(n.videoPath!.startsWith(`narracoes/${p.ws}/`) && await existe(n.videoPath!), 'vídeo narrado no bucket PRIVADO')
    // O vídeo narrado tem som e a mesma duração do original.
    const local = path.join(pasta, 'narrado.mp4')
    const { data } = await sb.storage.from(BUCKET).download(n.videoPath!)
    require('node:fs').writeFileSync(local, Buffer.from(await data!.arrayBuffer()))
    const probe = (() => { try { execFileSync(ff(), ['-i', local], { stdio: 'pipe' }) } catch (e) { return String((e as { stderr?: Buffer }).stderr ?? '') } return '' })()
    assert.match(probe, /Audio: aac/, 'tem a faixa de voz')
    assert.match(probe, /Duration: 00:00:1[45]\./, 'mesma duração do vídeo (15 s)')
    await assert.rejects(() => N.narracaoParaATitular({ workspaceId: p.ws, userId: p.u2, id: p.id }), /Só a titular/)
    const vista = await N.narracaoParaATitular({ workspaceId: p.ws, userId: p.u1, id: p.id })
    assert.ok(vista.narracao?.videoUrl?.includes('token='), 'URL assinada (temporária)')
    assert.equal(vista.narracao?.utilizavel, true)

    const ap = await A.aprovarEPublicar({ workspaceId: p.ws, userId: p.u1, id: p.id, versaoEscolhida: 'NARRADA' })
    assert.equal(ap.estado, 'APROVADO', 'aprovada, não publicada')
    assert.match(ap.bloqueio ?? '', /Versão narrada: baixe/)
    const depois = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })
    const apr = depois.apresentacao as { versaoEscolhida: string; formatoAudiovisual: string; video: { arquivo: string } }
    assert.deepEqual([apr.versaoEscolhida, apr.formatoAudiovisual], ['NARRADA', 'NARRACAO_GRAVADA'])
    assert.equal(apr.video.arquivo, p.arquivoOriginal)
    assert.equal(await prisma.publicacao.count({ where: { workspaceId: p.ws } }), 0, 'nada foi enviado ao TikTok')
    assert.ok(!((depois.versaoFinal as { legenda: string }).legenda.includes(N.DISCLOSURE_DA_VOZ_SINTETICA)), 'gravação real não leva aviso de IA')
    await assert.rejects(() => N.descartarNarracao({ workspaceId: p.ws, userId: p.u1, id: p.id }), /já foi aprovada/)
  })

  test('gravação que cortaria a fala: bloqueada, arquivos apagados; descartar apaga e a ORIGINAL segue aprovável', async () => {
    const N = await import('../lib/narracao')
    const A = await import('../lib/publicacao-assistida')
    const p = await publicacaoPronta('grav-longa')
    await assert.rejects(() => enviarGravacao(p, 24), /cortada/)
    const a = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })
    const n = N.narracaoDe(a.apresentacao)!
    assert.equal(n.estado, 'FALHOU')
    assert.equal(n.audioPath ?? null, null)
    await assert.rejects(() => A.aprovarEPublicar({ workspaceId: p.ws, userId: p.u1, id: p.id, versaoEscolhida: 'NARRADA' }), /não está pronta|checagem/)
    await enviarGravacao(p, 6)
    const pronta = N.narracaoDe((await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })).apresentacao)!
    await N.descartarNarracao({ workspaceId: p.ws, userId: p.u1, id: p.id })
    for (const cam of [pronta.audioPath!, pronta.videoPath!]) assert.equal(await existe(cam), false, `apagado: ${cam}`)
    const ap = await A.aprovarEPublicar({ workspaceId: p.ws, userId: p.u1, id: p.id })
    const apr = (await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: ap.id } })).apresentacao as { versaoEscolhida: string; formatoAudiovisual: string }
    assert.deepEqual([apr.versaoEscolhida, apr.formatoAudiovisual], ['ORIGINAL', 'IMAGENS_SEM_VOZ'])
  })

  test('VOZ LOCAL: sem consentimento → 403; com voz aprovada → fila (worker) → prévia; legenda com aviso de IA; revogar a voz apaga a narração', async () => {
    const N = await import('../lib/narracao')
    const A = await import('../lib/publicacao-assistida')
    const R = await import('../lib/digital-twin-revoke')
    const p = await publicacaoPronta('voz')
    const texto = 'Seu filho consegue dizer o que sente? Um dicionário de emoções. Toque no produto marcado.'
    await assert.rejects(() => N.pedirNarracaoComVozLocal({ workspaceId: p.ws, userId: p.u1, id: p.id, texto }), /Consentimento de voz/)
    const kVoz = await consentir(p, 'voz')
    await assert.rejects(() => N.pedirNarracaoComVozLocal({ workspaceId: p.ws, userId: p.u1, id: p.id, texto }), /não foi aprovada/)
    await prisma.digitalTwinProfile.update({ where: { id: p.perfil }, data: { enabled: true, voiceApprovedAt: new Date() } })
    await assetSintetico(p, 'VOICE_REFERENCE', null)
    await assert.rejects(() => N.pedirNarracaoComVozLocal({ workspaceId: p.ws, userId: p.u2, id: p.id, texto }), /Só a titular/)
    await assert.rejects(() => N.pedirNarracaoComVozLocal({ workspaceId: p.ws, userId: p.u1, id: p.id, texto: 'Eu testei e recomendo.' }), /depoimento/)
    const { jobId } = await N.pedirNarracaoComVozLocal({ workspaceId: p.ws, userId: p.u1, id: p.id, texto })
    const job = await prisma.digitalTwinJob.findUniqueOrThrow({ where: { id: jobId } })
    assert.deepEqual([job.jobType, job.contentId, job.status], ['NARRATION', p.id, 'QUEUED'])
    // Worker com síntese FALSA (tom sintético): nunca a voz real.
    const deps = {
      baixarReferencia: async () => sintetico(`ref-${Date.now()}.wav`, ['-f', 'lavfi', '-i', 'sine=frequency=180:duration=2']),
      sintetizar: async () => sintetico(`sint-${Date.now()}.wav`, ['-f', 'lavfi', '-i', 'sine=frequency=260:duration=7', '-af', 'volume=0.4']),
    }
    const r = await N.processarNarracaoComVozLocal(job, deps)
    assert.equal(r.ok, true, r.motivo)
    const n = N.narracaoDe((await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })).apresentacao)!
    assert.equal(n.estado, 'PREVIA_PRONTA')
    assert.ok(await existe(n.videoPath!) && await existe(n.audioPath!))
    // Consentimento não vigente (mesmo sem passar pela revogação): nenhum link da voz sintetizada é entregue.
    await prisma.voiceConsent.update({ where: { id: kVoz }, data: { status: 'REVOKED', revokedAt: new Date() } })
    const negada = await N.narracaoParaATitular({ workspaceId: p.ws, userId: p.u1, id: p.id })
    assert.deepEqual([negada.narracao?.videoUrl, negada.narracao?.audioUrl, negada.narracao?.utilizavel], [null, null, false])
    await prisma.voiceConsent.update({ where: { id: kVoz }, data: { status: 'GRANTED', revokedAt: null } })
    // Revogar a voz apaga a narração com a voz sintetizada (ainda não aprovada).
    await R.revogarVoiceConsent(p.ws, kVoz, p.u1)
    const depois = N.narracaoDe((await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })).apresentacao)!
    assert.equal(depois.estado, 'DESCARTADA')
    for (const cam of [n.audioPath!, n.videoPath!]) assert.equal(await existe(cam), false)
    await assert.rejects(() => A.aprovarEPublicar({ workspaceId: p.ws, userId: p.u1, id: p.id, versaoEscolhida: 'NARRADA' }), /não está pronta/)
  })

  test('VOZ LOCAL aprovada: aviso de IA na legenda e formato NARRACAO_VOZ_LOCAL; consentimento revogado antes do worker → nada é gerado', async () => {
    const N = await import('../lib/narracao')
    const A = await import('../lib/publicacao-assistida')
    const p = await publicacaoPronta('voz-aprova')
    const kVoz = await consentir(p, 'voz')
    await prisma.digitalTwinProfile.update({ where: { id: p.perfil }, data: { enabled: true, voiceApprovedAt: new Date() } })
    await assetSintetico(p, 'VOICE_REFERENCE', null)
    const texto = 'Um dicionário de emoções, explicado de forma simples. Toque no produto marcado.'
    const deps = {
      baixarReferencia: async () => sintetico(`ref2-${Date.now()}.wav`, ['-f', 'lavfi', '-i', 'sine=frequency=180:duration=2']),
      sintetizar: async () => sintetico(`sint2-${Date.now()}.wav`, ['-f', 'lavfi', '-i', 'sine=frequency=300:duration=6', '-af', 'volume=0.4']),
    }
    const { jobId } = await N.pedirNarracaoComVozLocal({ workspaceId: p.ws, userId: p.u1, id: p.id, texto })
    assert.equal((await N.processarNarracaoComVozLocal(await prisma.digitalTwinJob.findUniqueOrThrow({ where: { id: jobId } }), deps)).ok, true)
    const ap = await A.aprovarEPublicar({ workspaceId: p.ws, userId: p.u1, id: p.id, versaoEscolhida: 'NARRADA' })
    const depois = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: ap.id } })
    assert.ok((depois.versaoFinal as { legenda: string }).legenda.endsWith(N.DISCLOSURE_DA_VOZ_SINTETICA), 'aviso de IA na legenda')
    assert.equal((depois.apresentacao as { formatoAudiovisual: string }).formatoAudiovisual, 'NARRACAO_VOZ_LOCAL')
    assert.equal(depois.estado, 'APROVADO')
    // Revogar a voz DEPOIS de aprovada e antes de publicar: arquivos apagados e aprovação DESFEITA.
    const R = await import('../lib/digital-twin-revoke')
    const nAprovada = N.narracaoDe(depois.apresentacao)!
    await R.revogarVoiceConsent(p.ws, kVoz, p.u1)
    const desfeita = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })
    assert.equal(desfeita.estado, 'AGUARDANDO_APROVACAO', 'aprovação desfeita: a voz sintetizada não vai ao ar sem consentimento')
    assert.deepEqual([(desfeita.apresentacao as { versaoEscolhida: string }).versaoEscolhida, (desfeita.apresentacao as { formatoAudiovisual: string }).formatoAudiovisual], ['ORIGINAL', 'IMAGENS_SEM_VOZ'])
    assert.equal(desfeita.versaoFinal, null)
    for (const cam of [nAprovada.audioPath!, nAprovada.videoPath!]) assert.equal(await existe(cam), false, `apagado: ${cam}`)
    assert.equal((await N.narracaoParaATitular({ workspaceId: p.ws, userId: p.u1, id: p.id })).narracao, null)
    assert.ok(((desfeita.historico as { acao: string }[]) ?? []).some((h) => h.acao === 'APROVACAO_DESFEITA'))

    // Outro vídeo: pedido feito, consentimento revogado ANTES do worker processar → o worker não gera nada.
    const q = await publicacaoPronta('voz-revoga-antes')
    const kq = await consentir(q, 'voz')
    await prisma.digitalTwinProfile.update({ where: { id: q.perfil }, data: { enabled: true, voiceApprovedAt: new Date() } })
    await assetSintetico(q, 'VOICE_REFERENCE', null)
    const pedido = await N.pedirNarracaoComVozLocal({ workspaceId: q.ws, userId: q.u1, id: q.id, texto })
    await prisma.voiceConsent.update({ where: { id: kq }, data: { status: 'REVOKED', revokedAt: new Date() } })
    let sintetizou = false
    const r = await N.processarNarracaoComVozLocal(await prisma.digitalTwinJob.findUniqueOrThrow({ where: { id: pedido.jobId } }), { ...deps, sintetizar: async () => { sintetizou = true; return deps.sintetizar() } })
    assert.equal(r.ok, false)
    assert.equal(sintetizou, false, 'nenhuma síntese com consentimento revogado')
  })

  test('VOZ LOCAL já PUBLICADA: revogar apaga a cópia privada; a publicação (fato) continua registrada', async () => {
    const N = await import('../lib/narracao')
    const A = await import('../lib/publicacao-assistida')
    const R = await import('../lib/digital-twin-revoke')
    const p = await publicacaoPronta('voz-publicada')
    const kVoz = await consentir(p, 'voz')
    await prisma.digitalTwinProfile.update({ where: { id: p.perfil }, data: { enabled: true, voiceApprovedAt: new Date() } })
    await assetSintetico(p, 'VOICE_REFERENCE', null)
    const deps = {
      baixarReferencia: async () => sintetico(`ref3-${Date.now()}.wav`, ['-f', 'lavfi', '-i', 'sine=frequency=180:duration=2']),
      sintetizar: async () => sintetico(`sint3-${Date.now()}.wav`, ['-f', 'lavfi', '-i', 'sine=frequency=280:duration=6', '-af', 'volume=0.4']),
    }
    const { jobId } = await N.pedirNarracaoComVozLocal({ workspaceId: p.ws, userId: p.u1, id: p.id, texto: 'Um dicionário de emoções. Toque no produto marcado.' })
    assert.equal((await N.processarNarracaoComVozLocal(await prisma.digitalTwinJob.findUniqueOrThrow({ where: { id: jobId } }), deps)).ok, true)
    await A.aprovarEPublicar({ workspaceId: p.ws, userId: p.u1, id: p.id, versaoEscolhida: 'NARRADA' })
    const narr = N.narracaoDe((await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })).apresentacao)!
    await A.registrarPublicacaoManual({ workspaceId: p.ws, userId: p.u1, id: p.id, url: 'https://www.tiktok.com/@sintetica/video/7400000000000000122' })
    assert.equal((await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })).estado, 'PUBLICADO')
    await R.revogarVoiceConsent(p.ws, kVoz, p.u1)
    const depois = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })
    assert.equal(depois.estado, 'PUBLICADO', 'a publicação já aconteceu: o registro não some')
    const n = N.narracaoDe(depois.apresentacao)!
    assert.equal(n.estado, 'DESCARTADA')
    assert.match(n.motivo ?? '', /continua no TikTok/)
    for (const cam of [narr.audioPath!, narr.videoPath!]) assert.equal(await existe(cam), false, `cópia privada apagada: ${cam}`)
    assert.equal((depois.apresentacao as { formatoAudiovisual: string }).formatoAudiovisual, 'NARRACAO_VOZ_LOCAL', 'o formato publicado continua como fato (aprendizado)')
  })

  test('retenção: narração vencida e não aprovada sai com os arquivos (remoção confirmada)', async () => {
    const N = await import('../lib/narracao')
    const p = await publicacaoPronta('retencao')
    await enviarGravacao(p, 5)
    const n = N.narracaoDe((await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })).apresentacao)!
    const r = await N.limparNarracoesVencidas(new Date(Date.now() + 8 * DIA), p.ws)
    assert.deepEqual(r, { apagadas: 1, pendentes: 0 })
    for (const cam of [n.audioPath!, n.videoPath!]) assert.equal(await existe(cam), false)
    assert.equal(N.narracaoDe((await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })).apresentacao)!.estado, 'DESCARTADA')
    const t = await prisma.publicacaoAssistida.findUniqueOrThrow({ where: { id: p.id } })
    assert.equal(t.estado, 'AGUARDANDO_APROVACAO', 'a publicação segue (só a narração venceu)')
  })
})
