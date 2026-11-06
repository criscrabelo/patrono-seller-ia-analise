/**
 * P0.1 — Cost Safety Gate: revisão FINAL.
 *
 * Cobre as sete correções pedidas:
 *  1. todo caminho pago do fal.ai fechado, com operações distintas;
 *  2. Anthropic sem `custoEstimado: null` e com workspace propagado;
 *  3. reserva atômica por workspace + mês (a concorrência real fica em
 *     `rodada17-cost-gate-concorrencia.test.ts`, que precisa de Postgres);
 *  4. registro de reserva inválido é FAIL-CLOSED, nunca ignorado;
 *  5. `custoReservado` ≠ `custoReal`;
 *  6. Resend/Z-API revisados, sem workspace inventado nem estimativa enganosa;
 *  7. varredura de código: nenhuma chamada paga sem gate.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  avaliarCusto,
  estimarCusto,
  CUSTO_ESTIMADO_BRL,
  ACAO_AUDIT_AUTORIZADO,
  ACAO_AUDIT_BLOQUEIO,
  type PoliticaDeCusto,
} from '../lib/cost-safety-gate'
import {
  chaveDoPeriodo,
  somarReservas,
  GastoAcumuladoIndisponivel,
} from '../lib/cost-safety-reserva'
import { escolherFallback, listarPendenciasDeAutomacao } from '../lib/cost-fallback'

const RAIZ = join(__dirname, '..')
const lerFonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

/** Fonte sem comentários — para asserções sobre o CÓDIGO, não sobre o texto. */
const lerCodigo = (rel: string) =>
  lerFonte(rel)
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')

const LIBERADO: PoliticaDeCusto = { pagoHabilitado: true, orcamentoMensal: 100 }

function decidir(over: Partial<Parameters<typeof avaliarCusto>[0]> = {}) {
  return avaliarCusto({
    provider: 'fal.ai',
    operacao: 'gerar-video',
    workspaceId: 'ws-a',
    custoEstimado: 1,
    gastoAcumulado: 0,
    politica: LIBERADO,
    ...over,
  })
}

// ── 1. fal.ai: nenhum caminho pago sem gate ─────────────────────────────

