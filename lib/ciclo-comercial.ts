/**
 * P2.51 — CICLO COMERCIAL: descoberta → avaliação → seleção → afiliação → direitos → campanha.
 *
 * FUNÇÕES PURAS. Reaproveitam o motor que já existe (pontuarProduto, linkDoTikTokShop, situacaoDaAffiliateApi);
 * este módulo só junta as peças e REGISTRA o que falta, sem inventar dado:
 *  - descoberta SÓ de fonte real (export oficial do Creator Center que a titular baixou; histórico da curadoria;
 *    Affiliate API quando existir). Nada de produto de exemplo, nada de scraping;
 *  - dado ausente (vendas, avaliação, estoque, comissão vigente) vira LIMITAÇÃO escrita, nunca número;
 *  - o "não quero" da titular é feedback: o produto descartado não volta a ser proposto;
 *  - afiliação dependente de credenciamento/autorização BLOQUEIA a liberação comercial, com a pendência;
 *  - cada ativo do vídeo tem origem e permissão; terceiro sem licença, mídia de outro produto ou a voz da titular
 *    sem a aprovação dela para ESTE produto reprovam a cadeia de direitos.
 */
import { calcularDesempenhoHistorico, pontuarProduto, type ProdutoDoCatalogo } from './motor-de-oportunidades'
import { linkDoTikTokShop } from './tiktok-shop-link'
import { situacaoDaAffiliateApi } from './elegibilidade-tiktok-shop'

export type FonteDaDescoberta = 'CREATOR_CENTER_EXPORT' | 'CURADORIA_ANTERIOR' | 'TIKTOK_SHOP_AFFILIATE_API'
export type Plataforma = 'TIKTOK_SHOP' | 'SHOPEE' | 'OUTRA'

export interface ProdutoDescoberto {
  chave: string
  fonte: FonteDaDescoberta
  /** de onde exatamente: arquivo + sha256, ou "consulta somente leitura de <data>" */
  fonteDetalhe: string
  plataforma: Plataforma
  externalId: string | null
  nome: string
  loja: string | null
  link: string | null
  categoria: string | null
  precoUnitario: number | null
  /** % oficial da fonte; null = a fonte não informa */
  comissaoPercentual: number | null
  comissaoObservadaEm: string | null
  evidencias: string[]
  /** o que a titular já decidiu sobre este produto */
  feedbackDaTitular: 'DESCARTOU' | 'ESCOLHEU' | null
  observadoEm: string
}

/** Linha do export oficial (lib/creator-center-csv.ts → lerTabelaDoCreatorCenter). */
export interface LinhaDoCreatorCenter {
  produtoIdExterno: string | null; produtoNome: string | null; lojaNome: string | null; quantidade: number | null
  valorBase: number | null; taxaComissao: number | null; tipoConteudo: string | null; estado: string; statusOriginal?: string | null; dataPedido: string | Date | null
}

const plataformaDoLink = (link: string | null): Plataforma => !link ? 'OUTRA' : linkDoTikTokShop(link).ehProduto ? 'TIKTOK_SHOP' : /shopee\.com/i.test(link) ? 'SHOPEE' : 'OUTRA'
const iso = (d: string | Date | null) => (d ? new Date(d).toISOString() : null)

/** Um produto por id oficial; cada pedido real vira evidência (sem somar como venda: só LIQUIDADA é receita). */
export function descobrirDoCreatorCenter(linhas: LinhaDoCreatorCenter[], origem: { arquivo: string; sha256: string; lidoEm: Date }): ProdutoDescoberto[] {
  const por = new Map<string, ProdutoDescoberto>()
  for (const l of linhas) {
    if (!l.produtoIdExterno || !l.produtoNome) continue
    const link = `https://shop.tiktok.com/br/pdp/${l.produtoIdExterno}`
    const p = por.get(l.produtoIdExterno) ?? {
      chave: `tiktok-shop:${l.produtoIdExterno}`, fonte: 'CREATOR_CENTER_EXPORT' as const,
      fonteDetalhe: `export oficial do TikTok Creator Center (${origem.arquivo}, sha256 ${origem.sha256.slice(0, 16)})`,
      plataforma: 'TIKTOK_SHOP' as const, externalId: l.produtoIdExterno, nome: l.produtoNome.trim(), loja: l.lojaNome, link, categoria: null,
      precoUnitario: null, comissaoPercentual: null, comissaoObservadaEm: null, evidencias: [], feedbackDaTitular: null, observadoEm: origem.lidoEm.toISOString(),
    }
    if (l.valorBase !== null && l.quantidade) p.precoUnitario = Math.round((l.valorBase / l.quantidade) * 100) / 100
    if (l.taxaComissao !== null) { p.comissaoPercentual = Math.round(l.taxaComissao * 1000) / 10; p.comissaoObservadaEm = iso(l.dataPedido) }
    p.evidencias.push(`pedido real de ${iso(l.dataPedido)?.slice(0, 10) ?? 'data desconhecida'} via ${l.tipoConteudo ?? 'conteúdo desconhecido'} — situação oficial "${l.statusOriginal ?? l.estado}" (${l.estado})`)
    por.set(l.produtoIdExterno, p)
  }
  return [...por.values()]
}

/** Registro da curadoria anterior (CandidatoDeProduto), lido sem escrever. */
export interface RegistroDaCuradoria { fonte: string; externalId: string | null; nome: string; linkProduto: string | null; categoria: string | null; preco: number | null; comissaoPercentual: number | null; status: string; coletadoEm: string }

