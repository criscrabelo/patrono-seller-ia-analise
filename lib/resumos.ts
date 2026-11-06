/**
 * P2.17.13 — Resumos das páginas-resumo (Vendas & Receita, Canais de
 * receita, Conteúdo, Ferramentas). NÃO têm lógica comercial própria:
 * consomem os módulos que já existem (resultados por vídeo, fonte única de
 * vendas/comissões, programas, integrações, publicações assistidas).
 *
 * Regra: sem dado oficial = null (nunca zero inventado); nenhum valor
 * estimado entra aqui.
 */
import { prisma } from './prisma'
import { situacaoDaAffiliateApi } from './elegibilidade-tiktok-shop'
import { inicioDoDiaEmBrasilia } from './central'
import { resumoComissoes, resumoVendas } from './vendas-comissoes'
import { agregar } from './metricas-economicas'
import { brutoDaLinha } from './resultados-videos'
import { listarProviders } from './affiliate-providers'
import { capacidadeOuDesconhecida } from './affiliate-provider-capabilities'
import { envioDeWhatsappPermitido } from './transferencia-internacional'
import { lerPoliticaDeCusto } from './cost-safety-gate'
import { INTEGRACOES_DA_TELA } from './integracoes-da-tela'
import { CANDIDATO_NAO_EXCLUIDO } from './produto-canonico'
import { somarComissoes } from './financeiro'

const DIA = 24 * 60 * 60 * 1000

// ── Vendas & Receita ────────────────────────────────────────────────────

