/**
 * P2.17.17 / P2.17.22 — Kits de conteúdo das amostras, preparados ANTES da
 * entrega. Escritos à mão (sem IA paga), determinísticos e checados:
 *
 *   - linguagem de PLANEJAMENTO, nunca depoimento: nada de "testei", "uso",
 *     "minha pele…" — a opinião só existe depois do uso real e é dita pela
 *     titular com as palavras dela (o roteiro dá a estrutura, não a fala);
 *   - sem alegação médica/estética ou de resultado; claims passam pelo mesmo
 *     filtro de copy do resto do Patrono (lib/copy-por-canal.ts);
 *   - cada roteiro passa pelo Quality Gate de vídeo (preliminar: o QG final é
 *     o do arquivo gerado, em lib/video-assistido.ts);
 *   - "ranking de vendas" só vai ao ar com snapshot do app de até 7 dias.
 */
import { claimsNaoComprovados } from './copy-por-canal'
import { textoDisclosure } from './creative-factory'
import { CTA_A, CTA_B, type Estrutura } from './motor-de-videos-tiktok'
import { avaliarVideo, type AvaliacaoDoVideo } from './quality-gate-video-tiktok'
import { chaveDeProduto } from './observacoes-de-mercado'

export interface EtapaDoRoteiro { etapa: string; texto: string; textoNaTela: string | null }
export type Liberacao = 'AO_RECEBER' | 'APOS_USO_REAL'

export interface RoteiroDoKit {
  id: string
  titulo: string
  estrutura: Estrutura
  objetivo: 'RETENCAO' | 'CLIQUE' | 'VENDA'
  hook: string
  roteiro: EtapaDoRoteiro[]
  duracaoSegundos: 15 | 30
  cta: string
  legenda: string
  /** Precisa de uso real antes de gravar (a fala é da titular, não do Patrono). */
  exigeUsoReal: boolean
  liberadoQuando: Liberacao
  faceless: boolean
}

export interface KitDeConteudo {
  chave: string
  produto: string
  categoria: string
  papeis: ('PRODUTO_AFILIADO' | 'EQUIPAMENTO_OPERACIONAL')[]
  campanha: string | null
  objetivo: string
  formatoRecomendado: string
  duracaoRecomendada: string
  exigeUsoReal: boolean
  exigeDemonstracao: boolean
  podeSerFaceless: boolean
  roteiros: [RoteiroDoKit, RoteiroDoKit, RoteiroDoKit]
  hooks: [string, string, string]
  ctas: [string, string]
  legendas: [string, string]
  hashtags: string[]
  disclosure: string
  planoAB: { a: string; b: string; mede: string; regra: string }
  midiaNecessaria: string[]
  cenasParaGravar: string[]
  alternativaFaceless: string | null
  riscosDeClaim: string[]
  usosOperacionais?: string[]
}

const DISCLOSURE = textoDisclosure('afiliado')
const et = (etapa: string, texto: string, textoNaTela: string | null = null): EtapaDoRoteiro => ({ etapa, texto, textoNaTela })