export function descobrirDaCuradoriaAnterior(regs: RegistroDaCuradoria[], origem: string): ProdutoDescoberto[] {
  return regs.map((r) => {
    const tts = r.linkProduto ? linkDoTikTokShop(r.linkProduto) : null
    const externalId = r.externalId ?? (tts?.ehProduto ? tts.productId ?? null : null)
    return {
      chave: externalId ? `tiktok-shop:${externalId}` : `link:${r.linkProduto ?? r.nome}`, fonte: 'CURADORIA_ANTERIOR' as const, fonteDetalhe: origem,
      plataforma: plataformaDoLink(r.linkProduto), externalId, nome: r.nome.trim(), loja: null, link: r.linkProduto, categoria: r.categoria,
      precoUnitario: r.preco, comissaoPercentual: r.comissaoPercentual, comissaoObservadaEm: r.comissaoPercentual !== null ? r.coletadoEm : null,
      evidencias: [`candidato da curadoria (fonte ${r.fonte}) coletado em ${r.coletadoEm.slice(0, 10)}`],
      feedbackDaTitular: r.status === 'DESCARTADO' ? 'DESCARTOU' as const : r.status === 'ESCOLHIDO' || r.status === 'CADASTRADO' ? 'ESCOLHEU' as const : null,
      observadoEm: r.coletadoEm,
    }
  })
}

/** Mesma chave = mesmo produto: a fonte oficial vence campo a campo; o feedback da titular nunca se perde. */
export function unirDescobertas(...listas: ProdutoDescoberto[][]): ProdutoDescoberto[] {
  const ordem: FonteDaDescoberta[] = ['TIKTOK_SHOP_AFFILIATE_API', 'CREATOR_CENTER_EXPORT', 'CURADORIA_ANTERIOR']
  const por = new Map<string, ProdutoDescoberto>()
  for (const p of listas.flat().sort((a, b) => ordem.indexOf(a.fonte) - ordem.indexOf(b.fonte))) {
    const x = por.get(p.chave)
    if (!x) { por.set(p.chave, { ...p, evidencias: [...p.evidencias] }); continue }
    for (const k of ['loja', 'link', 'categoria', 'precoUnitario', 'comissaoPercentual', 'comissaoObservadaEm'] as const) if (x[k] === null && p[k] !== null) (x as unknown as Record<string, unknown>)[k] = p[k]
    x.evidencias.push(...p.evidencias)
    x.feedbackDaTitular = x.feedbackDaTitular ?? p.feedbackDaTitular
  }
  return [...por.values()]
}

// ── Elegibilidade e avaliação ───────────────────────────────────────────────────────────────

export interface ContextoDoCiclo {
  agora: Date
  /** produtos que NÃO entram (ex.: o Emocionário, retido pelos direitos e fora da P2.51) */
  excluir: { chave: string; motivo: string }[]
  /** comissão observada há mais tempo que isto precisa ser reconferida no card oficial */
  comissaoValidaDias: number
}

export interface ProdutoAvaliado extends ProdutoDescoberto {
  elegivel: boolean
  motivosDeInelegibilidade: string[]
  score: number
  motivosPositivos: string[]
  riscos: string[]
  /** o que a fonte não informou — escrito, nunca estimado */
  limitacoes: string[]
  criterios: { nome: string; valor: string }[]
}

export const CRITERIOS_DE_SELECAO = [
  '1. Fonte real e identificável (export oficial, curadoria registrada ou API oficial); sem fonte, não entra.',
  '2. Respeito à decisão da titular: produto descartado ("NÃO QUERO") não volta a ser proposto.',
  '3. Produto excluído por regra do ciclo (ex.: Emocionário, retido pelos direitos) não entra.',
  '4. Link de produto válido; prioridade para TikTok Shop (marcável no vídeo).',
  '5. Score do motor de oportunidades (lib/motor-de-oportunidades.ts → pontuarProduto): base de evidência, aderência ao perfil, prontidão.',
  '6. Desempate: comissão oficial conhecida > evidência de pedido real > preço conhecido.',
  '7. Dado ausente (vendas, avaliação, estoque, comissão vigente) fica como limitação escrita: não soma nem subtrai por suposição.',
] as const

