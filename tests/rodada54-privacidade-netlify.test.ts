/**
 * P2.8 — Política de Privacidade para a hospedagem Netlify (aprovada em
 * 03/10/2026). Confere que o texto da página diz exatamente o que foi
 * aprovado — e nada do que não pode ser afirmado.
 *
 * Sem banco, sem rede. Custo R$ 0,00.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dadosInstitucionais, versaoDaPolitica, DOMINIO_DO_SITE } from '../lib/institucional'
import { PRAZO_PADRAO_DE_ANONIMIZACAO_DIAS, PRAZO_PADRAO_DE_EXCLUSAO_DIAS } from '../lib/retencao-de-tarefas'

const RAIZ = join(__dirname, '..')
const PAGINA = readFileSync(join(RAIZ, 'app/(institucional)/privacidade/page.tsx'), 'utf8')
// O texto visível, sem o comentário de cabeçalho do arquivo.
const TEXTO = PAGINA.replace(/\/\*\*[\s\S]*?\*\//g, '')

describe('Dados institucionais da política', () => {
  test('domínio é dado institucional', () => {
    assert.equal(DOMINIO_DO_SITE, 'exemplo.com.br')
    assert.equal(dadosInstitucionais({}).dominio, 'exemplo.com.br')
  })

  test('a data da política vem do go-live e só aceita data válida', () => {
    assert.equal(versaoDaPolitica({}), null)
    assert.equal(versaoDaPolitica({ PATRONO_VERSAO_DA_POLITICA: '15/10/2026' }), '15/10/2026')
    for (const ruim of ['2026-10-15', '31/02/2026', '15/13/2026', 'amanhã', ' ']) {
      assert.equal(versaoDaPolitica({ PATRONO_VERSAO_DA_POLITICA: ruim }), null, ruim)
    }
    assert.match(TEXTO, /e\.versaoDaPolitica \? <>Versão de \{e\.versaoDaPolitica\}<\/> : <>Versão a vigorar com a mudança de hospedagem do serviço<\/>/)
  })

  test('o parágrafo de transição da Vercel só aparece quando ligado', () => {
    assert.equal(dadosInstitucionais({}).transicaoDaVercel, false)
    assert.equal(dadosInstitucionais({ PATRONO_TRANSICAO_DE_HOSPEDAGEM: 'vercel' }).transicaoDaVercel, true)
    assert.match(TEXTO, /\{e\.transicaoDaVercel \? \([\s\S]*?por até 14 dias após a mudança[\s\S]*?\) : null\}/)
    // Fora do bloco condicional, a Vercel não é mencionada.
    const semTransicao = TEXTO.replace(/\{e\.transicaoDaVercel \? \([\s\S]*?\) : null\}/, '')
    assert.ok(!/Vercel/.test(semTransicao), 'a Vercel aparece fora do parágrafo de transição')
  })
})

describe('Texto aprovado (P2.8)', () => {
  test('identifica controladora e domínio', () => {
    assert.match(TEXTO, /controladora dos dados pessoais tratados no/)
    assert.match(TEXTO, /Ela vale para o site\{' '\}\s*<strong>\{e\.dominio\}<\/strong>/)
  })

  test('hospedagem Netlify nos EUA, Supabase em São Paulo', () => {
    assert.match(TEXTO, /6\.1 Hospedagem da aplicação \(Netlify\)/)
    assert.match(TEXTO, /Estados Unidos \(us-east-2, Ohio\)/)
    assert.match(TEXTO, /rede global de entrega do fornecedor/)
    assert.ok(!/distribuída em vários países/.test(TEXTO), 'ajuste 1 não aplicado')
    assert.match(TEXTO, /sa-east-1, São Paulo/)
  })

  test('armazenamento: sem afirmação absoluta sobre a hospedagem (ajuste 3)', () => {
    assert.match(
      TEXTO,
      /os dados persistentes da conta e do negócio são armazenados no banco de dados descrito na seção 6\.2\. A hospedagem da aplicação pode manter registros técnicos e operacionais conforme os termos do fornecedor\./
    )
    assert.ok(!/não ficam guardados/.test(TEXTO))
  })

  test('transferência internacional: só o mecanismo registrado (ajuste 2, revisto na P2.14.2)', () => {
    assert.match(TEXTO, /Eventuais transferências internacionais de dados pessoais\s+observarão a LGPD e a Resolução CD\/ANPD nº 19\/2024\./)
    // P2.14.2: o único mecanismo nomeado é o do registro interno, e só no
    // parágrafo "Mecanismo jurídico". Nenhum outro pode ser afirmado.
    const fora = TEXTO.replace(/<strong>Mecanismo jurídico:<\/strong>[\s\S]*?<\/p>/, '')
    assert.ok(!/art\. 33, (inciso )?IX/i.test(fora), 'art. 33, IX citado fora do parágrafo do mecanismo')
    for (const proibido of [/cláusulas[- ]padrão/i, /Data Privacy Framework|\bDPF\b/i, /\bSCCs?\b/, /decisão de adequação/i, /normas corporativas globais/i]) {
      assert.ok(!proibido.test(TEXTO), `mecanismo afirmado: ${proibido}`)
    }
  })

  test('provedores de IA por categoria, sem nomes enquanto desligados', () => {
    assert.match(TEXTO, /Provedores de inteligência artificial e de processamento de mídia/)
    assert.ok(!/Anthropic|fal\.ai|\bfal\b|Claude|OpenAI/i.test(TEXTO))
    assert.match(TEXTO, /Recursos de IA oferecidos pela própria hospedagem não são usados\./)
  })

  test('WhatsApp e tarefas: registro no servidor; nenhum prazo além dos aprovados', () => {
    assert.match(TEXTO, /os números, a mensagem e o resultado de cada envio\s+ficam registrados no servidor/)
    assert.match(TEXTO, /pelo tempo necessário a essa finalidade e ao cumprimento das obrigações legais/)
    // Os únicos prazos permitidos já existiam ou foram aprovados: sessão (30),
    // prévias (7), transição da Vercel (14) e, desde a P2.9.1, a retenção
    // dos registros de tarefas (30 sem atividade / 180 da última atividade).
    const semPermitidos = TEXTO.replace(/até 30 dias/g, '').replace(/expiração de 7 dias/g, '').replace(/14 dias após a mudança/g, '')
      .replace(/após 30 dias sem atividade/g, '').replace(/após 180 dias contados da última atividade/g, '')
    assert.ok(!/\d+\s+dias/.test(semPermitidos), 'prazo de retenção afirmado sem aprovação')
  })

  test('P2.9.1: retenção dos registros de tarefas, igual à política técnica do código', () => {
    const s8 = TEXTO.slice(TEXTO.indexOf('8. Retenção e exclusão'), TEXTO.indexOf('9. Propriedade da mídia'))
    assert.match(s8, /Registros de tarefas em segundo plano/)
    assert.match(s8, /Registros de tarefas concluídas que contenham dados pessoais operacionais — como os números e a mensagem de um envio de WhatsApp — são anonimizados após 30 dias sem atividade./)
    assert.match(s8, /permanecem apenas os dados mínimos necessários ao controle técnico: o estado da tarefa, contagens e o identificador que impede que o mesmo pedido seja repetido./)
    assert.match(s8, /O registro anonimizado é excluído após 180 dias contados da última atividade./)
    assert.match(s8, /Tarefas ativas — em andamento ou aguardando execução — não entram nesse processo./)
    assert.match(s8, /Registros sujeitos a obrigação legal ou necessários ao exercício regular de direitos podem ser conservados, quando aplicável./)
    // A frase genérica não pode mais contradizer o prazo.
    assert.match(s8, /Salvo os registros de tarefas descritos a seguir, não há prazos fixos por categoria/)
    // O texto e o código dizem o mesmo número.
    assert.equal(PRAZO_PADRAO_DE_ANONIMIZACAO_DIAS, 30)
    assert.equal(PRAZO_PADRAO_DE_EXCLUSAO_DIAS, 180)
  })

  test('âncora de exclusão na seção 8', () => {
    assert.match(TEXTO, /<h2 id="exclusao"[^>]*>8\. Retenção e exclusão<\/h2>/)
    assert.match(TEXTO, /Encerramento da conta e exclusão de dados/)
  })

  test('canal de privacidade continua o e-mail institucional', () => {
    assert.match(TEXTO, /Canal de Privacidade e Proteção de Dados/)
    assert.match(TEXTO, /href=\{`mailto:\$\{e\.contato\}`\}/)
  })

  test('seção 9 curta, detalhe nos Termos', () => {
    const s9 = TEXTO.slice(TEXTO.indexOf('9. Propriedade da mídia'), TEXTO.indexOf('10. Segurança'))
    assert.match(s9, /não transfere a propriedade intelectual/)
    assert.match(s9, /Termos de Uso<\/Link> detalham/)
  })

  test('segurança declara só o que existe', () => {
    assert.match(TEXTO, /não acessam o banco de dados de produção/)
    assert.match(TEXTO, /mediante pedido autenticado pela própria aplicação/)
  })
})