export const KITS_DE_AMOSTRAS: KitDeConteudo[] = [
  {
    chave: chaveDeProduto({ nome: 'Hidrabene Protetor Solar Facial FPS 70' }),
    produto: 'Hidrabene Protetor Solar Facial FPS 70',
    categoria: 'Beleza',
    papeis: ['PRODUTO_AFILIADO'],
    campanha: null,
    objetivo: 'VENDA — forte evidência de vendas relatada pela titular (posição/número ainda não registrados); o vídeo precisa mostrar textura e rotina, sem prometer resultado.',
    formatoRecomendado: 'Demonstração de textura + rotina de manhã (rosto opcional; mãos e espelho bastam).',
    duracaoRecomendada: '15 s para o teste A/B; 30 s na versão rotina.',
    exigeUsoReal: true,
    exigeDemonstracao: true,
    podeSerFaceless: true,
    roteiros: [
      {
        id: 'hidrabene-textura', titulo: 'Textura em 10 segundos (sem opinião)', estrutura: 'DEMONSTRACAO', objetivo: 'VENDA',
        hook: 'Olha a textura desse protetor FPS 70 de perto.',
        roteiro: [
          et('Demonstração', 'Close na embalagem mostrando o FPS 70 no rótulo.', 'FPS 70 no rótulo'),
          et('Demonstração', 'Uma gota no dorso da mão; espalhe devagar em câmera próxima.', 'Textura de perto'),
          et('Benefício', 'Mostre como fica na pele logo depois de espalhar (sem afirmar efeito).', 'Como fica na pele'),
          et('CTA', 'Aponte para o produto marcado.', 'Produto marcado 👇'),
        ],
        duracaoSegundos: 15, cta: CTA_A, legenda: 'Textura do protetor facial FPS 70 de perto 👀 Produto marcado no vídeo.',
        exigeUsoReal: false, liberadoQuando: 'AO_RECEBER', faceless: true,
      },
      {
        id: 'hidrabene-rotina', titulo: 'Rotina da manhã (depois de usar alguns dias)', estrutura: 'TESTE_REAL', objetivo: 'VENDA',
        hook: 'Minha rotina da manhã em 30 segundos, com protetor FPS 70.',
        roteiro: [
          et('Problema', 'Mostre a pressa da manhã (café, bolsa, espelho).', 'Manhã corrida'),
          et('Demonstração', 'Passo a passo da rotina com o protetor como último passo do skincare.', 'Último passo: FPS 70'),
          et('Prova', 'Fale, com as SUAS palavras, o que você percebeu no uso real (textura, cheiro, se fica marcado). Sem prometer resultado.', null),
          et('CTA', 'Aponte para o produto marcado.', 'Produto marcado 👇'),
        ],
        duracaoSegundos: 30, cta: CTA_B, legenda: 'Rotina da manhã com protetor facial FPS 70 ☀️ Produto marcado no vídeo.',
        exigeUsoReal: true, liberadoQuando: 'APOS_USO_REAL', faceless: false,
      },
      {
        id: 'hidrabene-ranking', titulo: 'Por que chamou atenção no TikTok Shop', estrutura: 'ACHADO_TIKTOK_SHOP', objetivo: 'CLIQUE',
        hook: 'Esse protetor está no ranking de vendas do TikTok Shop. Fui ver por quê.',
        roteiro: [
          et('Curiosidade', 'Mostre a tela do ranking do app (gravação de tela) com a data do dia.', 'Ranking de hoje'),
          et('Demonstração', 'Mostre a embalagem e a textura na mão.', 'FPS 70'),
          et('Benefício', 'Diga para quem faz sentido: quem quer um protetor facial com FPS alto no dia a dia.', 'Para quem é'),
          et('CTA', 'Aponte para o produto marcado.', 'Produto marcado 👇'),
        ],
        duracaoSegundos: 15, cta: CTA_A, legenda: 'Fui ver por que esse protetor FPS 70 está no ranking do TikTok Shop 🔎 Produto marcado.',
        exigeUsoReal: false, liberadoQuando: 'AO_RECEBER', faceless: true,
      },
    ],
    hooks: ['Olha a textura desse protetor FPS 70 de perto.', 'Minha rotina da manhã em 30 segundos, com protetor FPS 70.', 'Esse protetor está no ranking de vendas do TikTok Shop. Fui ver por quê.'],
    ctas: [CTA_A, CTA_B],
    legendas: ['Textura do protetor facial FPS 70 de perto 👀 Produto marcado no vídeo.', 'Fui ver por que esse protetor FPS 70 está no ranking do TikTok Shop 🔎 Produto marcado.'],
    hashtags: ['#tiktokshop', '#protetorsolar', '#skincare', '#fps70', '#achadinhos'],
    disclosure: DISCLOSURE,
    planoAB: { a: 'hidrabene-textura', b: 'hidrabene-ranking', mede: 'retenção nos 3 primeiros segundos e cliques no produto', regra: 'Mesma duração (15 s) e mesmo CTA; muda só o gancho. Vencedor só com amostra mínima do motor de aprendizado.' },
    midiaNecessaria: ['vídeo vertical 9:16 com a textura na mão (luz natural)', 'close da embalagem', 'gravação de tela do ranking no dia (opcional, para o roteiro 3)'],
    cenasParaGravar: [
      'Embalagem fechada, rótulo FPS 70 visível (3 s)',
      'Uma gota no dorso da mão e espalhando em close (5–8 s)',
      'Pele logo depois de espalhar, contra a luz (3 s)',
      'Gravação de tela do ranking "Mais vendidos" no app, com a data (3 s, opcional)',
      'Só depois de alguns dias de uso: rotina da manhã no espelho (para o roteiro 2)',
    ],
    alternativaFaceless: 'Roteiros 1 e 3 são só mãos + embalagem + tela do app (sem rosto).',
    riscosDeClaim: [
      'Nada de alegação médica: não dizer que previne câncer, manchas, envelhecimento ou que "protege 100%".',
      'Não prometer resultado ("pele perfeita", "não deixa oleosa") — só a percepção da titular, depois do uso real, com as palavras dela.',
      '"Ranking de vendas" só com snapshot do app de até 7 dias; senão trocar o gancho do roteiro 3.',
      'Não comparar com outra marca sem dado verificável.',
    ],
  },
  {
    chave: chaveDeProduto({ nome: 'Kit Depilador Elétrico 4 em 1' }),
    produto: 'Kit Depilador Elétrico 4 em 1',
    categoria: 'Beleza',
    papeis: ['PRODUTO_AFILIADO'],
    campanha: null,
    objetivo: 'CLIQUE → VENDA — produto visual: mostrar as 4 funções e a praticidade, com imagem limpa e segura.',
    formatoRecomendado: 'Demonstração das funções na bancada (mãos), faceless.',
    duracaoRecomendada: '15 s (funções em sequência) e 30 s (unboxing + funções).',
    exigeUsoReal: false,
    exigeDemonstracao: true,
    podeSerFaceless: true,
    roteiros: [
      {
        id: 'depilador-4-funcoes', titulo: '4 funções em 15 segundos', estrutura: 'LISTA_3_MOTIVOS', objetivo: 'CLIQUE',
        hook: '4 funções num aparelho só. Olha como troca.',
        roteiro: [
          et('Motivo 1', 'Mostre o produto: o aparelho e a primeira ponteira encaixando.', 'Função 1'),
          et('Motivo 2', 'Troque para a segunda e terceira ponteiras (encaixe audível).', 'Funções 2 e 3'),
          et('Motivo 3', 'Quarta ponteira e o kit organizado na bancada.', 'Função 4'),
          et('CTA', 'Aponte para o produto marcado.', 'Produto marcado 👇'),
        ],
        duracaoSegundos: 15, cta: CTA_A, legenda: 'Depilador elétrico 4 em 1: as funções em 15 segundos ⚡ Produto marcado.',
        exigeUsoReal: false, liberadoQuando: 'AO_RECEBER', faceless: true,
      },
      {
        id: 'depilador-unboxing', titulo: 'Abre comigo: o que vem no kit', estrutura: 'UNBOXING', objetivo: 'RETENCAO',
        hook: 'Abre comigo: o que vem nesse kit depilador 4 em 1.',
        roteiro: [
          et('Abertura', 'Abra a caixa em câmera de cima, mãos apenas.', 'Abrindo agora'),
          et('Demonstração', 'Mostre cada peça do kit sobre a bancada.', 'O que vem no kit'),
          et('Benefício', 'Mostre como carrega e liga (sem usar no corpo).', 'Como liga'),
          et('CTA', 'Aponte para o produto marcado.', 'Produto marcado 👇'),
        ],
        duracaoSegundos: 30, cta: CTA_B, legenda: 'Tudo o que vem no kit depilador elétrico 4 em 1 📦 Produto marcado.',
        exigeUsoReal: false, liberadoQuando: 'AO_RECEBER', faceless: true,
      },
      {
        id: 'depilador-praticidade', titulo: 'Praticidade na necessaire de viagem', estrutura: 'UTILIDADE', objetivo: 'VENDA',
        hook: 'Um item que cabe na necessaire e resolve várias coisas.',
        roteiro: [
          et('Problema', 'Mostre uma necessaire cheia de itens separados.', 'Necessaire lotada'),
          et('Demonstração', 'Substitua por um kit compacto 4 em 1 e feche a necessaire.', 'Um kit só'),
          et('Benefício', 'Mostre o tamanho na mão e o encaixe das ponteiras.', 'Compacto'),
          et('CTA', 'Aponte para o produto marcado.', 'Produto marcado 👇'),
        ],
        duracaoSegundos: 15, cta: CTA_A, legenda: 'Kit depilador 4 em 1 que cabe na necessaire ✈️ Produto marcado.',
        exigeUsoReal: false, liberadoQuando: 'AO_RECEBER', faceless: true,
      },
    ],
    hooks: ['4 funções num aparelho só. Olha como troca.', 'Abre comigo: o que vem nesse kit depilador 4 em 1.', 'Um item que cabe na necessaire e resolve várias coisas.'],
    ctas: [CTA_A, CTA_B],
    legendas: ['Depilador elétrico 4 em 1: as funções em 15 segundos ⚡ Produto marcado.', 'Tudo o que vem no kit depilador elétrico 4 em 1 📦 Produto marcado.'],
    hashtags: ['#tiktokshop', '#depilador', '#beleza', '#achadinhos', '#praticidade'],
    disclosure: DISCLOSURE,
    planoAB: { a: 'depilador-4-funcoes', b: 'depilador-praticidade', mede: 'cliques no produto por 1.000 views', regra: 'Mesma duração (15 s); muda gancho e ângulo (funções × praticidade).' },
    midiaNecessaria: ['vídeo vertical das mãos na bancada (fundo limpo)', 'close de cada ponteira encaixando'],
    cenasParaGravar: [
      'Caixa fechada na bancada, câmera de cima (2 s)',
      'Abrindo a caixa e tirando as peças (5 s)',
      'Cada ponteira encaixando, uma por uma (2 s cada)',
      'Aparelho ligando / carregando (3 s)',
      'Kit organizado e dentro da necessaire (3 s)',
    ],
    alternativaFaceless: 'Todo o kit é faceless: só mãos e bancada.',
    riscosDeClaim: [
      'Sem imagem íntima ou de partes do corpo sensíveis: demonstrar na bancada (ou no máximo no antebraço).',
      'Não prometer "sem dor", "não irrita", "resultado duradouro/permanente" nem comparar com depilação a laser.',
      'Não citar especificação técnica que não esteja na embalagem.',
    ],
  },
  {
    chave: chaveDeProduto({ nome: 'Suporte de cabeça e peitoral para celular' }),
    produto: 'Suporte de cabeça e peitoral para celular',
    categoria: 'Eletrônicos',
    papeis: ['PRODUTO_AFILIADO', 'EQUIPAMENTO_OPERACIONAL'],
    campanha: null,
    objetivo: 'DUPLO: vender o suporte E virar equipamento de produção do BoraComprar (vídeos POV mãos livres dos demais produtos).',
    formatoRecomendado: 'POV gravado COM o próprio suporte (o vídeo é a demonstração).',
    duracaoRecomendada: '15 s (POV) e 30 s (montagem + POV).',
    exigeUsoReal: false,
    exigeDemonstracao: true,
    podeSerFaceless: true,
    roteiros: [
      {
        id: 'suporte-pov', titulo: 'POV: gravado com o próprio suporte', estrutura: 'POV', objetivo: 'RETENCAO',
        hook: 'POV: este vídeo foi gravado sem segurar o celular.',
        roteiro: [
          et('Demonstração', 'Grave em POV preparando algo na cozinha, mãos livres, com o suporte no peito.', 'Mãos livres'),
          et('Prova', 'Corte para uma câmera externa mostrando o suporte no corpo.', 'Gravado com isto'),
          et('Benefício', 'Mostre o ajuste das alças e do encaixe do celular.', 'Ajuste rápido'),
          et('CTA', 'Aponte para o produto marcado.', 'Produto marcado 👇'),
        ],
        duracaoSegundos: 15, cta: CTA_A, legenda: 'POV gravado mãos livres com suporte de peito para celular 🎥 Produto marcado.',
        exigeUsoReal: false, liberadoQuando: 'AO_RECEBER', faceless: true,
      },
      {
        id: 'suporte-montagem', titulo: 'Montagem em 30 segundos', estrutura: 'UNBOXING', objetivo: 'RETENCAO',
        hook: 'Abre comigo: como monta esse suporte de cabeça e peito.',
        roteiro: [
          et('Abertura', 'Abra a embalagem e mostre as peças.', 'Abrindo agora'),
          et('Demonstração', 'Monte o modo peitoral, depois troque para o modo cabeça.', 'Peito ou cabeça'),
          et('Benefício', 'Encaixe o celular e mostre o ângulo da câmera.', 'Ângulo POV'),
          et('CTA', 'Aponte para o produto marcado.', 'Produto marcado 👇'),
        ],
        duracaoSegundos: 30, cta: CTA_B, legenda: 'Montando o suporte de cabeça e peito para celular 📦 Produto marcado.',
        exigeUsoReal: false, liberadoQuando: 'AO_RECEBER', faceless: true,
      },
      {
        id: 'suporte-usos', titulo: '3 jeitos de usar', estrutura: 'LISTA_3_MOTIVOS', objetivo: 'CLIQUE',
        hook: '3 jeitos de usar um suporte de peito para celular.',
        roteiro: [
          et('Motivo 1', 'Cozinha: receita em POV, com o suporte em ação.', 'Cozinha'),
          et('Motivo 2', 'Unboxing de um pacote em POV.', 'Unboxing'),
          et('Motivo 3', 'Organização de uma gaveta em POV.', 'Organização'),
          et('CTA', 'Aponte para o produto marcado.', 'Produto marcado 👇'),
        ],
        duracaoSegundos: 15, cta: CTA_A, legenda: '3 jeitos de usar o suporte de peito para celular 📱 Produto marcado.',
        exigeUsoReal: false, liberadoQuando: 'AO_RECEBER', faceless: true,
      },
    ],
    hooks: ['POV: este vídeo foi gravado sem segurar o celular.', 'Abre comigo: como monta esse suporte de cabeça e peito.', '3 jeitos de usar um suporte de peito para celular.'],
    ctas: [CTA_A, CTA_B],
    legendas: ['POV gravado mãos livres com suporte de peito para celular 🎥 Produto marcado.', '3 jeitos de usar o suporte de peito para celular 📱 Produto marcado.'],
    hashtags: ['#tiktokshop', '#pov', '#suportecelular', '#criadordeconteudo', '#achadinhos'],
    disclosure: DISCLOSURE,
    planoAB: { a: 'suporte-pov', b: 'suporte-usos', mede: 'retenção média e cliques no produto', regra: 'Mesma duração (15 s); POV puro × lista de usos.' },
    midiaNecessaria: ['POV gravado com o suporte (celular no peito)', '1 cena de câmera externa mostrando o suporte no corpo (pescoço para baixo, se preferir)'],
    cenasParaGravar: [
      'Embalagem e peças sobre a mesa (3 s)',
      'Montagem no modo peito e no modo cabeça (8 s)',
      'POV na cozinha, mãos livres (5–8 s)',
      'POV abrindo um pacote (5 s)',
      'Câmera externa mostrando o suporte vestido (3 s)',
    ],
    alternativaFaceless: 'Todo POV é faceless por natureza; a câmera externa pode enquadrar do pescoço para baixo.',
    riscosDeClaim: [
      'Não prometer estabilização "profissional" nem compatibilidade com todos os celulares sem conferir a embalagem.',
      'Não afirmar conforto por horas antes de usar de verdade.',
    ],
    usosOperacionais: [
      'Gravar os vídeos POV dos demais produtos (mãos livres): Hidrabene (rotina), depilador (bancada), almofadas (montagem da sala).',
      'Unboxings das próximas amostras assim que chegarem.',
      'Cozinha, organização e produtos domésticos.',
      'Beleza: demonstrações em que as duas mãos precisam aparecer.',
    ],
  },
  {
    chave: chaveDeProduto({ nome: 'Capa de almofadas de Natal' }),
    produto: 'Capa de almofadas de Natal',
    categoria: 'Casa e Decoração',
    papeis: ['PRODUTO_AFILIADO'],
    campanha: 'natal-2026',
    objetivo: 'CLIQUE → VENDA na janela de Natal 2026 — transformação do ambiente, baixo ticket, presente/decoração.',
    formatoRecomendado: 'Antes/depois da decoração do sofá (legítimo: é troca de capa, não promessa de resultado).',
    duracaoRecomendada: '15 s (transformação) e 30 s (montagem completa).',
    exigeUsoReal: false,
    exigeDemonstracao: true,
    podeSerFaceless: true,
    roteiros: [
      {
        id: 'almofadas-antes-depois', titulo: 'Antes/depois do sofá', estrutura: 'ANTES_DEPOIS', objetivo: 'VENDA',
        hook: 'Antes e depois de deixar o sofá no clima de Natal.',
        roteiro: [
          et('Problema', 'Sofá com as capas de sempre (plano aberto).', 'Antes'),
          et('Demonstração', 'Troque as capas em corte rápido, mãos apenas.', 'Trocando'),
          et('Desejo', 'Plano aberto do sofá com as capas de Natal, luz quente.', 'Depois 🎄'),
          et('CTA', 'Aponte para o produto marcado.', 'Produto marcado 👇'),
        ],
        duracaoSegundos: 15, cta: CTA_A, legenda: 'Antes e depois: o sofá no clima de Natal em 15 segundos 🎄 Produto marcado.',
        exigeUsoReal: false, liberadoQuando: 'AO_RECEBER', faceless: true,
      },
      {
        id: 'almofadas-presente', titulo: 'Ideia de presente barato', estrutura: 'PRESENTE', objetivo: 'VENDA',
        hook: 'Uma ideia de presente de Natal para quem ama decorar a casa.',
        roteiro: [
          et('Para quem', 'Diga para quem é: quem gosta de decorar a casa no fim do ano.', 'Para quem é'),
          et('Demonstração', 'Mostre a capa dobrada como presente e depois na almofada.', 'Vira decoração'),
          et('Benefício', 'Mostre o tecido e a estampa de perto.', 'Detalhe da estampa'),
          et('CTA', 'Aponte para o produto marcado.', 'Produto marcado 👇'),
        ],
        duracaoSegundos: 15, cta: CTA_B, legenda: 'Ideia de presente de Natal para quem ama decorar 🎁 Produto marcado.',
        exigeUsoReal: false, liberadoQuando: 'AO_RECEBER', faceless: true,
      },
      {
        id: 'almofadas-montagem', titulo: 'Montando a sala de Natal', estrutura: 'NATAL', objetivo: 'CLIQUE',
        hook: 'Preparando o Natal por aqui: começando pelas almofadas.',
        roteiro: [
          et('Para quem', 'Abra mostrando a sala ainda sem decoração.', 'Começando o Natal'),
          et('Demonstração', 'Coloque as capas e organize as almofadas (POV com o suporte, se já tiver chegado).', 'Capas de Natal'),
          et('Desejo', 'Feche com a sala pronta e luz quente.', 'Ideia para o Natal 🎄'),
          et('CTA', 'Aponte para o produto marcado.', 'Produto marcado 👇'),
        ],
        duracaoSegundos: 30, cta: CTA_A, legenda: 'Preparando a sala para o Natal, começando pelas almofadas 🎄 Produto marcado.',
        exigeUsoReal: false, liberadoQuando: 'AO_RECEBER', faceless: true,
      },
    ],
    hooks: ['Antes e depois de deixar o sofá no clima de Natal.', 'Uma ideia de presente de Natal para quem ama decorar a casa.', 'Preparando o Natal por aqui: começando pelas almofadas.'],
    ctas: [CTA_A, CTA_B],
    legendas: ['Antes e depois: o sofá no clima de Natal em 15 segundos 🎄 Produto marcado.', 'Ideia de presente de Natal para quem ama decorar 🎁 Produto marcado.'],
    hashtags: ['#tiktokshop', '#natal', '#decoracaodenatal', '#casadecorada', '#achadinhos'],
    disclosure: DISCLOSURE,
    planoAB: { a: 'almofadas-antes-depois', b: 'almofadas-presente', mede: 'cliques no produto e vendas na janela de Natal', regra: 'Mesma duração (15 s); transformação × presente.' },
    midiaNecessaria: ['vídeo vertical do sofá antes e depois (mesmo enquadramento)', 'close da estampa e do tecido'],
    cenasParaGravar: [
      'Sofá com as capas atuais, plano aberto, câmera fixa (3 s)',
      'Trocando as capas, mãos apenas (5 s)',
      'Mesmo enquadramento com as capas de Natal, luz quente (3 s)',
      'Close da estampa e do tecido (2 s)',
      'Capa dobrada como presente (2 s)',
    ],
    alternativaFaceless: 'Todo o kit é faceless: sofá, mãos e detalhes.',
    riscosDeClaim: [
      'Antes/depois só da DECORAÇÃO (troca de capa); nada de promessa de durabilidade ou "não desbota".',
      'Tamanho e tecido só como estiver na embalagem/anúncio.',
      'Natal: conteúdo sazonal — publicar dentro da janela (prioridade sazonal, sem perder o prazo da amostra).',
    ],
  },
]

