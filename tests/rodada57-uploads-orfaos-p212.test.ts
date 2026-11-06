/**
 * Rodada 57 — P2.12: fechamento do upload direto do avatar.
 *
 *   1. Limite de 50 MB no bucket `digital-twin-private` (coerente com o
 *      maior limite por tipo).
 *   2. Limpeza dos uploads enviados e nunca confirmados (órfãos): ensaio por
 *      padrão, execução só com interruptor, por workspace, idempotente,
 *      sem apagar confirmado, recente ou confirmação em andamento.
 *
 * A parte de INTEGRAÇÃO roda contra o banco e o storage de TESTE e só roda
 * se souber qual é o projeto de produção, para provar que não está nele:
 *
 *   PATRONO_REF_DO_BANCO_DE_PRODUCAO=<ref> node --env-file="$LOCALAPPDATA/PatronoSeller/teste/.env.digital-twin-test" \
 *     node_modules/tsx/dist/cli.mjs --test tests/rodada57-uploads-orfaos-p212.test.ts
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { NextRequest } from 'next/server'
import { LIMITES_DO_UPLOAD_DIRETO, LIMITE_DO_BUCKET_BYTES, VALIDADE_DA_INTENCAO_MS } from '../lib/digital-twin-upload-direto'
import {
  MAXIMO_DE_EXCLUSOES_POR_EXECUCAO,
  PRAZO_MINIMO_HORAS,
  PRAZO_PADRAO_HORAS,
  VALIDADE_DO_TOKEN_DE_ENVIO_MS,
  carimboDoCaminho,
  classificarObjeto,
  decidirModo,
  executarLimpeza,
  lerPrazoHoras,
  type ObjetoDoBucket,
  type PortaDaLimpeza,
} from '../lib/limpeza-uploads-orfaos'

const RAIZ = join(__dirname, '..')
const MB = 1024 * 1024
const HORA = 60 * 60_000
const AGORA = new Date('2026-10-03T12:00:00Z')

function lerCodigo(rel: string): string {
  return readFileSync(join(RAIZ, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

// ── Porta em memória ─────────────────────────────────────────────────────

const WS_A = 'cwsaaaaaaaaaaaaaaaaaaaaaa'
const PF_A = 'cpfaaaaaaaaaaaaaaaaaaaaaa'
const WS_B = 'cwsbbbbbbbbbbbbbbbbbbbbbb'
const PF_B = 'cpfbbbbbbbbbbbbbbbbbbbbbb'

const caminho = (ws: string, pf: string, tipo: string, ts: number, hex = 'a1b2c3d4e5f6') => `${ws}/${pf}/${tipo}-${ts}-${hex}`
const objeto = (nome: string, criadoEm: Date | null, tamanho = 1000): ObjetoDoBucket => ({ nome, criadoEm, atualizadoEm: criadoEm, tamanho })

class PortaFalsa implements PortaDaLimpeza {
  objetos = new Map<string, ObjetoDoBucket>()
  registrados = new Set<string>()
  apagadosLog: string[] = []
  falharListagemDe = new Set<string>()
  /** Executa entre a listagem e a segunda consulta (simula a confirmação chegando). */
  antesDaSegundaConsulta?: () => void
  consultas = 0
  exclusividade?: PortaDaLimpeza['exclusividade']
  perfis = [
    { workspaceId: WS_A, profileId: PF_A },
    { workspaceId: WS_B, profileId: PF_B },
  ]
  add(o: ObjetoDoBucket) {
    this.objetos.set(o.nome, o)
    return o.nome
  }
  async listarPerfis(ws?: string) {
    return this.perfis.filter((p) => !ws || p.workspaceId === ws)
  }
  async listarObjetos(ws: string, pf: string) {
    if (this.falharListagemDe.has(ws)) throw new Error('storage fora')
    return [...this.objetos.values()].filter((o) => o.nome.startsWith(`${ws}/${pf}/`))
  }
  async caminhosRegistrados(c: string[]) {
    if (++this.consultas === 2 && this.antesDaSegundaConsulta) this.antesDaSegundaConsulta()
    return new Set(c.filter((x) => this.registrados.has(x)))
  }
  async apagar(c: string[]) {
    const feitos = c.filter((x) => this.objetos.delete(x))
    this.apagadosLog.push(...feitos)
    return feitos
  }
}

/** Cenário padrão: em A, um de cada; em B, um órfão antigo. */
function cenario() {
  const p = new PortaFalsa()
  const velho = AGORA.getTime() - 48 * HORA
  const confirmado = p.add(objeto(caminho(WS_A, PF_A, 'face_image', velho, '111111111111'), new Date(velho)))
  p.registrados.add(confirmado)
  const recente = p.add(objeto(caminho(WS_A, PF_A, 'reference_video', AGORA.getTime() - HORA, '222222222222'), new Date(AGORA.getTime() - HORA)))
  const orfao = p.add(objeto(caminho(WS_A, PF_A, 'voice_reference', velho, '333333333333'), new Date(velho), 2048))
  const foraDoPadrao = p.add(objeto(`${WS_A}/${PF_A}/consentimento.pdf`, new Date(velho)))
  const orfaoB = p.add(objeto(caminho(WS_B, PF_B, 'face_image', velho, '444444444444'), new Date(velho)))
  return { p, confirmado, recente, orfao, foraDoPadrao, orfaoB }
}

const rodar = (p: PortaFalsa, extra: Partial<Parameters<typeof executarLimpeza>[0]> = {}) =>
  executarLimpeza({ porta: p, agora: AGORA, prazoHoras: PRAZO_PADRAO_HORAS, modo: 'ensaio', ...extra })

// ── 1. Prazo, modo e padrão do caminho ───────────────────────────────────