export async function resumoVendasReceita(workspaceId: string, agora: Date = new Date()) {
  const inicioHoje = inicioDoDiaEmBrasilia(agora)
  const [resultados, vendas, comissoes] = await Promise.all([
    prisma.videoTikTokResultado.findMany({ where: { workspaceId }, orderBy: { publicadoEm: 'desc' }, take: 500 }),
    resumoVendas(workspaceId),
    resumoComissoes(workspaceId),
  ])
  const janela = (desde: number) => {
    const a = agregar(resultados.filter((r) => r.publicadoEm.getTime() >= desde).map(brutoDaLinha))
    return { comissao: a.comissao, receita: a.receitaDoVideo, vendas: a.vendas, views: a.views, receitaPor1000Views: a.receitaPor1000Views, conversao: a.conversaoCliqueVenda, ctr: a.ctr }
  }
  const valor = (r: { receita: number | null; comissao: number | null }) => r.receita ?? r.comissao ?? 0
  const comReceita = resultados.filter((r) => valor(r) > 0)
  const melhorVideo = [...comReceita].sort((a, b) => valor(b) - valor(a))[0] ?? null
  const porProduto = new Map<string, number>()
  const porCanal = new Map<string, number>()
  for (const r of comReceita) {
    porProduto.set(r.nomeProduto ?? '?', (porProduto.get(r.nomeProduto ?? '?') ?? 0) + valor(r))
    porCanal.set(r.canal, (porCanal.get(r.canal) ?? 0) + valor(r))
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? null
  const produto = top(porProduto)
  const canal = top(porCanal)
  return {
    geradoEm: agora.toISOString(),
    hoje: janela(inicioHoje.getTime()),
    sete: janela(agora.getTime() - 7 * DIA),
    trinta: janela(agora.getTime() - 30 * DIA),
    /** Fonte única de vendas/comissões (registros oficiais ou informados por você). */
    fonteUnica: { vendas, comissoes },
    melhorProduto: produto ? { nome: produto[0], receita: produto[1] } : null,
    melhorVideo: melhorVideo ? { produto: melhorVideo.nomeProduto, gancho: melhorVideo.gancho, receita: valor(melhorVideo), url: melhorVideo.urlDoVideo } : null,
    melhorCanal: canal ? { canal: canal[0], receita: canal[1] } : null,
    videosMedidos: resultados.filter((r) => r.views !== null).length,
  }
}

// ── Canais de receita (antiga "Monetização") ───────────────────────────

/** Sempre aparecem (relevantes para a operação); os demais só se você tiver programa, venda ou integração. */
export const CANAIS_PRINCIPAIS = ['tiktok-shop', 'shopee', 'amazon-associados', 'mercado-livre']

/**
 * P2.17.14 — Status SEMANTICAMENTE corretos. "Não cadastrado" só quando há
 * registro que o afirme (programa marcado NOT_REGISTERED). Sem registro no
 * Patrono, o status é NÃO CONFIRMADO: não sabemos se você participa — o
 * Patrono não estar conectado não prova que você não é afiliada.
 */
export type SituacaoDoCanal = 'CONECTADO' | 'CADASTRO_CONFIRMADO' | 'AGUARDANDO_CONEXAO' | 'AGUARDANDO_APROVACAO' | 'NAO_CONFIRMADO' | 'NAO_CADASTRADO'

export async function canaisDeReceita(workspaceId: string) {
  const [programas, integracoes, vendas, comissoes, candidatos] = await Promise.all([
    prisma.affiliateProgram.findMany({ where: { workspaceId } }),
    prisma.integracao.findMany({ where: { workspaceId }, select: { plataforma: true, status: true } }),
    prisma.sale.findMany({ where: { workspaceId, status: { not: 'CANCELLED' } }, select: { affiliateProgramId: true, amount: true, status: true } }),
    prisma.commission.findMany({ where: { workspaceId }, select: { id: true, affiliateProgramId: true, status: true, expectedAmount: true, confirmedAmount: true, receivedAmount: true, sale: { select: { status: true } } } }),
    prisma.candidatoDeProduto.groupBy({ by: ['providerId'], where: { workspaceId, status: { in: ['NOVO', 'APRESENTADO'] }, AND: [CANDIDATO_NAO_EXCLUIDO] }, _count: { providerId: true } }),
  ])
  const providers = listarProviders()
  const relevantes = providers.filter(
    (p) => CANAIS_PRINCIPAIS.includes(p.id) || programas.some((g) => g.platform === p.id) || integracoes.some((i) => i.plataforma === p.id || i.plataforma.startsWith(`${p.id}-`))
  )
  return relevantes.map((p) => {
    const programa = programas.find((g) => g.platform === p.id) ?? null
    const integrado = integracoes.some((i) => (i.plataforma === p.id || i.plataforma.startsWith(`${p.id}-`)) && i.status === 'conectado') || programa?.integrationStatus === 'CONNECTED'
    const cap = capacidadeOuDesconhecida(p.id)
    const integracaoOficial = cap.affiliateLinkGeneration === 'api-oficial'
    const doPrograma = <T extends { affiliateProgramId: string | null }>(xs: T[]) => (programa ? xs.filter((x) => x.affiliateProgramId === programa.id) : [])
    const vendasConfirmadas = doPrograma(vendas).filter((v) => v.status === 'CONFIRMED')
    const receita = vendasConfirmadas.length ? vendasConfirmadas.reduce((s, v) => s + (v.amount ?? 0), 0) : null
    const coms = doPrograma(comissoes)
    const somaCanal = somarComissoes(coms)
    const comissao = somaCanal.quantidade.LIQUIDADA + somaCanal.quantidade.RECEBIDA > 0 ? somaCanal.confirmada : null
    const oportunidades = candidatos.find((c) => c.providerId === p.id)?._count.providerId ?? 0
    const situacao: SituacaoDoCanal = integrado
      ? 'CONECTADO'
      : !programa
        ? 'NAO_CONFIRMADO'
        : programa.status === 'NOT_REGISTERED'
          ? 'NAO_CADASTRADO'
          : programa.status === 'WAITING_APPROVAL' || programa.status === 'REQUESTED'
            ? 'AGUARDANDO_APROVACAO'
            : programa.status === 'NEEDS_CONFIGURATION' || (programa.status === 'ACTIVE' && integracaoOficial)
              ? 'AGUARDANDO_CONEXAO'
              : 'CADASTRO_CONFIRMADO'
    const proximaAcao: Record<SituacaoDoCanal, string> = {
      CONECTADO: 'Nada a fazer: o Patrono acompanha.',
      CADASTRO_CONFIRMADO: 'Nada a fazer agora: sem integração oficial disponível, os resultados entram por registro.',
      AGUARDANDO_CONEXAO: programa?.status === 'NEEDS_CONFIGURATION' ? 'Completar a configuração do programa.' : 'Conectar a integração oficial (Integrações).',
      AGUARDANDO_APROVACAO: 'Aguardar a aprovação da plataforma.',
      NAO_CONFIRMADO: 'Confirmar em Meus Programas se você já participa; se não, cadastrar-se no site oficial.',
      NAO_CADASTRADO: p.cadastroDisponivel ? 'Cadastrar-se no programa oficial.' : 'Sem cadastro disponível agora.',
    }
    return {
      id: p.id, nome: p.nome, urlOficial: p.urlOficial, situacao, conectado: integrado, integracaoOficial,
      elegivel: situacao === 'CONECTADO' || situacao === 'CADASTRO_CONFIRMADO' || situacao === 'AGUARDANDO_CONEXAO',
      /** null = nenhuma venda/comissão REGISTRADA (não é "faturou zero"). */
      receita, comissao, oportunidades, proximaAcao: proximaAcao[situacao],
    }
  })
}

// ── Conteúdo ────────────────────────────────────────────────────────────

export async function resumoConteudo(workspaceId: string) {
  const [conteudos, assistidas, comVideo] = await Promise.all([
    prisma.conteudo.groupBy({ by: ['status'], where: { workspaceId }, _count: { status: true } }),
    prisma.publicacaoAssistida.groupBy({ by: ['estado'], where: { workspaceId, demonstracao: false }, _count: { estado: true } }),
    prisma.conteudo.count({ where: { workspaceId, videoUrl: { not: null } } }),
  ])
  const c = (s: string) => conteudos.find((x) => x.status === s)?._count.status ?? 0
  const a = (e: string) => assistidas.find((x) => x.estado === e)?._count.estado ?? 0
  return {
    aguardandoGeracao: { total: a('AGUARDANDO_MIDIA') + a('VIDEO_NA_FILA') + c('ideia') + c('produto_cadastrado'), detalhe: a('AGUARDANDO_MIDIA') ? `${a('AGUARDANDO_MIDIA')} aguardando mídia autorizada` : null },
    emGeracao: { total: a('GERANDO') + a('GERANDO_VIDEO'), detalhe: null },
    gerados: { total: c('roteiro_gerado') + comVideo, detalhe: comVideo ? `${comVideo} com vídeo` : null },
    aguardandoAprovacao: { total: c('aguardando_aprovacao') + a('AGUARDANDO_APROVACAO'), detalhe: null },
    agendados: { total: c('agendado') + c('aprovado'), detalhe: null },
    publicados: { total: c('publicado') + a('PUBLICADO'), detalhe: null },
  }
}

// ── Ferramentas ─────────────────────────────────────────────────────────

export type SituacaoDaFerramenta = 'ATIVA' | 'INDISPONIVEL' | 'NAO_CONFIGURADA'

export async function situacaoDasFerramentas(workspaceId: string, env: Record<string, string | undefined> = process.env) {
  const [links, whatsapp] = await Promise.all([
    prisma.linkDinamico.count({ where: { workspaceId } }),
    prisma.integracao.findUnique({ where: { workspaceId_plataforma: { workspaceId, plataforma: 'whatsapp' } }, select: { status: true } }),
  ])
  const envio = envioDeWhatsappPermitido(env)
  const iaPaga = lerPoliticaDeCusto(env).pagoHabilitado
  return [
    {
      href: '/links', nome: 'Links Dinâmicos', funcao: 'Cria links rastreados para medir clique e venda por conteúdo.',
      natureza: 'Ativa · secundária', situacao: 'ATIVA' as SituacaoDaFerramenta, motivo: `${links} link(s) criado(s).`,
    },
    {
      href: '/whatsapp', nome: 'WhatsApp em Massa', funcao: 'Envio de mensagens para listas de contatos.',
      natureza: 'Experimental',
      situacao: (!envio.permitido ? 'INDISPONIVEL' : whatsapp?.status === 'conectado' ? 'ATIVA' : 'NAO_CONFIGURADA') as SituacaoDaFerramenta,
      motivo: !envio.permitido ? 'Indisponível: dados de terceiros sem base legal de transferência internacional (LGPD). Sem solução oficial, não há contorno.' : whatsapp?.status === 'conectado' ? 'Conectado.' : 'Integração não configurada.',
    },
    {
      href: '/video-seller', nome: 'Video Seller', funcao: 'Gera roteiro e prompt de vídeo a partir de um texto (não cria o arquivo de vídeo, não usa o catálogo, não salva no Banco).',
      natureza: 'Legado',
      situacao: (iaPaga ? 'ATIVA' : 'INDISPONIVEL') as SituacaoDaFerramenta,
      motivo: iaPaga ? 'IA paga ligada.' : 'Indisponível: depende de IA paga, que está desligada. Para criar conteúdo sem custo, use Conteúdo.',
    },
  ]
}

// ── Status do topo (banner) ─────────────────────────────────────────────

/**
 * P2.17.13 — O que o banner pode afirmar: SÓ o que é verdade agora. Nada de
 * "IA gerando 24h" ou "mais vendas automático" sem dado.
 */
export async function statusDoTopo(workspaceId: string, env: Record<string, string | undefined> = process.env) {
  const { estadoDoCanalTikTok } = await import('./tiktok-estado-canal')
  const { LIMITE_ASSISTIDO } = await import('./publicacao-assistida')
  const [ws, gerando, canal, publicadas] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { automationPaused: true } }),
    prisma.publicacaoAssistida.count({ where: { workspaceId, demonstracao: false, estado: { in: ['GERANDO', 'VIDEO_NA_FILA', 'GERANDO_VIDEO'] } } }),
    estadoDoCanalTikTok(workspaceId),
    prisma.publicacaoAssistida.count({ where: { workspaceId, demonstracao: false, estado: 'PUBLICADO' } }),
  ])
  const iaPaga = lerPoliticaDeCusto(env).pagoHabilitado
  return {
    /**
     * P2.17.14: `Workspace.automationPaused` é o kill switch do AUTOPILOT —
     * tarefas e publicação AUTOMÁTICAS. Descobrir, ranquear e o modo
     * assistido continuam. Por isso o nome é "publicação automática".
     */
    publicacaoAutomatica: ws?.automationPaused ? 'PAUSADA' : 'LIGADA',
    assistido: { concluidas: publicadas, limite: LIMITE_ASSISTIDO, ativo: publicadas < LIMITE_ASSISTIDO },
    fila: gerando > 0 ? 'GERANDO' : 'VAZIA',
    gerando,
    /** Status técnico: aparece em Integrações/detalhes, não no topo. */
    iaPaga: iaPaga ? 'LIGADA' : 'DESLIGADA',
    tiktok: canal.nivel,
  } as const
}

