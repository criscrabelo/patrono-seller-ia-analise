import Anthropic from '@anthropic-ai/sdk'
import { guardarChamadaPaga } from './cost-safety-gate'
import { esperaMaximaDeProviderMs } from './limite-sincrono'
import type { ConteudoGerado, VideoSellerOutput, AlertaCompliance } from '@/types'

/**
 * P2.5: endereço da Anthropic FIXO. O SDK leria `ANTHROPIC_BASE_URL` do
 * ambiente — e a Netlify injeta essa variável (com uma chave própria)
 * apontando para o AI Gateway dela, que cobra em créditos da conta. Com o
 * endereço fixo, uma chave injetada pela plataforma só consegue falhar na
 * Anthropic; ela nunca é aceita, nunca cobra crédito da Netlify.
 *
 * E nada disso libera chamada: o gate de custo exige PAID_AI_ENABLED=true E
 * orçamento > 0 antes de qualquer requisição (lib/cost-safety-gate.ts).
 */
export const ENDERECO_DA_ANTHROPIC = 'https://api.anthropic.com'

// P2.50: maxRetries 0 — com orçamento ligado, uma reserva cobre UMA chamada (o SDK repetiria até 2x por conta própria).
const client = new Anthropic({
  maxRetries: 0,
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: ENDERECO_DA_ANTHROPIC,
})

const MODEL = 'claude-sonnet-4-6'

/**
 * CUSTO ZERO POR PADRÃO (Rodada 14): a API da Anthropic cobra por token.
 * Nenhuma das funções abaixo alcança a rede sem passar por aqui.
 *
 * Bloqueado, o chamador recebe `BloqueadoPorPoliticaDeCusto` e deve usar o
 * caminho determinístico gratuito — `gerarPresetTikTokDigitalTwinV1()` cobre
 * hook, caption, CTA, hashtags e disclosures sem IA paga.
 */
export class BloqueadoPorPoliticaDeCusto extends Error {
  constructor(
    public readonly provider: string,
    public readonly operacao: string,
    public readonly fallback: string | null,
    mensagem: string
  ) {
    super(mensagem)
    this.name = 'BloqueadoPorPoliticaDeCusto'
  }
}

/**
 * Gate de custo de TODAS as chamadas pagas deste arquivo.
 *
 * Correções da revisão final do P0.1:
 *
 * 1. NÃO passa mais `custoEstimado: null`. Passar `null` explicitamente
 *    anulava a tabela central `CUSTO_ESTIMADO_BRL`: sem estimativa,
 *    `avaliarCusto` bloqueia SEMPRE — nem com `PAID_AI_ENABLED=true` e
 *    orçamento positivo a operação era liberada. Omitindo o campo, o gate
 *    usa o teto conservador da tabela, que é o comportamento pretendido.
 *    O custo por token só se conhece depois da resposta; o teto da tabela é
 *    deliberadamente maior que a média para errar para o lado de gastar
 *    menos.
 *
 * 2. `workspaceId` é OBRIGATÓRIO na assinatura (pode ser `null`, mas quem
 *    chama tem de decidir conscientemente). Com serviços pagos habilitados,
 *    `null` bloqueia — sem workspace não há como apurar o gasto do mês.
 *
 * 3. Cada função usa a SUA operação. Antes as três usavam 'gerar-roteiro',
 *    o que misturava custos e fallbacks diferentes no mesmo registro de
 *    auditoria e tornava o consumo por operação impossível de ler.
 */
async function exigirPermissaoDeCusto(operacao: string, workspaceId: string | null): Promise<void> {
  const guarda = await guardarChamadaPaga({
    provider: 'anthropic',
    operacao,
    workspaceId,
  })
  if (!guarda.permitido) {
    throw new BloqueadoPorPoliticaDeCusto(
      'anthropic',
      operacao,
      guarda.fallback?.alternativa ?? null,
      `${guarda.decisao.explicacao} Alternativa gratuita: ${guarda.fallback?.alternativa ?? 'nenhuma'}.`
    )
  }
}

// ─── Geração principal de conteúdo ───────────────────────────────────────────

export interface ProdutoParaGeracao {
  nome: string
  preco?: number | null
  categoria: string
  publicoAlvo: string[]
  tipoVenda: string
  origemConteudo: string
  descricao?: string
  observacoes?: string
  beneficios: string[]
  pontosNegativos: string[]
}

export interface ConfiguracaoGeracao {
  redeSocial: string
  duracao: number
  estilo: string
  objetivo: string
}