describe('1. Prazo seguro e interruptor', () => {
  test('prazo padrão 24 h; mínimo acima do token de envio (2 h) e da intenção (10 min)', () => {
    assert.equal(PRAZO_PADRAO_HORAS, 24)
    assert.ok(PRAZO_MINIMO_HORAS * HORA > VALIDADE_DO_TOKEN_DE_ENVIO_MS + VALIDADE_DA_INTENCAO_MS)
    assert.equal(lerPrazoHoras({}), 24)
    assert.equal(lerPrazoHoras({ UPLOADS_ORFAOS_PRAZO_HORAS: '48' }), 48)
    for (const v of ['1', '2', '0', '-5', '2.5', 'abc', '99999']) assert.equal(lerPrazoHoras({ UPLOADS_ORFAOS_PRAZO_HORAS: v }), 24, v)
  })

  test('execução real só com o pedido E o interruptor; o resto é ensaio', () => {
    assert.equal(decidirModo('execucao', { LIMPEZA_UPLOADS_ORFAOS_ATIVA: 'true' }).modo, 'execucao')
    assert.equal(decidirModo('execucao', {}).modo, 'ensaio')
    assert.equal(decidirModo('execucao', { LIMPEZA_UPLOADS_ORFAOS_ATIVA: '1' }).modo, 'ensaio')
    assert.equal(decidirModo('execucao', { LIMPEZA_UPLOADS_ORFAOS_ATIVA: 'TRUE' }).modo, 'ensaio')
    assert.equal(decidirModo(null, { LIMPEZA_UPLOADS_ORFAOS_ATIVA: 'true' }).modo, 'ensaio')
    assert.equal(decidirModo('ensaio', { LIMPEZA_UPLOADS_ORFAOS_ATIVA: 'true' }).modo, 'ensaio')
  })

  test('padrão do caminho: só o do upload direto, deste workspace e deste perfil', () => {
    const ts = AGORA.getTime()
    assert.equal(carimboDoCaminho(caminho(WS_A, PF_A, 'face_image', ts), WS_A, PF_A), ts)
    assert.equal(carimboDoCaminho(caminho(WS_A, PF_A, 'face_image', ts), WS_B, PF_B), null, 'outro workspace')
    assert.equal(carimboDoCaminho(caminho(WS_A, PF_A, 'face_image', ts), WS_A, PF_B), null, 'outro perfil')
    for (const nome of [
      `previews/${PF_A}/talking_head-${ts}-abc123`,
      caminho(WS_A, PF_A, 'consent_evidence', ts),
      caminho(WS_A, PF_A, 'generated_preview', ts),
      `${WS_A}/${PF_A}/face_image-${ts}-a1b2c3d4e5f6.png`,
      `${WS_A}/${PF_A}/sub/face_image-${ts}-a1b2c3d4e5f6`,
      `${WS_A}/${PF_A}/face_image-123-a1b2c3d4e5f6`,
      `${WS_A}/${PF_A}/`,
    ]) assert.equal(carimboDoCaminho(nome, WS_A, PF_A), null, nome)
    assert.equal(carimboDoCaminho(caminho('', PF_A, 'face_image', ts), '', PF_A), null)
  })
})

describe('1. Classificação de cada objeto', () => {
  const ctx = (registrados: string[] = []) => ({ workspaceId: WS_A, profileId: PF_A, registrados: new Set(registrados), agora: AGORA, prazoHoras: 24 })
  const velho = AGORA.getTime() - 48 * HORA

  test('confirmado nunca entra, por mais antigo que seja', () => {
    const n = caminho(WS_A, PF_A, 'face_image', velho - 365 * 24 * HORA)
    assert.equal(classificarObjeto(objeto(n, new Date(velho)), ctx([n])), 'confirmado')
  })

  test('recente não confirmado é preservado (pelo caminho e pelas datas do storage)', () => {
    const recente = AGORA.getTime() - 23 * HORA
    assert.equal(classificarObjeto(objeto(caminho(WS_A, PF_A, 'face_image', recente), new Date(recente)), ctx()), 'recente')
    // Caminho velho, mas o objeto chegou há pouco (token de envio usado tarde): conta a data mais nova.
    assert.equal(classificarObjeto(objeto(caminho(WS_A, PF_A, 'face_image', velho), new Date(AGORA.getTime() - HORA)), ctx()), 'recente')
    const o = { ...objeto(caminho(WS_A, PF_A, 'face_image', velho), new Date(velho)), atualizadoEm: new Date(AGORA.getTime() - HORA) }
    assert.equal(classificarObjeto(o, ctx()), 'recente')
  })

  test('órfão antigo é elegível', () => {
    assert.equal(classificarObjeto(objeto(caminho(WS_A, PF_A, 'reference_video', velho), new Date(velho)), ctx()), 'elegivel')
  })

  test('sem data no storage ou carimbo no futuro: preservado', () => {
    assert.equal(classificarObjeto(objeto(caminho(WS_A, PF_A, 'face_image', velho), null), ctx()), 'recente')
    assert.equal(classificarObjeto(objeto(caminho(WS_A, PF_A, 'face_image', AGORA.getTime() + HORA), new Date(velho)), ctx()), 'recente')
  })

  test('fora do padrão (prévia, consentimento, outro nome) nunca é elegível', () => {
    assert.equal(classificarObjeto(objeto(`${WS_A}/${PF_A}/consentimento.pdf`, new Date(velho)), ctx()), 'fora-do-padrao')
    assert.equal(classificarObjeto(objeto(caminho(WS_A, PF_A, 'consent_evidence', velho), new Date(velho)), ctx()), 'fora-do-padrao')
  })

  test('nada dentro da janela de confirmação é elegível, mesmo com prazo forçado para baixo', () => {
    const dentro = AGORA.getTime() - (VALIDADE_DA_INTENCAO_MS + VALIDADE_DO_TOKEN_DE_ENVIO_MS)
    for (const prazoHoras of [0, 1, 2, 3]) {
      const c = { ...ctx(), prazoHoras }
      assert.equal(classificarObjeto(objeto(caminho(WS_A, PF_A, 'face_image', dentro), new Date(dentro)), c), 'recente', `prazo ${prazoHoras}`)
      assert.equal(classificarObjeto(objeto(caminho(WS_A, PF_A, 'face_image', AGORA.getTime() - VALIDADE_DA_INTENCAO_MS / 2), new Date(AGORA.getTime() - 1000)), c), 'recente')
    }
  })
})

// ── 2. Execução com porta em memória ─────────────────────────────────────