// ── Produtos (o que cada cartão mostra além do cadastro) ───────────────

/**
 * P2.17.13 — Por produto: status econômico (mesma régua do modo assistido),
 * comissão e vendas REAIS (fonte única), mídias autorizadas e conteúdos.
 * Sem registro = null (o cartão não mostra o campo).
 */
export async function resumoDosProdutos(workspaceId: string) {
  const { statusDosProdutos } = await import('./resultados-videos')
  const [candidatos, vendas, comissoes, midias, status] = await Promise.all([
    prisma.candidatoDeProduto.findMany({ where: { workspaceId, produtoId: { not: null } }, select: { id: true, produtoId: true } }),
    prisma.sale.groupBy({ by: ['productId'], where: { workspaceId, status: 'CONFIRMED', productId: { not: null } }, _count: { productId: true } }),
    prisma.commission.findMany({ where: { workspaceId, productId: { not: null } }, select: { id: true, productId: true, status: true, expectedAmount: true, confirmedAmount: true, receivedAmount: true, sale: { select: { status: true } } } }),
    prisma.midiaDoProduto.groupBy({ by: ['produtoId'], where: { workspaceId, status: 'AUTORIZADA', demonstracao: false, produtoId: { not: null } }, _count: { produtoId: true } }),
    statusDosProdutos(workspaceId),
  ])
  const out: Record<string, { statusEconomico: string | null; vendas: number | null; comissao: number | null; midiasAutorizadas: number }> = {}
  const ids = new Set<string>([...candidatos.map((c) => c.produtoId!), ...vendas.map((v) => v.productId!), ...comissoes.map((c) => c.productId!), ...midias.map((m) => m.produtoId!)])
  for (const id of ids) {
    const cand = candidatos.find((c) => c.produtoId === id)
    const st = (cand && status.get(cand.id)) || status.get(id)
    const somaProduto = somarComissoes(comissoes.filter((c) => c.productId === id))
    const confirmadas = somaProduto.quantidade.LIQUIDADA + somaProduto.quantidade.RECEBIDA
    out[id] = {
      statusEconomico: st?.status ?? null,
      vendas: vendas.find((v) => v.productId === id)?._count.productId ?? null,
      comissao: confirmadas ? somaProduto.confirmada : null,
      midiasAutorizadas: midias.find((m) => m.produtoId === id)?._count.produtoId ?? 0,
    }
  }
  return out
}

