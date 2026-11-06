/**
 * P2.69 — dois controles críticos de publicação (com as correções da revisão independente):
 *  1. o sha256 é RECALCULADO, em fluxo, do arquivo que VAI AO AR (o narrado, na versão narrada); arquivo trocado,
 *     ilegível ou acima do limite RETÉM a publicação — e o registro manual do link passa pela mesma liberação;
 *  2. números DITOS por extenso são conferidos como VALORES com os fatos com fonte; divergência ou falta de fonte REPROVA.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sha256DoArquivoDeVideo } from '../lib/hash-do-video'
import { liberacaoParaPublicacao } from '../lib/quality-gate-conformidade'
import { liberacaoDoArquivoAPublicar } from '../lib/publicacao-assistida'
import { avaliarBarreiraProfissional, numerosPorExtenso, numerosNormalizados } from '../lib/barreira-profissional'

const bytes = Buffer.from('video-aprovado')
const SHA = createHash('sha256').update(bytes).digest('hex')
const respostaCom = (b: Buffer, status = 200, comTamanho = true) => (async () => new Response(new Uint8Array(b), { status, headers: comTamanho ? { 'content-length': String(b.length) } : {} })) as unknown as typeof fetch

describe('P2.69 — sha256 real do arquivo, em fluxo', () => {
  test('URL e arquivo local', async () => {
    assert.equal(await sha256DoArquivoDeVideo('https://x.test/v.mp4', { fetch: respostaCom(bytes) }), SHA)
    const dir = mkdtempSync(join(tmpdir(), 'hash-')); const f = join(dir, 'v.mp4'); writeFileSync(f, bytes)
    assert.equal(await sha256DoArquivoDeVideo(f), SHA)
  })
  test('acima do limite SEM content-length também é recusado (sem carregar tudo na memória)', async () => {
    await assert.rejects(sha256DoArquivoDeVideo('https://x.test/v.mp4', { fetch: respostaCom(Buffer.alloc(2048), 200, false), limiteBytes: 1024 }), /limite/)
  })
  test('inacessível, vazio ou sem caminho: erro (quem chama retém)', async () => {
    await assert.rejects(sha256DoArquivoDeVideo('https://x.test/v.mp4', { fetch: respostaCom(Buffer.from(''), 404) }))
    await assert.rejects(sha256DoArquivoDeVideo('https://x.test/v.mp4', { fetch: respostaCom(Buffer.alloc(0)) }))
    await assert.rejects(sha256DoArquivoDeVideo(''))
  })
})

describe('P2.69 — liberação sobre o arquivo que vai ao ar', () => {
  const qg = { veredito: 'APROVADO', arquivo: { sha256: SHA }, comercial: { veredito: 'APRESENTAR_A_TITULAR' }, conformidade: { veredito: 'APTO' }, barreira: { decisao: 'APTO_PARA_TITULAR', sha256: SHA } }
  /** storage em memória: `origens` = o que cada origem devolve; registra o que foi lido */
  const portas = (origens: Record<string, Buffer>, lidos: string[] = []) => { const m = new Map<string, Buffer>(); return {
    baixar: async (o: string) => { lidos.push(o); if (!origens[o]) throw new Error('404'); return origens[o] },
    subirSemSobrescrever: async (c: string, b: Buffer) => (m.has(c) ? 'JA_EXISTE' as const : (m.set(c, b), 'CRIADO' as const)),
    ler: async (c: string) => m.get(c)!,
    urlDeLeitura: async (c: string) => `https://x.test/storage/v1/object/sign/digital-twin-private/${c}?token=t`,
  } }
  test('versão padrão: hash do vídeo base; trocado = retido', async () => {
    const lidos: string[] = []
    const a = { workspaceId: 'ws1', apresentacao: { video: { arquivo: 'https://x.test/base.mp4' } }, qualityGate: qg }
    const r = await liberacaoDoArquivoAPublicar(a, portas({ 'https://x.test/base.mp4': bytes }, lidos))
    assert.equal(r.liberado, true)
    assert.equal(r.fixado?.caminho, `ws1/aprovados/${SHA}.mp4`)
    assert.deepEqual(lidos, ['https://x.test/base.mp4'])
    assert.equal((await liberacaoDoArquivoAPublicar(a, portas({ 'https://x.test/base.mp4': Buffer.from('outro') }))).liberado, false)
  })
  test('revisão A1: versão NARRADA confere o arquivo NARRADO (não o base); auditoria do base não libera o narrado', async () => {
    const lidos: string[] = []
    const a = { workspaceId: 'ws1', apresentacao: { video: { arquivo: 'https://x.test/base.mp4' }, versaoEscolhida: 'NARRADA', narracao: { videoPath: 'ws/a/video-narrado.mp4' } }, qualityGate: qg }
    const r = await liberacaoDoArquivoAPublicar(a, portas({ 'https://x.test/base.mp4': bytes, 'ws/a/video-narrado.mp4': Buffer.from('narrado') }, lidos))
    assert.deepEqual(lidos, ['ws/a/video-narrado.mp4'])
    assert.equal(r.liberado, false)
    assert.equal(r.fixado, null)
  })
  test('arquivo ilegível ou ausente: retido com o motivo', async () => {
    const r = await liberacaoDoArquivoAPublicar({ workspaceId: 'ws1', apresentacao: { video: { arquivo: 'https://x.test/v.mp4' } }, qualityGate: qg }, portas({}))
    assert.equal(r.liberado, false); assert.match(r.motivos[0], /fixar o arquivo/)
    assert.equal((await liberacaoDoArquivoAPublicar({ workspaceId: 'ws1', apresentacao: {}, qualityGate: qg }, portas({}))).liberado, false)
  })
  test('arquivo TROCADO depois da aprovação: liberação compara com o hash real', async () => {
    const trocado = await sha256DoArquivoDeVideo('https://x.test/v.mp4', { fetch: respostaCom(Buffer.from('outro-video')) })
    assert.equal(liberacaoParaPublicacao(qg, trocado).liberado, false)
  })
})