/** P2.50 (Codex 24): texto padrão — a nota do produto vem do motor com evidência, nunca da IA de texto. */
export const VEREDITO_SEM_AVALIACAO = 'Avaliação do produto não é feita pela IA de texto: veja a pontuação com evidência em Oportunidades.'

export async function gerarConteudo(
  produto: ProdutoParaGeracao,
  config: ConfiguracaoGeracao,
  workspaceId: string | null = null,
): Promise<ConteudoGerado> {
  const afiliado = produto.tipoVenda === 'Afiliado'
  const beneficios = produto.beneficios.filter(Boolean).slice(0, 3).join(' | ') || 'não informado'

  const userPrompt = `Crie conteúdo comercial para ${config.redeSocial}.

PRODUTO: ${produto.nome}
CATEGORIA: ${produto.categoria}
BENEFÍCIOS: ${beneficios}
ESTILO: ${config.estilo} | DURAÇÃO: ${config.duracao}s | OBJETIVO: ${config.objetivo}
${afiliado ? 'AFILIADO: sim — inclua #publi e mencione "link na bio"' : ''}

Use só os dados acima: não invente números, avaliações, resultados ou alegações sobre o produto.
Retorne APENAS este JSON (valores curtos e diretos):
{
  "roteiro": "roteiro cena a cena, máx 250 chars",
  "legenda": "legenda para ${config.redeSocial}, máx 200 chars${afiliado ? ', com #publi' : ''}",
  "hashtags": ["5 a 8 hashtags sem #"],
  "textoTela": "texto para aparecer na tela, máx 60 chars",
  "narracao": "narração em voz off, máx 150 chars",
  "chamadaAcao": "CTA direto, máx 60 chars",
  "promptVideoIA": "video prompt em INGLÊS detalhado para Kling/Runway, descrevendo cena, movimento e estilo, máx 250 chars",
  "promptCurto": "video prompt em INGLÊS compacto, máx 80 chars",
  "alertasCompliance": [{"tipo":"publicidade","mensagem":"...","severidade":"verde","acaoRecomendada":"..."}]
}`

  await exigirPermissaoDeCusto('gerar-roteiro', workspaceId)
  // P2.2: na Netlify a rota morre aos 30 s. Teto de 24 s e nenhuma repetição
  // automática — repetir uma chamada paga que estourou o tempo só cobraria
  // de novo para estourar de novo. Fora da Netlify, o padrão de sempre.
  const teto = esperaMaximaDeProviderMs()
  const message = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 900,
      system: 'Especialista em conteúdo comercial brasileiro. Retorne APENAS JSON válido, sem markdown.',
      messages: [{ role: 'user', content: userPrompt }],
    },
    teto ? { timeout: teto, maxRetries: 0 } : undefined
  )

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const motivo =
      message.stop_reason === 'max_tokens'
        ? 'A resposta foi cortada (limite de tokens). Tente reduzir o conteúdo ou avise o suporte.'
        : 'A IA retornou um formato inválido. Tente novamente.'
    throw new Error(`Falha ao interpretar resposta da IA: ${motivo}`)
  }

  const legenda = (parsed.legenda as string) ?? ''

  // Mapeia a legenda gerada para o campo correto da rede selecionada
  const legendaMap: Partial<Record<string, string>> = {
    'TikTok': 'legendaTiktok',
    'Instagram Reels': 'legendaInstagram',
    'YouTube Shorts': 'legendaYoutube',
    'WhatsApp': 'legendaWhatsapp',
    'Facebook': 'legendaFacebook',
    'Marketplace': 'legendaMarketplace',
  }
  const campoLegenda = legendaMap[config.redeSocial] ?? 'legendaInstagram'

  return {
    roteiro: (parsed.roteiro as string) ?? '',
    legendaTiktok: campoLegenda === 'legendaTiktok' ? legenda : '',
    legendaInstagram: campoLegenda === 'legendaInstagram' ? legenda : '',
    legendaYoutube: campoLegenda === 'legendaYoutube' ? legenda : '',
    legendaWhatsapp: campoLegenda === 'legendaWhatsapp' ? legenda : '',
    legendaFacebook: campoLegenda === 'legendaFacebook' ? legenda : '',
    legendaMarketplace: campoLegenda === 'legendaMarketplace' ? legenda : '',
    hashtags: (parsed.hashtags as string[]) ?? [],
    textoTela: (parsed.textoTela as string) ?? '',
    narracao: (parsed.narracao as string) ?? '',
    trilhaSugerida: '',
    promptVideoIA: (parsed.promptVideoIA as string) ?? '',
    promptCurto: (parsed.promptCurto as string) ?? '',
    chamadaAcao: (parsed.chamadaAcao as string) ?? '',
    // P2.50 (Codex 24): a IA de texto não avalia o produto — nota e veredito sem pesquisa
    // comprovada eram opinião com cara de dado. A avaliação é a do motor (Oportunidades).
    notaProduto: null,
    pontosPositivos: [],
    pontosNegativos: [],
    veredito: VEREDITO_SEM_AVALIACAO,
    alertasCompliance: (parsed.alertasCompliance as AlertaCompliance[]) ?? [],
  }
}