// ── Vídeos (qualquer origem real) ───────────────────────────────────────

const ORIGEM_DO_VIDEO: Record<string, string> = {
  DERIVADO: 'Gerado pelo Patrono (FFmpeg, mídia autorizada)',
  PROPRIO: 'Enviado por você',
  GERADO_PELO_PATRONO: 'Gerado pelo Patrono',
  LICENCIADO: 'Licenciado',
}

/**
 * P2.17.13 — Todo vídeo REAL do fluxo, de qualquer origem: conteúdos com
 * arquivo de vídeo e os MP4 do modo assistido (ainda sem conteúdo). Só entra
 * o que tem arquivo — "vídeo" nunca é roteiro.
 */
export async function videosDoFluxo(workspaceId: string) {
  const [conteudos, assistidas] = await Promise.all([
    prisma.conteudo.findMany({
      where: { workspaceId, videoUrl: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, videoUrl: true, status: true, createdAt: true, redeSocial: true, alertasCompliance: true, produto: { select: { nome: true } } },
    }),
    prisma.publicacaoAssistida.findMany({ where: { workspaceId, conteudoId: null }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, nomeProduto: true, estado: true, apresentacao: true, demonstracao: true, updatedAt: true } }),
  ])
  const deConteudo = conteudos.map((c) => {
    const ev = (c.alertasCompliance as { tipo?: string; origem?: string; assetUrl?: string }[]).find((a) => a?.tipo === 'direito_da_midia' && a.assetUrl === c.videoUrl)
    return { id: c.id, url: c.videoUrl!, produto: c.produto?.nome ?? '—', status: c.status, canal: c.redeSocial, em: c.createdAt.toISOString(), origem: ORIGEM_DO_VIDEO[ev?.origem ?? ''] ?? 'Origem não registrada', link: `/conteudos/${c.id}`, demonstracao: false }
  })
  const deAssistida = assistidas.flatMap((a) => {
    const v = (a.apresentacao as { video?: { arquivo?: string | null } } | null)?.video
    if (!v?.arquivo) return []
    return [{ id: a.id, url: v.arquivo, produto: a.nomeProduto, status: a.estado, canal: 'tiktok', em: a.updatedAt.toISOString(), origem: ORIGEM_DO_VIDEO.DERIVADO, link: '/precisa-de-voce', demonstracao: a.demonstracao }]
  })
  return [...deAssistida, ...deConteudo].sort((x, y) => y.em.localeCompare(x.em))
}