export function avaliarProduto(p: ProdutoDescoberto, ctx: ContextoDoCiclo): ProdutoAvaliado {
  const inel: string[] = []
  const exc = ctx.excluir.find((e) => e.chave === p.chave || (p.externalId && e.chave === `tiktok-shop:${p.externalId}`))
  if (exc) inel.push(exc.motivo)
  if (p.feedbackDaTitular === 'DESCARTOU') inel.push('A titular já descartou este produto ("NÃO QUERO"): não volta a ser proposto.')
  if (!p.link) inel.push('Sem link do produto na fonte.')
  const catalogo: ProdutoDoCatalogo = {
    id: p.chave, nome: p.nome, categoria: p.categoria ?? 'Outros', preco: p.precoUnitario, linkProduto: p.link, imagens: [],
    origemConteudo: 'De fornecedor', origemDados: p.fonte, providerId: p.plataforma === 'TIKTOK_SHOP' ? 'tiktok_shop' : null,
    status: 'ativo', removidoDaOrigemEm: null, createdAt: new Date(p.observadoEm), comissaoPercentual: p.comissaoPercentual,
  }
  const o = pontuarProduto(catalogo, calcularDesempenhoHistorico({ taxaConversao: null, receitaPorClique: null, cliques: 0, vendasElegiveis: 0, publicacoesRecentes: 0 }), { canaisCapazes: [], agora: ctx.agora })
  const lim: string[] = ['vendas do produto: a fonte não informa', 'avaliação e número de avaliações: a fonte não informa', 'estoque: a fonte não informa']
  if (p.comissaoPercentual === null) lim.push('comissão: nenhuma fonte oficial informou')
  else if (p.comissaoObservadaEm && (ctx.agora.getTime() - new Date(p.comissaoObservadaEm).getTime()) / 86_400_000 > ctx.comissaoValidaDias)
    lim.push(`comissão de ${p.comissaoPercentual}% observada em ${p.comissaoObservadaEm.slice(0, 10)} (mais de ${ctx.comissaoValidaDias} dias): reconferir no card oficial ao marcar`)
  if (p.precoUnitario === null) lim.push('preço: a fonte não informa')
  if (!p.categoria) lim.push('categoria: a fonte não informa')
  const pedidosReais = p.evidencias.filter((e) => e.startsWith('pedido real')).length
  return {
    ...p, elegivel: inel.length === 0, motivosDeInelegibilidade: inel, score: o.score,
    motivosPositivos: [...(o.motivosPositivos ?? []), ...(pedidosReais ? [`${pedidosReais} pedido(s) real(is) pela conta da titular (fonte oficial) — prova de que o produto está no programa de afiliados`] : [])],
    riscos: o.riscos ?? [], limitacoes: [...new Set([...lim, ...(o.dadosAusentes ?? []).filter((d) => d === 'taxaConversaoObservada' || d === 'receitaPorClique').map((d) => d === 'taxaConversaoObservada' ? 'conversão: sem histórico próprio' : 'receita por clique: sem histórico próprio')])],
    criterios: [
      { nome: 'plataforma', valor: p.plataforma }, { nome: 'score do motor', valor: String(o.score) },
      { nome: 'comissão oficial', valor: p.comissaoPercentual === null ? 'desconhecida' : `${p.comissaoPercentual}%` },
      { nome: 'pedidos reais (oficial)', valor: String(pedidosReais) }, { nome: 'preço unitário', valor: p.precoUnitario === null ? 'desconhecido' : `R$ ${p.precoUnitario.toFixed(2)}` },
      { nome: 'feedback da titular', valor: p.feedbackDaTitular ?? 'nenhum' },
    ],
  }
}

export interface Selecao { escolhido: ProdutoAvaliado | null; justificativa: string[]; alternativas: ProdutoAvaliado[]; descartados: { nome: string; motivos: string[] }[] }

export function selecionarPrioritario(avaliados: ProdutoAvaliado[]): Selecao {
  const ok = avaliados.filter((a) => a.elegivel)
  const pedidos = (a: ProdutoAvaliado) => a.evidencias.filter((e) => e.startsWith('pedido real')).length
  ok.sort((a, b) => Number(b.plataforma === 'TIKTOK_SHOP') - Number(a.plataforma === 'TIKTOK_SHOP') || b.score - a.score
    || Number(b.comissaoPercentual !== null) - Number(a.comissaoPercentual !== null) || pedidos(b) - pedidos(a) || Number(b.precoUnitario !== null) - Number(a.precoUnitario !== null))
  const e = ok[0] ?? null
  const justificativa = !e ? ['Nenhum produto elegível nas fontes reais disponíveis.'] : [
    `${e.nome} (${e.plataforma === 'TIKTOK_SHOP' ? 'TikTok Shop, marcável no vídeo' : e.plataforma}).`,
    `Fonte: ${e.fonteDetalhe}.`,
    `Score do motor: ${e.score}.`,
    e.comissaoPercentual !== null ? `Comissão oficial: ${e.comissaoPercentual}%${e.precoUnitario !== null ? ` (≈ R$ ${(e.precoUnitario * e.comissaoPercentual / 100).toFixed(2)} por unidade a R$ ${e.precoUnitario.toFixed(2)})` : ''}.` : 'Comissão: desconhecida.',
    ...e.motivosPositivos.slice(0, 3),
    `Limitações registradas: ${e.limitacoes.join('; ')}.`,
  ]
  return { escolhido: e, justificativa, alternativas: ok.slice(1), descartados: avaliados.filter((a) => !a.elegivel).map((a) => ({ nome: a.nome, motivos: a.motivosDeInelegibilidade })) }
}

// ── Afiliação ───────────────────────────────────────────────────────────────────────────────

export interface EstadoDaAfiliacao {
  /** a conta de afiliada está verificada (identidade/fiscal)? null = não confirmado por fonte oficial */
  contaVerificada: boolean | null
}
export interface VerificacaoDeAfiliacao {
  programa: 'CONFIRMADO_POR_FONTE_OFICIAL' | 'NAO_CONFIRMADO'
  linkValido: boolean
  linkDeAfiliado: string
  liberacaoComercial: 'LIBERADA' | 'BLOQUEADA'
  pendencias: string[]
}

export function verificarAfiliacao(p: ProdutoAvaliado, estado: EstadoDaAfiliacao, agora: Date, comissaoValidaDias: number): VerificacaoDeAfiliacao {
  const pend: string[] = []
  const tts = p.link ? linkDoTikTokShop(p.link) : null
  const linkValido = !!tts?.ehProduto && !!tts.productId && (!p.externalId || tts.productId === p.externalId)
  if (!linkValido) pend.push('Link do produto inválido ou de outro produto.')
  const programa = p.evidencias.some((e) => e.startsWith('pedido real')) && p.comissaoPercentual !== null ? 'CONFIRMADO_POR_FONTE_OFICIAL' as const : 'NAO_CONFIRMADO' as const
  if (programa === 'NAO_CONFIRMADO') pend.push('Programa de afiliados do produto não confirmado por fonte oficial.')
  if (p.comissaoObservadaEm && (agora.getTime() - new Date(p.comissaoObservadaEm).getTime()) / 86_400_000 > comissaoValidaDias) pend.push(`Comissão vigente não confirmada (última observação oficial em ${p.comissaoObservadaEm.slice(0, 10)}): conferir no card oficial ao marcar.`)
  if (estado.contaVerificada !== true) pend.push('Conta de afiliada verificada (identidade/fiscal) não confirmada: credenciamento pendente.')
  const api = situacaoDaAffiliateApi(agora)
  const linkDeAfiliado = p.plataforma === 'TIKTOK_SHOP'
    ? !api.bloqueada ? `Affiliate API: ${api.rotulo} (ainda sem credenciais: marcação manual no app até a certificação)` : `marcação do produto no app do TikTok ao publicar (MANUAL por limitação oficial). ${api.frase}`
    : 'link do programa de afiliados da plataforma (não verificado)'
  if (p.plataforma !== 'TIKTOK_SHOP') pend.push('Link de afiliado fora do TikTok Shop não verificado.')
  return { programa, linkValido, linkDeAfiliado, liberacaoComercial: pend.length ? 'BLOQUEADA' : 'LIBERADA', pendencias: pend }
}