describe('2. Ensaio, execução, workspaces e repetição', () => {
  test('ensaio (padrão) não apaga nada e relata por workspace', async () => {
    const { p } = cenario()
    const r = await rodar(p)
    assert.equal(r.modo, 'ensaio')
    assert.equal(p.apagadosLog.length, 0)
    assert.equal(p.objetos.size, 5)
    const a = r.workspaces.find((w) => w.workspaceId === WS_A)!
    assert.deepEqual(
      { vistos: a.objetosVistos, confirmados: a.confirmados, recentes: a.recentes, fora: a.foraDoPadrao, elegiveis: a.elegiveis, bytes: a.bytesElegiveis, apagados: a.apagados },
      { vistos: 4, confirmados: 1, recentes: 1, fora: 1, elegiveis: 1, bytes: 2048, apagados: 0 }
    )
    assert.equal(r.totais.elegiveis, 2)
  })

  test('execução apaga SOMENTE o órfão elegível', async () => {
    const { p, confirmado, recente, orfao, foraDoPadrao, orfaoB } = cenario()
    const r = await rodar(p, { modo: 'execucao' })
    assert.deepEqual(p.apagadosLog.sort(), [orfao, orfaoB].sort())
    for (const fica of [confirmado, recente, foraDoPadrao]) assert.ok(p.objetos.has(fica), 'preservado')
    assert.equal(r.totais.apagados, 2)
  })

  test('restrita a um workspace: o outro permanece intacto', async () => {
    const { p, orfao, orfaoB } = cenario()
    const r = await rodar(p, { modo: 'execucao', workspaceId: WS_A })
    assert.deepEqual(p.apagadosLog, [orfao])
    assert.ok(p.objetos.has(orfaoB))
    assert.deepEqual(r.workspaces.map((w) => w.workspaceId), [WS_A])
  })

  test('arquivo registrado por OUTRO workspace também é preservado', async () => {
    const { p, orfaoB } = cenario()
    p.registrados.add(orfaoB) // asset de qualquer workspace preserva
    await rodar(p, { modo: 'execucao' })
    assert.ok(p.objetos.has(orfaoB))
  })

  test('falha ao listar um workspace: nada dele é apagado, os outros seguem', async () => {
    const { p, orfao, orfaoB } = cenario()
    p.falharListagemDe.add(WS_B)
    const r = await rodar(p, { modo: 'execucao' })
    assert.deepEqual(p.apagadosLog, [orfao])
    assert.ok(p.objetos.has(orfaoB))
    assert.equal(r.workspaces.find((w) => w.workspaceId === WS_B)!.falha, 'listagem')
    assert.equal(r.totais.workspacesComFalha, 1)
  })

  test('falha ao consultar os registros: nada é apagado (fail-closed)', async () => {
    const { p } = cenario()
    p.caminhosRegistrados = async () => {
      throw new Error('banco fora')
    }
    const r = await rodar(p, { modo: 'execucao' })
    assert.equal(p.apagadosLog.length, 0)
    assert.ok(r.workspaces.every((w) => w.falha === 'registro'))
  })

  test('repetir não muda nada (idempotente)', async () => {
    const { p } = cenario()
    await rodar(p, { modo: 'execucao' })
    const restantes = [...p.objetos.keys()].sort()
    const r2 = await rodar(p, { modo: 'execucao' })
    assert.equal(r2.totais.apagados, 0)
    assert.equal(r2.totais.elegiveis, 0)
    assert.deepEqual([...p.objetos.keys()].sort(), restantes)
  })

  test('confirmação chegando entre a listagem e a exclusão: o objeto fica', async () => {
    const { p, orfao } = cenario()
    const soA = { modo: 'execucao' as const, workspaceId: WS_A }
    p.antesDaSegundaConsulta = () => p.registrados.add(orfao)
    const r = await rodar(p, soA)
    assert.ok(p.objetos.has(orfao))
    assert.equal(r.totais.apagados, 0)
    assert.equal(r.totais.elegiveis, 1, 'era elegível na listagem')
  })

  test('disparo simultâneo: só uma execução real por vez; a outra não faz nada', async () => {
    const { p, orfao, orfaoB } = cenario()
    let ocupada = false
    p.exclusividade = async <T,>(fn: () => Promise<T>) => {
      if (ocupada) return { executou: false as const }
      ocupada = true
      try {
        return { executou: true as const, valor: await fn() }
      } finally {
        ocupada = false
      }
    }
    const [r1, r2] = await Promise.all([rodar(p, { modo: 'execucao' }), rodar(p, { modo: 'execucao' })])
    assert.equal(r1.totais.apagados + r2.totais.apagados, 2)
    assert.equal([r1, r2].filter((r) => r.outraExecucaoEmAndamento).length, 1)
    assert.deepEqual(p.apagadosLog.sort(), [orfao, orfaoB].sort())
    // Ensaio não precisa da trava: roda mesmo com outra execução em andamento.
    ocupada = true
    assert.equal((await rodar(p)).outraExecucaoEmAndamento, undefined)
  })

  test('teto de exclusões por execução: o resto fica para a próxima', async () => {
    const p = new PortaFalsa()
    const velho = AGORA.getTime() - 48 * HORA
    for (let i = 0; i < 5; i++) p.add(objeto(caminho(WS_A, PF_A, 'face_image', velho, `00000000000${i}`), new Date(velho)))
    const r = await rodar(p, { modo: 'execucao', maximoDeExclusoes: 3 })
    assert.equal(r.totais.apagados, 3)
    assert.equal(r.limiteDeExclusoesAtingido, true)
    const r2 = await rodar(p, { modo: 'execucao', maximoDeExclusoes: 3 })
    assert.equal(r2.totais.apagados, 2)
    assert.ok(MAXIMO_DE_EXCLUSOES_POR_EXECUCAO > 0)
  })

  test('relatório sem nome de arquivo nem caminho', async () => {
    const { p, confirmado, recente, orfao, foraDoPadrao, orfaoB } = cenario()
    const texto = JSON.stringify(await rodar(p, { modo: 'execucao' }))
    for (const n of [confirmado, recente, orfao, foraDoPadrao, orfaoB]) {
      assert.ok(!texto.includes(n), 'caminho no relatório')
      assert.ok(!texto.includes(n.split('/').pop()!), 'nome de arquivo no relatório')
    }
    assert.ok(!texto.includes(PF_A), 'id do perfil no relatório')
  })
})

// ── 3. Limite do bucket ──────────────────────────────────────────────────

