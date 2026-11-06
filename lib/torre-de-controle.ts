/**
 * P2.17.10 — Torre de Controle v1: a operação inteira numa leitura só.
 *
 *   DESCOBRINDO → ANALISANDO → GERANDO → VALIDANDO → APROVANDO → PUBLICANDO → VENDENDO → APRENDENDO
 *
 * Não tem lógica própria: CONSOME os módulos que já existem (Command Center,
 * Event Ledger, vendas/comissões, metas, modo assistido, resultados, status
 * dos produtos, visões). Só mostra atividade REAL; sem dado = "sem dado
 * oficial ainda" (null), nunca zero inventado.
 */
import { prisma } from './prisma'
import { estadoDaOperacao, atividadeDeHoje, inicioDoDiaEmBrasilia } from './central'
import { resumoComissoes, resumoVendas } from './vendas-comissoes'
import { ultimaColeta } from './curadoria'
import { analisarMetas, listarMetasAtivas, recompensaEmJogo } from './metas-tiktok'
import { relatorioDeTransicao, LIMITE_ASSISTIDO, statusReal } from './publicacao-assistida'
import { centralPrecisaDeVoce } from './precisa-de-voce-central'
import { brutoDaLinha, statusDosProdutos } from './resultados-videos'
import { agregar } from './metricas-economicas'
import { aprendizadoDasLinhas } from './resultados-videos'
import { estadoDoCanalTikTok } from './tiktok-estado-canal'
import { painelDeVisoes } from './visoes-de-produtos-http'
import { nomeCurto } from './motor-de-videos-tiktok'
import { operacaoComercial } from './operacao-comercial'
import { log } from './observabilidade'
import { CANDIDATO_NAO_EXCLUIDO } from './produto-canonico'
import { resumoFinanceiro } from './financeiro'

const DIA = 24 * 60 * 60 * 1000
const ROTULO_DA_FILA: Record<string, string> = {
  PRONTO_PARA_PUBLICACAO: 'pronto para publicar', PRONTO_PARA_APROVACAO: 'pronto para aprovar', PRONTO_PARA_CONTEUDO: 'pronto para gravar', GERANDO: 'gerando',
  MEDINDO: 'medindo', AGUARDANDO_AMOSTRA: 'amostra a caminho', AGUARDANDO_TERCEIRO: 'aguardando vendedor', BLOQUEADO: 'bloqueado',
}
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// ── Agenda (P2.17.12) ───────────────────────────────────────────────────
// O Calendário mora em Conteúdo (/calendario, rota única). A Torre só
// resume: plano de hoje, próximas publicações, próximo horário e atalho.

export interface ItemDaAgenda { quando: string; titulo: string; origem: 'CONTEUDO' | 'ASSISTIDA'; link: string }

/** FUNÇÃO PURA. Só o que tem data marcada; nada inventado. */
export function resumoDaAgenda(
  conteudos: { id: string; status: string; dataAgendamento: Date | null; dataPublicacao: Date | null; produto: { nome: string } | null; redeSocial: string | null }[],
  assistidas: { id: string; estado: string; horarioPlanejado: Date | null; nomeProduto: string }[],
  agora: Date,
  inicioHoje: Date
): { hoje: ItemDaAgenda[]; proximas: ItemDaAgenda[]; proximoHorario: string | null } {
  const itens: (ItemDaAgenda & { t: number })[] = []
  for (const c of conteudos) {
    const d = c.dataAgendamento ?? c.dataPublicacao
    if (!d || c.status === 'publicado') continue
    itens.push({ t: d.getTime(), quando: d.toISOString(), titulo: [c.produto?.nome ?? 'Conteúdo', c.redeSocial].filter(Boolean).join(' · '), origem: 'CONTEUDO', link: '/calendario' })
  }
  for (const a of assistidas) {
    if (!a.horarioPlanejado || ['PUBLICADO', 'REJEITADO'].includes(a.estado)) continue
    itens.push({ t: a.horarioPlanejado.getTime(), quando: a.horarioPlanejado.toISOString(), titulo: `${a.nomeProduto} · TikTok (assistida)`, origem: 'ASSISTIDA', link: '/precisa-de-voce' })
  }
  itens.sort((x, y) => x.t - y.t)
  const fimHoje = inicioHoje.getTime() + DIA
  const limpar = ({ t: _t, ...i }: ItemDaAgenda & { t: number }): ItemDaAgenda => i
  const hoje = itens.filter((i) => i.t >= inicioHoje.getTime() && i.t < fimHoje).map(limpar)
  const futuras = itens.filter((i) => i.t >= agora.getTime())
  return { hoje, proximas: futuras.slice(0, 5).map(limpar), proximoHorario: futuras[0]?.quando ?? null }
}