// ── Relatório por período ───────────────────────────────────────────────

/**
 * P2.17.13 — Relatório no modelo ATUAL: resultados por vídeo (manual até a
 * API, depois API), fonte única de vendas/comissões, conteúdos e
 * publicações do período, vencedores do aprendizado (só com amostra mínima),
 * por categoria e por canal. Sem dado = null.
 */
export async function relatorioDoPeriodo(workspaceId: string, desde: Date, ate: Date) {
  const { aprendizadoDasLinhas } = await import('./resultados-videos')
  const periodo = { gte: desde, lte: ate }
  const [resultados, conteudos, publicados, vendas, comissoes] = await Promise.all([
    prisma.videoTikTokResultado.findMany({ where: { workspaceId, publicadoEm: periodo } }),
    prisma.conteudo.count({ where: { workspaceId, createdAt: periodo } }),
    prisma.conteudo.count({ where: { workspaceId, status: 'publicado', dataPublicacao: periodo } }),
    prisma.sale.findMany({ where: { workspaceId, status: 'CONFIRMED', date: periodo }, select: { amount: true } }),
    prisma.commission.findMany({ where: { workspaceId, createdAt: periodo }, select: { id: true, status: true, expectedAmount: true, confirmedAmount: true, receivedAmount: true, sale: { select: { status: true } } } }),
  ])
  const a = agregar(resultados.map(brutoDaLinha))
  const grupo = (chave: (r: (typeof resultados)[number]) => string) => {
    const m = new Map<string, typeof resultados>()
    for (const r of resultados) m.set(chave(r), [...(m.get(chave(r)) ?? []), r])
    return [...m.entries()].map(([nome, rs]) => {
      const g = agregar(rs.map(brutoDaLinha))
      return { nome, videos: rs.length, receita: g.receitaDoVideo, vendas: g.vendas, views: g.views }
    }).sort((x, y) => (y.receita ?? -1) - (x.receita ?? -1))
  }
  const somaPeriodo = somarComissoes(comissoes)
  const comissaoFonteUnica = somaPeriodo.quantidade.LIQUIDADA + somaPeriodo.quantidade.RECEBIDA > 0 ? somaPeriodo.confirmada : null
  return {
    desde: desde.toISOString(),
    ate: ate.toISOString(),
    receita: a.receitaDoVideo,
    comissao: a.comissao ?? comissaoFonteUnica,
    vendas: a.vendas ?? (vendas.length ? vendas.length : null),
    vendasConfirmadasFonteUnica: vendas.length,
    conteudos,
    publicados: publicados + resultados.length,
    visualizacoes: a.views,
    ctr: a.ctr,
    conversao: a.conversaoCliqueVenda,
    receitaPor1000Views: a.receitaPor1000Views,
    videosMedidos: a.videosMedidos,
    vencedores: aprendizadoDasLinhas(resultados).filter((d) => d.vencedor).map((d) => ({ dimensao: d.dimensao, vencedor: d.vencedor!, recomendacao: d.recomendacao })),
    categorias: grupo((r) => r.categoria ?? 'Sem categoria'),
    canais: grupo((r) => r.canal),
    origemDasMetricas: resultados.some((r) => r.origemMetricas.startsWith('API_TIKTOK')) ? 'API oficial' : resultados.length ? 'manual (até a API conectar)' : null,
  }
}