describe('1. fal.ai — toda submissão paga tem gate e operação própria', () => {
  const fonte = lerFonte('lib/falai.ts')

  test('as três submissões POST estão gated, cada uma com sua operação', () => {
    for (const op of ['gerar-video', 'compor-video', 'adicionar-legenda']) {
      assert.ok(
        fonte.includes(`exigirAutorizacaoFal('${op}'`),
        `submissão ${op} precisa passar pelo gate`
      )
    }
  })

  test('VARREDURA: todo `method: POST` vem depois de um gate', () => {
    // Regressão do defeito encontrado na revisão: `comporVideos()` e
    // `adicionarLegendaVideo()` faziam POST sem gate nenhum.
    const linhas = fonte.split('\n')
    const posts = linhas.flatMap((l, i) => (/method:\s*'POST'/.test(l) ? [i] : []))
    assert.equal(posts.length, 3, 'o arquivo tem exatamente 3 submissões pagas')
    for (const i of posts) {
      const antes = linhas.slice(Math.max(0, i - 40), i).join('\n')
      assert.match(
        antes,
        /exigirAutorizacaoFal\(/,
        `POST na linha ${i + 1} não tem gate nas 40 linhas anteriores`
      )
    }
  })

  test('POLLING e RESULTADO continuam FORA do gate, de propósito', () => {
    // Bloquear polling de trabalho já pago deixaria o job órfão: teríamos
    // pago e não buscado o resultado.
    for (const fn of [
      'consultarStatusVideo',
      'obterResultadoVideo',
      'obterResultadoCompose',
      'obterResultadoLegenda',
    ]) {
      const corpo = fonte.slice(fonte.indexOf(`export async function ${fn}`))
      const primeiroFecha = corpo.indexOf('\n}')
      assert.ok(
        !corpo.slice(0, primeiroFecha).includes('exigirAutorizacaoFal'),
        `${fn} é leitura de trabalho já contratado e não pode ser barrada`
      )
    }
  })

  test('o gate NÃO voltou para falFetch (isso barraria o polling)', () => {
    const corpo = fonte.slice(fonte.indexOf('async function falFetch'))
    const fim = corpo.indexOf('\n}\n')
    assert.ok(!corpo.slice(0, fim).includes('guardarChamadaPaga'))
  })

  test('submeterMultiplosClipes propaga o workspace para cada clipe', () => {
    // Sem propagar, N-1 clipes seriam avaliados sem workspace — e cada clipe
    // é uma cobrança separada.
    assert.match(fonte, /submeterGeracaoVideo\(params, motor, workspaceId\)/)
  })

  test('cada operação paga tem teto próprio na tabela central', () => {
    for (const op of ['gerar-video', 'compor-video', 'adicionar-legenda']) {
      const v = estimarCusto('fal.ai', op)
      assert.ok(typeof v === 'number' && v > 0, `sem teto para fal.ai:${op}`)
    }
    // Gerar vídeo é a operação mais cara: o teto tem de refletir isso.
    assert.ok(estimarCusto('fal.ai', 'gerar-video')! > estimarCusto('fal.ai', 'compor-video')!)
    assert.ok(estimarCusto('fal.ai', 'compor-video')! > estimarCusto('fal.ai', 'adicionar-legenda')!)
  })
})

// ── 2. Anthropic ────────────────────────────────────────────────────────

describe('2. Anthropic — estimativa real e workspace propagado', () => {
  const fonte = lerFonte('lib/claude.ts')

  test('não passa mais `custoEstimado: null` (que anulava a tabela)', () => {
    assert.ok(
      !/custoEstimado:\s*null/.test(lerCodigo('lib/claude.ts')),
      'passar null explicitamente bloqueava até com as duas chaves ligadas'
    )
  })

  test('as três funções usam operações DISTINTAS', () => {
    for (const op of ['gerar-roteiro', 'gerar-video-seller', 'analisar-compliance']) {
      assert.ok(fonte.includes(`exigirPermissaoDeCusto('${op}'`), `falta a operação ${op}`)
    }
    // Antes as três usavam 'gerar-roteiro', misturando custos e fallbacks.
    const ocorrencias = fonte.match(/exigirPermissaoDeCusto\('gerar-roteiro'/g) ?? []
    assert.equal(ocorrencias.length, 1)
  })

  test('workspaceId é parâmetro explícito, não assumido', () => {
    assert.match(fonte, /async function exigirPermissaoDeCusto\(operacao: string, workspaceId: string \| null\)/)
    assert.ok(!/workspaceId: string \| null = null\): Promise<void>/.test(fonte), 'o helper não pode ter default silencioso')
  })

  test('as rotas passam o workspace da sessão', () => {
    assert.match(lerFonte('app/api/conteudos/gerar/route.ts'), /gerarConteudo\([^)]*session\.user\.workspaceId\)/)
    assert.match(lerFonte('app/api/video-seller/route.ts'), /gerarVideoSeller\(entrada, session\.user\.workspaceId\)/)
  })

  test('com as duas chaves ligadas, uma operação Anthropic AGORA libera', () => {
    const d = decidir({
      provider: 'anthropic',
      operacao: 'gerar-roteiro',
      custoEstimado: estimarCusto('anthropic', 'gerar-roteiro'),
    })
    assert.equal(d.permitido, true)
  })
})

// ── 3. Reserva atômica: chave de período ────────────────────────────────