// ── Cadeia de direitos dos ativos ───────────────────────────────────────────────────────────

export type OrigemDoAtivo = 'GERADO_PELO_PATRONO' | 'PROPRIO_DA_TITULAR' | 'LICENCIADO' | 'AUTORIZADO_PELO_TITULAR' | 'TERCEIRO_SEM_LICENCA'
export interface AtivoDaCampanha {
  papel: string; arquivo: string; sha256: string; origem: OrigemDoAtivo
  permissao: string
  /** documento/registro da licença ou autorização (obrigatório para LICENCIADO/AUTORIZADO) */
  evidencia?: string | null
  /** voz da titular: só com a aprovação DELA para este produto (condição do consentimento de 20/10) */
  vozDaTitular?: boolean
}
export interface ManifestoDeDireitos { aprovado: boolean; ativos: AtivoDaCampanha[]; problemas: string[] }

export function manifestoDeDireitos(ativos: AtivoDaCampanha[], ctx: { produtoChave: string; produtoAprovadoPelaTitular: boolean; pastasDeOutrosProdutos: string[] }): ManifestoDeDireitos {
  const prob: string[] = []
  const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase()
  for (const a of ativos) {
    if (a.origem === 'TERCEIRO_SEM_LICENCA') prob.push(`${a.papel}: material de terceiro sem licença (${a.arquivo}).`)
    if ((a.origem === 'LICENCIADO' || a.origem === 'AUTORIZADO_PELO_TITULAR') && !a.evidencia) prob.push(`${a.papel}: ${a.origem} sem documento da licença/autorização.`)
    if (ctx.pastasDeOutrosProdutos.some((p) => norm(a.arquivo).includes(norm(p)))) prob.push(`${a.papel}: ativo de OUTRO produto (${a.arquivo}) — não pode ser reutilizado.`)
    if (a.vozDaTitular && !ctx.produtoAprovadoPelaTitular) prob.push(`${a.papel}: voz da titular só com a aprovação dela para este produto (consentimento de 20/10).`)
    if (!a.sha256) prob.push(`${a.papel}: ativo sem sha256 (origem não rastreável).`)
  }
  return { aprovado: prob.length === 0, ativos, problemas: prob }
}

// ── Campanha ────────────────────────────────────────────────────────────────────────────────

export interface CampanhaParaAprovacao {
  liberacaoComercial: 'LIBERADA' | 'BLOQUEADA'
  motivos: string[]
}

/** Junta afiliação e direitos no bloco `campanha` do qualityGate (lido por liberacaoParaPublicacao). */
export function blocoDaCampanha(afiliacao: VerificacaoDeAfiliacao, direitos: ManifestoDeDireitos): CampanhaParaAprovacao {
  const motivos = [...afiliacao.pendencias, ...direitos.problemas.map((p) => `Direitos: ${p}`)]
  return { liberacaoComercial: motivos.length ? 'BLOQUEADA' : 'LIBERADA', motivos }
}

// ── Roteiro automático (só fatos verificáveis do título oficial) ────────────────────────────

export interface FichaDoProduto {
  pasta: string; prefixo: string; template: 'produto-geral'; voz: 'neutra-local'; midia: { origem: 'GERADA_PELO_PATRONO' }
  conformidade: { categoria: string }
  produto: { nome: string; nomeCompleto: string; idNaLoja: string | null; categoriaNaLoja: string | null; categoria: string; loja: string | null }
  fatosValidados: string[]
  gancho: string; ganchoNaTela: string; apresentacao: string; demonstracao: string; proposta: string; cta: string; exemplos: string[]
  legendaDoPost: { abertura: string; descricao: string; pessoal: string; cta: string; hashtags: string[]; rotuloIA: string }
}

/** Fatos que o PRÓPRIO título oficial afirma de forma verificável (medidas, quantidades, formato, marca, cor). */
export function fatosDoTitulo(titulo: string): { marca: string | null; formato: string | null; gramatura: string | null; quantidade: string | null; cor: string | null; linha: string | null } {
  const t = titulo.replace(/\s+/g, ' ')
  const marca = t.match(/^([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}]+)/u)?.[1] ?? null
  const formato = t.match(/\b(A[3-5])\b/)?.[1] ?? null
  const gramatura = t.match(/\b(\d{2,3})\s?g\b/i)?.[1] ?? null
  const quantidade = t.match(/\b(\d{2,4})\s+(Folhas|Unidades|Peças)\b/i) ? `${t.match(/\b(\d{2,4})\s+(Folhas|Unidades|Peças)\b/i)![1]} ${t.match(/\b(\d{2,4})\s+(Folhas|Unidades|Peças)\b/i)![2].toLowerCase()}` : null
  const corLida = t.match(/\b(Branco|Branca|Preto|Preta|Azul|Rosa)\b/i)?.[1]?.toLowerCase() ?? null
  // "na cor ..." pede o feminino
  const cor = corLida ? ({ branco: 'branca', preto: 'preta' } as Record<string, string>)[corLida] ?? corLida : null
  const linha = t.match(/\b(Report(?: Premium)?|Chamex|Office)\b/i)?.[1] ?? null
  return { marca, formato, gramatura, quantidade, cor, linha }
}

