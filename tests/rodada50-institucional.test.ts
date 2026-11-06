/**
 * Páginas institucionais — dados da empresa e liberação no middleware.
 *
 * O comportamento HTTP (200 sem sessão, texto no HTML, nada parecido
 * liberado) está em `tests/protecao-rotas.test.mjs`, contra o app rodando.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cnpjValido, formatarCnpj, dadosInstitucionais, RAZAO_SOCIAL, CNPJ_DA_EMPRESA } from '../lib/institucional'

const RAIZ = join(__dirname, '..')

describe('Dados institucionais', () => {
  test('a razão social é exatamente a da empresa', () => {
    assert.equal(RAZAO_SOCIAL, 'PATRONO INOVA SIMPLES (I.S.)')
    assert.equal(dadosInstitucionais({}).produto, 'Patrono Seller')
  })

  test('CNPJ válido é formatado; inválido nunca é exibido', () => {
    // CNPJ de exemplo com dígitos verificadores corretos.
    assert.equal(formatarCnpj('11222333000181'), '11.222.333/0001-81')
    assert.equal(formatarCnpj('11.222.333/0001-81'), '11.222.333/0001-81')
    for (const ruim of ['11222333000182', '00000000000000', '123', '', null, undefined]) {
      assert.equal(cnpjValido(ruim as string), false, String(ruim))
      assert.equal(formatarCnpj(ruim as string), null)
    }
  })

  test('o CNPJ da empresa é o informado pela titular, e é válido', () => {
    assert.equal(cnpjValido(CNPJ_DA_EMPRESA), true)
    assert.equal(dadosInstitucionais({}).cnpj, '11.222.333/0001-81')
  })

  test('a configuração só sobrepõe quando é válida', () => {
    assert.equal(dadosInstitucionais({ PATRONO_EMPRESA_CNPJ: 'abc' }).cnpj, '11.222.333/0001-81')
    assert.equal(dadosInstitucionais({ PATRONO_EMPRESA_CNPJ: '11222333000182' }).cnpj, '11.222.333/0001-81')
    assert.equal(dadosInstitucionais({ PATRONO_EMPRESA_CNPJ: '11222333000181' }).cnpj, '11.222.333/0001-81')
  })
})

describe('Middleware: só as três páginas ficam públicas', () => {
  const codigo = readFileSync(join(RAIZ, 'middleware.ts'), 'utf8')

  test('as três rotas estão na lista exata, e a regra continua "negar por padrão"', () => {
    for (const r of ["'/sobre'", "'/privacidade'", "'/termos'"]) assert.ok(codigo.includes(r), r)
    // Comparação exata, não prefixo — `/sobre/qualquer-coisa` continua protegido.
    assert.match(codigo, /ROTAS_PUBLICAS\.includes\(pathname\)/)
    assert.match(codigo, /const PREFIXOS_API_PUBLICOS = \['\/api\/auth', '\/api\/l\/', '\/api\/cron'\]/)
  })

  test('as páginas não leem sessão nem banco', () => {
    for (const f of ['layout.tsx', 'sobre/page.tsx', 'privacidade/page.tsx', 'termos/page.tsx']) {
      const src = readFileSync(join(RAIZ, 'app/(institucional)', f), 'utf8')
      // Import e chamada, nunca a menção: um comentário pode citar o schema.
      for (const proibido of [
        /from ['"][^'"]*prisma['"]/, /getServerSession\(/, /getToken\(/, /process\.env/, /from ['"][^'"]*\/auth['"]/,
      ]) {
        assert.ok(!proibido.test(src), `${f} usa ${proibido}`)
      }
    }
  })
})

// ── Consistência entre /sobre, /privacidade e /termos ──────────────────
//
// Os três textos precisam dizer a mesma coisa sobre o produto. Cada regra
// abaixo nasceu de uma contradição real encontrada na revisão jurídica.

const fonte = (f: string) => readFileSync(join(RAIZ, 'app/(institucional)', f, 'page.tsx'), 'utf8')
const TEXTOS = { sobre: fonte('sobre'), privacidade: fonte('privacidade'), termos: fonte('termos') }

describe('Consistência entre os documentos institucionais', () => {
  const PROIBIDAS: [RegExp, string][] = [
    [/\[REVISAR|REVISAR:|<Revisar/, 'marcador de revisão'],
    [/somente pelas APIs oficiais|apenas por APIs oficiais|exclusivamente por APIs/i, 'promessa absoluta de API oficial (a integração Shopee de imagens não era oficial)'],
    [/coleta de páginas/i, 'afirmação absoluta sobre coleta de páginas'],
    [/expiram automaticamente|removid[ao]s automaticamente/i, 'remoção automática de prévias (a rotina não está agendada)'],
    [/pequeno porte/i, 'enquadramento como agente de pequeno porte (receita e grupo econômico não comprovados)'],
    [/encarregado/i, 'encarregado não nomeado'],
    [/pode encerrar a conta a qualquer momento|encerrar a conta a qualquer momento/i, 'encerramento por funcionalidade própria (não existe)'],
    [/criptografad[oa]s? em repouso|criptografia em repouso/i, 'criptografia de tokens em repouso (não implementada)'],
    [/em toda divulgação|sempre identificado/i, 'promessa absoluta de aviso comercial (o aviso é garantido nas legendas da plataforma)'],
  ]

  for (const [nome, texto] of Object.entries(TEXTOS)) {
    for (const [padrao, porque] of PROIBIDAS) {
      test(`${nome}: sem ${porque}`, () => {
        assert.ok(!padrao.test(texto), `${nome} contém ${padrao}`)
      })
    }
    test(`${nome}: identifica a empresa pela fonte única`, () => {
      assert.match(texto, /dadosInstitucionais\(\)/)
      assert.match(texto, /razaoSocial/)
    })
  }

  test('/sobre e /termos descrevem as integrações do mesmo jeito', () => {
    for (const t of [TEXTOS.sobre, TEXTOS.termos]) {
      assert.match(t, /priorizando APIs oficiais quando disponíveis e autorizadas/)
      assert.match(t, /Não utiliza automação de navegador/)
      assert.match(t, /fluxo não oficial ficam bloqueadas até revisão/)
    }
  })

  test('/privacidade e /termos descrevem o encerramento do mesmo jeito', () => {
    for (const t of [TEXTOS.privacidade, TEXTOS.termos]) {
      assert.match(t, /solicitar o encerramento da conta/)
      assert.match(t, /conforme procedimento interno e as obrigações legais aplicáveis/)
    }
  })

  test('/privacidade cita as normas certas e o canal', () => {
    assert.match(TEXTOS.privacidade, /Resolução CD\/ANPD nº 15\/2024/)
    assert.match(TEXTOS.privacidade, /Resolução CD\/ANPD nº 19\/2024/)
    assert.match(TEXTOS.privacidade, /Canal de Privacidade e Proteção de Dados/)
    // Biometria: o art. 11 só para tratamento futuro; a base de imagem e voz é o art. 7º, I.
    assert.match(TEXTOS.privacidade, /<strong>Consentimento<\/strong> \(art\. 7º, I\)/)
  })

  test('/termos tem as 17 seções', () => {
    for (let i = 1; i <= 17; i++) assert.match(TEXTOS.termos, new RegExp(`>${i}\. `), `seção ${i}`)
  })
})

describe('Integração não oficial da Shopee: bloqueada', () => {
  test('a rota de imagens não chama mais o endpoint interno e responde 403', () => {
    const rota = readFileSync(join(RAIZ, 'app/api/integracoes/shopee/imagens/route.ts'), 'utf8')
    assert.ok(!/shopee\.com\.br\/api\/v4\/item\/get['`]/.test(rota.replace(/\/\*[\s\S]*?\*\//g, '')), 'endpoint interno ainda é chamado')
    assert.ok(!/fetch\(/.test(rota), 'a rota não pode fazer requisição')
    assert.match(rota, /status: 403/)
    assert.match(rota, /INTEGRACAO_NAO_OFICIAL_BLOQUEADA/)
  })
})