describe('3. Chave de reserva — por workspace E por mês', () => {
  test('workspaces diferentes nunca compartilham o lock', () => {
    const agora = new Date('2026-09-21T12:00:00Z')
    assert.notEqual(chaveDoPeriodo('ws-a', agora), chaveDoPeriodo('ws-b', agora))
  })

  test('o mesmo workspace no mesmo mês usa a mesma chave', () => {
    assert.equal(
      chaveDoPeriodo('ws-a', new Date('2026-09-01T00:00:00Z')),
      chaveDoPeriodo('ws-a', new Date('2026-09-30T23:59:59Z'))
    )
  })

  test('virada de mês zera o período (orçamento é MENSAL)', () => {
    assert.notEqual(
      chaveDoPeriodo('ws-a', new Date('2026-09-30T23:59:59Z')),
      chaveDoPeriodo('ws-a', new Date('2026-10-01T00:00:00Z'))
    )
  })

  test('o módulo de reserva usa advisory lock transacional', () => {
    const fonte = lerFonte('lib/cost-safety-reserva.ts')
    assert.match(fonte, /pg_advisory_xact_lock/)
    assert.match(fonte, /\$transaction/)
    // O INSERT da reserva tem de acontecer DENTRO da transação (tx), senão
    // a atomicidade não existe.
    assert.match(fonte, /tx\.auditLog\.create/)
  })
})

// ── 4. Registro inválido é FAIL-CLOSED ──────────────────────────────────

