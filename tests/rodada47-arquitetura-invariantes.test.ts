/**
 * Invariantes de arquitetura, verificadas no GRAFO DE IMPORTS.
 *
 * Uma varredura de texto num arquivo só prova o que aquele arquivo faz.
 * Estes testes caminham pelas importações a partir de cada cron e
 * perguntam o que é ALCANÇÁVEL — que é a pergunta que importa quando o
 * risco é "alguém, três módulos abaixo, chama o provider pago".
 *
 * Eles falham no dia em que um import novo abrir um caminho que hoje não
 * existe. É de propósito: é mais barato descobrir aqui do que na fatura.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, sep, relative } from 'node:path'

const RAIZ = join(__dirname, '..')

/** Resolve um import relativo ou com alias `@/` para um arquivo real. */
function resolver(deArquivo: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(RAIZ, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(deArquivo), spec)
  else return null // pacote de node_modules: fora do nosso grafo
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(cand) && !cand.endsWith('/')) {
      try {
        if (readFileSync(cand, 'utf8') !== undefined) return cand
      } catch {
        /* diretório: segue para o próximo candidato */
      }
    }
  }
  return null
}

/** Todos os arquivos do projeto alcançáveis a partir de um ponto de entrada. */
function alcancaveis(entrada: string): Set<string> {
  const vistos = new Set<string>()
  const fila = [entrada]
  const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'|import\s*\(\s*'([^']+)'\s*\)/g
  while (fila.length) {
    const arq = fila.pop()!
    if (vistos.has(arq)) continue
    vistos.add(arq)
    let src = ''
    try {
      src = readFileSync(arq, 'utf8')
    } catch {
      continue
    }
    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2]
      if (!spec) continue
      const alvo = resolver(arq, spec)
      if (alvo && !vistos.has(alvo)) fila.push(alvo)
    }
  }
  return vistos
}

const CRONS = [
  'app/api/cron/oportunidades/route.ts',
  'app/api/cron/executar-fila/route.ts',
  'app/api/cron/ml-janela-observacao/route.ts',
  'app/api/cron/sincronizar-catalogo/route.ts',
]

describe('Nenhum cron alcança provider pago', () => {
  for (const cron of CRONS) {
    test(`${cron} não alcança lib/falai.ts`, () => {
      const grafo = alcancaveis(join(RAIZ, cron))
      const pago = [...grafo].filter((f) => /[\\/]lib[\\/]falai\.ts$/.test(f))
      assert.deepEqual(
        pago,
        [],
        `${cron} alcança o provider pago por: ${[...grafo].filter((f) => f.includes('falai')).join(', ')}`
      )
    })
  }

  test('o grafo do ciclo de oportunidades é realmente percorrido', () => {
    // Guarda do próprio teste: se o resolvedor parasse de achar arquivos,
    // os testes acima passariam por vazio e não provariam nada.
    const grafo = alcancaveis(join(RAIZ, 'app/api/cron/oportunidades/route.ts'))
    assert.ok(grafo.size > 10, `grafo pequeno demais (${grafo.size}) — o resolvedor quebrou`)
    assert.ok(
      [...grafo].some((f) => f.endsWith('ciclo-de-oportunidades.ts')),
      'o ciclo deveria estar no grafo'
    )
    assert.ok([...grafo].some((f) => f.endsWith('plano-de-acao.ts')))
  })
})

describe('O ciclo de oportunidades não alcança publicação', () => {
  test('nenhum módulo de distribuição entra no grafo do cron diário', () => {
    const grafo = [...alcancaveis(join(RAIZ, 'app/api/cron/oportunidades/route.ts'))]
    for (const proibido of [
      'distribuicao-orquestrador.ts',
      'adaptadores-reais.ts',
      'publicacao-fluxo.ts',
      'instagram.ts',
      'tiktok-channel.ts',
    ]) {
      assert.ok(
        !grafo.some((f) => f.endsWith(proibido)),
        `o cron de oportunidades alcança ${proibido}`
      )
    }
  })

  test('o executor ALCANÇA distribuição — e isso é por desenho', () => {
    // Não é falha: o executor registra a ação de distribuir. O que impede a
    // publicação é ADAPTADORES_LIGADOS vazio, não a ausência do import.
    // Este teste existe para que a diferença fique explícita.
    const grafo = [...alcancaveis(join(RAIZ, 'app/api/cron/executar-fila/route.ts'))]
    assert.ok(grafo.some((f) => f.endsWith('distribuicao-orquestrador.ts')))
    assert.ok(grafo.some((f) => f.endsWith('adaptadores-reais.ts')))
  })
})

describe('Autoridade única de capacidades da fábrica', () => {
  test('só um arquivo declara a lista de formatos produzidos', () => {
    const declaram: string[] = []
    for (const rel of [
      'lib/capacidades-da-fabrica.ts',
      'lib/fabrica-de-conteudo.ts',
      'lib/plano-de-acao.ts',
      'lib/ciclo-de-oportunidades.ts',
    ]) {
      const s = readFileSync(join(RAIZ, rel), 'utf8')
      // A assinatura de uma DECLARAÇÃO de lista: os dois formatos, como
      // literais, dentro de um array.
      if (/\[\s*\n?\s*'VIDEO_9X16_FFMPEG_NARRADO',\s*\n?\s*'TEXTO_COM_LINK',?\s*\n?\s*\]/.test(s)) {
        declaram.push(rel)
      }
    }
    assert.deepEqual(declaram, ['lib/capacidades-da-fabrica.ts'])
  })
})

