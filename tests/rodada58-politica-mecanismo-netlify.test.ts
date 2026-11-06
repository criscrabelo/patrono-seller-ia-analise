/**
 * P2.14.2 — A seção 6 da Política nomeia o mecanismo de transferência da
 * hospedagem (art. 33, IX c/c art. 7º, V) e afirma três coisas sobre o
 * código. Este teste confere cada afirmação contra o código, para que o
 * texto publicado não fique mais forte do que a aplicação:
 *
 *   1. WhatsApp não roda em hospedagem no exterior (Netlify ou Vercel);
 *   2. imagem e voz do avatar não passam pelas funções (upload direto);
 *   3. o clique num link não grava o IP de quem acessa.
 *
 * Se alguma trava for removida, o teste falha e o texto precisa mudar junto.
 * Sem banco, sem rede. Custo R$ 0,00.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { envioDeWhatsappPermitido } from '../lib/transferencia-internacional'

const RAIZ = join(__dirname, '..')
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const PAGINA = ler('app/(institucional)/privacidade/page.tsx').replace(/\/\*\*[\s\S]*?\*\//g, '')
const MECANISMO = PAGINA.match(/<strong>Mecanismo jurídico:<\/strong>([\s\S]*?)<\/p>/)?.[1] ?? ''
const texto = MECANISMO.replace(/\s+/g, ' ')

describe('Política, seção 6 — mecanismo registrado (P2.14.2)', () => {
  test('nomeia só o art. 33, IX c/c art. 7º, V, para os fluxos contratuais da usuária', () => {
    assert.ok(MECANISMO, 'parágrafo "Mecanismo jurídico" ausente')
    assert.match(texto, /na medida necessária para executar o contrato com a usuária, a pedido dela/)
    assert.match(texto, /art\. 33, inciso IX, combinado com o art\. 7º, inciso V, da LGPD/)
    assert.match(texto, /art\. 9º, inciso II, alínea &quot;c&quot;, do Regulamento aprovado pela Resolução CD\/ANPD nº 19\/2024/)
    assert.match(texto, /O fornecedor atua como operador/)
    // Nenhuma base genérica para toda a hospedagem.
    assert.ok(!/toda a hospedagem|qualquer transferência/i.test(texto))
  })

  test('WhatsApp: o texto diz que não roda no exterior, e o código bloqueia', () => {
    assert.match(texto, /envio de mensagens de WhatsApp[\s\S]*não são executadas pela hospedagem no exterior/)
    // Sinais reais de cada plataforma: nenhuma libera o envio.
    const hospedagens: Record<string, string | undefined>[] = [
      { NETLIFY: 'true' },
      { CONTEXT: 'production', SITE_ID: 's', DEPLOY_ID: 'd' },
      { TRABALHO_LONGO_MODO: 'segundo-plano' },
      { VERCEL_ENV: 'production' },
      { VERCEL: '1' },
      { NETLIFY: 'true', NODE_ENV: 'test' },
    ]
    for (const env of hospedagens) {
      assert.equal(envioDeWhatsappPermitido(env).permitido, false, JSON.stringify(env))
    }
    // As três portas de envio consultam a trava.
    for (const arq of ['app/api/whatsapp/enviar/route.ts', 'lib/whatsapp.ts', 'lib/trabalhos-longos/envio-whatsapp.ts']) {
      assert.match(ler(arq), /envioDeWhatsappPermitido\(/, arq)
    }
  })

  test('avatar: o texto diz que não passa pelas funções, e a rota antiga está fechada', () => {
    assert.match(texto, /imagem e a voz do recurso de avatar, não são executadas pela hospedagem no exterior/)
    const assets = ler('app/api/digital-twin/assets/route.ts')
    const post = assets.slice(assets.indexOf('export async function POST'))
    assert.match(post, /status: 410/)
    assert.match(post, /USE_UPLOAD_DIRETO/)
    assert.ok(!/formData\(|arrayBuffer\(/.test(post), 'a rota antiga voltou a receber o arquivo')
    // O caminho vigente é a URL assinada para o navegador enviar direto ao Supabase.
    assert.match(ler('lib/digital-twin-upload-direto-servico.ts'), /criarUrlDeEnvioPrivado\(/)
  })

  test('links: o texto diz que o IP não é armazenado, e nem o modelo nem a rota o gravam', () => {
    assert.match(texto, /a aplicação não armazena o endereço IP de quem acessa/)
    const modelo = ler('prisma/schema.prisma').match(/model EventoLink \{[\s\S]*?\n\}/)?.[0] ?? ''
    assert.ok(modelo, 'model EventoLink não encontrado')
    assert.ok(!/^\s*(ip|ipAddress|enderecoIp|userAgent|cookie|visitorId)\b/im.test(modelo), 'EventoLink ganhou campo de identificação do visitante')
    const rota = ler('app/api/l/[slug]/route.ts')
    assert.ok(!/x-forwarded-for|x-real-ip|x-nf-client-connection-ip|req\.ip\b|cookies\(/i.test(rota), 'a rota de links passou a ler IP ou cookie')
  })
})