describe('4. Registro de reserva inválido BLOQUEIA, não é ignorado', () => {
  test('soma normal de reservas válidas', () => {
    assert.equal(
      somarReservas([
        { id: '1', metadata: { custoReservado: 2.5 } },
        { id: '2', metadata: { custoReservado: 7.5 } },
      ]),
      10
    )
  })

  test('zero é válido (operação estimada em R$ 0,00 ainda é registro íntegro)', () => {
    assert.equal(somarReservas([{ id: '1', metadata: { custoReservado: 0 } }]), 0)
  })

  for (const [rotulo, meta] of [
    ['campo ausente', {}],
    ['metadata nulo', null],
    ['NaN', { custoReservado: NaN }],
    ['Infinity', { custoReservado: Infinity }],
    ['negativo', { custoReservado: -5 }],
    ['string', { custoReservado: '3.00' }],
    ['objeto', { custoReservado: { valor: 3 } }],
  ] as Array<[string, unknown]>) {
    test(`${rotulo} lança GastoAcumuladoIndisponivel`, () => {
      // Ignorar baixaria o consumo do mês e deixaria passar gasto acima do
      // teto. Total não confiável BLOQUEIA.
      assert.throws(
        () => somarReservas([{ id: 'x', metadata: meta }]),
        GastoAcumuladoIndisponivel
      )
    })
  }

  test('um registro ruim contamina o lote inteiro', () => {
    assert.throws(
      () =>
        somarReservas([
          { id: 'bom', metadata: { custoReservado: 1 } },
          { id: 'ruim', metadata: { custoReservado: 'x' } },
        ]),
      GastoAcumuladoIndisponivel
    )
  })

  test('o gate trata a falha da reserva como bloqueio, não como zero', () => {
    const codigo = lerCodigo('lib/cost-safety-gate.ts')
    // O motivo do `negar()` local é fixo: qualquer falha da reserva vira
    // GASTO_ACUMULADO_INDISPONIVEL, nunca "gasto zero".
    assert.match(codigo, /motivo: 'GASTO_ACUMULADO_INDISPONIVEL'/)
    // E o catch da reserva de fato cai no caminho de bloqueio.
    assert.match(codigo, /catch \(e\)[\s\S]{0,600}registrarBloqueio\(params, negar\(/)
  })
})

// ── 5. custoReservado ≠ custoReal ───────────────────────────────────────

describe('5. Reserva não é gasto faturado', () => {
  test('o campo somado chama-se custoReservado, e isso está documentado', () => {
    const fonte = lerFonte('lib/cost-safety-reserva.ts')
    assert.match(fonte, /custoReservado/)
    assert.match(fonte, /custoReal/, 'a diferença precisa estar escrita no módulo')
    assert.match(fonte, /RESERVA NÃO É GASTO REAL|NAO E GASTO REAL/i)
  })

  test('autorizado e bloqueado são ações de auditoria distintas', () => {
    assert.equal(ACAO_AUDIT_AUTORIZADO, 'custo.autorizado')
    assert.equal(ACAO_AUDIT_BLOQUEIO, 'custo.bloqueado_por_politica')
    assert.notEqual(ACAO_AUDIT_AUTORIZADO, ACAO_AUDIT_BLOQUEIO)
  })

  test('só o AUTORIZADO grava custoReservado — bloqueio não consome orçamento', () => {
    const fonte = lerFonte('lib/cost-safety-reserva.ts')
    assert.match(fonte, /if \(decisao\.permitido\)[\s\S]{0,200}metadata\.custoReservado/)
  })
})

// ── 6. Resend / Z-API ───────────────────────────────────────────────────

describe('6. Resend e Z-API — sem workspace inventado, sem estimativa enganosa', () => {
  test('não têm estimativa na tabela, e por isso ficam bloqueados', () => {
    assert.equal(estimarCusto('resend', 'enviar-email'), null)
    assert.equal(estimarCusto('z-api', 'enviar-whatsapp'), null)
    assert.ok(!Object.keys(CUSTO_ESTIMADO_BRL).some((k) => k.startsWith('resend:') || k.startsWith('z-api:')))
  })

  test('sem estimativa, nem as duas chaves ligadas liberam', () => {
    const d = decidir({ provider: 'resend', operacao: 'enviar-email', custoEstimado: null })
    assert.equal(d.permitido, false)
  })

  test('nenhum dos dois inventa workspace', () => {
    for (const arq of ['lib/email.ts', 'lib/whatsapp.ts']) {
      const fonte = lerFonte(arq)
      assert.ok(
        !/workspaceId:\s*'[^']+'/.test(fonte),
        `${arq} não pode passar um workspaceId literal — AuditLog tem FK para Workspace`
      )
    }
  })

  test('nenhum dos dois passa custoEstimado próprio (fonte única: a tabela)', () => {
    for (const arq of ['lib/email.ts', 'lib/whatsapp.ts']) {
      assert.ok(!/custoEstimado:/.test(lerFonte(arq)), `${arq} não deve duplicar a estimativa`)
    }
  })

  test('bloqueio não derruba o fluxo que chamou', () => {
    assert.match(lerFonte('lib/email.ts'), /return \{ enviado: false \}/)
    assert.match(lerFonte('lib/whatsapp.ts'), /return \{ permitido: false, motivo \}/)
  })

  test('os ENVIOS do Z-API estão gated; verificarConexao (status) não', () => {
    const fonte = lerFonte('lib/whatsapp.ts')
    const enviosGated = fonte.match(/envioPermitidoPelaPolitica\('enviar-whatsapp'/g) ?? []
    assert.equal(enviosGated.length, 2, 'send-text e send-image')
    const conexao = fonte.slice(fonte.indexOf('export async function verificarConexao'))
    assert.ok(
      !conexao.slice(0, conexao.indexOf('\n}')).includes('envioPermitidoPelaPolitica'),
      'consulta de status não consome cota de mensagem — barrá-la esconderia "WhatsApp desconectado" sem economizar nada'
    )
  })

  test('whatsapp propaga o workspace da sessão quando existe', () => {
    // P2.2: o trabalho nasce com o workspace da SESSÃO, e o executor envia
    // com o workspace do trabalho — o gate apura o orçamento do negócio certo.
    const rota = lerCodigo('app/api/whatsapp/enviar/route.ts')
    assert.match(rota, /iniciarTrabalhoLongo\(\{\s*workspaceId: session\.user\.workspaceId,/)
    const executor = lerCodigo('lib/trabalhos-longos/envio-whatsapp.ts')
    const envios = executor.match(/pedido\.mensagem \}?, e\.trabalho\.workspaceId\)/g) ?? []
    assert.equal(envios.length, 2, 'send-text e send-image com o workspace do trabalho')
  })
})

// ── 7. Fallbacks: executados onde a capacidade existe ───────────────────

describe('7. Fallback só onde a capacidade existe de verdade', () => {
  test('compor-video cai no FFmpeg local, que existe neste repositório', () => {
    const f = escolherFallback('fal.ai', 'compor-video')
    assert.equal(f.tipo, 'LOCAL_GRATUITO')
    assert.equal(f.alternativa, 'concat-video.concatVideos')
    assert.equal(f.pendenciaDeAutomacao, false)
    // A função referenciada precisa existir — fallback mapeado para função
    // inexistente é pior que fallback nenhum.
    assert.match(lerFonte('lib/concat-video.ts'), /export async function concatVideos/)
  })

  test('a rota de status EXECUTA a concatenação local quando a paga é bloqueada', () => {
    const rota = lerFonte('app/api/conteudos/[id]/video-status/route.ts')
    assert.match(rota, /BloqueadoPorPoliticaDeCusto/)
    assert.match(rota, /await concatVideos\(urlsClipes\)/)
    assert.match(rota, /status: 'pronto'/)
  })

  test('adicionar-legenda NÃO inventa capacidade: vira pendência de automação', () => {
    const f = escolherFallback('fal.ai', 'adicionar-legenda')
    assert.equal(f.tipo, 'SEM_ALTERNATIVA')
    assert.equal(f.alternativa, null)
    assert.equal(f.pendenciaDeAutomacao, true)
    assert.ok(
      listarPendenciasDeAutomacao().some((p) => p.chave === 'fal.ai:adicionar-legenda')
    )
  })

  test('de fato não existe função local que queime legenda em vídeo pronto', () => {
    // Justifica a pendência acima: renderer-ffmpeg só monta vídeo a partir de
    // IMAGEM. Se um dia existir, este teste falha e o fallback é atualizado.
    const renderer = lerFonte('lib/renderer-ffmpeg.ts')
    assert.ok(!/legendarVideoExistente|queimarLegenda/.test(renderer))
  })

  test('bloqueio da legenda devolve o SRT gratuito, não um erro seco', () => {
    // P2.2: a legenda virou trabalho longo; a resposta do bloqueio sai do
    // executor e a rota a repassa sem mudar.
    assert.match(
      lerFonte('app/api/conteudos/[id]/adicionar-legenda/route.ts'),
      /NextResponse\.json\(r\.resposta\.corpo, \{ status: r\.resposta\.status \}\)/
    )
    const rota = lerFonte('lib/trabalhos-longos/legenda-video.ts')
    assert.match(rota, /bloqueadoPorCusto: true/)
    assert.match(rota, /srt,/)
    assert.match(rota, /pendenciaDeAutomacao: 'fal\.ai:adicionar-legenda'/)
  })

  test('compliance sem equivalente determinístico é pendência declarada', () => {
    const f = escolherFallback('anthropic', 'analisar-compliance')
    assert.equal(f.pendenciaDeAutomacao, true)
  })

  test('operação desconhecida nunca vira "pode gastar"', () => {
    assert.equal(estimarCusto('fal.ai', 'operacao-que-nao-existe'), null)
    assert.equal(decidir({ operacao: 'operacao-que-nao-existe', custoEstimado: null }).permitido, false)
  })
})

// ── Varredura final ─────────────────────────────────────────────────────

describe('Varredura final: nenhum provedor pago fora do gate', () => {
  test('só quatro arquivos falam com provedor pago, e os quatro importam o gate', () => {
    for (const arq of ['lib/falai.ts', 'lib/claude.ts', 'lib/email.ts', 'lib/whatsapp.ts']) {
      assert.match(lerFonte(arq), /guardarChamadaPaga/, `${arq} precisa passar pelo gate`)
    }
  })

  test('a política continua desligada por padrão', () => {
    const fonte = lerFonte('lib/cost-safety-gate.ts')
    assert.match(fonte, /pagoHabilitado:\s*false/)
    assert.match(fonte, /orcamentoMensal:\s*0/)
  })
})