describe('Os portões de publicação continuam fechados', () => {
  test('só Instagram e TikTok (P2.17.10) estão em ADAPTADORES_DISPONIVEIS — e nenhum liga sem a flag', () => {
    const s = readFileSync(join(RAIZ, 'lib/adaptadores-reais.ts'), 'utf8')
    const bloco = s.slice(
      s.indexOf('export const ADAPTADORES_DISPONIVEIS'),
      s.indexOf('export const CANAIS_SEM_ADAPTER_DISPONIVEL')
    )
    assert.match(bloco, /instagram: adaptadorInstagram/)
    assert.match(bloco, /tiktok: adaptadorTikTok/)
    for (const canal of ['facebook:', 'youtube:', 'pinterest:']) {
      assert.ok(!bloco.includes(canal), `${canal} não pode estar disponível`)
    }
  })

  test('o registro de adapters ligados nasce vazio no código', () => {
    const s = readFileSync(join(RAIZ, 'lib/distribuicao-orquestrador.ts'), 'utf8')
    assert.match(s, /export const ADAPTADORES_LIGADOS: Record<string, AdaptadorDeCanal> = \{\}/)
  })

  test('o registro de renovadores ligados nasce vazio no código', () => {
    const s = readFileSync(join(RAIZ, 'lib/renovacao-de-acesso.ts'), 'utf8')
    assert.match(s, /export const RENOVADORES_LIGADOS: Record<string, RenovadorDeAcesso> = \{\}/)
  })
})