const palavras = (s: string) => s.split(/\s+/).filter(Boolean).length
const letras = (s: string) => [...s].filter((c) => /\p{L}/u.test(c)).length
/** Fala que a voz sintética consegue dizer bem (lição da v6: ≥ 6 palavras e ≥ 30 letras). */
export const falaValida = (s: string) => palavras(s) >= 6 && letras(s) >= 30

export function roteiroAutomatico(p: ProdutoAvaliado, slug: string, nomeDaPasta: string): FichaDoProduto {
  const f = fatosDoTitulo(p.nome)
  const papel = /papel|sulfite|folhas/i.test(p.nome)
  const curto = papel ? `papel ${f.formato ?? ''} ${f.marca ?? ''}`.replace(/\s+/g, ' ').trim() : p.nome.split(/\s+/).slice(0, 4).join(' ')
  const fatos = [
    f.marca && `marca ${f.marca}`, f.linha && `linha ${f.linha}`, f.formato && `formato ${f.formato}`, f.gramatura && `folha de ${f.gramatura} g/m²`,
    f.quantidade && (papel ? `pacote de ${f.quantidade}` : f.quantidade), f.cor && `cor ${f.cor}`,
  ].filter(Boolean) as string[]
  const fonte = '(título oficial do anúncio no TikTok Shop, via export do Creator Center)'
  const gancho = papel ? 'Sabe aquela hora em que a impressora pede papel e acabou?' : `Você já conhecia este produto da loja ${p.loja ?? 'parceira'}?`
  const apresentacao = papel ? `Esse é o ${curto}${f.linha ? `, linha ${f.linha}` : ''}, em pacote de ${f.quantidade ?? 'várias folhas'}.` : `Esse é o ${curto}, vendido pela loja ${p.loja ?? 'parceira'}.`
  // P2.69+: o número fica na própria frase (a conferência dos números exige que a frase diga só o que a ficha diz)
  const demonstracao = papel ? `Folha ${f.formato ?? 'padrão'} de ${f.gramatura ?? '?'} gramas por metro quadrado. ${f.cor ? `Na cor ${f.cor}, no` : 'No'} tamanho padrão que a impressora de casa já usa.` : `Confira as medidas e os detalhes direto no card oficial do produto.`
  const proposta = papel ? 'Um pacote para deixar guardado para as tarefas da escola e do trabalho.' : 'Uma opção para conhecer com calma antes de decidir a compra.'
  const cta = 'Se quiser conhecer, o produto está na sacolinha do vídeo.'
  const exemplos = [f.formato, f.gramatura && `${f.gramatura} g/m²`, f.quantidade].filter(Boolean) as string[]
  for (const [nome, s] of Object.entries({ gancho, apresentacao, demonstracao, proposta, cta })) if (!falaValida(s)) throw new Error(`roteiro: fala "${nome}" curta demais para a voz sintética: "${s}"`)
  const tags = papel ? ['#papelA4', `#${(f.marca ?? 'papel').toLowerCase()}`, '#materialdeescritorio', '#impressao', '#TikTokShop'] : ['#achadinhos', '#TikTokShop']
  return {
    pasta: nomeDaPasta, prefixo: slug, template: 'produto-geral', voz: 'neutra-local', midia: { origem: 'GERADA_PELO_PATRONO' },
    conformidade: { categoria: papel ? 'PAPELARIA' : 'GERAL' },
    produto: { nome: curto.replace(/^papel/, 'Papel'), nomeCompleto: p.nome, idNaLoja: p.externalId, categoriaNaLoja: p.categoria, categoria: papel ? 'Papelaria' : (p.categoria ?? 'Outros'), loja: p.loja },
    fatosValidados: fatos.map((x) => `${x} ${fonte}`),
    gancho, ganchoNaTela: papel ? 'A impressora pediu\n{papel} e acabou?' : 'Já conhecia\n{este produto?}',
    apresentacao, demonstracao, proposta, cta, exemplos,
    legendaDoPost: {
      abertura: papel ? 'A impressora pediu papel bem na hora? 🖨️' : 'Achado do TikTok Shop 🛍️',
      // Só fatos verificáveis (nunca as alegações de marketing do título, como 'alta brancura').
      // a loja vem ANTES dos números, numa frase longa (a conferência trata frase curta colada no número como condição)
      descricao: `${curto.replace(/^papel/, 'Papel')}${p.loja ? `, vendido pela loja ${p.loja}` : ''}, segundo os dados do anúncio.${fatos.length ? ` ${fatos.join(', ')}.` : ''}`,
      pessoal: '',
      cta: '🛍️ Conheça o produto na sacolinha do vídeo.',
      hashtags: tags,
      rotuloIA: 'Narração com voz sintética gerada por inteligência artificial (voz neutra, não é a voz da criadora).',
    },
  }
}