// ── Integrações (visão executiva) ───────────────────────────────────────

export type SituacaoDaIntegracao = 'CONECTADO' | 'PRECISA_DE_VOCE' | 'AGUARDANDO_PLATAFORMA' | 'BLOQUEADO_EXTERNAMENTE' | 'NAO_CONFIGURADO'

/**
 * P2.17.13 — Cada integração em UMA linha: status (5 possíveis), impacto e
 * próxima ação. O detalhe técnico (tokens, escopos, preflight) continua nos
 * cartões de configuração, recolhidos.
 */
export async function integracoesExecutivo(workspaceId: string, env: Record<string, string | undefined> = process.env) {
  const { estadoDoCanalTikTok } = await import('./tiktok-estado-canal')
  const { evidenciaDoTikTokShop } = await import('./tiktok-shop-evidencia')
  const [canal, shop, integracoes] = await Promise.all([
    estadoDoCanalTikTok(workspaceId, env),
    evidenciaDoTikTokShop(workspaceId).catch(() => null),
    prisma.integracao.findMany({ where: { workspaceId }, select: { plataforma: true, status: true } }),
  ])
  const conectada = (p: string) => integracoes.find((i) => i.plataforma === p)?.status === 'conectado'
  const daTitular = canal.bloqueios.find((b) => b.quem === 'TITULAR')
  const doTikTok = canal.bloqueios.find((b) => b.quem === 'TIKTOK')
  const whatsappPermitido = envioDeWhatsappPermitido(env).permitido
  const NADA = 'Nada: o Patrono acompanha.'
  const IMPACTO: Record<string, string> = {
    instagram: 'Publicação de Reels.',
    mercadolivre: 'Anúncios e vendas do Mercado Livre.',
    shopee: 'Preço, comissão e vendas oficiais da Shopee.',
    hotmart: 'Produtos digitais e comissões da Hotmart.',
    amazon: 'Produtos e comissões da Amazon.',
  }
  // P2.17.14: UMA linha por integração da tela (lib/integracoes-da-tela.ts) — o contador vem daqui.
  const linhas: { id: string; nome: string; situacao: SituacaoDaIntegracao; impacto: string; proximaAcao: string }[] = INTEGRACOES_DA_TELA.map(({ id, nome }) => {
    if (id === 'tiktok') {
      // Criar o app é ação SUA (a mesma pendência da central); a aprovação dele é do TikTok.
      return {
        id, nome,
        situacao: canal.nivel !== 'BLOQUEADO' ? 'CONECTADO' : !canal.appConfigurado || daTitular ? 'PRECISA_DE_VOCE' : doTikTok ? 'AGUARDANDO_PLATAFORMA' : 'NAO_CONFIGURADO',
        impacto: canal.nivel === 'BLOQUEADO' ? 'Sem ela, o vídeo aprovado não é enviado ao TikTok.' : 'Envio pela API oficial liberado.',
        proximaAcao: !canal.appConfigurado ? 'Conferir se já existe app no TikTok for Developers (só criar se não houver), com Login Kit + Content Posting API, e aguardar a aprovação do TikTok.' : daTitular?.texto ?? doTikTok?.texto ?? NADA,
      }
    }
    if (id === 'tiktok-shop') {
      return {
        id, nome, situacao: shop ? 'CONECTADO' : 'BLOQUEADO_EXTERNAMENTE',
        impacto: shop ? 'Descoberta de produtos e comissões oficiais.' : 'Sem ela, produtos e comissões do TikTok Shop entram por contingência.',
        proximaAcao: shop ? NADA : `${situacaoDaAffiliateApi().frase} Nada a fazer agora: a operação segue assistida na página Operação.`,
      }
    }
    if (id === 'whatsapp') {
      return {
        id, nome, situacao: !whatsappPermitido ? 'BLOQUEADO_EXTERNAMENTE' : conectada('whatsapp') ? 'CONECTADO' : 'NAO_CONFIGURADO',
        impacto: 'Ferramenta secundária de envio.',
        proximaAcao: !whatsappPermitido ? 'Indisponível (LGPD) até haver solução oficial; nada a fazer agora.' : 'Opcional.',
      }
    }
    return {
      id, nome, situacao: conectada(id) ? 'CONECTADO' : 'NAO_CONFIGURADO',
      impacto: IMPACTO[id] ?? 'Integração opcional.',
      proximaAcao: conectada(id) ? NADA : 'Opcional: conectar quando for usar este canal.',
    }
  })
  const contagem = (sit: SituacaoDaIntegracao) => linhas.filter((l) => l.situacao === sit).length
  return {
    linhas,
    /** X de Y — Y é a quantidade de integrações que a tela mostra. */
    total: linhas.length,
    conectadas: contagem('CONECTADO'),
    porSituacao: {
      CONECTADO: contagem('CONECTADO'), PRECISA_DE_VOCE: contagem('PRECISA_DE_VOCE'), AGUARDANDO_PLATAFORMA: contagem('AGUARDANDO_PLATAFORMA'),
      BLOQUEADO_EXTERNAMENTE: contagem('BLOQUEADO_EXTERNAMENTE'), NAO_CONFIGURADO: contagem('NAO_CONFIGURADO'),
    },
  }
}
