/**
 * P2.18.6 — Envio de mídia pelo navegador com TOKEN ASSINADO.
 * O storage recusa escrita anônima (RLS): o envio antigo (anon direto)
 * falhava com "new row violates row-level security policy". Agora o servidor
 * emite um token para UM caminho dentro do workspace da sessão.
 * Storage de TESTE; o arquivo de prova é removido no fim.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { caminhoDeEnvio, validarEnvio, MAX_IMAGEM } from '../lib/envio-de-midia'

const TEM_STORAGE = !!process.env.SUPABASE_SERVICE_ROLE_KEY && (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('ref-teste-exemplo')

describe('envio de mídia: regras', () => {
  test('só foto ou vídeo, com teto de tamanho', () => {
    assert.equal(validarEnvio({ tipo: 'image/jpeg', tamanho: 1000 }), null)
    assert.equal(validarEnvio({ tipo: 'video/mp4', tamanho: 50 * 1048576 }), null)
    assert.match(validarEnvio({ tipo: 'application/pdf', tamanho: 10 })!, /fotos ou vídeos/)
    assert.match(validarEnvio({ tipo: 'image/png', tamanho: MAX_IMAGEM + 1 })!, /muito grande/)
  })
  test('o caminho começa SEMPRE pelo workspace da sessão; o prefixo do cliente é saneado', () => {
    const c = caminhoDeEnvio({ workspaceId: 'ws_123', tipo: 'image/jpeg', prefixo: '../outro-ws/../../x', agora: new Date(0), aleatorio: 'abc' })
    assert.deepEqual(c, { bucket: 'imagens', path: 'ws-ws_123/outro-wsx/0-abc.jpg' })
    assert.equal(caminhoDeEnvio({ workspaceId: 'w', tipo: 'video/quicktime', aleatorio: 'z', agora: new Date(0) }).path, 'ws-w/midias/0-z.mov')
    assert.equal(caminhoDeEnvio({ workspaceId: 'w', tipo: 'video/mp4' }).bucket, 'videos')
  })
  test('o navegador não escreve mais com a chave anônima direto (usa o token do servidor)', () => {
    const fonte = fs.readFileSync('lib/upload-midia.ts', 'utf8')
    assert.match(fonte, /\/api\/midias\/envio/)
    assert.match(fonte, /uploadToSignedUrl/)
    assert.doesNotMatch(fonte, /uploadFile\(/)
    assert.doesNotMatch(fs.readFileSync('app/(dashboard)/conteudos/page.tsx', 'utf8'), /uploadFile\(/)
  })
})

describe('envio de mídia no storage de TESTE', { skip: !TEM_STORAGE ? 'exige storage de TESTE' : false }, () => {
  test('anônimo direto é recusado; com o token assinado o envio funciona e a URL pública responde', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const adm = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const blob = new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' })
    const { path } = caminhoDeEnvio({ workspaceId: 'teste-r98', tipo: 'image/jpeg', prefixo: 'prova' })
    const direto = await anon.storage.from('imagens').upload(`${path}.direto`, blob, { contentType: 'image/jpeg' })
    assert.ok(direto.error, 'escrita anônima direta continua bloqueada (RLS)')
    const { criarUrlDeEnvioPrivado } = await import('../lib/supabase')
    const { token } = await criarUrlDeEnvioPrivado('imagens', path)
    try {
      const r = await anon.storage.from('imagens').uploadToSignedUrl(path, token, blob, { contentType: 'image/jpeg' })
      assert.equal(r.error, null)
      const url = anon.storage.from('imagens').getPublicUrl(path).data.publicUrl
      assert.equal((await fetch(url, { method: 'HEAD' })).status, 200)
      const reuso = await anon.storage.from('imagens').uploadToSignedUrl(path, token, blob, { contentType: 'image/jpeg' })
      assert.ok(reuso.error, 'o token não sobrescreve o arquivo (sem upsert)')
    } finally {
      await adm.storage.from('imagens').remove([path])
    }
  })
})

describe('render no Linux: a imagem nunca vai ao FFmpeg como ".img"', () => {
  test('extensão real pelos bytes (JPEG, PNG, WEBP, GIF, BMP; desconhecido = .jpg)', async () => {
    const { extensaoDaImagem } = await import('../lib/renderer-ffmpeg')
    assert.equal(extensaoDaImagem(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), '.jpg')
    assert.equal(extensaoDaImagem(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), '.png')
    assert.equal(extensaoDaImagem(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), '.webp')
    assert.equal(extensaoDaImagem(new Uint8Array([0x47, 0x49, 0x46, 0x38])), '.gif')
    assert.equal(extensaoDaImagem(new Uint8Array([0x42, 0x4d, 0, 0])), '.bmp')
    assert.equal(extensaoDaImagem(new Uint8Array([1, 2, 3])), '.jpg')
  })
  test('o render assistido renomeia toda IMAGEM antes de chamar o FFmpeg', () => {
    const fonte = fs.readFileSync('lib/renderer-ffmpeg.ts', 'utf8')
    assert.equal((fonte.match(/comExtensaoReal\(/g) ?? []).length, 3, 'definição + vídeo de 1 mídia + vídeo de várias mídias')
  })
})

describe('texto na tela sem drawtext (FFmpeg do Linux): legenda ASS com o mesmo visual', () => {
  test('ASS 1080×1920, caixa translúcida, posição e intervalo de cada cena, sem chaves nem quebra crua', async () => {
    const { legendaAss } = await import('../lib/renderer-ffmpeg')
    const ass = legendaAss([
      { texto: 'Olha essa {garrafa}', inicio: 0, fim: 2.5, posicao: 'topo' },
      { texto: 'Linha 1\nLinha 2', inicio: 2.5, fim: 6, posicao: 'rodape', tamanho: 64 },
    ])
    assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/)
    assert.match(ass, /Style: topo-58,Noto Sans,73,&H00FFFFFF,&H00FFFFFF,&H66000000,&H66000000,1,0,0,0,100,100,0,0,3,22,0,8/)
    assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:02\.50,topo-58,,0,0,0,,Olha essa garrafa/)
    assert.ok(ass.includes('Dialogue: 0,0:00:02.50,0:00:06.00,rodape-64,,0,0,0,,Linha 1' + String.fromCharCode(92) + 'NLinha 2'), 'quebra de linha vira \N')
  })
  test('a fonte livre vai junto no pacote da função de render da Netlify', () => {
    assert.match(fs.readFileSync('netlify.toml', 'utf8'), /noto-sans-v27-latin-regular\.ttf/)
    assert.ok(fs.existsSync('node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf'))
  })
})
