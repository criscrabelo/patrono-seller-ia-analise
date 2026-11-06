/**
 * P2.117 — Narração profissional licenciada (Azure Speech, Thalita). Sem rede, sem chave real, sem custo.
 *   node node_modules/tsx/dist/cli.mjs --test tests/rodada170-p2117-voz-azure.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  VOZES_AUTORIZADAS, caracteresCobrados, chaveDeCache, configDoAmbiente, custoEstimadoUsd, montarSsml, sintetizar,
  type ConfigDaAzure, type FrasesDoRoteiro, type IdDaVoz, type PortasDaAzure,
} from '../lib/voz/provedor-azure'
import { formatoAudiovisualDa, legendaComDisclosure, DISCLOSURE_DA_VOZ_LICENCIADA, DISCLOSURE_DA_VOZ_SINTETICA, type NarracaoDaPublicacao } from '../lib/narracao'

const HD: IdDaVoz = 'pt-BR-Thalita:DragonHDLatestNeural'
const ROTEIRO: FrasesDoRoteiro[] = [
  { texto: 'Esse é o Emocionário, um dicionário ilustrado de emoções.', intencao: 'APRESENTACAO' },
  { texto: 'Aqui, as crianças podem conhecer sentimentos como ternura, gratidão, orgulho e medo.', intencao: 'DEMONSTRACAO' },
  { texto: 'Uma forma delicada de começar conversas sobre aquilo que sentimos.', intencao: 'PROPOSTA' },
  { texto: 'Se quiser conhecer, o livro está na sacolinha.', intencao: 'CTA' },
]
const CHAVE_FALSA = 'chave-falsa-de-teste-0000'
const cfg = (p: Partial<ConfigDaAzure> = {}): ConfigDaAzure => ({ ativa: true, chave: CHAVE_FALSA, regiao: 'eastus', orcamentoMensal: 100_000, ...p })
const wavFalso = () => { const b = Buffer.alloc(100); b.write('RIFF', 0, 'ascii'); return b }

function portas(o: { status?: number; uso?: number; cache?: Map<string, Buffer> } = {}) {
  const chamadas: { url: string; init: RequestInit }[] = []
  const usos: number[] = []
  const cache = o.cache ?? new Map<string, Buffer>()
  const p: PortasDaAzure = {
    fetch: (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init })
      const st = o.status ?? 200
      return new Response(st === 200 ? new Uint8Array(wavFalso()) : 'erro', { status: st })
    }) as unknown as typeof fetch,
    usoDoMes: async () => o.uso ?? 0,
    registrarUso: async (c) => { usos.push(c) },
    lerCache: async (k) => cache.get(k) ?? null,
    gravarCache: async (k, w) => { cache.set(k, w) },
  }
  return { p, chamadas, usos, cache }
}

describe('SSML', () => {
  test('roteiro aprovado vira SSML com a voz HD, pausas por intenção e sem elementos que a HD rejeita', () => {
    const s = montarSsml(ROTEIRO, { voz: HD })
    assert.match(s, /<voice name="pt-BR-Thalita:DragonHDLatestNeural">/)
    assert.equal((s.match(/<s>/g) ?? []).length, 4)
    assert.equal((s.match(/<break /g) ?? []).length, 3, 'sem pausa depois do CTA')
    assert.doesNotMatch(s, /<prosody|<emphasis|express-as|mstts:silence/)
    for (const f of ROTEIRO) assert.ok(s.includes(f.texto), `o texto aprovado entra sem alteração: ${f.texto}`)
  })
  test('fonema corrige "conversas" sem mudar o texto', () => {
    const s = montarSsml(ROTEIRO, { voz: HD, fonemas: { conversas: 'kõˈvɛʁsɐs' } })
    assert.match(s, /<phoneme alphabet="ipa" ph="kõˈvɛʁsɐs">conversas<\/phoneme>/)
    assert.equal(s.replace(/<[^>]+>/g, ''), ROTEIRO.map((f) => f.texto).join(''))
  })
  test('fonemas: uma passada só — sem aninhar, sem corromper tag, chave com apóstrofo casa', () => {
    const s1 = montarSsml([{ texto: 'Vamos começar conversas.', intencao: 'CTA' }], { voz: HD, fonemas: { 'começar conversas': 'X', conversas: 'Y' } })
    assert.equal((s1.match(/<phoneme /g) ?? []).length, 1)
    assert.match(s1, /<phoneme alphabet="ipa" ph="X">começar conversas<\/phoneme>/)
    const s2 = montarSsml([{ texto: 'A fase e o ipa.', intencao: 'CTA' }], { voz: HD, fonemas: { fase: 'ipa', ipa: 'Z' } })
    assert.match(s2, /<phoneme alphabet="ipa" ph="ipa">fase<\/phoneme> e o <phoneme alphabet="ipa" ph="Z">ipa<\/phoneme>/)
    const s3 = montarSsml([{ texto: "Livro da D'Ávila.", intencao: 'CTA' }], { voz: HD, fonemas: { "D'Ávila": 'dʒiˈavilɐ' } })
    assert.match(s3, /<phoneme alphabet="ipa" ph="dʒiˈavilɐ">D&apos;Ávila<\/phoneme>/)
  })
  test('temperatura inválida (NaN) não vai para o SSML', () => {
    assert.doesNotMatch(montarSsml(ROTEIRO, { voz: HD, temperatura: Number('abc') }), /parameters=/)
  })
  test('temperatura só na HD e limitada a 0–1; XML escapado', () => {
    assert.match(montarSsml(ROTEIRO, { voz: HD, temperatura: 3 }), /parameters="temperature=1.00"/)
    assert.doesNotMatch(montarSsml(ROTEIRO, { voz: 'pt-BR-ThalitaNeural', temperatura: 0.5 }), /parameters=/)
    assert.match(montarSsml([{ texto: 'A & B <x>', intencao: 'CTA' }], { voz: HD }), /A &amp; B &lt;x&gt;/)
  })
  test('voz fora da lista autorizada é recusada (nunca a voz da titular)', () => {
    assert.throws(() => montarSsml(ROTEIRO, { voz: 'pt-BR-VozDaTitular' as IdDaVoz }), /fora da lista autorizada/)
    assert.equal(Object.values(VOZES_AUTORIZADAS).every((v) => v.provedor === 'AZURE'), true)
  })
  test('caracteres cobrados ≈ texto falado; custo por vídeo bem abaixo de 1 centavo de dólar', () => {
    const s = montarSsml(ROTEIRO, { voz: HD })
    const c = caracteresCobrados(s)
    assert.ok(c > ROTEIRO.map((f) => f.texto).join('').length, 'as tags dentro de <voice> também são cobradas')
    assert.equal(c, s.slice(s.indexOf('>', s.indexOf('<voice')) + 1, s.indexOf('</voice>')).length)
    assert.ok(custoEstimadoUsd(c, true) < 0.01)
    assert.ok(custoEstimadoUsd(c, true) > custoEstimadoUsd(c, false))
  })
})

describe('síntese (fetch falso)', () => {
  const ssml = montarSsml(ROTEIRO, { voz: HD })
  test('desligada por padrão: nenhuma chamada de rede', async () => {
    const { p, chamadas } = portas()
    const r = await sintetizar(ssml, HD, cfg({ ativa: false }), p)
    assert.equal(r.ok, false); assert.equal(chamadas.length, 0)
    assert.equal(configDoAmbiente({}).ativa, false)
  })
  test('sem chave ou região: recusa sem rede', async () => {
    const { p, chamadas } = portas()
    assert.equal((await sintetizar(ssml, HD, cfg({ chave: null }), p)).ok, false)
    assert.equal((await sintetizar(ssml, HD, cfg({ regiao: null }), p)).ok, false)
    assert.equal(chamadas.length, 0)
  })
  test('HD em brazilsouth: recusa antes de chamar (região sem HD)', async () => {
    const { p, chamadas } = portas()
    const r = await sintetizar(ssml, HD, cfg({ regiao: 'brazilsouth' }), p)
    assert.equal(r.ok, false); assert.match((r as { motivo: string }).motivo, /não oferece vozes HD/)
    assert.equal(chamadas.length, 0)
  })
  test('orçamento mensal travado: recusa antes de chamar', async () => {
    const { p, chamadas } = portas({ uso: 99_990 })
    const r = await sintetizar(ssml, HD, cfg(), p)
    assert.equal(r.ok, false); assert.match((r as { motivo: string }).motivo, /Orçamento/)
    assert.equal(chamadas.length, 0)
  })
  test('sucesso: endpoint da região, chave só no cabeçalho, uso registrado, cache gravado', async () => {
    const { p, chamadas, usos, cache } = portas()
    const r = await sintetizar(ssml, HD, cfg(), p)
    assert.equal(r.ok, true)
    assert.equal(chamadas.length, 1)
    assert.equal(chamadas[0].url, 'https://eastus.tts.speech.microsoft.com/cognitiveservices/v1')
    const h = chamadas[0].init.headers as Record<string, string>
    assert.equal(h['Ocp-Apim-Subscription-Key'], CHAVE_FALSA)
    assert.equal(String(chamadas[0].init.body).includes(CHAVE_FALSA), false)
    assert.equal(usos.length, 1)
    assert.ok(cache.has(chaveDeCache(HD, ssml)))
    assert.equal(JSON.stringify(r).includes(CHAVE_FALSA), false, 'a chave nunca volta no resultado')
  })
  test('cache: a mesma narração não é paga duas vezes (nem com a flag desligada)', async () => {
    const cache = new Map<string, Buffer>([[chaveDeCache(HD, ssml), wavFalso()]])
    const { p, chamadas } = portas({ cache })
    const r = await sintetizar(ssml, HD, cfg({ ativa: false }), p)
    assert.equal(r.ok, true); assert.equal((r as { doCache: boolean }).doCache, true)
    assert.equal(chamadas.length, 0)
  })
  test('erros da Azure viram motivo em português, sem a chave', async () => {
    for (const [st, re] of [[401, /chave/], [400, /HD pode não estar disponível/], [429, /Limite/]] as const) {
      const { p, usos } = portas({ status: st })
      const r = await sintetizar(ssml, HD, cfg(), p)
      assert.equal(r.ok, false); assert.match((r as { motivo: string }).motivo, re)
      assert.equal(JSON.stringify(r).includes(CHAVE_FALSA), false)
      assert.equal(usos.length, 0, 'falha não conta no orçamento')
    }
  })
})

describe('modo VOZ_PROFISSIONAL_LICENCIADA na narração', () => {
  const n = { modo: 'VOZ_PROFISSIONAL_LICENCIADA' } as NarracaoDaPublicacao
  test('formato próprio e aviso de IA sem dizer "minha própria voz"', () => {
    assert.equal(formatoAudiovisualDa('NARRADA', n), 'NARRACAO_VOZ_LICENCIADA')
    const l = legendaComDisclosure('Olha que livro lindo #publi', 'NARRACAO_VOZ_LICENCIADA')
    assert.ok(l.endsWith(DISCLOSURE_DA_VOZ_LICENCIADA))
    assert.equal(l.includes(DISCLOSURE_DA_VOZ_SINTETICA), false)
    assert.equal(legendaComDisclosure(l, 'NARRACAO_VOZ_LICENCIADA'), l, 'não duplica')
  })
  test('modos antigos inalterados', () => {
    assert.equal(formatoAudiovisualDa('NARRADA', { modo: 'VOZ_LOCAL' } as NarracaoDaPublicacao), 'NARRACAO_VOZ_LOCAL')
    assert.equal(formatoAudiovisualDa('NARRADA', { modo: 'GRAVACAO_REAL' } as NarracaoDaPublicacao), 'NARRACAO_GRAVADA')
    assert.ok(legendaComDisclosure('x', 'NARRACAO_VOZ_LOCAL').endsWith(DISCLOSURE_DA_VOZ_SINTETICA))
    assert.equal(legendaComDisclosure('x', 'NARRACAO_GRAVADA'), 'x')
  })
})