describe('P2.69 — números falados por extenso, como valores', () => {
  test('decimais, milhares e compostos', () => {
    assert.deepEqual(numerosPorExtenso('a nota é quatro vírgula nove, com mais de cinco mil vendidos'), [4.9, 5000])
    assert.deepEqual(numerosPorExtenso('são mil e seiscentos LEDs e cem mil vendidos'), [1600, 100000])
    assert.deepEqual(numerosPorExtenso('nota quatro vírgula sessenta e cinco'), [4.65])
  })
  test('revisão A5/A6: "um vírgula cento e vinte e cinco" = 1,125 (não 1125); "quatro vírgula zero cinco" = 4,05', () => {
    assert.deepEqual(numerosPorExtenso('um vírgula cento e vinte e cinco'), [1.125])
    assert.deepEqual(numerosPorExtenso('quatro vírgula zero cinco'), [4.05])
  })
  test('revisão A7: "e meio" e "dúzia"', () => {
    assert.deepEqual(numerosPorExtenso('nota quatro e meio'), [4.5])
    assert.deepEqual(numerosPorExtenso('vem com duas dúzias'), [24])
  })
  test('revisão A8: "dois anos" é afirmação (conferida); só "um/uma" isolados são linguagem comum', () => {
    assert.deepEqual(numerosPorExtenso('garantia de dois anos'), [2])
    assert.deepEqual(numerosPorExtenso('é um cordão para uma casa'), [])
  })
  test('revisão A9: pontuação separa números vizinhos', () => {
    assert.deepEqual(numerosPorExtenso('nota quatro, cinco mil vendas'), [4, 5000])
  })
  test('"+5 mil" na tela e "mais de 5 mil" no fato = 5000', () => {
    assert.deepEqual(numerosNormalizados('+5 mil'), ['5000'])
  })
  const item = (falado: string[], fatos: string[]) => avaliarBarreiraProfissional({ sha256: SHA, produtoFisico: false, midiaDoProduto: { aparece: true, direitosComprovados: true }, afirmacoes: { trechosDoVideo: falado, fatosValidados: fatos } }).itens.find((i) => i.id === 'afirmacoesVerificaveis')!.status
  test('conferido com o fato: APROVADO; divergente ou sem fonte: REPROVADO', () => {
    assert.equal(item(['nota quatro vírgula nove e mais de cinco mil vendidos'], ['nota 4,9 e mais de 5 mil vendidos (painel, 27/10/2026)']), 'APROVADO')
    assert.equal(item(['nota quatro vírgula oito'], ['nota 4,9 (painel)']), 'REPROVADO')
    assert.equal(item(['mais de dez mil vendidos'], []), 'REPROVADO')
  })
  test('revisão A5: 1,125 falado NÃO casa com "1.125 avaliações" (1125)', () => {
    assert.equal(item(['nota um vírgula cento e vinte e cinco'], ['1.125 avaliações (painel)']), 'REPROVADO')
  })
  test('revisão A10: fato escrito por extenso também vale ("cinco mil vendas")', () => {
    assert.equal(item(['5 mil vendas'], ['cinco mil vendas (painel)']), 'APROVADO')
  })
})