// ── Checagens (FUNÇÕES PURAS) ───────────────────────────────────────────

/** Depoimento antes do uso real: proibido no texto do Patrono (a opinião é da titular, com as palavras dela). */
export const DEPOIMENTO = /\b(eu\s+(uso|usei|testei|amei|aprovo|recomendo)|testei|usei|depois de usar|minha pele (ficou|est[aá])|uso todo dia|uso h[aá]|me apaixonei|virou meu favorito|recomendo demais|funciona mesmo)\b/i

/** A legenda que vai ao ar: texto + divulgação de afiliado + hashtags (mesma montagem do motor de vídeos). */
export function legendaCompleta(k: Pick<KitDeConteudo, 'disclosure' | 'hashtags'>, legenda: string): string {
  return [legenda, k.disclosure, k.hashtags.join(' ')].join('\n\n')
}

export function textosDoKit(k: KitDeConteudo): string[] {
  return [
    ...k.hooks, ...k.ctas, ...k.legendas,
    ...k.roteiros.flatMap((r) => [r.hook, r.legenda, r.cta, ...r.roteiro.flatMap((e) => [e.texto, e.textoNaTela ?? ''])]),
  ].filter(Boolean)
}

export interface ChecagemDoKit {
  chave: string
  depoimentos: string[]
  claims: string[]
  qualityGate: { id: string; veredito: AvaliacaoDoVideo['veredito']; resumo: string; motivos: string[] }[]
  ok: boolean
}