export async function torreDeControle(workspaceId: string, agora: Date = new Date()) {
  const inicioHoje = inicioDoDiaEmBrasilia(agora)
  const [operacao, linhaDoTempo, vendas, comissoes, coleta, metas, assistidas, resultados, canal, conteudos, publicacoes, candidatosAbertos, visoes] = await Promise.all([
    estadoDaOperacao(workspaceId, agora),
    atividadeDeHoje(workspaceId, agora),
    resumoVendas(workspaceId),
    resumoComissoes(workspaceId),
    ultimaColeta(workspaceId),
    listarMetasAtivas(workspaceId),
    prisma.publicacaoAssistida.findMany({ where: { workspaceId, demonstracao: false }, orderBy: { updatedAt: 'desc' }, take: 30 }),
    prisma.videoTikTokResultado.findMany({ where: { workspaceId }, orderBy: { publicadoEm: 'desc' }, take: 300 }),
    estadoDoCanalTikTok(workspaceId),
    prisma.conteudo.groupBy({ by: ['status'], where: { workspaceId }, _count: { status: true } }),
    prisma.publicacao.groupBy({ by: ['estado'], where: { workspaceId }, _count: { estado: true } }),
    prisma.candidatoDeProduto.count({ where: { workspaceId, status: { in: ['NOVO', 'APRESENTADO'] }, AND: [CANDIDATO_NAO_EXCLUIDO] } }),
    painelDeVisoes(workspaceId, 'MELHOR_OPORTUNIDADE', agora).catch(() => null),
  ])
  const agendados = await prisma.conteudo.findMany({
    where: { workspaceId, status: { not: 'publicado' }, OR: [{ dataAgendamento: { gte: inicioHoje } }, { dataPublicacao: { gte: inicioHoje } }] },
    select: { id: true, status: true, dataAgendamento: true, dataPublicacao: true, redeSocial: true, produto: { select: { nome: true } } },
    orderBy: { dataAgendamento: 'asc' },
    take: 50,
  })
  const agenda = resumoDaAgenda(agendados, assistidas, agora, inicioHoje)
  const [status, relatorio, central, comercial] = await Promise.all([statusDosProdutos(workspaceId, resultados), relatorioDeTransicao(workspaceId), centralPrecisaDeVoce(workspaceId, agora), operacaoComercial(workspaceId, agora).catch((e) => {
    // A Torre abre mesmo assim; a falha não fica silenciosa.
    log('error', 'torre.operacao_comercial', { workspaceId, erro: String(e).slice(0, 300) })
    return null
  })])

  // ── Receita real (resultados por vídeo; comissões da fonte única) ───────
  const desde = (ms: number) => resultados.filter((r) => r.publicadoEm.getTime() >= ms)
  const janela = (rs: typeof resultados) => {
    const a = agregar(rs.map(brutoDaLinha))
    return { vendas: a.vendas, comissao: a.comissao, receita: a.receitaDoVideo, views: a.views, receitaPor1000Views: a.receitaPor1000Views }
  }
  const hoje = janela(desde(inicioHoje.getTime()))
  const sete = janela(desde(agora.getTime() - 7 * DIA))
  const trinta = janela(desde(agora.getTime() - 30 * DIA))
  const comReceita = resultados.filter((r) => (r.receita ?? r.comissao ?? 0) > 0)
  const melhorVideo = [...comReceita].sort((a, b) => (b.receita ?? b.comissao ?? 0) - (a.receita ?? a.comissao ?? 0))[0] ?? null
  // P2.26/P2.25: o dinheiro do topo pela fonte canônica (confirmado ≠ previsão). A comissão DIGITADA nos vídeos
  // aparece à parte como "informada" e sem os vídeos que já têm pedido importado (a mesma venda não conta duas vezes).
  const [fin30, finAberto, comPedido] = await Promise.all([
    resumoFinanceiro(workspaceId, { periodoDaVenda: { desde: new Date(agora.getTime() - 30 * DIA), ate: agora } }),
    resumoFinanceiro(workspaceId),
    prisma.pedidoAfiliadoTikTok.findMany({ where: { workspaceId, videoResultadoId: { in: resultados.map((r) => r.id) } }, select: { videoResultadoId: true } }).then((ps) => new Set(ps.map((p) => p.videoResultadoId))),
  ])
  const informadaNosVideos30d = agregar(desde(agora.getTime() - 30 * DIA).filter((r) => !comPedido.has(r.id)).map(brutoDaLinha)).comissao

  // ── Metas ──────────────────────────────────────────────────────────────
  const analises = analisarMetas(metas, agora)
  const abertas = analises.filter((a) => a.situacao === 'EM_ANDAMENTO' || a.situacao === 'NAO_INICIADA')
  const urgente = [...abertas].sort((a, b) => b.pressao - a.pressao || a.diasRestantes - b.diasRestantes)[0] ?? null
  const emJogo = recompensaEmJogo(metas, analises)

  // ── Produtos por status ────────────────────────────────────────────────
  const produtos = [...status.entries()].map(([id, s]) => ({ id, nome: s.nome, status: s.status, motivo: s.motivos[0] ?? null, vendas: s.agregado.vendas, receita: s.agregado.receitaDoVideo, videos: s.agregado.videos }))
  const escalar = produtos.filter((p) => p.status === 'ESCALAR')
  const pausar = produtos.filter((p) => p.status === 'PAUSAR')

  // ── Jornada (contadores reais) ─────────────────────────────────────────
  const porEstadoAssistido = (e: string) => assistidas.filter((a) => a.estado === e).length
  const contagemConteudo = Object.fromEntries(conteudos.map((c) => [c.status, c._count.status]))
  const contagemPublicacao = Object.fromEntries(publicacoes.map((p) => [p.estado, p._count.estado]))
  const aprendizado = aprendizadoDasLinhas(resultados)
  const jornada = [
    { etapa: 'DESCOBRINDO', rotulo: 'Descobrindo', valor: candidatosAbertos, detalhe: coleta ? `última coleta ${coleta.em.toISOString()}` : 'nenhuma coleta ainda' },
    { etapa: 'ANALISANDO', rotulo: 'Analisando', valor: coleta?.avaliados ?? null, detalhe: coleta ? `${coleta.apresentados} apresentados no Top 3` : null },
    { etapa: 'GERANDO', rotulo: 'Gerando', valor: porEstadoAssistido('GERANDO') + porEstadoAssistido('VIDEO_NA_FILA') + porEstadoAssistido('GERANDO_VIDEO') + (contagemConteudo['roteiro_gerado'] ?? 0), detalhe: porEstadoAssistido('AGUARDANDO_MIDIA') ? `${porEstadoAssistido('AGUARDANDO_MIDIA')} aguardando mídia autorizada` : null },
    { etapa: 'VALIDANDO', rotulo: 'Validando', valor: assistidas.filter((a) => (a.qualityGate as { veredito?: string } | null)?.veredito && a.estado === 'AGUARDANDO_APROVACAO').length, detalhe: 'checagem de qualidade feita' },
    { etapa: 'APROVANDO', rotulo: 'Aprovando', valor: porEstadoAssistido('AGUARDANDO_APROVACAO'), detalhe: 'aguardando você' },
    { etapa: 'PUBLICANDO', rotulo: 'Publicando', valor: porEstadoAssistido('APROVADO') + porEstadoAssistido('PUBLICANDO') + (contagemPublicacao['DISTRIBUINDO'] ?? 0), detalhe: canal.nivel === 'BLOQUEADO' ? 'TikTok bloqueado (ver status)' : null },
    { etapa: 'VENDENDO', rotulo: 'Vendendo', valor: resultados.filter((r) => (r.vendas ?? 0) > 0).length, detalhe: trinta.vendas === null ? 'sem dado oficial ainda' : `${trinta.vendas} vendas em 30 dias` },
    { etapa: 'APRENDENDO', rotulo: 'Aprendendo', valor: aprendizado.filter((a) => a.vencedor).length, detalhe: aprendizado.some((a) => a.vencedor) ? 'vencedores com amostra mínima' : 'amostra ainda insuficiente' },
  ]

  // ── Agora ─────────────────────────────────────────────────────────────
  const publicando = assistidas.find((a) => a.estado === 'PUBLICANDO')
  // P2.17.12: "aguardando aprovação" só existe com o MP4 gerado.
  const aguardando = assistidas.find((a) => a.estado === 'AGUARDANDO_APROVACAO' && statusReal(a).videoGerado)
  const gerandoVideo = assistidas.find((a) => a.estado === 'VIDEO_NA_FILA' || a.estado === 'GERANDO_VIDEO')
  const semMidia = assistidas.find((a) => a.estado === 'AGUARDANDO_MIDIA')
  const agoraFazendo = publicando
    ? { tarefa: `Aguardando resposta do TikTok: ${publicando.nomeProduto}`, inicio: publicando.updatedAt.toISOString(), status: 'PUBLICANDO', proxima: 'Confirmar a publicação e registrar o resultado.' }
    : aguardando
      ? {
          // P2.17.11: roteiro pronto ≠ vídeo pronto — o status diz o que de fato existe.
          tarefa: `${aguardando.nomeProduto}: ${statusReal(aguardando).principal}`,
          inicio: aguardando.updatedAt.toISOString(),
          status: 'AGUARDANDO SUA APROVAÇÃO',
          proxima: 'Publicar assim que você aprovar.',
        }
      : gerandoVideo
        ? { tarefa: `${gerandoVideo.nomeProduto}: ${statusReal(gerandoVideo).principal}`, inicio: gerandoVideo.updatedAt.toISOString(), status: gerandoVideo.estado === 'GERANDO_VIDEO' ? 'VÍDEO EM GERAÇÃO' : 'VÍDEO NA FILA', proxima: 'Checar o arquivo e te mostrar o vídeo final para aprovar.' }
        : semMidia
          ? { tarefa: `${semMidia.nomeProduto}: ${statusReal(semMidia).principal}`, inicio: semMidia.updatedAt.toISOString(), status: 'AGUARDANDO MÍDIA AUTORIZADA', proxima: 'Gerar o vídeo sozinho assim que houver foto ou vídeo autorizado.' }
          : operacao.patrono.ultimoCiclo
        ? { tarefa: `Último ciclo: ${operacao.patrono.ultimoCiclo.estado.toLowerCase()}`, inicio: operacao.patrono.ultimoCiclo.quando, status: operacao.patrono.estado.titulo ?? 'parado', proxima: operacao.proximaAcao?.texto ?? null }
        : { tarefa: 'Parado: nenhum ciclo registrado ainda.', inicio: null, status: 'PARADO', proxima: operacao.proximaAcao?.texto ?? null }

  // P2.17.13: a mesma informação, enxuta para bater o olho: produto · etapa · depois.
  const foco = publicando ?? aguardando ?? gerandoVideo ?? semMidia ?? null
  const agoraEnxuto = {
    produto: foco ? nomeCurto(foco.nomeProduto) : null,
    // P2.17.14: "PARADO" soava como sistema parado; é "nenhuma tarefa em andamento".
    etapa: foco ? (publicando ? 'Publicando' : aguardando ? 'Aguardando sua aprovação' : gerandoVideo ? (gerandoVideo.estado === 'GERANDO_VIDEO' ? 'Gerando o vídeo' : 'Vídeo na fila') : 'Aguardando mídia autorizada') : agoraFazendo.status === 'PARADO' ? 'Nenhuma tarefa em andamento' : agoraFazendo.status,
    // P2.26: sem tarefa em andamento, nada de 'depois' daqui — a próxima ação é a do HOJE (decisão única).
    depois: foco ? (publicando ? 'Confirmar a publicação e medir o resultado' : aguardando ? 'Publicar assim que você aprovar' : gerandoVideo ? 'Checar o vídeo e te mostrar' : 'Gerar o vídeo automaticamente') : null,
  }

  // ── Precisa de você: a central ÚNICA (o mesmo número do sininho) ───────
  const precisaDeVoce = central.map((p) => ({ titulo: p.titulo, link: p.acao.link ?? '/precisa-de-voce', categoria: p.categoria }))

  // ── Onde está o dinheiro agora (máx. 3, só com dado real) ──────────────
  const dinheiro: { titulo: string; detalhe: string; valor: number | null; href: string; acao: string }[] = []
  if (urgente && emJogo > 0) dinheiro.push({ titulo: `Missão "${urgente.nome}"`, detalhe: `faltam ${urgente.faltam} · ${urgente.diasRestantes} dia(s)`, valor: emJogo, href: '/tiktok-metas', acao: 'Ver missão' })
  for (const p of escalar.slice(0, 2)) dinheiro.push({ titulo: `${p.nome} — ESCALAR`, detalhe: p.motivo ?? 'vende com sinais saudáveis', valor: p.receita ?? null, href: '/vendas-receita', acao: 'Ver resultados' })
  // P2.17.19: a fila comercial (amostras, publicações) — a próxima execução que gera dinheiro.
  for (const i of (comercial?.fila ?? []).filter((x) => x.estado !== 'ESCALAR' && x.estado !== 'PAUSAR' && x.estado !== 'PUBLICADO')) {
    if (dinheiro.length >= 3) break
    const comissao = i.comissaoPorVenda !== null ? ` · comissão vista ${reais(i.comissaoPorVenda)}/venda` : ''
    dinheiro.push({ titulo: `${nomeCurto(i.produto)} — ${ROTULO_DA_FILA[i.estado] ?? i.estado}`, detalhe: `${i.acao}${comissao}`, valor: null, href: i.link, acao: i.quem === 'TITULAR' ? 'Agir' : 'Ver' })
  }
  if (dinheiro.length < 3 && visoes?.itens[0]) dinheiro.push({ titulo: visoes.itens[0].nome, detalhe: visoes.comparacao ?? visoes.itens[0].porque, valor: null, href: '/oportunidades', acao: 'Ver oportunidade' })

  // P2.26: "próxima ação" NÃO é calculada aqui — a resposta única é o bloco HOJE (/api/hoje → lib/hoje.ts),
  // que vem da decisão da Operação (lib/decisao-agora.ts). A Torre só mostra o que o Patrono está fazendo.

  return {
    geradoEm: agora.toISOString(),
    status: {
      tiktok: { nivel: canal.nivel, frase: canal.frase },
      tiktokShopApi: 'BLOQUEADO PELO TIKTOK — Affiliate Creator API não confirmada para o Brasil',
      integracoes: operacao.integracoes,
      publicacaoAutomatica: canal.nivel,
      metricas: resultados.some((r) => r.origemMetricas.startsWith('API_TIKTOK')) ? 'API oficial' : 'manuais (até a conexão oficial)',
      // P2.17.14: status técnico — só nos detalhes, não no topo.
      iaPaga: process.env.PAID_AI_ENABLED === 'true' ? 'LIGADA' : 'DESLIGADA',
      patrono: operacao.patrono.estado,
    },
    receita: {
      hoje, sete, trinta,
      comissoesFonteUnica: comissoes,
      /** P2.26: dinheiro do topo pela fonte canônica; "informada" = digitada nos vídeos sem pedido importado. */
      financeiro: { confirmada30d: fin30.confirmada, previsao: finAberto.previsao, revertida30d: fin30.revertida, informadaNosVideos30d },
      vendasFonteUnica: vendas,
      missaoEmJogo: emJogo || null,
      melhorProduto: escalar[0]?.nome ?? produtos.filter((p) => (p.receita ?? 0) > 0).sort((a, b) => (b.receita ?? 0) - (a.receita ?? 0))[0]?.nome ?? null,
      melhorVideo: melhorVideo ? { produto: melhorVideo.nomeProduto, gancho: melhorVideo.gancho, receita: melhorVideo.receita ?? melhorVideo.comissao, url: melhorVideo.urlDoVideo } : null,
    },
    agora: agoraFazendo,
    agoraEnxuto,
    agenda,
    jornada,
    assistido: {
      concluidas: relatorio.concluidas,
      limite: LIMITE_ASSISTIDO,
      porEstado: Object.fromEntries(['GERANDO', 'AGUARDANDO_MIDIA', 'VIDEO_NA_FILA', 'GERANDO_VIDEO', 'VIDEO_FALHOU', 'AGUARDANDO_APROVACAO', 'APROVADO', 'PUBLICANDO', 'PUBLICADO', 'FALHOU'].map((e) => [e, porEstadoAssistido(e)])),
      recomendacao: relatorio.recomendacao,
    },
    filaDeConteudos: contagemConteudo,
    filaDePublicacao: assistidas.filter((a) => a.estado !== 'REJEITADO').slice(0, 8).map((a) => ({
      id: a.id, produto: a.nomeProduto, estado: a.estado, statusReal: statusReal(a).principal, videoGerado: statusReal(a).videoGerado,
      video: ((a.apresentacao as { video?: { situacao?: string; arquivo?: string | null; erro?: string | null } } | null)?.video ?? null),
      qualityGate: (a.qualityGate as { veredito?: string } | null)?.veredito ?? null, motivoEscolha: a.motivoEscolha,
      bloqueio: a.bloqueio, erro: a.erro, url: a.urlPublicada, ordem: a.ordem,
    })),
    produtos: { escalar, pausar, total: produtos.length },
    precisaDeVoce,
    precisaDeVoceTotal: central.length,
    dinheiro: dinheiro.slice(0, 3),
    // P2.17.17/27: visão compacta — só o que muda decisão/execução (não é ERP).
    amostras: comercial && comercial.amostras.total > 0 ? {
      pendentesDeAprovacao: comercial.amostras.pendentesDeAprovacao, aprovadas: comercial.amostras.aprovadas, enviadas: comercial.amostras.enviadas,
      recebidas: comercial.amostras.recebidas, comPrazoProximo: comercial.amostras.comPrazoProximo, total: comercial.amostras.total,
    } : null,
    caminhoPrimeiraComissao: comercial?.caminho ?? null,
    riscos: (comercial?.riscos ?? []).filter((r) => r.gravidade !== 'BAIXA').slice(0, 4),
    linhaDoTempo,
  }
}