// ─── Video Seller ─────────────────────────────────────────────────────────────

export interface EntradaVideoSeller {
  nome: string
  descricao?: string
  publicoAlvo: string
  plataforma: string
  duracao: number
  objetivo: string
  estilo: string
  temImagem?: boolean
}

export async function gerarVideoSeller(
  entrada: EntradaVideoSeller,
  workspaceId: string | null = null
): Promise<VideoSellerOutput> {
  const userPrompt = `Crie roteiro e prompt de vídeo comercial para:

PRODUTO: ${entrada.nome}
DESCRIÇÃO: ${entrada.descricao || 'Não informada'}
PÚBLICO-ALVO: ${entrada.publicoAlvo}
PLATAFORMA: ${entrada.plataforma}
DURAÇÃO: ${entrada.duracao} segundos
OBJETIVO: ${entrada.objetivo}
ESTILO: ${entrada.estilo}

Retorne JSON com:
{
  "analiseProduto": {
    "tipo": "string",
    "publicoAlvo": "string",
    "diferenciais": ["string"],
    "melhorFormato": "string"
  },
  "objetivoVideo": "string",
  "ideaCentral": "string",
  "roteiro": [
    {
      "cena": 1,
      "inicio": "0s",
      "fim": "3s",
      "descricaoVisual": "string",
      "movimento": "string",
      "textoTela": "string",
      "som": "string",
      "objetivo": "string"
    }
  ],
  "textosTela": ["string"],
  "narracao": "string",
  "estiloVisual": "string",
  "sugestaoMusica": "string",
  "promptCompleto": "string detalhado em inglês para Runway/Kling/Pika/Veo",
  "promptCurto": "string em inglês versão compacta",
  "ctaFinal": ["string"],
  "variacoesTeste": [
    {
      "versao": "A",
      "descricao": "string",
      "diferencial": "string"
    }
  ],
  "hashtagsSugeridas": ["string"],
  "tituloSugerido": "string"
}`

  await exigirPermissaoDeCusto('gerar-video-seller', workspaceId)
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: `Você é o Patrono Video Seller, especialista em criação de vídeos comerciais para e-commerce brasileiro.
Crie roteiros profissionais, persuasivos e otimizados para conversão.
Os prompts de vídeo devem ser em inglês, detalhados e compatíveis com Runway, Kling, Pika e Veo.
Retorne APENAS JSON válido, sem markdown, sem explicações.`,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  try {
    return JSON.parse(cleaned) as VideoSellerOutput
  } catch {
    throw new Error('Falha ao interpretar resposta do Video Seller. Tente novamente.')
  }
}

// ─── Análise de Compliance ────────────────────────────────────────────────────

export async function analisarCompliance(params: {
  roteiro: string
  legenda: string
  tipoVenda: string
  origemConteudo: string
  workspaceId?: string | null
}): Promise<AlertaCompliance[]> {
  const userPrompt = `Analise este conteúdo para riscos legais e de plataforma no contexto brasileiro:

ROTEIRO: ${params.roteiro}
LEGENDA: ${params.legenda}
TIPO DE VENDA: ${params.tipoVenda}
ORIGEM DO CONTEÚDO: ${params.origemConteudo}

Retorne JSON:
{
  "alertas": [
    {
      "tipo": "publicidade|copyright|ia|enganoso|plataforma",
      "mensagem": "string",
      "severidade": "verde|amarelo|vermelho",
      "acaoRecomendada": "string"
    }
  ]
}`

  await exigirPermissaoDeCusto('analisar-compliance', params.workspaceId ?? null)
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: `Você é especialista em compliance de marketing digital, LGPD, direitos autorais e regras de plataformas (TikTok, Instagram, YouTube) no Brasil.
Retorne APENAS JSON válido.`,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
  const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  try {
    const parsed = JSON.parse(cleaned)
    return parsed.alertas as AlertaCompliance[]
  } catch {
    return []
  }
}