/** Descoberta REAL mínima: sem o número de produtos reais pedido, o ciclo para (nada de completar com exemplo). */
export function exigirDescobertaReal(lista: ProdutoDescoberto[], minimo = 3): ProdutoDescoberto[] {
  const reais = lista.filter((p) => p.fonteDetalhe && (p.externalId || p.link))
  if (reais.length < minimo) throw new Error(`descoberta real insuficiente: ${reais.length} produto(s) com fonte e identificação (mínimo ${minimo}) — nada é inventado`)
  return reais
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// P2.68 — NEGÓCIO COORDENADO POR OBJETIVO: primeiro o que IMPEDE vender (afiliação, direitos de mídia, canal,
// viabilidade de conteúdo profissional); só depois comissão e potencial. Lição da P2.66: Cordão e Kappa foram
// escolhidos pela comissão e travaram por falta de imagem utilizável.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export type ProgramaDeAfiliados = 'MERCADO_LIVRE' | 'HOTMART' | 'TIKTOK_SHOP' | 'AWIN' | 'SHOPEE' | 'AMAZON'
/** De onde viria a imagem do produto, com direito de uso. */
export type MidiaDisponivel =
  | 'NENHUMA' | 'MATERIAL_DO_PRODUTOR' | 'CRIATIVO_OFICIAL_SEM_MODIFICACAO' | 'AMOSTRA_FILMAVEL' | 'PROPRIA_DA_TITULAR' | 'NAO_INVESTIGADA'
export type QuemResolve = 'PATRONO' | 'TITULAR' | 'TERCEIRO'

export interface FatosDaOportunidade {
  id: string; nome: string; programa: ProgramaDeAfiliados; produtoFisico: boolean
  afiliacao: 'ATIVA' | 'PERFIL_INEXISTENTE' | 'PENDENTE_APROVACAO' | 'NAO_CONFIRMADA'
  linkOficial: string | null
  midia: MidiaDisponivel
  /** documento/página que comprova o direito de uso (termos do produtor, licença, amostra própria…) */
  midiaEvidencia?: string | null
  /** a mídia só pode ser usada sem modificação (ex.: criativos Awin): a peça não pode ser editada */
  midiaSemModificacao?: boolean
  canal: { destino: 'MARCACAO_NATIVA' | 'LINK_NA_BIO' | null; destinoPronto: boolean; midiaCadastradaNoPrograma: boolean | null }
  /** decisão da titular que retém o produto (ex.: Emocionário/Suzano) */
  retidoPelaTitular?: string | null
  comissaoPercentual: number | null; comissaoObservadaEm: string | null; precoUnitario: number | null
}
export type Portao = 'ELEGIBILIDADE' | 'DIREITOS_DE_MIDIA' | 'CANAL' | 'VIABILIDADE_DE_CONTEUDO'
/** `chave` é ESTÁVEL (não muda se o texto for reescrito): é ela que identifica a tarefa na fila (re-revisão, defeito novo 1). */
export interface PendenciaDoPortao { chave: string; texto: string; quem: QuemResolve }
export interface ResultadoDoPortao { portao: Portao; status: 'OK' | 'BLOQUEADO' | 'NAO_VERIFICADO'; pendencias: PendenciaDoPortao[] }

const MIDIA_COM_PRODUTO: MidiaDisponivel[] = ['MATERIAL_DO_PRODUTOR', 'CRIATIVO_OFICIAL_SEM_MODIFICACAO', 'AMOSTRA_FILMAVEL', 'PROPRIA_DA_TITULAR']

export function portoesDaOportunidade(f: FatosDaOportunidade): ResultadoDoPortao[] {
  const r = (portao: Portao, pend: PendenciaDoPortao[], naoVerificado = false): ResultadoDoPortao => ({ portao, status: pend.length ? (naoVerificado ? 'NAO_VERIFICADO' : 'BLOQUEADO') : 'OK', pendencias: pend })
  // 1. Elegibilidade da afiliação
  const e: PendenciaDoPortao[] = []
  if (f.retidoPelaTitular) e.push({ chave: 'retido-pela-titular', texto: `Retido pela titular: ${f.retidoPelaTitular}`, quem: 'TITULAR' })
  if (f.afiliacao === 'PERFIL_INEXISTENTE') e.push({ chave: 'ativar-perfil', texto: `Ativar o perfil de afiliada (${f.programa}): cadastro, decisão da titular.`, quem: 'TITULAR' })
  if (f.afiliacao === 'PENDENTE_APROVACAO') e.push({ chave: 'aprovacao-da-afiliacao', texto: 'Afiliação aguardando aprovação do produtor/programa.', quem: 'TERCEIRO' })
  if (f.afiliacao === 'NAO_CONFIRMADA') e.push({ chave: 'confirmar-afiliacao', texto: 'Afiliação não confirmada no painel oficial.', quem: 'PATRONO' })
  if (f.programa !== 'TIKTOK_SHOP' && !f.linkOficial) e.push({ chave: 'gerar-link-oficial', texto: `Gerar o link oficial no painel do programa, sem alterar${f.afiliacao === 'ATIVA' ? '' : ' (depois da afiliação ativa)'}.`, quem: 'PATRONO' })
  // 2. Direitos de mídia
  const d: PendenciaDoPortao[] = []
  let dNv = false
  if (f.midia === 'NENHUMA') d.push(f.produtoFisico
    ? { chave: 'sem-midia-do-produto', texto: 'Sem mídia do produto com direito de uso (fotos/vídeos do anúncio não são licenciados ao afiliado).', quem: 'TERCEIRO' }
    : { chave: 'digital-com-arte-propria', texto: 'Produto digital sem material do produtor: conteúdo só com telas/arte originais do Patrono.', quem: 'PATRONO' })
  else if (f.midia === 'NAO_INVESTIGADA') { d.push({ chave: 'investigar-material-autorizado', texto: 'Verificar se o programa/produtor oferece material de divulgação autorizado.', quem: 'PATRONO' }); dNv = true }
  else if (f.midia === 'AMOSTRA_FILMAVEL' && !f.midiaEvidencia) d.push(
    { chave: 'pedir-amostra', texto: 'Pedir a amostra no app (pedido de amostra: aprovação da titular).', quem: 'TITULAR' },
    { chave: 'entrega-da-amostra', texto: 'Vendedor aprovar e entregar a amostra.', quem: 'TERCEIRO' },
    { chave: 'filmar-produto', texto: 'Filmar o produto recebido (o Patrono não filma: titular ou pessoa contratada).', quem: 'TITULAR' })
  else if (!f.midiaEvidencia) { d.push({ chave: 'documento-de-autorizacao', texto: 'Registrar o documento que autoriza o uso da mídia (termos do produtor/licença).', quem: 'PATRONO' }); dNv = true }
  // 3. Canal: para onde vai o clique
  const c: PendenciaDoPortao[] = []
  if (!f.canal.destino) c.push({ chave: 'definir-destino', texto: 'Definir o destino do clique (marcação nativa ou página de links).', quem: 'PATRONO' })
  else if (f.programa === 'TIKTOK_SHOP' && f.canal.destino !== 'MARCACAO_NATIVA') c.push({ chave: 'tiktok-marcacao-nativa', texto: 'TikTok Shop vende pela marcação do produto no vídeo, não por link na bio.', quem: 'PATRONO' })
  else if (!f.canal.destinoPronto) c.push({ chave: 'destino-pronto', texto: f.canal.destino === 'LINK_NA_BIO' ? 'Página de links oficial publicada e colocada na bio (deploy e bio: autorização da titular).' : 'Produto disponível para marcação no app.', quem: 'TITULAR' })
  if (f.canal.midiaCadastradaNoPrograma === false) c.push({ chave: 'cadastrar-midia-no-programa', texto: 'Cadastrar o canal como Mídia no programa (termo do programa).', quem: 'TITULAR' })
  if (f.canal.midiaCadastradaNoPrograma === null && f.programa === 'MERCADO_LIVRE') c.push({ chave: 'conferir-midias-cadastradas', texto: 'Conferir no painel se Instagram/TikTok estão cadastrados como Mídias (ML 1.3).', quem: 'PATRONO' })
  // 4. Viabilidade de conteúdo profissional (regra da P2.66)
  const v: PendenciaDoPortao[] = []
  if (f.produtoFisico && !MIDIA_COM_PRODUTO.includes(f.midia)) v.push({ chave: 'fisico-sem-midia-inviavel', texto: 'Produto físico sem mídia do produto: formato "oferta sem imagem" suspenso; não viável até haver mídia.', quem: 'TERCEIRO' })
  if (!f.produtoFisico && f.midia === 'NENHUMA') v.push({ chave: 'digital-so-telas', texto: 'Produto digital sem material do produtor: só telas/animação originais (a barreira decide).', quem: 'PATRONO' })
  if (f.midiaSemModificacao) v.push({ chave: 'midia-sem-modificacao', texto: 'Mídia só pode ser usada sem modificação: confirmar se o vídeo pronto do anunciante serve ao canal.', quem: 'PATRONO' })
  return [r('ELEGIBILIDADE', e), r('DIREITOS_DE_MIDIA', d, dNv), r('CANAL', c), r('VIABILIDADE_DE_CONTEUDO', v)]
}

/** Principal = a viável com MENOS pendências (as de terceiro e as da titular pesam mais). Comissão só desempata. */
export function priorizarOportunidades(fs: FatosDaOportunidade[]): { ordem: { fatos: FatosDaOportunidade; portoes: ResultadoDoPortao[]; pendencias: number; daTitular: number; deTerceiro: number }[]; principal: string | null } {
  const ordem = fs.map((fatos) => {
    const portoes = portoesDaOportunidade(fatos)
    const p = portoes.flatMap((x) => x.pendencias)
    return { fatos, portoes, pendencias: p.length, daTitular: p.filter((x) => x.quem === 'TITULAR').length, deTerceiro: p.filter((x) => x.quem === 'TERCEIRO').length }
  }).sort((a, b) =>
    Number(!!a.fatos.retidoPelaTitular) - Number(!!b.fatos.retidoPelaTitular)
    || a.deTerceiro - b.deTerceiro // bloqueio de terceiro (sem mídia, aprovação alheia) é o que menos controlamos
    || (a.pendencias + a.daTitular) - (b.pendencias + b.daTitular)
    || (b.fatos.comissaoPercentual ?? -1) - (a.fatos.comissaoPercentual ?? -1))
  const viavel = ordem.find((o) => !o.fatos.retidoPelaTitular && o.deTerceiro === 0)
  return { ordem, principal: viavel?.fatos.id ?? null }
}

// ── P2.68: critérios VERIFICÁVEIS de conclusão de cada etapa da campanha ───────────────────
/** Roteiro, vídeo ou link sozinhos NÃO tornam a campanha pronta: só a evidência de cada etapa. */
export const ETAPAS_DO_CICLO = [
  { id: 'OPORTUNIDADE_APTA', criterio: 'Os 4 portões (elegibilidade, direitos de mídia, canal, viabilidade) OK.' },
  { id: 'LINK_OFICIAL', criterio: 'Link gerado no painel oficial, registrado sem alteração, com comissão conferida há no máximo 7 dias.' },
  { id: 'MIDIA_AUTORIZADA', criterio: 'Cada ativo com origem, sha256 e documento de autorização/licença (manifesto de direitos aprovado).' },
  { id: 'VIDEO_NA_BARREIRA', criterio: 'Barreira de Qualidade Profissional APTA no sha256 final, com laudo independente calibrado.' },
  { id: 'DESTINO_DO_CLIQUE', criterio: 'Marcação nativa disponível OU página de links publicada com o link oficial e conferida.' },
  { id: 'APROVACAO_DA_TITULAR', criterio: 'Aprovação da titular registrada para ESTE sha256.' },
  { id: 'PUBLICADO', criterio: 'URL do post registrada e conferida no perfil.' },
  { id: 'MEDIDO', criterio: 'Métricas de fonte oficial coletadas pelo menos 48 h após a publicação.' },
  { id: 'RESULTADO', criterio: 'Vendas e comissões do relatório oficial, com prevista e recebida separadas.' },
] as const
export type EtapaDoCiclo = (typeof ETAPAS_DO_CICLO)[number]['id']
export interface EvidenciasDaCampanha {
  portoesOk?: boolean
  link?: { url: string; registradoEm: string; comissaoConferidaEm: string } | null
  manifestoDeDireitosAprovado?: boolean
  barreira?: { decisao: string; sha256: string } | null
  /** página de links: `linkConferido` é o link que ESTÁ na página publicada (precisa ser o link oficial da campanha) */
  destinoDoClique?: { tipo: 'MARCACAO_NATIVA' | 'PAGINA_DE_LINKS'; conferidoEm: string; linkConferido?: string } | null
  aprovacaoDaTitular?: { sha256: string; em: string } | null
  publicacao?: { url: string; conferidaEm: string } | null
  metricasColetadasEm?: string | null
  resultadoOficialEm?: string | null
}
export function etapaDaCampanha(ev: EvidenciasDaCampanha, agora: Date): { concluidas: EtapaDoCiclo[]; atual: EtapaDoCiclo | null; falta: string | null; prontaParaATitular: boolean } {
  const dias = (iso: string) => (agora.getTime() - new Date(iso).getTime()) / 86_400_000
  const ok: Record<EtapaDoCiclo, boolean> = {
    OPORTUNIDADE_APTA: ev.portoesOk === true,
    // conferência no futuro (data inválida) não vale
    LINK_OFICIAL: !!ev.link && dias(ev.link.comissaoConferidaEm) >= 0 && dias(ev.link.comissaoConferidaEm) <= 7,
    MIDIA_AUTORIZADA: ev.manifestoDeDireitosAprovado === true,
    VIDEO_NA_BARREIRA: ev.barreira?.decisao === 'APTO_PARA_TITULAR' && /^[0-9a-f]{64}$/i.test(ev.barreira.sha256 ?? ''),
    DESTINO_DO_CLIQUE: !!ev.destinoDoClique && (ev.destinoDoClique.tipo === 'MARCACAO_NATIVA' || (!!ev.link && ev.destinoDoClique.linkConferido === ev.link.url)),
    APROVACAO_DA_TITULAR: !!ev.aprovacaoDaTitular && ev.aprovacaoDaTitular.sha256 === ev.barreira?.sha256,
    PUBLICADO: !!ev.publicacao,
    MEDIDO: !!ev.metricasColetadasEm && !!ev.publicacao && (new Date(ev.metricasColetadasEm).getTime() - new Date(ev.publicacao.conferidaEm).getTime()) / 3_600_000 >= 48,
    RESULTADO: !!ev.resultadoOficialEm,
  }
  const concluidas: EtapaDoCiclo[] = []
  for (const e of ETAPAS_DO_CICLO) { if (!ok[e.id]) break; concluidas.push(e.id) }
  const prox = ETAPAS_DO_CICLO[concluidas.length] ?? null
  // pronta para a titular = tudo ANTES da aprovação dela concluído (nunca só roteiro, vídeo ou link)
  const antes: EtapaDoCiclo[] = ['OPORTUNIDADE_APTA', 'LINK_OFICIAL', 'MIDIA_AUTORIZADA', 'VIDEO_NA_BARREIRA', 'DESTINO_DO_CLIQUE']
  return { concluidas, atual: prox?.id ?? null, falta: prox?.criterio ?? null, prontaParaATitular: antes.every((x) => ok[x]) }
}

// ── P2.68: métricas reais, sem misturar o que é diferente ──────────────────────────────────
export const METRICAS = ['VISUALIZACOES', 'CLIQUES', 'VENDAS', 'COMISSAO_PREVISTA', 'COMISSAO_RECEBIDA'] as const
export type Metrica = (typeof METRICAS)[number]
export interface LeituraDeMetrica { metrica: Metrica; valor: number; fonte: string; oficial: boolean; coletadoEm: string }
/** Venda e comissão SÓ de fonte oficial; prevista ≠ recebida; nenhuma métrica é derivada de outra; sem leitura = null. */
export function quadroDeResultados(leituras: LeituraDeMetrica[]): { quadro: Record<Metrica, LeituraDeMetrica | null>; recusadas: { leitura: LeituraDeMetrica; motivo: string }[] } {
  const quadro = Object.fromEntries(METRICAS.map((m) => [m, null])) as Record<Metrica, LeituraDeMetrica | null>
  const recusadas: { leitura: LeituraDeMetrica; motivo: string }[] = []
  for (const l of leituras) {
    if (!Number.isFinite(l.valor) || l.valor < 0) { recusadas.push({ leitura: l, motivo: 'valor inválido' }); continue }
    if (['VENDAS', 'COMISSAO_PREVISTA', 'COMISSAO_RECEBIDA'].includes(l.metrica) && !l.oficial) { recusadas.push({ leitura: l, motivo: 'venda/comissão só de fonte oficial do programa' }); continue }
    const atual = quadro[l.metrica]
    if (!atual || l.coletadoEm > atual.coletadoEm) quadro[l.metrica] = l
  }
  return { quadro, recusadas }
}