describe('3. Limite de tamanho coerente com 50 MB', () => {
  test('LIMITE_DO_BUCKET_BYTES = 50 MB = maior limite por tipo (vídeo)', () => {
    assert.equal(LIMITE_DO_BUCKET_BYTES, 50 * MB)
    assert.equal(LIMITES_DO_UPLOAD_DIRETO.REFERENCE_VIDEO.maximoBytes, LIMITE_DO_BUCKET_BYTES)
    for (const l of Object.values(LIMITES_DO_UPLOAD_DIRETO)) assert.ok(l.maximoBytes <= LIMITE_DO_BUCKET_BYTES)
  })

  test('o script de go-live aplica exatamente esse valor, mantém privado e recusa produção sem confirmação', () => {
    const s = lerCodigo('scripts/limite-bucket-digital-twin.mjs')
    assert.match(s, /const LIMITE_BYTES = 52428800\b/)
    assert.equal(52428800, LIMITE_DO_BUCKET_BYTES)
    assert.match(s, /public: false/)
    assert.match(s, /--confirmo-producao/)
    assert.match(s, /refProd\.length < 8\) sair\(/)
    assert.ok(!/process\.exit\(/.test(s))
  })
})

// ── 4. Rota e agendamento ────────────────────────────────────────────────

describe('4. Rota, Scheduled Function e workflow', () => {
  test('rota: segredo, agendador declarado, fail-closed, ensaio por padrão — nessa ordem', () => {
    const s = lerCodigo('app/api/cron/limpar-uploads-orfaos/route.ts')
    const ordem = ['autorizacaoDeRotinaValida(', 'chamadaDoAgendadorDeclarado(req.headers)', 'uploadDiretoConfigurado()', 'decidirModo(', 'executarLimpeza(']
    let ultimo = -1
    for (const marco of ordem) {
      const i = s.indexOf(marco)
      assert.ok(i > ultimo, `${marco} fora de ordem`)
      ultimo = i
    }
    assert.match(s, /status: 503/)
    assert.ok(!/LIMPEZA_UPLOADS_ORFAOS_ATIVA/.test(s), 'o interruptor só é lido em decidirModo')
  })

  test('Scheduled Function diária, desligada por padrão (sujeita ao agendador, à lista e ao interruptor)', async () => {
    const fn = readFileSync(join(RAIZ, 'netlify/functions/rotina-limpar-uploads-orfaos.ts'), 'utf8')
    assert.match(fn, /schedule: '30 4 \* \* \*'/)
    assert.match(fn, /dispararRotina\('limpar-uploads-orfaos', contexto, process\.env, fetch, '\?modo=execucao'\)/)

    const { dispararRotina } = await import('../netlify/rotina-interna')
    const urls: string[] = []
    const enviar = (async (url: string) => { urls.push(url); return new Response('{}') }) as unknown as typeof fetch
    const ctx = { site: { url: 'https://x.test' } }
    assert.equal((await dispararRotina('limpar-uploads-orfaos', ctx, {}, enviar, '?modo=execucao')).disparou, false, 'sem agendador')
    assert.equal((await dispararRotina('limpar-uploads-orfaos', ctx, { AGENDADOR_DOS_CRONS: 'netlify', CRON_SECRET: 's', ROTINAS_NETLIFY_LIGADAS: 'expurgar-tarefas' }, enviar, '?modo=execucao')).disparou, false, 'fora da lista')
    assert.equal((await dispararRotina('limpar-uploads-orfaos', ctx, { AGENDADOR_DOS_CRONS: 'netlify', CRON_SECRET: 's', ROTINAS_NETLIFY_LIGADAS: 'limpar-uploads-orfaos' }, enviar, '?modo=execucao')).disparou, true)
    assert.deepEqual(urls, ['https://x.test/api/cron/limpar-uploads-orfaos?modo=execucao'])
  })

  test('workflow do GitHub: 04:30 UTC (igual à Netlify), disparo manual com ensaio padrão', () => {
    const wf = readFileSync(join(RAIZ, '.github/workflows/patrono-crons.yml'), 'utf8')
    assert.match(wf, /- cron: '30 4 \* \* \*'/)
    assert.match(wf, /AGENDA: \$\{\{ github\.event\.schedule \}\}/)
    assert.match(wf, /elif \[ "\$\{AGENDA\}" = "30 4 \* \* \*" \]; then\n(?:\s*#.*\n)*\s*chamar "limpar-uploads-orfaos" "\?modo=execucao"/)
    assert.ok(!/hora\}" = "0?4" \]; then chamar "limpar-uploads-orfaos"/.test(wf), 'não chama mais às 04:00')
    assert.match(wf, /--header "x-patrono-agendador: github"/)
    assert.match(wf, /- limpar-uploads-orfaos/)
    assert.match(wf, /DISPATCH_ALVO\}" = "limpar-uploads-orfaos" \]; \} && \[ "\$\{DISPATCH_MODO\}" = "operacao" \]/)
    const fn = readFileSync(join(RAIZ, 'netlify/functions/rotina-limpar-uploads-orfaos.ts'), 'utf8')
    assert.match(fn, /schedule: '30 4 \* \* \*'/, 'mesmo horário nos dois')
  })

  test('a limpeza nunca lê nem transfere conteúdo de arquivo', () => {
    for (const rel of ['lib/limpeza-uploads-orfaos.ts', 'lib/limpeza-uploads-orfaos-porta.ts', 'app/api/cron/limpar-uploads-orfaos/route.ts']) {
      const s = lerCodigo(rel)
      assert.ok(!/download\(|criarUrlAssinada|createSignedUrl|arrayBuffer\(|formData\(|uploadBuffer/.test(s), rel)
    }
  })
})

// ── 4b. Um agendador por vez (regra estrita desta rotina) ────────────────

describe('4b. Só o agendador declarado em AGENDADOR_DOS_CRONS dispara', () => {
  const cab = (agendador?: string) => ({ get: (n: string) => (n === 'x-patrono-agendador' ? agendador ?? null : null) })

  test('1. AGENDADOR_DOS_CRONS=netlify: chamada do GitHub (ou sem origem) é recusada', async () => {
    const { chamadaDoAgendadorDeclarado } = await import('../lib/agendador')
    const env = { AGENDADOR_DOS_CRONS: 'netlify' }
    assert.equal(chamadaDoAgendadorDeclarado(cab('github'), env).ok, false)
    assert.equal(chamadaDoAgendadorDeclarado(cab(), env).ok, false)
    assert.equal(chamadaDoAgendadorDeclarado(cab('netlify'), env).ok, true)
  })

  test('2. AGENDADOR_DOS_CRONS=github: a Netlify é recusada — na função e na rota', async () => {
    const { chamadaDoAgendadorDeclarado } = await import('../lib/agendador')
    const env = { AGENDADOR_DOS_CRONS: 'github' }
    assert.equal(chamadaDoAgendadorDeclarado(cab('netlify'), env).ok, false)
    assert.equal(chamadaDoAgendadorDeclarado(cab(), env).ok, false)
    assert.equal(chamadaDoAgendadorDeclarado(cab('github'), env).ok, true)

    const { dispararRotina } = await import('../netlify/rotina-interna')
    let chamadas = 0
    const enviar = (async () => { chamadas++; return new Response('{}') }) as unknown as typeof fetch
    const r = await dispararRotina('limpar-uploads-orfaos', { site: { url: 'https://x.test' } }, { ...env, CRON_SECRET: 's' }, enviar, '?modo=execucao')
    assert.equal(r.disparou, false)
    assert.equal(chamadas, 0, 'a Scheduled Function nem chama a rota')
  })

  test('3. sem agendador declarado (ou valor inválido): ambos falham fechado', async () => {
    const { chamadaDoAgendadorDeclarado } = await import('../lib/agendador')
    for (const env of [{}, { AGENDADOR_DOS_CRONS: '' }, { AGENDADOR_DOS_CRONS: 'GITHUB' }, { AGENDADOR_DOS_CRONS: 'vercel' }, { AGENDADOR_DOS_CRONS: 'github,netlify' }]) {
      for (const origem of ['github', 'netlify', undefined]) {
        assert.equal(chamadaDoAgendadorDeclarado(cab(origem), env).ok, false, `${JSON.stringify(env)} / ${origem}`)
      }
    }
    const { dispararRotina } = await import('../netlify/rotina-interna')
    let chamadas = 0
    const enviar = (async () => { chamadas++; return new Response('{}') }) as unknown as typeof fetch
    assert.equal((await dispararRotina('limpar-uploads-orfaos', { site: { url: 'https://x.test' } }, { CRON_SECRET: 's' }, enviar, '?modo=execucao')).disparou, false)
    assert.equal(chamadas, 0)
  })

  test('a regra geral das outras rotas não mudou (ausente = GitHub aceito)', async () => {
    const { chamadaDeOutroAgendador } = await import('../lib/agendador')
    assert.equal(chamadaDeOutroAgendador(cab(), {}), false)
    assert.equal(chamadaDeOutroAgendador(cab('github'), {}), false)
    assert.equal(chamadaDeOutroAgendador(cab('github'), { AGENDADOR_DOS_CRONS: 'netlify' }), true)
  })
})

// ── 4c. O despachante do GitHub, executado de verdade (curl e date falsos) ─

const BASH = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash'
const SEM_BASH = existsSync(BASH) ? false : `bash não encontrado em ${BASH}`

describe('4c. Workflow do GitHub executado com curl falso', { skip: SEM_BASH }, () => {
  /** O bloco `run: |` do passo, sem a indentação do YAML. */
  function scriptDoWorkflow(): string {
    const linhas = readFileSync(join(RAIZ, '.github/workflows/patrono-crons.yml'), 'utf8').replace(/\r\n/g, '\n').split('\n')
    const i = linhas.findIndex((l) => /^\s+run: \|$/.test(l))
    const corpo: string[] = []
    for (const l of linhas.slice(i + 1)) {
      if (l.trim() && !l.startsWith(' '.repeat(10))) break
      corpo.push(l.slice(10))
    }
    return corpo.join('\n')
  }

  function rodarWorkflow(opcoes: { agenda?: string; evento?: string; hora?: string; alvo?: string; modo?: string; codigoDaLimpeza?: string }) {
    const dir = mkdtempSync(join(tmpdir(), 'r57-wf-'))
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    // Caminhos no formato do bash (C:/x → /c/x): o ':' do drive quebraria o PATH.
    const posix = (c: string) => c.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`)
    const log = join(dir, 'chamadas.log')
    // curl falso: registra URL e cabeçalhos; devolve 200, ou o código pedido para a limpeza.
    writeFileSync(
      join(bin, 'curl'),
      `#!/bin/bash\nurl="\${@: -1}"; hs=""; prev=""\nfor a in "$@"; do if [ "$prev" = "--header" ]; then hs="$hs|$a"; fi; prev="$a"; done\necho "$url $hs" >> "${posix(log)}"\ncase "$url" in *limpar-uploads-orfaos*) printf '%s' "${opcoes.codigoDaLimpeza ?? '200'}";; *) printf 200;; esac\n`,
      { mode: 0o755 } // no Linux, arquivo sem permissão de execução é ignorado no PATH (e o curl de verdade seria chamado)
    )
    writeFileSync(join(bin, 'date'), `#!/bin/bash\necho ${opcoes.hora ?? '07'}\n`, { mode: 0o755 })
    const script = join(dir, 'run.sh')
    // O bash do Git para Windows reescreve o PATH ao iniciar: os falsos entram na frente dentro do script.
    writeFileSync(script, `export PATH="${posix(bin)}:$PATH"
${scriptDoWorkflow()}`)
    const r = spawnSync(BASH, [posix(script)], {
      encoding: 'utf8',
      env: {
        PATH: `${posix(bin)}:/usr/bin:/bin`,
        CRON_SECRET: 'segredo-falso',
        BASE_URL: 'https://app.invalido',
        PUBLICAR_ATIVO: '',
        DISPATCH_ALVO: opcoes.alvo ?? '',
        DISPATCH_MODO: opcoes.modo ?? '',
        AGENDA: opcoes.agenda ?? '',
        GITHUB_EVENT_NAME: opcoes.evento ?? 'schedule',
      } as unknown as NodeJS.ProcessEnv,
    })
    const chamadas = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []
    rmSync(dir, { recursive: true, force: true })
    return { status: r.status, chamadas, saida: `${r.stdout}${r.stderr}` }
  }

  test('agenda das 04:30: chama SÓ a limpeza, com execução pedida e origem github', () => {
    const r = rodarWorkflow({ agenda: '30 4 * * *', hora: '04' })
    assert.equal(r.status, 0, r.saida)
    assert.equal(r.chamadas.length, 1, r.chamadas.join('\n'))
    assert.match(r.chamadas[0], /^https:\/\/app\.invalido\/api\/cron\/limpar-uploads-orfaos\?modo=execucao /)
    assert.match(r.chamadas[0], /\|x-patrono-agendador: github/)
  })

  test('agenda de hora em hora às 04:00: expurgo sim, limpeza não', () => {
    const r = rodarWorkflow({ agenda: '0 * * * *', hora: '04' })
    assert.equal(r.status, 0, r.saida)
    assert.ok(r.chamadas.some((c) => c.includes('/expurgar-tarefas?modo=execucao')))
    assert.ok(!r.chamadas.some((c) => c.includes('limpar-uploads-orfaos')))
  })

  test('409 da limpeza (GitHub não é o agendador declarado) não vira falha do workflow', () => {
    const r = rodarWorkflow({ agenda: '30 4 * * *', codigoDaLimpeza: '409' })
    assert.equal(r.status, 0, r.saida)
    assert.match(r.saida, /o GitHub não é o agendador declarado/)
  })

  test('outro erro da limpeza continua falhando alto', () => {
    assert.equal(rodarWorkflow({ agenda: '30 4 * * *', codigoDaLimpeza: '500' }).status, 1)
  })

  test('disparo manual: ensaio por padrão; operação pede execução', () => {
    const ensaio = rodarWorkflow({ evento: 'workflow_dispatch', alvo: 'limpar-uploads-orfaos', modo: 'ensaio' })
    assert.match(ensaio.chamadas[0], /limpar-uploads-orfaos\?modo=ensaio /)
    const op = rodarWorkflow({ evento: 'workflow_dispatch', alvo: 'limpar-uploads-orfaos', modo: 'operacao' })
    assert.match(op.chamadas[0], /limpar-uploads-orfaos\?modo=execucao /)
  })
})

// ── 5. Integração: banco e storage de TESTE ──────────────────────────────

const REF_PROD = (process.env.PATRONO_REF_DO_BANCO_DE_PRODUCAO ?? '').trim()
const TEM_AMBIENTE = !!process.env.DATABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXTAUTH_SECRET
const MOTIVO_PULO = !TEM_AMBIENTE
  ? 'ambiente de teste (banco + storage) ausente'
  : REF_PROD.length < 8
    ? 'PATRONO_REF_DO_BANCO_DE_PRODUCAO ausente — sem saber qual é a produção, a integração não roda'
    : false

function refDaChave(chave: string): string | null {
  const partes = chave.split('.')
  if (partes.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')).ref ?? null
  } catch {
    return null
  }
}

describe('5. Nenhuma credencial de produção presente', { skip: MOTIVO_PULO }, () => {
  test('banco, URL e chave do storage não são da produção', () => {
    for (const v of ['DATABASE_URL', 'DIRECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
      assert.ok(!(process.env[v] ?? '').includes(REF_PROD), `${v} é da produção`)
    }
    for (const v of ['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
      const ref = refDaChave(process.env[v] ?? '')
      if (ref) assert.notEqual(ref, REF_PROD, `${v} da produção`)
    }
  })

  test('a referência de produção não aparece nos testes nem no código novo', () => {
    const arquivos = [
      ...readdirSync(join(RAIZ, 'tests')).filter((f) => /\.(ts|mjs)$/.test(f)).map((f) => join('tests', f)),
      'lib/limpeza-uploads-orfaos.ts',
      'lib/limpeza-uploads-orfaos-porta.ts',
      'app/api/cron/limpar-uploads-orfaos/route.ts',
      'netlify/functions/rotina-limpar-uploads-orfaos.ts',
      'scripts/limite-bucket-digital-twin.mjs',
    ]
    for (const rel of arquivos) assert.ok(!readFileSync(join(RAIZ, rel), 'utf8').includes(REF_PROD), rel)
  })
})

describe('5. Bucket e limpeza contra o Supabase de TESTE', { skip: MOTIVO_PULO }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let svc: typeof import('../lib/digital-twin-upload-direto-servico')
  let supa: typeof import('../lib/supabase')
  let porta: typeof import('../lib/limpeza-uploads-orfaos-porta')
  let admin: import('@supabase/supabase-js').SupabaseClient
  const BUCKET = 'digital-twin-private'
  const marca = `r57-${Date.now()}`
  const criados: string[] = []
  const paraLimpar = new Set<string>()
  type Ws = { workspaceId: string; userId: string; profileId: string }
  let A: Ws
  let B: Ws
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201ffa50b2b0000000049454e44ae426082', 'hex')
  // Objetos acabam de ser criados; "agora" da limpeza é deslocado para frente.
  const FUTURO = () => new Date(Date.now() + 48 * HORA)

  async function criar(sufixo: string): Promise<Ws> {
    const ws = await prisma.workspace.create({ data: { name: `R57-${sufixo}`, ownerId: `${marca}-${sufixo}` }, select: { id: true } })
    criados.push(ws.id)
    const user = await prisma.user.create({ data: { email: `${marca}-${sufixo}@teste.local`, name: 'U', password: 'x', workspaceId: ws.id }, select: { id: true } })
    const profile = await prisma.digitalTwinProfile.create({ data: { workspaceId: ws.id, ownerUserId: user.id, displayName: 'Twin' }, select: { id: true } })
    return { workspaceId: ws.id, userId: user.id, profileId: profile.id }
  }

  async function subir(nome: string) {
    paraLimpar.add(nome)
    const { error } = await admin.storage.from(BUCKET).upload(nome, PNG, { contentType: 'image/png', upsert: false })
    assert.equal(error, null, error?.message)
    return nome
  }

  const existe = async (nome: string) => !!(await supa.infoDoObjetoPrivado(BUCKET, nome))
  const orfaoDe = (s: Ws, ts = Date.now(), tipo = 'face_image') => `${s.workspaceId}/${s.profileId}/${tipo}-${ts}-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`

  /** Upload direto completo (①②③) — o asset nasce de verdade. */
  async function confirmado(s: Ws) {
    const r = await svc.autorizarEnvioDireto(s, { type: 'FACE_IMAGE', mimeType: 'image/png', size: PNG.length })
    assert.equal(r.status, 200)
    const intencao = r.corpo.intencao as string
    const nome = JSON.parse(Buffer.from(intencao.split('.')[0], 'base64url').toString('utf8')).caminho as string
    paraLimpar.add(nome)
    const put = await fetch(r.corpo.uploadUrl as string, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: new Uint8Array(PNG) })
    assert.equal(put.status, 200)
    assert.equal((await svc.confirmarEnvioDireto(s, { intencao })).status, 200)
    return nome
  }

  before(async () => {
    prisma = (await import('../lib/prisma')).prisma
    svc = await import('../lib/digital-twin-upload-direto-servico')
    supa = await import('../lib/supabase')
    porta = await import('../lib/limpeza-uploads-orfaos-porta')
    const { createClient } = await import('@supabase/supabase-js')
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    A = await criar('a')
    B = await criar('b')
  })

  after(async () => {
    if (paraLimpar.size) await admin.storage.from(BUCKET).remove([...paraLimpar])
    for (const ws of criados) {
      await prisma.digitalTwinAsset.deleteMany({ where: { workspaceId: ws } })
      await prisma.digitalTwinProfile.deleteMany({ where: { workspaceId: ws } })
      await prisma.auditLog.deleteMany({ where: { workspaceId: ws } })
      await prisma.user.deleteMany({ where: { workspaceId: ws } })
      await prisma.workspace.deleteMany({ where: { id: ws } })
    }
    await prisma.$disconnect()
  })

  test('bucket privado com file_size_limit = 50 MB', async () => {
    const { data, error } = await admin.storage.getBucket(BUCKET)
    assert.equal(error, null)
    assert.equal(data?.public, false)
    assert.equal(data?.file_size_limit, LIMITE_DO_BUCKET_BYTES)
  })

  test('o storage recusa 50 MB + 1 byte pela URL assinada e aceita exatamente 50 MB', async () => {
    const acima = `${A.workspaceId}/${A.profileId}/reference_video-${Date.now()}-acima0000000`
    const exato = `${A.workspaceId}/${A.profileId}/reference_video-${Date.now()}-exato0000000`
    paraLimpar.add(acima).add(exato)
    const enviar = async (nome: string, bytes: number) => {
      const { signedUrl } = await supa.criarUrlDeEnvioPrivado(BUCKET, nome)
      return fetch(signedUrl, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: new Uint8Array(bytes) })
    }
    const r1 = await enviar(acima, LIMITE_DO_BUCKET_BYTES + 1)
    assert.notEqual(r1.status, 200, 'acima do limite foi aceito')
    await r1.text()
    assert.equal(await existe(acima), false)
    const r2 = await enviar(exato, LIMITE_DO_BUCKET_BYTES)
    assert.equal(r2.status, 200, await r2.text())
    assert.equal((await supa.infoDoObjetoPrivado(BUCKET, exato))?.tamanho, LIMITE_DO_BUCKET_BYTES)
    await admin.storage.from(BUCKET).remove([exato])
  })

  test('cenário completo: ensaio, execução, outro workspace, repetição', async () => {
    const conf = await confirmado(A)
    const orfao = await subir(orfaoDe(A))
    const agoraLimpeza = FUTURO()
    const recente = await subir(orfaoDe(A, agoraLimpeza.getTime() - HORA, 'voice_reference')) // carimbo 1 h antes do "agora"
    const fora = await subir(`${A.workspaceId}/${A.profileId}/r57-fora-do-padrao.bin`)
    const previa = await subir(`previews/${A.profileId}/r57-previa-${Date.now()}`)
    const orfaoB = await subir(orfaoDe(B))
    const p = porta.portaDaLimpezaReal()

    // Ensaio: relata, não apaga.
    const ensaio = await executarLimpeza({ porta: p, agora: agoraLimpeza, prazoHoras: 24, modo: 'ensaio', workspaceId: A.workspaceId })
    const ra = ensaio.workspaces[0]
    assert.deepEqual(
      { ws: ra.workspaceId, conf: ra.confirmados, orf: ra.elegiveis, rec: ra.recentes, fora: ra.foraDoPadrao, apag: ra.apagados, falha: ra.falha },
      { ws: A.workspaceId, conf: 1, orf: 1, rec: 1, fora: 1, apag: 0, falha: undefined }
    )
    for (const n of [conf, orfao, recente, fora, previa, orfaoB]) assert.ok(await existe(n), 'ensaio apagou algo')

    // Execução restrita a A: só o órfão de A sai.
    const exec = await executarLimpeza({ porta: p, agora: agoraLimpeza, prazoHoras: 24, modo: 'execucao', workspaceId: A.workspaceId })
    assert.equal(exec.totais.apagados, 1)
    assert.equal(await existe(orfao), false)
    for (const n of [conf, recente, fora, previa, orfaoB]) assert.ok(await existe(n), 'apagou o que não devia')
    assert.equal(await prisma.digitalTwinAsset.count({ where: { storagePath: conf } }), 1, 'asset confirmado intacto')
    const aud = await prisma.auditLog.findFirst({ where: { workspaceId: A.workspaceId, action: 'digital_twin.uploads_orfaos_removidos' } })
    assert.deepEqual(aud?.metadata, { quantidade: 1 })
    assert.ok(!JSON.stringify(exec).includes(orfao.split('/').pop()!), 'nome do arquivo no relatório')

    // Repetição: nada muda.
    const de2 = await executarLimpeza({ porta: p, agora: agoraLimpeza, prazoHoras: 24, modo: 'execucao', workspaceId: A.workspaceId })
    assert.equal(de2.totais.apagados, 0)
    assert.equal(de2.totais.elegiveis, 0)
    for (const n of [conf, recente, fora, previa, orfaoB]) assert.ok(await existe(n))
  })

  test('confirmação em andamento: asset criado entre a listagem e a exclusão preserva o arquivo', async () => {
    const nome = await subir(orfaoDe(A))
    const real = porta.portaDaLimpezaReal()
    let consultas = 0
    const comCorrida: PortaDaLimpeza = {
      ...real,
      listarPerfis: () => real.listarPerfis(A.workspaceId),
      async caminhosRegistrados(c) {
        if (++consultas === 2) {
          await prisma.digitalTwinAsset.create({ data: { workspaceId: A.workspaceId, profileId: A.profileId, type: 'FACE_IMAGE', storagePath: nome, mimeType: 'image/png' } })
        }
        return real.caminhosRegistrados(c)
      },
    }
    const r = await executarLimpeza({ porta: comCorrida, agora: FUTURO(), prazoHoras: 24, modo: 'execucao', workspaceId: A.workspaceId })
    assert.equal(r.totais.apagados, 0)
    assert.ok(await existe(nome), 'apagou arquivo com confirmação chegando')
  })

  test('upload recém-autorizado e enviado, ainda sem confirmação: preservado no tempo real', async () => {
    const r = await svc.autorizarEnvioDireto(A, { type: 'FACE_IMAGE', mimeType: 'image/png', size: PNG.length })
    const intencao = r.corpo.intencao as string
    const nome = JSON.parse(Buffer.from(intencao.split('.')[0], 'base64url').toString('utf8')).caminho as string
    paraLimpar.add(nome)
    assert.equal((await fetch(r.corpo.uploadUrl as string, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: new Uint8Array(PNG) })).status, 200)
    // Prazo mínimo forçado para baixo: ainda assim nada na janela de confirmação.
    await executarLimpeza({ porta: porta.portaDaLimpezaReal(), agora: new Date(), prazoHoras: 0, modo: 'execucao', workspaceId: A.workspaceId })
    assert.ok(await existe(nome))
    assert.equal((await svc.confirmarEnvioDireto(A, { intencao })).status, 200, 'confirmação segue possível')
  })

  /** Chama a rota com ambiente controlado; restaura tudo no fim. */
  async function comAmbiente<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const chaves = ['CRON_SECRET', 'AGENDADOR_DOS_CRONS', 'LIMPEZA_UPLOADS_ORFAOS_ATIVA', ...Object.keys(env)]
    const antes = Object.fromEntries(chaves.map((k) => [k, process.env[k]]))
    process.env.CRON_SECRET = 'r57-segredo'
    delete process.env.AGENDADOR_DOS_CRONS
    delete process.env.LIMPEZA_UPLOADS_ORFAOS_ATIVA
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    try {
      return await fn()
    } finally {
      for (const [k, v] of Object.entries(antes)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }
  async function pedirRota(q: string, origem?: string, auth = 'Bearer r57-segredo') {
    const { GET } = await import('../app/api/cron/limpar-uploads-orfaos/route')
    const headers: Record<string, string> = { authorization: auth }
    if (origem) headers['x-patrono-agendador'] = origem
    return GET(new NextRequest(`http://localhost/api/cron/limpar-uploads-orfaos${q}`, { headers }))
  }

  test('rota: só o agendador declarado passa (1, 2 e 3), antes de tocar no storage', async () => {
    const nome = await subir(orfaoDe(A))
    const q = `?modo=execucao&workspace=${A.workspaceId}`
    const casos: [string | undefined, string | undefined, number][] = [
      ['netlify', 'github', 409], // 1. GitHub recusado com Netlify ativa
      ['netlify', undefined, 409],
      ['netlify', 'netlify', 200],
      ['github', 'netlify', 409], // 2. Netlify recusada com GitHub ativo
      ['github', undefined, 409],
      ['github', 'github', 200],
      [undefined, 'github', 409], // 3. sem agendador: ambos falham fechado
      [undefined, 'netlify', 409],
      [undefined, undefined, 409],
      ['', 'github', 409],
    ]
    for (const [agendador, origem, esperado] of casos) {
      const res = await comAmbiente({ AGENDADOR_DOS_CRONS: agendador, LIMPEZA_UPLOADS_ORFAOS_ATIVA: 'true' }, () => pedirRota(q, origem))
      assert.equal(res.status, esperado, `agendador=${agendador} origem=${origem}`)
      if (esperado === 409) {
        // Recusa antes do storage: nem com storage desconfigurado muda a resposta.
        const semStorage = await comAmbiente({ AGENDADOR_DOS_CRONS: agendador, SUPABASE_SERVICE_ROLE_KEY: '' }, () => pedirRota(q, origem))
        assert.equal(semStorage.status, 409)
      }
    }
    assert.ok(await existe(nome), 'objeto recente intacto')
  })

  test('rota: ensaio por padrão, relatório sem caminho; sem storage configurado, 503 e nada feito', async () => {
    const nome = await subir(orfaoDe(A))
    const q = `?workspace=${A.workspaceId}`
    await comAmbiente({ AGENDADOR_DOS_CRONS: 'github' }, async () => {
      assert.equal((await pedirRota('', 'github', 'Bearer errado')).status, 401)

      process.env.LIMPEZA_UPLOADS_ORFAOS_ATIVA = 'true'
      const res = await pedirRota(q, 'github') // sem ?modo=execucao → ensaio
      const corpo = await res.json()
      assert.equal(res.status, 200)
      assert.equal(corpo.modo, 'ensaio')
      assert.ok(!JSON.stringify(corpo).includes(A.profileId))
      assert.ok(await existe(nome))

      delete process.env.LIMPEZA_UPLOADS_ORFAOS_ATIVA
      const pedida = await (await pedirRota(`?modo=execucao&workspace=${A.workspaceId}`, 'github')).json()
      assert.equal(pedida.modo, 'ensaio', 'execução pedida sem interruptor')
      assert.match(pedida.motivoDoModo, /LIMPEZA_UPLOADS_ORFAOS_ATIVA não está ligada/)

      const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
      process.env.SUPABASE_SERVICE_ROLE_KEY = ''
      try {
        assert.equal((await pedirRota(`?modo=execucao&workspace=${A.workspaceId}`, 'github')).status, 503)
      } finally {
        process.env.SUPABASE_SERVICE_ROLE_KEY = chave
      }
    })
    assert.ok(await existe(nome))
  })

  test('4. disparo repetido (e simultâneo) não apaga duas vezes nem produz efeito adicional', async () => {
    const orfao = await subir(orfaoDe(A))
    const outro = await subir(orfaoDe(A, Date.now(), 'reference_video'))
    const agora = FUTURO()
    const p = porta.portaDaLimpezaReal()
    const somaAuditada = async () =>
      (await prisma.auditLog.findMany({ where: { workspaceId: A.workspaceId, action: 'digital_twin.uploads_orfaos_removidos' }, select: { metadata: true } }))
        .reduce((s, a) => s + ((a.metadata as { quantidade?: number } | null)?.quantidade ?? 0), 0)
    const contarAuditorias = () => prisma.auditLog.count({ where: { workspaceId: A.workspaceId, action: 'digital_twin.uploads_orfaos_removidos' } })
    const somaAntes = await somaAuditada()
    const rodada = () => executarLimpeza({ porta: p, agora, prazoHoras: 24, modo: 'execucao', workspaceId: A.workspaceId })

    // Quantos órfãos A tem agora (os dois deste teste + os que testes anteriores deixaram).
    const esperados = (await executarLimpeza({ porta: p, agora, prazoHoras: 24, modo: 'ensaio', workspaceId: A.workspaceId })).totais.elegiveis
    assert.ok(esperados >= 2)

    // Dois disparos simultâneos (se a trava de agendador falhasse) + uma terceira repetição.
    const [r1, r2] = await Promise.all([rodada(), rodada()])
    assert.equal(r1.totais.apagados + r2.totais.apagados, esperados, 'cada órfão apagado uma única vez')
    assert.equal([r1, r2].filter((r) => r.outraExecucaoEmAndamento).length, 1, 'só uma execução real por vez')
    const r3 = await rodada()
    assert.equal(r3.totais.apagados, 0)
    assert.equal(r3.totais.elegiveis, 0)
    assert.equal(await existe(orfao), false)
    assert.equal(await existe(outro), false)
    assert.equal((await somaAuditada()) - somaAntes, esperados, 'auditoria soma exatamente o que foi apagado')
    const auditoriasAposExecucao = await contarAuditorias()

    // Pela rota, com a trava: o GitHub chamando com a Netlify ativa é recusado; a repetição da Netlify é ensaio vazio.
    await comAmbiente({ AGENDADOR_DOS_CRONS: 'netlify' }, async () => {
      assert.equal((await pedirRota(`?modo=execucao&workspace=${A.workspaceId}`, 'github')).status, 409)
      const a = await (await pedirRota(`?modo=execucao&workspace=${A.workspaceId}`, 'netlify')).json()
      const b = await (await pedirRota(`?modo=execucao&workspace=${A.workspaceId}`, 'netlify')).json()
      assert.deepEqual(a.totais, b.totais, 'repetir a chamada dá o mesmo relatório')
      assert.equal(b.totais.apagados, 0)
    })
    assert.equal(await contarAuditorias(), auditoriasAposExecucao, 'nenhum efeito adicional')
  })
})