describe('Machine Learning continua em shadow mode', () => {
  /** Remove comentarios: a invariante e sobre CHAMADA, e comentario nao chama. */
  function semComentarios(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*/gm, '$1 ')
  }

  test('nenhum cron CHAMA treino ou promocao de modelo', () => {
    const DEFINEM = ['ml-model.ts', 'ml-model-registry.ts', 'ml-training-pipeline.ts']
    let examinados = 0
    for (const entrada of CRONS) {
      for (const f of alcancaveis(join(RAIZ, entrada))) {
        // Separador de caminho varia por sistema: no Windows é barra
        // invertida, e um filtro só com `/` deixaria o teste vazio.
        if (!f.includes(`${sep}lib${sep}`)) continue
        examinados += 1
        if (DEFINEM.some((d) => f.endsWith(d))) continue // e onde a funcao mora
        const codigo = semComentarios(readFileSync(f, 'utf8'))
        for (const chamada of [/treinarRegressaoLogistica\s*\(/, /promoverModelo\s*\(/, /treinarModeloConversao\s*\(/]) {
          assert.ok(!chamada.test(codigo), `${entrada} alcanca ${chamada} sendo CHAMADO em ${f}`)
        }
      }
    }
    assert.ok(examinados > 20, `poucos arquivos examinados (${examinados}) — o filtro quebrou`)
  })

  test('o cron diario nem alcanca o pipeline de treino', () => {
    // Antes desta rodada alcancava: lib/ml-engine.ts importava so a
    // constante CONVERSION_MODEL_FAMILY do pipeline, e um import de
    // constante e um import de modulo. Nada era treinado por isso, mas a
    // fronteira ficava indefensavel. A constante mudou para
    // lib/ml-constantes.ts; quem le nao carrega mais quem treina.
    const grafo = [...alcancaveis(join(RAIZ, 'app/api/cron/oportunidades/route.ts'))]
    assert.ok(!grafo.some((f) => f.endsWith('ml-training-pipeline.ts')), 'o treino voltou ao grafo do cron')
  })

  test('a constante mora num modulo puro, sem import', () => {
    const s = readFileSync(join(RAIZ, 'lib/ml-constantes.ts'), 'utf8')
    assert.deepEqual(s.match(/^\s*import/gm) ?? [], [])
    assert.match(s, /CONVERSION_MODEL_FAMILY = 'conversion_probability'/)
  })
})

describe('Observabilidade dos crons', () => {
  test('o cron do executor reporta FALHAS, nao so sucessos', () => {
    // O laco sempre contou `falhas`; a rota nao as devolvia. Uma execucao
    // com jobs falhando ficava indistinguivel de uma limpa para quem le a
    // resposta — e e a resposta que alguem olha quando algo parece parado.
    const s = readFileSync(join(RAIZ, 'app/api/cron/executar-fila/route.ts'), 'utf8')
    assert.match(s, /totalFalhas \+= r\.falhas/)
    assert.match(s, /^\s*totalFalhas,$/m)
  })

  test('o cron de oportunidades reporta erro por workspace', () => {
    const s = readFileSync(join(RAIZ, 'lib/ciclo-de-oportunidades.ts'), 'utf8')
    assert.match(s, /erro: string \| null/)
    assert.match(s, /erros: porWorkspace\.filter/)
  })

  test('os dois crons declaram custo na resposta', () => {
    const ciclo = readFileSync(join(RAIZ, 'lib/ciclo-de-oportunidades.ts'), 'utf8')
    assert.match(ciclo, /custoTotal: 0/)
    const exec = readFileSync(join(RAIZ, 'app/api/cron/executar-fila/route.ts'), 'utf8')
    assert.match(exec, /custoTotal: 0/)
  })
})

describe('O projeto continua DEPLOYÁVEL', () => {
  /**
   * Estes dois testes nasceram de duas falhas reais, descobertas só quando
   * o `next build` rodou pela primeira vez em muitas rodadas. Nem
   * `tsc --noEmit` nem a suíte pegavam nenhuma das duas, porque nenhuma é
   * erro de tipo nem de comportamento — são regras de plataforma.
   */

  /** Todos os `route.ts` sob `app/`. */
  function rotas(dir = join(RAIZ, 'app')): string[] {
    const achados: string[] = []
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, entrada.name)
      if (entrada.isDirectory()) achados.push(...rotas(caminho))
      else if (entrada.name === 'route.ts' || entrada.name === 'route.tsx') achados.push(caminho)
    }
    return achados
  }

  test('nenhum route.ts exporta coisa que o App Router não aceita', () => {
    // O Next só admite, num `route.ts`, os handlers HTTP e um punhado de
    // configs. Qualquer outro export vira erro de TIPO no `next build` —
    // e só lá. Foi assim que `export { compararFilas, capacidadesDeclaradas }`
    // no cron de oportunidades deixou o projeto indeployável sem ninguém
    // notar: parecia uma conveniência inofensiva.
    const PERMITIDOS = new Set([
      'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
      'dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime',
      'preferredRegion', 'maxDuration', 'generateStaticParams',
    ])

    const arquivos = rotas()
    assert.ok(arquivos.length > 10, `poucas rotas encontradas (${arquivos.length}) — a varredura quebrou`)

    const proibidos: string[] = []
    for (const arq of arquivos) {
      const src = readFileSync(arq, 'utf8')
      // `export const X`, `export function X`, `export async function X`
      for (const m of src.matchAll(/^export\s+(?:const|let|var|(?:async\s+)?function\*?|class)\s+(\w+)/gm)) {
        if (!PERMITIDOS.has(m[1])) proibidos.push(`${relative(RAIZ, arq)} -> ${m[1]}`)
      }
      // `export { A, B }` — reexport, que foi exatamente o caso real.
      for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const nome of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!.trim())) {
          if (nome && !PERMITIDOS.has(nome)) proibidos.push(`${relative(RAIZ, arq)} -> ${nome}`)
        }
      }
      // `export default` também não é aceito num route.ts.
      if (/^export\s+default\b/m.test(src)) proibidos.push(`${relative(RAIZ, arq)} -> default`)
    }

    assert.deepEqual(
      proibidos,
      [],
      `route.ts não pode exportar isto — o next build falha:\n  ${proibidos.join('\n  ')}`
    )
  })

  test('vercel.json não declara cron — o plano Hobby recusa', () => {
    // O plano Hobby só aceita cron diário. O `vercel.json` tinha dois
    // sub-diários (`0 6,12,18 * * *` e `*/30 * * * *`), e por isso TODO
    // deploy era recusado na validação — por 60 dias, sem ninguém saber.
    // O agendamento mora no GitHub Actions agora.
    const vercel = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8'))
    assert.ok(
      !('crons' in vercel),
      'vercel.json voltou a declarar crons: o deploy será recusado no plano Hobby'
    )
  })

  test('todo cron do código está agendado no workflow', () => {
    // A mudança de casa não pode ter deixado nenhum para trás.
    const fluxo = readFileSync(join(RAIZ, '.github/workflows/patrono-crons.yml'), 'utf8')
    const noCodigo = readdirSync(join(RAIZ, 'app/api/cron'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
    assert.ok(noCodigo.length >= 5, `poucos crons encontrados (${noCodigo.length})`)
    const semAgenda = noCodigo.filter((c) => !fluxo.includes(c))
    assert.deepEqual(semAgenda, [], `crons sem agendamento no workflow: ${semAgenda.join(', ')}`)
  })

  test('o workflow não carrega segredo e não opera sem ele', () => {
    const fluxo = readFileSync(join(RAIZ, '.github/workflows/patrono-crons.yml'), 'utf8')
    // O segredo vem do cofre do GitHub, nunca do arquivo.
    assert.match(fluxo, /\$\{\{ secrets\.CRON_SECRET \}\}/)
    // E vai no header, nunca na URL — query string entra em log de acesso.
    assert.match(fluxo, /--header "Authorization: Bearer \$\{CRON_SECRET\}"/)
    assert.ok(!/CRON_SECRET=['"][^'"$]/.test(fluxo), 'o workflow não pode conter valor literal de segredo')
    // Sem segredo, não chama nada.
    assert.match(fluxo, /if \[ -z "\$\{CRON_SECRET:-\}" \] && \[ -z "\$\{BASE_URL:-\}" \]; then/)
  })
})
