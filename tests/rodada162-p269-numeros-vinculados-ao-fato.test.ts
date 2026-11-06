/**
 * P2.69+ — conferência SEMÂNTICA: cada número do vídeo (algarismo ou por extenso) é vinculado ao ATRIBUTO do seu
 * contexto e só passa se a ficha tiver um fato com o mesmo atributo E o mesmo valor — não basta o valor existir em
 * qualquer fato.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { afirmacoesNumericas, conferirAfirmacoes } from '../lib/afirmacoes-numericas'
import { avaliarBarreiraProfissional } from '../lib/barreira-profissional'

const FICHA = ['Nota 4,9 de 5 estrelas com 1.125 avaliações (página do produto, 27/10/2026)', 'Mais de 5 mil vendidos (painel do vendedor, 27/10/2026)', '1.600 LEDs (título do anúncio)', 'Garantia de 2 anos (anúncio)']
const ok = (trechos: string[], fatos = FICHA) => conferirAfirmacoes(trechos, fatos).semVinculo

describe('atributo lido do contexto', () => {
  test('algarismos e por extenso, à frente e atrás', () => {
    const a = (t: string) => afirmacoesNumericas(t).filter((x) => !String(x.atributo).startsWith('CODIGO')).map((x) => [x.valor, x.atributo, x.comparador])
    assert.deepEqual(a('nota 4,9 de 5 estrelas'), [[4.9, 'NOTA', '='], [5, 'ESCALA', '=']])
    assert.deepEqual(a('quatro vírgula nove estrelas e mais de cinco mil vendidos'), [[4.9, 'NOTA', '='], [5000, 'VENDAS', '>']])
    assert.deepEqual(a('+5 mil vendas'), [[5000, 'VENDAS', '>']])
    assert.deepEqual(a('R$ 39,90'), [[39.9, 'PRECO', '=']])
    assert.deepEqual(a('20% de desconto'), [[20, 'PERCENTUAL:desconto', '=']])
    assert.deepEqual(a('vinte por cento'), [[20, null, '=']])
    assert.deepEqual(a('mil e seiscentos LEDs'), [[1600, 'LEDS', '=']])
    assert.deepEqual(a('120cm de cordão'), [[120, 'COMPRIMENTO_CM:cordao', '=']])
    assert.deepEqual(a('1.125 avaliações'), [[1125, 'QTD_AVALIACOES', '=']])
    assert.deepEqual(a('são 3 cartas'), [[3, 'UNIDADE:carta', '=']])
    assert.deepEqual(a('só 20!'), [[20, null, '=']])
  })
})

describe('vínculo com o fato CERTO da ficha', () => {
  test('cada número no seu fato: APROVADO (texto na tela e fala)', () => {
    assert.deepEqual(ok(['Nota 4,9 ★', '+5 mil vendidos', 'quatro vírgula nove estrelas, mais de cinco mil vendidos', 'mil e seiscentos LEDs', 'dois anos de garantia']), [])
  })
  test('valor que existe na ficha, mas em OUTRO fato: REPROVADO', () => {
    // 5 é a ESCALA da nota e "5 mil" são vendas — "nota 5" não tem fato
    assert.equal(ok(['nota 5']).length, 1)
    // 1.125 é o número de AVALIAÇÕES, não de vendas
    assert.equal(ok(['1.125 vendidos']).length, 1)
    // 2 são ANOS de garantia, não estrelas
    assert.equal(ok(['2 estrelas']).length, 1)
    // 1.600 são LEDs, não avaliações
    assert.equal(ok(['mil e seiscentas avaliações']).length, 1)
    // 4,9 é a nota, não o preço
    assert.equal(ok(['por R$ 4,90']).length, 1)
  })
  test('número sem contexto que permita vincular: REPROVADO (nunca presumido)', () => {
    const r = ok(['só 4,9!'])
    assert.equal(r.length, 1)
    assert.match(r[0], /sem contexto/)
  })
  test('valor divergente no atributo certo: REPROVADO', () => {
    assert.equal(ok(['nota 4,8']).length, 1)
    assert.equal(ok(['mais de 10 mil vendidos']).length, 1)
  })
  test('a fonte entre parênteses não é fato: "27 avaliações" não casa com a data 27/10', () => {
    assert.equal(ok(['27 avaliações']).length, 1)
  })
  test('fato sem atributo identificável não valida nada', () => {
    assert.equal(ok(['nota 4,9'], ['4,9 (painel)']).length, 1)
  })
})

describe('na barreira profissional', () => {
  const item = (trechos: string[]) => avaliarBarreiraProfissional({ sha256: 'a'.repeat(64), produtoFisico: false, midiaDoProduto: { aparece: true, direitosComprovados: true }, afirmacoes: { trechosDoVideo: trechos, fatosValidados: FICHA } }).itens.find((i) => i.id === 'afirmacoesVerificaveis')!
  test('APROVADO só com todos vinculados; o motivo diz qual número e de que atributo', () => {
    assert.equal(item(['Nota 4,9', '+5 mil vendidos']).status, 'APROVADO')
    const r = item(['Nota 4,9', 'nota 5 mil'])
    assert.equal(r.status, 'REPROVADO')
    assert.match(r.motivo, /nota = 5000/)
  })
})

describe('revisão independente P2.69+ — casos que antes APROVAVAM indevidamente', () => {
  const nega = (video: string, fato: string) => assert.ok(conferirAfirmacoes([video], [fato]).semVinculo.length >= 1, `${video} × ${fato}`)
  const aceita = (video: string, fato: string) => assert.deepEqual(conferirAfirmacoes([video], [fato]).semVinculo, [], `${video} × ${fato}`)
  test('achado 1: unidade de tempo exige o qualificador; data e horário não são duração', () => {
    nega('2 anos de garantia', '2 anos de uso')
    nega('garantia de 2 anos', 'durabilidade de 2 anos')
    nega('entrega em 30 dias', '30 dias de garantia')
    nega('promoção só até dia 30', '30 dias de garantia')
    nega('às 20h ao vivo', '20 horas de bateria')
    nega('carrega em 10 horas', 'bateria de 10 horas')
    nega('dura 2 anos', '2 anos de garantia')
    aceita('dois anos de garantia', 'Garantia de 2 anos')
    aceita('um ano de garantia', 'garantia de 1 ano')
  })
  test('achado 2: percentual exige do que é', () => {
    nega('50% algodão', '50% de desconto')
    nega('70% mais rápido', '70% de desconto')
    nega('100% algodão', '100% de satisfação')
    aceita('20% OFF', '20% de desconto')
  })
  test('achado 3: pessoas/clientes só contam pelo verbo', () => {
    nega('mais de 5 mil pessoas avaliaram', 'mais de 5 mil vendas')
    nega('5 mil clientes satisfeitos', '5 mil vendas')
    aceita('mais de 5 mil pessoas compraram', 'mais de 5 mil pessoas compraram')
  })
  test('achado 4: comparador conta', () => {
    nega('mais de 5 mil vendas', 'quase 5 mil vendas')
    nega('até 50% off', '50% de desconto')
    nega('menos de 2 horas para carregar', 'carrega em 2 horas')
    nega('mais de 5 mil vendas', '5.000 vendas')
  })
  test('achado 5: "um ano", "meia dúzia", "metade", "dobro", "milhares", ordinais são afirmações', () => {
    for (const v of ['um ano de garantia', 'uma hora de bateria', 'meia dúzia de LEDs', 'metade do preço', 'o dobro de LEDs', 'segunda unidade grátis', 'primeiro lugar', 'milhares de clientes']) {
      assert.equal(conferirAfirmacoes([v], []).semVinculo.length, 1, v)
    }
    aceita('meia dúzia de LEDs', '6 LEDs')
    aceita('leve a segunda unidade grátis', 'leve a segunda unidade grátis (regulamento)')
  })
  test('achado 6: preço tem papel (de/por/parcela)', () => {
    nega('de R$ 89,90 por R$ 129,90', 'de R$ 129,90 por R$ 89,90')
    aceita('de R$ 129,90 por R$ 89,90', 'de R$ 129,90 por R$ 89,90')
    aceita('R$ 49,90 em 3x de R$ 16,63', 'R$ 49,90 em 3x de R$ 16,63')
    aceita('R$ 49,90 ou 3x de R$ 16,63', 'R$ 49,90 ou 3x de R$ 16,63')
  })
  test('achado 7: ano/data na ficha não vira fato de vendas; "escala de 5" não é nota 5', () => {
    nega('2.025 vendas', '5 mil vendas no Natal 2025')
    nega('nota 5', 'escala de 5 estrelas')
  })
  test('achado 8/9: código de modelo, dois-pontos, emoji, escala sem "nota", intervalo e conversão de unidade', () => {
    assert.deepEqual(conferirAfirmacoes(['Folha A4 de 75 gramas por metro quadrado'], ['formato A4', 'folha de 75 g/m²']).semVinculo, [])
    aceita('Bluetooth 5.3', 'Bluetooth 5.3')
    aceita('Nota: 4,9', 'nota 4,9')
    aceita('4,9 ⭐', 'nota 4,9')
    aceita('nota 4,9 de 5', 'nota 4,9 de 5 estrelas')
    nega('4,9 de 5', 'nota 4,9 de 5 estrelas') // regra fechada: a palavra "nota" do fato tem de estar no vídeo
    aceita('indicado de 3 a 5 anos', 'indicado de 3 a 5 anos')
    nega('cordão de 1,2 metros', 'cordão de 120 cm') // regra fechada: a unidade dita tem de ser a da ficha
    // código de modelo só passa se estiver na ficha
    aceita('papel A4', 'formato A4')
    nega('PS5', 'formato A4')
  })
})

describe('segunda revisão independente P2.69+ — aprovações indevidas', () => {
  const nega = (video: string, fatos: string[]) => assert.ok(conferirAfirmacoes([video], fatos).semVinculo.length >= 1, `${video} × ${fatos.join(' / ')}`)
  const aceita = (video: string, fatos: string[]) => assert.deepEqual(conferirAfirmacoes([video], fatos).semVinculo, [], `${video} × ${fatos.join(' / ')}`)
  test('1: colado em letra, "k", algarismos de outros sistemas, frações, milhões', () => {
    for (const v of ['+10k vendidos', '5k avaliações', 'Garantia de 5anos', '12meses de garantia', 'TOP1', 'Milhões de pessoas já compraram', 'Bilhões de vendas', '½ preço', '¼ de desconto', '５ estrelas', '٥ estrelas']) nega(v, [])
    assert.deepEqual(afirmacoesNumericas('+10k vendidos').map((x) => [x.valor, x.atributo, x.comparador]), [[10000, 'VENDAS', '>']])
    aceita('５ estrelas', ['5 estrelas'])
  })
  test('2: "x" e "vezes" só são parcelas com contexto de pagamento', () => {
    nega('Lava 3 vezes mais rápido', ['Em 3x sem juros'])
    nega('Duas vezes mais bateria', ['2x sem juros'])
    nega('Em 30x sem juros', ['Dimensões: 30 x 20 cm'])
    nega('Use 2 vezes ao dia', ['2x sem juros'])
    nega('12x sem juros', ['12x com juros'])
    aceita('em 3x sem juros', ['Em 3x sem juros'])
  })
  test('3: "N de M <pessoas>" não é nota', () => {
    nega('9 de 10 clientes recomendam', ['Nota 9 de 10'])
    nega('Aprovado por 9 de 10 médicos', ['Nota 9 de 10'])
    nega('4,8 de 5 dentistas recomendam', ['Nota 4,8 de 5'])
  })
  test('4/5: frete, cupom, economia e preço antigo não são o preço do produto', () => {
    nega('Frete grátis a partir de R$ 79', ['De R$ 79 por R$ 59'])
    nega('Frete grátis nas compras de R$ 79', ['De R$ 79 por R$ 59'])
    nega('Cupom de R$ 20', ['De R$ 20 por R$ 15'])
    nega('Antes R$ 69', ['De R$ 89 por R$ 69'])
    nega('Preço antigo R$ 69', ['De R$ 89 por R$ 69'])
    nega('Economize R$ 20', ['De R$ 20 por R$ 15'])
    aceita('de R$ 79 por R$ 59', ['De R$ 79 por R$ 59'])
    nega('por R$ 59', ['De R$ 79 por R$ 59']) // regra fechada: o preço vem com o "de" que a ficha diz
  })
  test('6: palavras próximas têm de estar no MESMO fato; o resto da oração, na ficha', () => {
    nega('Restam só 2 unidades!', ['Kit com 2 unidades'])
    nega('Últimas 3 peças em estoque', ['Jogo com 3 peças'])
    nega('Potência de 20 W', ['Carregador de 20 W incluso'])
    nega('6,5 polegadas de bateria', ['Tela de 6,5 polegadas', 'Bateria de 5000 mAh'])
    aceita('Kit com 2 unidades', ['Kit com 2 unidades'])
    aceita('tela de 6,5 polegadas', ['Tela de 6,5 polegadas', 'Bateria de 5000 mAh'])
  })
  test('7/8: data exige o mês; "a partir de 3 anos de garantia" não é idade', () => {
    nega('Oferta até dia 28 de dezembro', ['Black Friday dia 28 de novembro'])
    nega('Vendas no dia 30', ['Promoção dia 30'])
    nega('a partir de 3 anos de garantia', ['Indicado a partir de 3 anos'])
    aceita('indicado a partir de 3 anos', ['Indicado a partir de 3 anos'])
    nega('a partir de 3 anos', ['Indicado a partir de 3 anos'])
  })
  test('9: "1.600,00" é 1600', () => {
    nega('R$ 160.000', ['Por R$ 1.600,00'])
    aceita('R$ 1.299,90', ['por R$ 1299,90'])
  })
  test('10/12: atributo do vizinho, "5 mil e quinhentos", "+ de 1.000", ordinais comuns', () => {
    assert.deepEqual(afirmacoesNumericas('vendas: 1.200 e nota 4,9').map((x) => x.atributo), ['VENDAS', 'NOTA'])
    assert.deepEqual(afirmacoesNumericas('5 mil e quinhentos vendidos').map((x) => x.valor), [5500])
    assert.deepEqual(afirmacoesNumericas('+ de 1.000 vendidos').map((x) => x.comparador), ['>'])
    assert.deepEqual(afirmacoesNumericas('segundo o fabricante, é ótimo'), [])
  })
  test('robustez: entradas estranhas não travam', () => {
    for (const t of ['', '!!!', '9'.repeat(400), '1.'.repeat(2000), 'um '.repeat(5000), 'mil e '.repeat(5000)]) conferirAfirmacoes([t], ['nota 4,9'])
  })
})

describe('terceira revisão independente P2.69+ — regra fechada por oração', () => {
  const nega = (video: string, fatos: string[], nome = '') => assert.ok(conferirAfirmacoes([video], fatos, nome).semVinculo.length >= 1, `${video} × ${fatos.join(' / ')}`)
  const aceita = (video: string[], fatos: string[], nome = '') => assert.deepEqual(conferirAfirmacoes(video, fatos, nome).semVinculo, [], `${video.join(' / ')} × ${fatos.join(' / ')}`)
  test('2: significado emprestado de outro fato', () => {
    nega('30 horas de bateria sem o estojo', ['30 horas de bateria com o estojo', '6 horas de bateria sem o estojo'])
    nega('80% das usuárias aprovam', ['resultado visível em 7 dias em 80% das usuárias', 'usuárias aprovam a textura'])
    nega('São 30 g de proteína no pote', ['30 g de proteína por dose'], 'Whey Protein Pote 900 g')
  })
  test('3: vários números casando com fatos diferentes', () => {
    nega('Carrega 100% em 30 minutos', ['carrega 50% em 30 minutos', 'bateria carrega 100% em 90 minutos'])
    nega('Carrega 100% em 30 minutos', ['carrega 50% em 30 minutos', 'carrega 100% em 90 minutos'])
  })
  test('4: a condição do fato não pode sumir no vídeo', () => {
    nega('R$ 49,90', ['R$ 49,90 no Pix'])
    nega('10% de desconto', ['10% de desconto no Pix'])
    nega('50% de desconto', ['50% de desconto na segunda unidade'])
    nega('80% das usuárias', ['80% das usuárias relataram ressecamento'])
    nega('10x no cartão', ['10x com juros no cartão'])
    nega('Em até 10x no cartão', ['10x com juros no cartão'])
  })
  test('5: condição/negação na oração vizinha', () => {
    nega('Até 30 horas de bateria, sem precisar do estojo', ['até 30 horas de bateria'])
    nega('Até 30 horas de bateria. Sem precisar carregar o estojo', ['até 30 horas de bateria'])
    nega('2 anos de garantia? Não', ['2 anos de garantia'])
  })
  test('6: "a mais", "a menos", "só", "apenas", com/sem', () => {
    nega('Custa R$ 20 a menos', ['por R$ 20'])
    nega('Custa R$ 20 a mais', ['por R$ 20'])
    nega('2 anos a mais de garantia', ['2 anos de garantia'])
    nega('Só 2 unidades!', ['kit com 2 unidades'])
    nega('Apenas 2 unidades', ['kit com 2 unidades'])
    nega('10x com juros', ['10x sem juros'])
  })
  test('7: o roteiro automático de papel passa contra a ficha que ele mesmo gera (com legenda e hashtags)', async () => {
    const { roteiroAutomatico } = await import('../lib/ciclo-comercial')
    for (const nome of ['Chamex Papel Sulfite A4 Office 75g 500 Folhas Branco', 'Chamex Papel A4 75 g 500 Folhas', 'Papel Sulfite A4 Report 75g 500 folhas']) {
      const f = roteiroAutomatico({ nome, externalId: '1', categoria: 'Papelaria', loja: 'Loja X' } as never, 'x', 'x')
      const leg = f.legendaDoPost as unknown as Record<string, unknown>
      // a legenda montada como em scripts/producao/produzir-video.mjs:72
      const L = leg as { abertura: string; descricao: string; pessoal: string; cta: string; hashtags: string[]; rotuloIA: string }
      const legenda = [L.abertura, '', L.descricao, '', L.pessoal, L.cta, '', '#publi Contém link de afiliada.', L.rotuloIA, '', L.hashtags.join(' ')].join('\n')
      aceita([f.apresentacao, f.demonstracao, f.proposta, f.cta, legenda], f.fatosValidados, `${f.produto.nome} ${f.produto.nomeCompleto}`)
    }
  })
})

describe('quarta revisão independente P2.69+', () => {
  const nega = (video: string, fatos: string[], nome = '') => assert.ok(conferirAfirmacoes([video], fatos, nome).semVinculo.length >= 1, `${video} × ${fatos.join(' / ')}`)
  test('1: condição entre parênteses no fato continua sendo fato (só a fonte no fim sai)', () => {
    nega('R$ 49,90', ['R$ 49,90 (à vista no Pix)'])
    nega('12x no cartão #semjuros', ['12x no cartão (com juros)'])
    nega('Mais de 5 mil vendidos', ['Mais de 5 mil vendidos (todas as cores somadas)'])
    assert.deepEqual(conferirAfirmacoes(['Mais de 5 mil vendidos'], ['Mais de 5 mil vendidos (painel do vendedor, 27/10/2026)']).semVinculo, [])
  })
  test('2: condição do fato em oração/frase sem número', () => {
    nega('R$ 49,90', ['No Pix, R$ 49,90'])
    nega('R$ 49,90', ['R$ 49,90. Válido só no Pix.'])
    nega('50% de desconto', ['50% de desconto, na segunda unidade'])
    nega('2 anos de garantia', ['2 anos de garantia, só para a tela'])
    nega('Cada uma sai por R$ 39,90', ['Comprando 2 unidades, cada uma sai por R$ 39,90'])
  })
  test('3: o kit não some', () => {
    nega('Por R$ 59,90', ['Kit com 2 unidades por R$ 59,90'])
    nega('Por R$ 59,90', ['R$ 59,90 o kit com 3'])
  })
  test('4: o nome do produto não encobre condição', () => {
    const nome = 'Fone de Ouvido Bluetooth Sem Fio com Estojo de Carga'
    nega('Até 30 horas de bateria sem o estojo', ['Até 30 horas de bateria com o estojo'], nome)
    nega('Até 30 horas de bateria', ['Até 30 horas de bateria com o estojo de carga'], nome)
  })
  test('5: número em hashtag', () => {
    nega('Por R$ 49,90 #50off', ['Por R$ 49,90'])
    nega('Por R$ 49,90 #12xsemjuros #top1', ['Por R$ 49,90'])
  })
  test('6: condição antes ou longe, "nem", "mesmo"', () => {
    nega('Mesmo sem o estojo! 30 horas de bateria.', ['30 horas de bateria'])
    nega('30 horas de bateria. Incrível. Sem o estojo, claro.', ['30 horas de bateria'])
    nega('R$ 49,90 com cupom. Nem precisa.', ['R$ 49,90 com cupom'])
  })
  test('7: comparador em parcelas e "pelo menos"', () => {
    nega('12x sem juros', ['Até 12x sem juros'])
    nega('pelo menos 5 mil vendidos', ['5 mil vendidos'])
  })
})

describe('quinta revisão independente P2.69+', () => {
  const nega = (video: string, fatos: string[]) => assert.ok(conferirAfirmacoes([video], fatos).semVinculo.length >= 1, `${video} × ${fatos.join(' / ')}`)
  test('ALTA 1: aviso obrigatório não isenta condição na mesma frase', () => {
    nega('R$ 49,90. Publicidade, só no Pix.', ['R$ 49,90'])
    nega('R$ 49,90, só no Pix, conteúdo com inteligência artificial.', ['R$ 49,90'])
    nega('1 ano de garantia, mas só para quem é afiliado.', ['1 ano de garantia'])
  })
  test('ALTA 2: na frase do número, oração sem número tem de estar na ficha', () => {
    for (const v of ['R$ 49,90, com frete grátis.', 'R$ 49,90. Frete incluso.', 'R$ 49,90. Cada unidade.', 'R$ 49,90, para assinantes.', 'R$ 49,90. Por mês.']) nega(v, ['R$ 49,90'])
    for (const v of ['Garantia de 1 ano, vitalícia na tela', 'Garantia de 1 ano. Inclusive contra quedas e água.']) nega(v, ['Garantia de 1 ano'])
    nega('2 anos de garantia, também para a bateria', ['2 anos de garantia'])
    nega('Bateria de 30 horas, com o volume no máximo.', ['Bateria de 30 horas'])
  })
  test('MÉDIA: ordinais, semanas, centena, terço', () => {
    for (const v of ['O segundo mais vendido da categoria.', 'Uma semana de bateria.', 'Uma centena de avaliações positivas.', 'Um terço do preço da loja.', 'Quinto lugar em vendas.']) nega(v, ['Bateria de 30 horas'])
    nega('Garantia de 1 ano. O primeiro do Brasil.', ['Garantia de 1 ano'])
    assert.deepEqual(conferirAfirmacoes(['Segundo o fabricante, é resistente.'], []).semVinculo, [])
  })
  test('BAIXA: escala diferente de 5 tem de ser dita', () => {
    nega('Nota 4,9.', ['Nota 4,9 de 10'])
    assert.deepEqual(conferirAfirmacoes(['Nota 4,9 ★'], ['Nota 4,9 de 5 estrelas']).semVinculo, [])
  })
})

describe('sexta revisão independente P2.69+', () => {
  const nega = (video: string | string[], fatos: string[]) => assert.ok(conferirAfirmacoes(Array.isArray(video) ? video : [video], fatos).semVinculo.length >= 1, `${video} × ${fatos.join(' / ')}`)
  test('ALTA 1: condição de OUTRO fato (com outro número) não cobre a oração', () => {
    nega('Por R$ 49,90, frete grátis!', ['Por R$ 49,90', 'Frete grátis acima de R$ 99'])
    nega('Até 30 horas de bateria, sem o estojo.', ['Até 30 horas de bateria', 'Até 6 horas de bateria sem o estojo'])
    nega('Garantia de 2 anos, só para a tela.', ['Garantia de 2 anos', 'Garantia de 1 ano só para a tela'])
    nega('Por R$ 49,90, no kit.', ['Por R$ 49,90', 'Por R$ 89,90 no kit'])
    nega('Até 30 horas de bateria, com o cancelamento de ruído ligado.', ['Até 30 horas de bateria', 'Até 20 horas de bateria com o cancelamento de ruído ligado'])
  })
  test('ALTA 2: frase curta colada no número', () => {
    for (const v of ['Mais de 5 mil vendidos. Esta semana.', 'Mais de 5 mil vendidos. Hoje.', 'Mais de 5 mil vendidos. Na última semana.']) nega(v, ['Mais de 5 mil vendidos'])
    for (const v of ['Acesso completo por R$ 29,90. Por semana.', 'Acesso completo por R$ 29,90. Mensais.']) nega(v, ['Acesso completo por R$ 29,90'])
    for (const v of ['Por R$ 49,90. Por pessoa.', 'Por R$ 49,90. No kit.', 'Por R$ 49,90. O kit completo.', 'Por R$ 49,90. Por tempo limitado.', 'Por R$ 49,90. Na Black Friday.']) nega(v, ['Por R$ 49,90'])
    nega('Por R$ 497. No plano anual.', ['Por R$ 497'])
    nega('Nota 4,9. No Reclame Aqui.', ['Nota 4,9'])
    nega('Garantia de 1 ano. Estendida.', ['Garantia de 1 ano'])
    nega('Garantia de 1 ano. Total.', ['Garantia de 1 ano'])
  })
  test('ALTA 3: condição comercial em OUTRO trecho do vídeo (CTA, legenda)', () => {
    nega(['Por R$ 49,90.', 'Só no Pix e só hoje!'], ['Por R$ 49,90'])
    nega(['Por R$ 49,90.', 'Preço válido no Pix.'], ['Por R$ 49,90'])
    nega(['Por R$ 49,90.', '#publi Corre, válido só no Pix!'], ['Por R$ 49,90'])
    assert.deepEqual(conferirAfirmacoes(['Por R$ 49,90 no Pix.', 'Garanta o seu pelo link da sacolinha, no Pix.'], ['Por R$ 49,90 no Pix']).semVinculo, [])
  })
  test('MÉDIA 4: hashtag de condição', () => {
    nega('Por R$ 49,90 #fretegratis #semjuros', ['Por R$ 49,90'])
    nega('Por R$ 49,90 #sohoje #pix', ['Por R$ 49,90'])
  })
  test('MÉDIA 5: "10k+", "5 mil+", "> 5 mil", "~R$ 50"', () => {
    nega('10k+ vendidos', ['10 mil vendidos'])
    nega('5 mil+ vendidos', ['5 mil vendidos'])
    nega('> 5 mil vendidos', ['5 mil vendidos'])
    nega('~R$ 50', ['R$ 50'])
    assert.deepEqual(conferirAfirmacoes(['10k+ vendidos'], ['mais de 10 mil vendidos']).semVinculo, [])
  })
})

describe('sétima revisão independente P2.69+', () => {
  const nega = (video: string | string[], fatos: string[], nome = '') => assert.ok(conferirAfirmacoes(Array.isArray(video) ? video : [video], fatos, nome).semVinculo.length >= 1, `${video} × ${fatos.join(' / ')}`)
  test('ALTA 1: frase que retoma o número ("esse valor", "isso", "essa nota")', () => {
    nega('Por R$ 49,90. Esse valor já inclui o purificador completo.', ['Por R$ 49,90'], 'Refil para Purificador Acqua')
    nega(['Por R$ 49,90.', 'Esse preço vale pelo par, viu gente?'], ['Por R$ 49,90'])
    nega('Garantia de 1 ano. Ela cobre quedas, água e mau uso.', ['Garantia de 1 ano'])
    nega('Até 30 horas de bateria. Isso usando o cancelamento de ruído ligado o tempo inteiro.', ['Até 30 horas de bateria'])
    nega('Mais de 5 mil vendidos. Esse número foi batido em poucos dias.', ['Mais de 5 mil vendidos'])
    nega(['Mais de 5 mil vendidos.', 'E olha que esse produto foi lançado agora em outubro!'], ['Mais de 5 mil vendidos'])
    nega('Nota 4,9. Essa nota vem de compradores verificados da Amazon.', ['Nota 4,9'])
    nega(['Em 12x no cartão.', 'E o melhor: você não paga nada a mais por isso!'], ['Em 12x no cartão'])
  })
  test('ALTA 2: urgência de preço', () => {
    nega(['Por R$ 49,90.', 'Corre que esse preço acaba domingo!'], ['Por R$ 49,90'])
    nega('Por R$ 49,90. Depois volta pro preço normal de loja.', ['Por R$ 49,90'])
  })
  test('MÉDIA 3: palavra promocional do nome do produto', () => {
    nega('Por R$ 199,90 na promoção de lançamento.', ['Por R$ 199,90'], 'Tênis Runner Masculino Lançamento Promoção')
    nega('Por R$ 29,90. Oferta de Black Friday.', ['Por R$ 29,90'], 'Fone Bluetooth TWS Oferta Black Friday')
  })
  test('MÉDIA 4: "número um", "nota máxima"', () => {
    nega('O número um em vendas da Amazon.', ['Por R$ 49,90'])
    nega(['Por R$ 49,90.', 'Nota máxima de quem já comprou.'], ['Por R$ 49,90'])
  })
})

describe('P2.74 — endereço do texto da licença CC não é afirmação; outros links continuam conferidos', () => {
  test('creativecommons.org/…/4.0 passa sem fato; número em outro link ou fora do link continua barrado', () => {
    assert.deepEqual(conferirAfirmacoes(['Texto da licença: creativecommons.org/licenses/by-sa/4.0'], [], 'Arduino UNO R4 WiFi').semVinculo, [])
    assert.deepEqual(conferirAfirmacoes(['Veja em https://www.creativecommons.org/licenses/by-sa/4.0/deed.pt-br'], [], 'X').semVinculo, [])
    assert.equal(conferirAfirmacoes(['Cupom em loja.com.br/promo-50'], [], 'X').semVinculo.length, 1)
    assert.equal(conferirAfirmacoes(['creativecommons.org/licenses/by-sa/4.0 e 50% de desconto'], [], 'X').semVinculo.length, 1)
  })
})
