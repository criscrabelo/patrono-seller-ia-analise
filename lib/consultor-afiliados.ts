/**
 * P2.17.3 — Consultor de afiliados. FUNÇÃO PURA, regras + dados reais, sem IA.
 *
 * Para cada oportunidade responde, em primeira pessoa e linguagem simples:
 * vale a pena? por quê? programa? canal? formato? comissão? evidência de
 * venda? sazonalidade? risco? próximo passo?
 *
 * Disciplina:
 *  - só usa o que está no candidato e no registro de programas
 *    (lib/affiliate-providers.ts, com data da verificação e fonte);
 *  - o que não se sabe é dito como desconhecido, nunca preenchido;
 *  - evidência de venda pesa mais que sazonalidade e comissão;
 *  - nesta fase o canal é só o TikTok (sem dispersar para outros canais).
 */
import { ehProdutoTikTokShop } from './tiktok-shop-link'
import { buscarProvider } from './affiliate-providers'
import { planejarVideos } from './motor-de-videos-tiktok'
import type { AnaliseDaMeta } from './metas-tiktok'

export type Veredito = 'PRIORIZAR' | 'TESTAR' | 'AGUARDAR' | 'EVITAR'

export interface EntradaDoConsultor {
  nome: string
  categoria: string | null
  preco: number | null
  providerId: string | null
  linkProduto: string | null
  comissaoPercentual: number | null
  comissaoValor: number | null
  vendas: number | null
  baseDeEvidencia: number
  confianca: string
  nivelDeRisco: string | null
  riscos: string[]
  complianceBloqueante?: boolean
  publicacaoImpedida: boolean
  campanha: { nome: string; aderencia: number; tags: string[] } | null
}

export interface Consultoria {
  veredito: Veredito
  resumo: string
  valeAPena: string
  porque: string[]
  programa: string
  canal: string
  formato: string
  comissao: string
  evidencia: string
  sazonalidade: string
  risco: string
  proximoPasso: string
}

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const NOME_DA_ESTRUTURA: Record<string, string> = {
  DEMONSTRACAO: 'demonstração rápida',
  PROBLEMA_SOLUCAO: 'problema → solução',
  PRESENTE: 'ideia de presente',
  ACHADO_TIKTOK_SHOP: '"olha o que eu achei no TikTok Shop"',
  LISTA_3_MOTIVOS: '"3 motivos para…"',
  POV: 'POV',
  FACELESS: 'só as mãos (sem aparecer)',
}