export function checarKit(k: KitDeConteudo): ChecagemDoKit {
  const textos = textosDoKit(k)
  const depoimentos = textos.filter((t) => DEPOIMENTO.test(t))
  const claims = [...new Set(textos.flatMap((t) => claimsNaoComprovados(t)))]
  const qualityGate = k.roteiros.map((r) => {
    const a = avaliarVideo(
      { gancho: r.hook, roteiro: r.roteiro, cta: r.cta, legenda: legendaCompleta(k, r.legenda), disclosure: k.disclosure, hashtags: k.hashtags, duracaoSegundos: r.duracaoSegundos, exigeExperienciaReal: r.exigeUsoReal, objetivo: r.objetivo },
      { tiktokShop: true }
    )
    return { id: r.id, veredito: a.veredito, resumo: a.resumo, motivos: a.motivos }
  })
  const ok = !depoimentos.length && !claims.length && qualityGate.every((q) => q.veredito !== 'BLOQUEADO')
  return { chave: k.chave, depoimentos, claims, qualityGate, ok }
}

export function kitDaChave(chave: string): KitDeConteudo | null {
  return KITS_DE_AMOSTRAS.find((k) => k.chave === chave) ?? null
}

/** Para a tela: o kit com a checagem e o que está liberado AGORA (antes do uso real, só os "AO_RECEBER"). */
export function kitParaTela(chave: string, recebida: boolean) {
  const k = kitDaChave(chave)
  if (!k) return null
  return {
    ...k,
    checagem: checarKit(k),
    liberados: k.roteiros.filter((r) => r.liberadoQuando === 'AO_RECEBER').map((r) => r.id),
    aguardandoUsoReal: k.roteiros.filter((r) => r.liberadoQuando === 'APOS_USO_REAL').map((r) => r.id),
    situacao: recebida ? 'Pronto para gravar.' : 'Preparado antes da entrega (planejamento, não depoimento).',
  }
}