export function consultar(c: EntradaDoConsultor, agora: Date = new Date(), metas: AnaliseDaMeta[] = []): Consultoria {
  const tiktokShop = ehProdutoTikTokShop(c.providerId, c.linkProduto)
  const provider = c.providerId ? buscarProvider(c.providerId) : undefined

  // Evidência de venda: o que existe de fato.
  const vendasFortes = typeof c.vendas === 'number' && c.vendas >= 100
  const evidenciaForte = vendasFortes || c.baseDeEvidencia >= 60
  const evidenciaFraca = !evidenciaForte && c.baseDeEvidencia < 40
  const evidencia = typeof c.vendas === 'number'
    ? `${c.vendas.toLocaleString('pt-BR')} vendidos (dado da loja); base de evidência ${c.baseDeEvidencia}/100.`
    : `Vendas não informadas pela fonte; base de evidência ${c.baseDeEvidencia}/100${evidenciaFraca ? ' (fraca)' : ''}.`

  const comissaoBoa = (c.comissaoPercentual ?? 0) >= 15 || (c.comissaoValor ?? 0) >= 10
  const comissao = c.comissaoValor !== null
    ? `${c.comissaoPercentual !== null ? `${c.comissaoPercentual}% ≈ ` : '≈ '}${reais(c.comissaoValor)} por venda.`
    : c.comissaoPercentual !== null ? `${c.comissaoPercentual}% (preço desconhecido, sem valor por venda).` : 'Comissão não informada: confira no programa antes de investir tempo.'

  const natal = c.campanha && c.campanha.aderencia > 0 ? c.campanha : null
  const sazonalidade = natal
    ? `Combina com ${natal.nome} (aderência ${natal.aderencia}/100; ${natal.tags.join(', ')}).`
    : c.campanha ? `Pouca ligação com ${c.campanha.nome}.` : 'Sem campanha sazonal ativa.'

  const missoesDeVideo = metas.filter((m) => m.usaProdutoNoVideo && (m.situacao === 'EM_ANDAMENTO' || m.situacao === 'NAO_INICIADA'))
  const ajudaMissao = tiktokShop && missoesDeVideo.length > 0

  const programa = provider
    ? `${provider.nome} — regras conferidas em ${provider.lastVerifiedAt} (fonte: ${provider.fonteDasRegras}).`
    : tiktokShop ? 'TikTok Shop (link de produto reconhecido); regras do programa ainda não conferidas para este produto.' : 'Programa não identificado: informe de qual programa é o link.'

  const canal = tiktokShop
    ? 'TikTok, com o produto marcado no vídeo (a comissão do TikTok Shop vem da marcação).'
    : 'TikTok com link na bio — sem comissão do TikTok Shop por este vídeo.'

  const plano = planejarVideos({ nome: c.nome, categoria: c.categoria, preco: c.preco, vendas: c.vendas, tiktokShop }, agora)
  const primeira = plano.testeInicial.variantes[0]?.split('-')[0] ?? 'DEMONSTRACAO'
  const formato = `${NOME_DA_ESTRUTURA[primeira] ?? 'demonstração rápida'}, vídeo curto (15 s); potencial ${plano.potencial.nivel.toLowerCase()} — ${plano.potencial.aviso.toLowerCase()}`

  const bloqueado = c.complianceBloqueante || c.nivelDeRisco === 'ALTO'
  const risco = bloqueado
    ? `Alto: ${c.riscos[0] ?? 'regra de compliance.'}`
    : c.riscos.length ? c.riscos.slice(0, 2).join(' ') : 'Nenhum risco relevante encontrado com os dados disponíveis.'

  // Veredito: evidência > Natal/missão > comissão.
  let veredito: Veredito
  if (bloqueado) veredito = 'EVITAR'
  else if (evidenciaForte) veredito = 'PRIORIZAR'
  else if (natal && natal.aderencia >= 50 || comissaoBoa || ajudaMissao) veredito = 'TESTAR'
  else veredito = 'AGUARDAR'

  const porque: string[] = []
  if (evidenciaForte) porque.push(vendasFortes ? 'já vende de verdade' : 'tem boa base de evidência')
  if (natal) porque.push(`combina com ${natal.nome}`)
  if (ajudaMissao) porque.push('ajuda a cumprir uma missão do TikTok Shop que paga recompensa')
  if (comissaoBoa) porque.push('a comissão é boa')
  if (plano.facilidadeDeVideo >= 75) porque.push('é fácil de mostrar em vídeo')

  const resumo =
    veredito === 'EVITAR' ? `Eu evitaria este agora porque ${risco.replace(/^Alto: /, '').toLowerCase()}`
      : veredito === 'PRIORIZAR' ? `Eu priorizaria este produto porque ${porque.join(', ')}.`
        : veredito === 'TESTAR'
          ? `${comissaoBoa && evidenciaFraca ? 'A comissão é boa, mas a evidência de venda ainda é fraca. ' : ''}Eu testaria com poucos vídeos porque ${porque.join(', ') || 'há sinais, mas pouca prova'}.`
          : 'Eu aguardaria: ainda não há evidência de venda, campanha nem comissão que justifiquem o tempo agora.'

  const valeAPena = { PRIORIZAR: 'Sim, vale priorizar.', TESTAR: 'Vale testar com poucos vídeos.', AGUARDAR: 'Ainda não.', EVITAR: 'Não agora.' }[veredito]
  const proximoPasso =
    veredito === 'EVITAR' ? 'Descartar ou resolver o risco antes de qualquer conteúdo.'
      : !tiktokShop ? 'Se houver o mesmo produto no TikTok Shop, prefira ele (comissão e missões).'
        : veredito === 'PRIORIZAR' ? `Escolher o produto e gravar os ${plano.testeInicial.variantes.length} vídeos do teste A/B/C.`
          : veredito === 'TESTAR' ? 'Gravar 1–2 vídeos de teste e medir clique no produto antes de investir mais.'
            : 'Voltar a avaliar quando houver vendas ou comissão informadas.'

  return { veredito, resumo, valeAPena, porque, programa, canal, formato, comissao, evidencia, sazonalidade, risco, proximoPasso }
}
