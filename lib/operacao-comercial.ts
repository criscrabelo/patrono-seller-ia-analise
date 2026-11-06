/**
 * P2.17.19 · .20 · .23 · .24 · .27 · .28 — A OPERAÇÃO COMERCIAL numa leitura.
 *
 *   - Fila "Onde está o dinheiro agora?": qual é a PRÓXIMA EXECUÇÃO comercial.
 *     Não substitui o motor de Oportunidades (que decide o que vale a pena):
 *     só ordena o que já está em jogo (amostras, publicações, vencedores).
 *   - Plano das 10 primeiras publicações: um EXPERIMENTO organizado (hipóteses
 *     que variam formato/gancho/duração/objetivo/categoria) — slots reais com
 *     dado real; slots futuros só com hipótese, nunca com dado inventado.
 *   - Agenda sugerida: só sugere horário quando existe material; dependência
 *     real aparece como dependência ("Aguardando amostra/mídia/aprovação").
 *   - Riscos operacionais: o que pode fazer perder dinheiro; só vira
 *     notificação quando a ação é da titular.
 *   - Caminho para a primeira comissão: cada etapa com estado verdadeiro.
 *   - Atribuição: CONFIRMADA | PROVÁVEL | DESCONHECIDA — nunca correlação
 *     transformada em certeza.
 *
 * Tudo FUNÇÃO PURA, exceto `operacaoComercial()` (a única leitura do banco).
 */
import { aprovadaOuAlem } from './estados-da-publicacao'
import { prisma } from './prisma'
import { listarAmostras, priorizarAmostras, valorEconomico, type AmostraDaTela } from './amostras'
import { analisarMetas, listarMetasAtivas, type AnaliseDaMeta } from './metas-tiktok'
import { statusReal, horarioSugerido, LIMITE_ASSISTIDO } from './publicacao-assistida'
import { statusDosProdutos } from './resultados-videos'
import { estadoDoCanalTikTok } from './tiktok-estado-canal'
import { kitDaChave } from './kits-de-amostras'
import { campanhaAtiva } from './campanha-sazonal'

const DIA = 24 * 60 * 60 * 1000
const dataBR = (iso: string | Date) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })

// ── Fila comercial ──────────────────────────────────────────────────────

export const ESTADOS_DA_FILA = [
  'PRONTO_PARA_PUBLICACAO', 'PRONTO_PARA_APROVACAO', 'ESCALAR', 'PRONTO_PARA_CONTEUDO', 'GERANDO', 'PUBLICADO', 'MEDINDO',
  'AGUARDANDO_AMOSTRA', 'AGUARDANDO_TERCEIRO', 'BLOQUEADO', 'PAUSAR',
] as const
export type EstadoDaFila = (typeof ESTADOS_DA_FILA)[number]
export type Quem = 'PATRONO' | 'TITULAR' | 'TIKTOK' | 'VENDEDOR'

export interface ItemDaFila {
  id: string
  produto: string
  estado: EstadoDaFila
  quem: Quem
  acao: string
  motivo: string
  /** Comissão vista por venda (R$) — referência, não previsão. null = não vista. */
  comissaoPorVenda: number | null
  prazo: string | null
  link: string
  origem: 'AMOSTRA' | 'PUBLICACAO' | 'RESULTADO'
}

export interface AssistidaParaFila {
  id: string
  estado: string
  nomeProduto: string
  candidatoId: string | null
  apresentacao: unknown
  qualityGate: unknown
  publishId: string | null
  publicadoEm: Date | null
  bloqueio: string | null
  updatedAt: Date
}

/** FUNÇÃO PURA. Um item por produto em jogo; o mesmo produto não aparece duas vezes (publicação vence amostra). */
export function filaComercial(p: {
  amostras: AmostraDaTela[]
  assistidas: AssistidaParaFila[]
  status: { id: string; nome: string; status: string; motivo: string | null }[]
  agora: Date
}): ItemDaFila[] {
  const itens: ItemDaFila[] = []
  const vistos = new Set<string>()
  const comissaoDe = (candidatoId: string | null) => {
    const a = p.amostras.find((x) => x.candidatoId && x.candidatoId === candidatoId)
    return a ? a.comissaoObservada ?? a.sinais?.comissaoValor ?? null : null
  }
  for (const a of p.assistidas) {
    if (['REJEITADO'].includes(a.estado)) continue
    const st = statusReal(a)
    const amostra = p.amostras.find((x) => x.publicacaoAssistidaId === a.id || (x.candidatoId && x.candidatoId === a.candidatoId && x.estado === 'RECEBIDA'))
    const base = { id: `assistida:${a.id}`, produto: a.nomeProduto, comissaoPorVenda: comissaoDe(a.candidatoId), prazo: amostra?.prazo?.em ?? null, origem: 'PUBLICACAO' as const }
    let item: ItemDaFila | null = null
    if (a.estado === 'APROVADO' || a.estado === 'PUBLICANDO') item = { ...base, estado: 'PRONTO_PARA_PUBLICACAO', quem: a.bloqueio ? 'TITULAR' : 'PATRONO', acao: a.bloqueio ? 'Publicar no app e marcar o produto (o TikTok ainda não permite pelo Patrono); depois colar o link.' : 'Enviar ao TikTok e acompanhar.', motivo: a.bloqueio ?? 'Aprovado.', link: '/publicacoes-assistidas' }
    else if (a.estado === 'AGUARDANDO_APROVACAO' && st.videoGerado) item = { ...base, estado: 'PRONTO_PARA_APROVACAO', quem: 'TITULAR', acao: 'Assistir e aprovar (ou pedir ajuste).', motivo: 'Vídeo gerado e checado.', link: '/precisa-de-voce' }
    else if (['GERANDO', 'VIDEO_NA_FILA', 'GERANDO_VIDEO', 'AJUSTE_PEDIDO'].includes(a.estado) || (a.estado === 'AGUARDANDO_APROVACAO' && !st.videoGerado)) item = { ...base, estado: 'GERANDO', quem: 'PATRONO', acao: 'Gerar e checar o vídeo.', motivo: st.principal, link: '/publicacoes-assistidas' }
    else if (a.estado === 'AGUARDANDO_MIDIA') item = amostra ? { ...base, estado: 'PRONTO_PARA_CONTEUDO', quem: 'TITULAR', acao: 'Gravar as cenas do kit e enviar.', motivo: 'Amostra recebida; falta a mídia (gravada por você).', link: '/precisa-de-voce' } : { ...base, estado: 'BLOQUEADO', quem: 'TITULAR', acao: 'Enviar foto/vídeo seu do produto — ou rejeitar e o Patrono escolhe outro.', motivo: 'Sem mídia autorizada não há vídeo.', link: '/precisa-de-voce' }
    else if (a.estado === 'VIDEO_FALHOU' || a.estado === 'FALHOU') item = { ...base, estado: 'BLOQUEADO', quem: 'PATRONO', acao: 'Tentar de novo ou trocar de produto.', motivo: a.bloqueio ?? 'A geração/publicação falhou.', link: '/publicacoes-assistidas' }
    else if (a.estado === 'PUBLICADO') {
      const recente = a.publicadoEm && p.agora.getTime() - a.publicadoEm.getTime() < 14 * DIA
      item = { ...base, estado: recente ? 'MEDINDO' : 'PUBLICADO', quem: 'PATRONO', acao: recente ? 'Medir views, cliques, vendas e comissão.' : 'Janela de medição encerrada: entra no aprendizado.', motivo: 'Publicado.', link: '/vendas-receita' }
    }
    if (!item) continue
    itens.push(item)
    if (a.candidatoId) vistos.add(a.candidatoId)
  }
  for (const s of p.status) {
    if (s.status !== 'ESCALAR' && s.status !== 'PAUSAR') continue
    itens.push({
      id: `resultado:${s.id}`, produto: s.nome, estado: s.status as EstadoDaFila, quem: 'PATRONO',
      acao: s.status === 'ESCALAR' ? 'Fazer mais vídeos deste produto (variar gancho/formato).' : 'Parar de investir neste produto por enquanto.',
      motivo: s.motivo ?? (s.status === 'ESCALAR' ? 'Vende com sinais saudáveis.' : 'Sinais fracos.'), comissaoPorVenda: comissaoDe(s.id), prazo: null, link: '/vendas-receita', origem: 'RESULTADO',
    })
  }
  for (const a of p.amostras) {
    if (a.candidatoId && vistos.has(a.candidatoId)) continue
    const base = { id: `amostra:${a.id}`, produto: a.nomeProduto, comissaoPorVenda: a.comissaoObservada ?? a.sinais?.comissaoValor ?? null, prazo: a.prazo?.em ?? null, origem: 'AMOSTRA' as const, link: '/tiktok-metas#amostras' }
    if (a.efetivo === 'SOLICITADA' || a.efetivo === 'PENDENTE_APROVACAO' || a.efetivo === 'APROVADA')
      itens.push({ ...base, estado: 'AGUARDANDO_TERCEIRO', quem: 'VENDEDOR', acao: a.efetivo === 'APROVADA' ? 'Aguardando o vendedor enviar.' : 'Aguardando o vendedor aprovar.', motivo: 'Roteiros e cenas já preparados.' })
    else if (a.efetivo === 'ENVIADA') itens.push({ ...base, estado: 'AGUARDANDO_AMOSTRA', quem: 'VENDEDOR', acao: 'A caminho. Ao chegar, marque "Recebida".', motivo: 'Kit pronto para gravar na chegada.' })
    else if (a.efetivo === 'CONTEUDO_PENDENTE' || a.efetivo === 'RECEBIDA') itens.push({ ...base, estado: 'PRONTO_PARA_CONTEUDO', quem: a.acaoDaTitular ? 'TITULAR' : 'PATRONO', acao: a.acaoDaTitular ? 'Gravar as cenas do kit.' : 'Abrir a produção.', motivo: a.alertasDetalhe.join(' ') || 'Amostra recebida.' })
  }
  const ordem = (e: EstadoDaFila) => ESTADOS_DA_FILA.indexOf(e)
  return itens.sort(
    (x, y) =>
      ordem(x.estado) - ordem(y.estado) ||
      (x.prazo ?? '9999').localeCompare(y.prazo ?? '9999') ||
      (y.comissaoPorVenda ?? -1) - (x.comissaoPorVenda ?? -1)
  )
}

/** A próxima execução comercial: o primeiro item que alguém NOSSO pode mover agora. */
export function proximaExecucao(fila: ItemDaFila[]): ItemDaFila | null {
  return fila.find((i) => (i.quem === 'PATRONO' || i.quem === 'TITULAR') && !['PUBLICADO', 'MEDINDO', 'PAUSAR'].includes(i.estado)) ?? null
}

// ── Plano das 10 primeiras ──────────────────────────────────────────────

export interface HipoteseDoSlot { estrutura: string; duracao: 15 | 30; objetivo: 'RETENCAO' | 'CLIQUE' | 'VENDA'; hipotese: string; categoriaSugerida: string | null; kitSugerido: string | null }

/**
 * A matriz do experimento: varia formato, gancho, duração, objetivo e
 * categoria. É GUIA — se a fila comercial apontar oportunidade melhor, ela
 * vence (não se sacrifica dinheiro para completar a matriz).
 */
export const MATRIZ_DAS_10: HipoteseDoSlot[] = [
  { estrutura: 'DEMONSTRACAO', duracao: 15, objetivo: 'VENDA', hipotese: 'Demonstração curta de produto já com demanda vende mais que gancho de curiosidade.', categoriaSugerida: 'Beleza', kitSugerido: 'hidrabene-textura' },
  { estrutura: 'ANTES_DEPOIS', duracao: 15, objetivo: 'VENDA', hipotese: 'Transformação visual de ambiente converte bem em produto sazonal de baixo ticket.', categoriaSugerida: 'Casa e Decoração', kitSugerido: 'almofadas-antes-depois' },
  { estrutura: 'POV', duracao: 15, objetivo: 'RETENCAO', hipotese: 'POV mãos livres segura mais a atenção nos 3 primeiros segundos.', categoriaSugerida: 'Eletrônicos', kitSugerido: 'suporte-pov' },
  { estrutura: 'LISTA_3_MOTIVOS', duracao: 15, objetivo: 'CLIQUE', hipotese: 'Lista de funções gera mais clique no produto que unboxing.', categoriaSugerida: 'Beleza', kitSugerido: 'depilador-4-funcoes' },
  { estrutura: 'ACHADO_TIKTOK_SHOP', duracao: 15, objetivo: 'CLIQUE', hipotese: 'Mostrar o ranking do app como prova social aumenta o clique.', categoriaSugerida: 'Beleza', kitSugerido: 'hidrabene-ranking' },
  { estrutura: 'PRESENTE', duracao: 15, objetivo: 'VENDA', hipotese: 'Ângulo "presente de Natal" vende mais que "decoração" na mesma peça.', categoriaSugerida: 'Casa e Decoração', kitSugerido: 'almofadas-presente' },
  { estrutura: 'UNBOXING', duracao: 30, objetivo: 'RETENCAO', hipotese: 'Vídeo de 30 s de unboxing retém tanto quanto o de 15 s (testa a duração).', categoriaSugerida: null, kitSugerido: 'depilador-unboxing' },
  { estrutura: 'TESTE_REAL', duracao: 30, objetivo: 'VENDA', hipotese: 'Opinião real (depois do uso) converte mais que demonstração neutra.', categoriaSugerida: 'Beleza', kitSugerido: 'hidrabene-rotina' },
  { estrutura: 'VENCEDOR_EM_OUTRO_PRODUTO', duracao: 15, objetivo: 'VENDA', hipotese: 'O formato vencedor das 8 primeiras repete o resultado em outro produto.', categoriaSugerida: null, kitSugerido: null },
  { estrutura: 'PRODUTO_VENCEDOR_NOVO_GANCHO', duracao: 15, objetivo: 'VENDA', hipotese: 'O produto que mais vendeu vende de novo com outro gancho (antes de escalar).', categoriaSugerida: null, kitSugerido: null },
]

export interface SlotDoPlano {
  slot: number
  rotulo: string
  situacao: 'PUBLICADA' | 'EM_PRODUCAO' | 'PLANEJADA'
  hipotese: HipoteseDoSlot
  real: null | {
    produto: string; categoria: string | null; origem: string; motivo: string; estrutura: string; hook: string | null; cta: string | null; duracao: number | null
    qualityGate: string | null; aprovacao: string | null; publicadoEm: string | null; link: string | null
    views: number | null; retencao: number | null; cliques: number | null; vendas: number | null; comissao: number | null; aprendizado: string | null
  }
  produtoSugerido: string | null
}

/** FUNÇÃO PURA. Slots 1..10: publicadas (dado real), a em produção, e as planejadas (só hipótese). */
export function planoDasDez(p: {
  publicadas: { ordem: number | null; nomeProduto: string; estrutura: string; motivoEscolha: string; objetivoDoTeste: string; apresentacao: unknown; qualityGate: unknown; aprovadoDePrimeira: boolean | null; publicadoEm: Date | null; urlPublicada: string | null; candidatoId: string | null; resultado: { views: number | null; retencaoMedia: number | null; cliquesProduto: number | null; vendas: number | null; comissao: number | null } | null; origem: string }[]
  emProducao: { nomeProduto: string; estrutura: string; objetivoDoTeste: string } | null
  amostras: AmostraDaTela[]
}): SlotDoPlano[] {
  const pub = p.publicadas.filter((x) => x.ordem !== null).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
  const usadas = new Set(pub.map((x) => x.estrutura))
  const pendentes = MATRIZ_DAS_10.filter((h) => !usadas.has(h.estrutura))
  const slots: SlotDoPlano[] = []
  for (let i = 1; i <= LIMITE_ASSISTIDO; i++) {
    const real = pub.find((x) => x.ordem === i)
    if (real) {
      const ap = (real.apresentacao ?? {}) as { versao?: { gancho?: string; cta?: string; duracaoSegundos?: number }; produto?: { categoria?: string | null } }
      const h = MATRIZ_DAS_10.find((m) => m.estrutura === real.estrutura) ?? { estrutura: real.estrutura, duracao: 15 as const, objetivo: 'VENDA' as const, hipotese: real.objetivoDoTeste, categoriaSugerida: null, kitSugerido: null }
      slots.push({
        slot: i, rotulo: `${i}/${LIMITE_ASSISTIDO}`, situacao: 'PUBLICADA', hipotese: h, produtoSugerido: null,
        real: {
          produto: real.nomeProduto, categoria: ap.produto?.categoria ?? null, origem: real.origem, motivo: real.motivoEscolha, estrutura: real.estrutura,
          hook: ap.versao?.gancho ?? null, cta: ap.versao?.cta ?? null, duracao: ap.versao?.duracaoSegundos ?? null,
          qualityGate: (real.qualityGate as { veredito?: string } | null)?.veredito ?? null,
          aprovacao: real.aprovadoDePrimeira === null ? null : real.aprovadoDePrimeira ? 'aprovado de primeira' : 'aprovado após ajuste',
          publicadoEm: real.publicadoEm?.toISOString() ?? null, link: real.urlPublicada,
          views: real.resultado?.views ?? null, retencao: real.resultado?.retencaoMedia ?? null, cliques: real.resultado?.cliquesProduto ?? null,
          vendas: real.resultado?.vendas ?? null, comissao: real.resultado?.comissao ?? null,
          aprendizado: null,
        },
      })
      continue
    }
    const proximo = slots.filter((s) => s.situacao !== 'PUBLICADA').length === 0
    if (proximo && p.emProducao) {
      const h = MATRIZ_DAS_10.find((m) => m.estrutura === p.emProducao!.estrutura) ?? pendentes[0] ?? MATRIZ_DAS_10[i - 1]
      slots.push({ slot: i, rotulo: `${i}/${LIMITE_ASSISTIDO}`, situacao: 'EM_PRODUCAO', hipotese: h, real: null, produtoSugerido: p.emProducao.nomeProduto })
      continue
    }
    const h = pendentes.shift() ?? MATRIZ_DAS_10[i - 1]
    const kit = h.kitSugerido ? p.amostras.find((a) => kitDaChave(a.chave)?.roteiros.some((r) => r.id === h.kitSugerido) && !['REJEITADA', 'CANCELADA'].includes(a.efetivo)) : null
    slots.push({ slot: i, rotulo: `${i}/${LIMITE_ASSISTIDO}`, situacao: 'PLANEJADA', hipotese: h, real: null, produtoSugerido: kit ? `${kit.nomeProduto} (${kit.rotulo.toLowerCase()})` : null })
  }
  return slots
}

// ── Agenda sugerida (Calendário automático) ─────────────────────────────

export interface ItemDaAgendaSugerida { quando: string | null; titulo: string; tipo: 'PUBLICAR' | 'APROVAR' | 'GRAVAR' | 'DEPENDENCIA' | 'PRAZO'; dependencia: string | null; link: string }

/**
 * FUNÇÃO PURA. Só põe horário onde há material (aprovado/pronto para
 * aprovar) — horário é hipótese declarada (sem dado de audiência ainda);
 * no máximo 2 por dia. Sem material: dependência sem data. Prazos reais
 * (missão, amostra) entram como marcos.
 */
export function agendaSugerida(fila: ItemDaFila[], metas: (AnaliseDaMeta & { fim?: Date })[], amostras: AmostraDaTela[], agora: Date, natalFim: Date | null): ItemDaAgendaSugerida[] {
  const out: ItemDaAgendaSugerida[] = []
  let cursor = horarioSugerido(agora)
  let noDia = 0
  let dia = cursor.toISOString().slice(0, 10)
  const proximoHorario = () => {
    const d = cursor.toISOString().slice(0, 10)
    if (d !== dia) { dia = d; noDia = 0 }
    if (noDia >= 2) { cursor = new Date(cursor.getTime() + DIA); cursor.setUTCHours(22, 0, 0, 0); dia = cursor.toISOString().slice(0, 10); noDia = 0 }
    noDia++
    const q = cursor.toISOString()
    cursor = new Date(cursor.getTime() + 4 * 60 * 60 * 1000)
    return q
  }
  for (const i of fila) {
    if (i.estado === 'PRONTO_PARA_PUBLICACAO') out.push({ quando: proximoHorario(), titulo: `Publicar: ${i.produto}`, tipo: 'PUBLICAR', dependencia: null, link: i.link })
    else if (i.estado === 'PRONTO_PARA_APROVACAO') out.push({ quando: proximoHorario(), titulo: `Publicar (após sua aprovação): ${i.produto}`, tipo: 'APROVAR', dependencia: 'Aguardando aprovação', link: i.link })
    else if (i.estado === 'PRONTO_PARA_CONTEUDO') out.push({ quando: null, titulo: `Gravar as cenas: ${i.produto}`, tipo: 'GRAVAR', dependencia: 'Aguardando mídia', link: i.link })
    else if (i.estado === 'AGUARDANDO_AMOSTRA' || i.estado === 'AGUARDANDO_TERCEIRO') out.push({ quando: null, titulo: i.produto, tipo: 'DEPENDENCIA', dependencia: 'Aguardando amostra', link: i.link })
    else if (i.estado === 'BLOQUEADO' && /mídia/i.test(i.motivo)) out.push({ quando: null, titulo: i.produto, tipo: 'DEPENDENCIA', dependencia: 'Aguardando mídia', link: i.link })
  }
  // P2.18: o prazo é o FIM REAL da missão (antes: agora + dias arredondados para cima, que passava do fim —
  // ex.: missão até 19/10 23:59 aparecia como 20/10). Sem o fim, cai na estimativa antiga.
  for (const m of metas) if (m.situacao === 'EM_ANDAMENTO' || m.situacao === 'NAO_INICIADA') out.push({ quando: (m.fim ?? new Date(agora.getTime() + m.diasRestantes * DIA)).toISOString(), titulo: `Prazo da missão: ${m.nome} (faltam ${m.faltam})`, tipo: 'PRAZO', dependencia: null, link: '/tiktok-metas' })
  for (const a of amostras) if (a.prazo && a.estado === 'RECEBIDA') out.push({ quando: a.prazo.em, titulo: `Prazo ${a.prazo.confirmado ? 'confirmado' : 'estimado'} da amostra: ${a.nomeProduto}`, tipo: 'PRAZO', dependencia: null, link: '/tiktok-metas#amostras' })
  // O fim da campanha é exclusivo (00:00 do dia seguinte): mostra o último instante do último dia.
  if (natalFim && natalFim.getTime() > agora.getTime()) out.push({ quando: new Date(natalFim.getTime() - 60_000).toISOString(), titulo: 'Fim da janela de Natal', tipo: 'PRAZO', dependencia: null, link: '/oportunidades' })
  // Datadas primeiro (em ordem), depois as dependências.
  return out.sort((a, b) => (a.quando ?? '9999').localeCompare(b.quando ?? '9999'))
}

// ── Riscos operacionais ─────────────────────────────────────────────────

export type TipoDeRisco =
  | 'AMOSTRA_APROVADA_SEM_ENVIO' | 'AMOSTRA_RECEBIDA_SEM_CONTEUDO' | 'MISSAO_PERTO_DO_PRAZO' | 'VIDEO_PRONTO_SEM_APROVACAO'
  | 'SAZONAL_PERDENDO_JANELA' | 'COMISSAO_ALTERADA' | 'OPORTUNIDADE_ESFRIANDO' | 'PUBLICACAO_SEM_METRICA' | 'VENDA_SEM_COMISSAO_CONFIRMADA'
export interface RiscoOperacional { tipo: TipoDeRisco; produto: string | null; detalhe: string; quem: Quem; /** Só a titular pode resolver → pode notificar. */ notificar: boolean; gravidade: 'ALTA' | 'MEDIA' | 'BAIXA' }

/** FUNÇÃO PURA. O Patrono resolve o que é dele; só notifica o que é da titular. */
export function riscosOperacionais(p: {
  amostras: AmostraDaTela[]
  metas: AnaliseDaMeta[]
  assistidas: AssistidaParaFila[]
  resultados: { nomeProduto: string | null; publicadoEm: Date; views: number | null; vendas: number | null; comissao: number | null }[]
  observacoes: { chave: string; nomeProduto: string; observadoEm: Date; comissaoExibida: number | null; rankingPosicao: number | null }[]
  natalFim: Date | null
  agora: Date
}): RiscoOperacional[] {
  const r: RiscoOperacional[] = []
  for (const a of p.amostras) {
    if (a.efetivo === 'APROVADA' && a.alertas.includes('ATRASADA')) r.push({ tipo: 'AMOSTRA_APROVADA_SEM_ENVIO', produto: a.nomeProduto, detalhe: a.alertasDetalhe.join(' '), quem: 'VENDEDOR', notificar: false, gravidade: 'BAIXA' })
    if (a.estado === 'RECEBIDA' && a.alertas.includes('OBRIGACAO_DE_CONTEUDO')) r.push({ tipo: 'AMOSTRA_RECEBIDA_SEM_CONTEUDO', produto: a.nomeProduto, detalhe: a.alertasDetalhe.join(' '), quem: a.acaoDaTitular ? 'TITULAR' : 'PATRONO', notificar: !!a.acaoDaTitular, gravidade: a.alertas.includes('ATRASADA') || a.alertas.includes('PRAZO_PROXIMO') ? 'ALTA' : 'MEDIA' })
    if (a.aderenciaNatal && p.natalFim && a.estado !== 'RECEBIDA' && !['PUBLICADA', 'MEDINDO_RESULTADO', 'CONCLUIDA', 'REJEITADA', 'CANCELADA'].includes(a.efetivo)) {
      const dias = Math.ceil((p.natalFim.getTime() - p.agora.getTime()) / DIA)
      if (dias <= 45) r.push({ tipo: 'SAZONAL_PERDENDO_JANELA', produto: a.nomeProduto, detalhe: `Produto de Natal ainda sem vídeo; a janela fecha em ${dias} dia(s).`, quem: 'VENDEDOR', notificar: false, gravidade: dias <= 21 ? 'ALTA' : 'MEDIA' })
    }
  }
  for (const m of p.metas) {
    if ((m.situacao === 'EM_ANDAMENTO' || m.situacao === 'NAO_INICIADA') && (m.risco === 'ALTO' || m.risco === 'MEDIO') && m.diasRestantes <= 10) {
      // Missão de vitrine/amostra depende de ação no app (limitação oficial) → é da titular.
      const daTitular = m.tipo === 'ADICIONAR_PRODUTOS' || m.tipo === 'SOLICITAR_AMOSTRAS'
      r.push({ tipo: 'MISSAO_PERTO_DO_PRAZO', produto: null, detalhe: `${m.nome}: faltam ${m.faltam} em ${m.diasRestantes} dia(s) (${m.recompensaTexto}).`, quem: daTitular ? 'TITULAR' : 'PATRONO', notificar: daTitular, gravidade: m.risco === 'ALTO' ? 'ALTA' : 'MEDIA' })
    }
  }
  for (const a of p.assistidas) {
    if (a.estado === 'AGUARDANDO_APROVACAO' && statusReal(a).videoGerado && p.agora.getTime() - a.updatedAt.getTime() > DIA) r.push({ tipo: 'VIDEO_PRONTO_SEM_APROVACAO', produto: a.nomeProduto, detalhe: 'Vídeo pronto há mais de 24 h esperando a sua aprovação.', quem: 'TITULAR', notificar: false /* já está na central */, gravidade: 'MEDIA' })
  }
  for (const x of p.resultados) {
    const horas = (p.agora.getTime() - x.publicadoEm.getTime()) / 3_600_000
    if (horas > 48 && x.views === null) r.push({ tipo: 'PUBLICACAO_SEM_METRICA', produto: x.nomeProduto, detalhe: 'Publicado há mais de 48 h sem views registradas (manual até a API de métricas).', quem: 'TITULAR', notificar: false, gravidade: 'BAIXA' })
    if ((x.vendas ?? 0) > 0 && x.comissao === null) r.push({ tipo: 'VENDA_SEM_COMISSAO_CONFIRMADA', produto: x.nomeProduto, detalhe: 'Há venda registrada sem comissão confirmada (o TikTok paga às quartas, após a liquidação).', quem: 'TIKTOK', notificar: false, gravidade: 'BAIXA' })
  }
  // Mudanças entre snapshots manuais do mesmo produto.
  const porChave = new Map<string, typeof p.observacoes>()
  for (const o of p.observacoes) porChave.set(o.chave, [...(porChave.get(o.chave) ?? []), o])
  for (const os of porChave.values()) {
    const ord = [...os].sort((a, b) => a.observadoEm.getTime() - b.observadoEm.getTime())
    const com = ord.filter((o) => o.comissaoExibida !== null)
    if (com.length >= 2 && com[com.length - 1].comissaoExibida !== com[com.length - 2].comissaoExibida) {
      const [a, b] = [com[com.length - 2].comissaoExibida!, com[com.length - 1].comissaoExibida!]
      r.push({ tipo: 'COMISSAO_ALTERADA', produto: ord[0].nomeProduto, detalhe: `Comissão vista mudou de R$ ${a.toFixed(2)} para R$ ${b.toFixed(2)} (snapshots manuais).`, quem: 'PATRONO', notificar: false, gravidade: b < a ? 'MEDIA' : 'BAIXA' })
    }
    const rk = ord.filter((o) => o.rankingPosicao !== null)
    if (rk.length >= 2 && rk[rk.length - 1].rankingPosicao! > rk[rk.length - 2].rankingPosicao! + 5) {
      r.push({ tipo: 'OPORTUNIDADE_ESFRIANDO', produto: ord[0].nomeProduto, detalhe: `Caiu de #${rk[rk.length - 2].rankingPosicao} para #${rk[rk.length - 1].rankingPosicao} no ranking visto no app.`, quem: 'PATRONO', notificar: false, gravidade: 'BAIXA' })
    }
  }
  const peso = { ALTA: 0, MEDIA: 1, BAIXA: 2 }
  return r.sort((a, b) => peso[a.gravidade] - peso[b.gravidade])
}

// ── Caminho para a primeira comissão ────────────────────────────────────

export type EstadoDaEtapa = 'CONCLUIDO' | 'EM_ANDAMENTO' | 'BLOQUEADO' | 'PRECISA_DE_VOCE' | 'DEPENDE_DO_TIKTOK'
export interface EtapaDoCaminho { etapa: string; estado: EstadoDaEtapa; detalhe: string }

/** FUNÇÃO PURA. Cada etapa com o estado verdadeiro; nunca "sucesso" sem o fato. */
export function caminhoParaPrimeiraComissao(f: {
  contaAfiliadaConfirmada: { em: string; fonte: string } | null
  produtosEmJogo: number
  amostrasACaminho: number
  amostrasRecebidas: number
  missaoProdutosAdicionados: number | null
  midiaAutorizada: boolean
  videoGerando: boolean
  videoGerado: boolean
  qgAprovado: boolean
  aguardandoAprovacao: boolean
  aprovado: boolean
  publicado: { modo: string | null } | null
  views: number | null
  cliques: number | null
  vendas: number | null
  comissao: number | null
  canalAutomatico: boolean
}): EtapaDoCaminho[] {
  const e = (etapa: string, estado: EstadoDaEtapa, detalhe: string): EtapaDoCaminho => ({ etapa, estado, detalhe })
  const publicado = !!f.publicado
  return [
    f.contaAfiliadaConfirmada
      ? e('Conta de afiliada', 'CONCLUIDO', `Pagamento/fiscal concluído — ${f.contaAfiliadaConfirmada.fonte} em ${dataBR(f.contaAfiliadaConfirmada.em)} (sem confirmação por API).`)
      : e('Conta de afiliada', 'PRECISA_DE_VOCE', 'Confirmar no app que a conta está verificada.'),
    f.produtosEmJogo > 0 ? e('Produto escolhido', 'CONCLUIDO', `${f.produtosEmJogo} produto(s) em jogo (amostras/publicações).`) : e('Produto escolhido', 'EM_ANDAMENTO', 'O Patrono escolhe pelo ranking de Oportunidades.'),
    publicado || (f.missaoProdutosAdicionados ?? 0) > 0
      ? e('Na vitrine', 'CONCLUIDO', publicado ? 'Produto marcado em vídeo publicado.' : `Missão registra ${f.missaoProdutosAdicionados} produto(s) adicionado(s).`)
      : e('Na vitrine', 'PRECISA_DE_VOCE', 'Adicionar no app (manual por limitação oficial: a API de vitrine não está liberada no Brasil).'),
    f.midiaAutorizada
      ? e('Mídia', 'CONCLUIDO', 'Há mídia autorizada.')
      : f.amostrasRecebidas > 0
        ? e('Mídia', 'PRECISA_DE_VOCE', 'Amostra recebida: gravar as cenas do kit.')
        : f.amostrasACaminho > 0
          ? e('Mídia', 'EM_ANDAMENTO', `Aguardando ${f.amostrasACaminho} amostra(s) (aprovação/envio do vendedor).`)
          : e('Mídia', 'PRECISA_DE_VOCE', 'Foto/vídeo seu de um produto do ranking — ou pedir amostra.'),
    f.videoGerado ? e('Vídeo', 'CONCLUIDO', 'MP4 gerado.') : f.videoGerando ? e('Vídeo', 'EM_ANDAMENTO', 'Gerando.') : e('Vídeo', 'BLOQUEADO', 'Depende da mídia.'),
    f.qgAprovado ? e('Quality Gate', 'CONCLUIDO', 'Arquivo checado e aprovado.') : e('Quality Gate', f.videoGerado ? 'EM_ANDAMENTO' : 'BLOQUEADO', f.videoGerado ? 'Checando o arquivo.' : 'Depende do vídeo.'),
    f.aprovado || publicado ? e('Aprovação', 'CONCLUIDO', 'Aprovado por você.') : f.aguardandoAprovacao ? e('Aprovação', 'PRECISA_DE_VOCE', 'Assistir e aprovar.') : e('Aprovação', 'BLOQUEADO', 'Depende do vídeo.'),
    publicado
      ? e('Produto marcado', 'CONCLUIDO', f.publicado!.modo === 'MANUAL_PELA_TITULAR' ? 'Declarado por você na publicação manual.' : 'Na publicação.')
      : e('Produto marcado', 'PRECISA_DE_VOCE', 'Marcar no app ao publicar (a API de publicação não tem campo de produto).'),
    publicado ? e('Publicado', 'CONCLUIDO', 'Vídeo no ar.') : f.aprovado ? e('Publicado', f.canalAutomatico ? 'EM_ANDAMENTO' : 'PRECISA_DE_VOCE', f.canalAutomatico ? 'Enviando ao TikTok.' : 'Publicar no app e colar o link (app TikTok ainda não aprovado).') : e('Publicado', 'BLOQUEADO', 'Depende da aprovação.'),
    f.views !== null ? e('Views', 'CONCLUIDO', `${f.views.toLocaleString('pt-BR')} views.`) : e('Views', publicado ? 'DEPENDE_DO_TIKTOK' : 'BLOQUEADO', publicado ? 'Registro manual até a API de métricas (app aprovado).' : 'Depende da publicação.'),
    f.cliques !== null ? e('Clique', 'CONCLUIDO', `${f.cliques.toLocaleString('pt-BR')} cliques.`) : e('Clique', publicado ? 'DEPENDE_DO_TIKTOK' : 'BLOQUEADO', publicado ? 'Visto no painel do TikTok; registrar até haver API.' : 'Depende da publicação.'),
    (f.vendas ?? 0) > 0 ? e('Venda', 'CONCLUIDO', `${f.vendas} venda(s).`) : e('Venda', publicado ? 'EM_ANDAMENTO' : 'BLOQUEADO', publicado ? 'Aguardando a primeira venda.' : 'Depende da publicação.'),
    (f.comissao ?? 0) > 0 ? e('Comissão', 'CONCLUIDO', `R$ ${f.comissao!.toFixed(2).replace('.', ',')}.`) : e('Comissão', (f.vendas ?? 0) > 0 ? 'DEPENDE_DO_TIKTOK' : 'BLOQUEADO', (f.vendas ?? 0) > 0 ? 'O TikTok confirma após a liquidação (pagamento às quartas).' : 'Depende da venda.'),
  ]
}

// ── Atribuição (P2.17.28) ───────────────────────────────────────────────

export type Atribuicao = 'CONFIRMADA' | 'PROVAVEL' | 'DESCONHECIDA'
/** Janela documentada de atribuição do TikTok Shop BR (14 dias após o clique). */
export const JANELA_DE_ATRIBUICAO_DIAS = 14

/**
 * FUNÇÃO PURA. Venda → vídeo/produto:
 *   CONFIRMADA  — o próprio TikTok atribuiu ao vídeo (resultado por vídeo) ou
 *                 há clique rastreado do nosso link (Sale.clickEventId);
 *   PROVÁVEL    — mesmo produto, UM único vídeo nosso publicado nos 14 dias
 *                 anteriores (nunca vira confirmada por isso);
 *   DESCONHECIDA — o resto (incluindo mais de um vídeo possível).
 */
export function classificarAtribuicao(v: { origem: 'RESULTADO_DO_VIDEO' | 'VENDA'; clickEventId?: string | null; produtoId?: string | null; data: Date }, videos: { produtoId: string | null; publicadoEm: Date }[]): { classe: Atribuicao; motivo: string } {
  if (v.origem === 'RESULTADO_DO_VIDEO') return { classe: 'CONFIRMADA', motivo: 'Venda informada no resultado do próprio vídeo (atribuída pelo TikTok).' }
  if (v.clickEventId) return { classe: 'CONFIRMADA', motivo: 'Clique rastreado do nosso link antes da venda.' }
  if (!v.produtoId) return { classe: 'DESCONHECIDA', motivo: 'Venda sem produto/link: não dá para saber a origem.' }
  const candidatos = videos.filter((x) => x.produtoId === v.produtoId && x.publicadoEm.getTime() <= v.data.getTime() && v.data.getTime() - x.publicadoEm.getTime() <= JANELA_DE_ATRIBUICAO_DIAS * DIA)
  if (candidatos.length === 1) return { classe: 'PROVAVEL', motivo: 'Um único vídeo nosso deste produto nos 14 dias anteriores (correlação, não prova).' }
  if (candidatos.length > 1) return { classe: 'DESCONHECIDA', motivo: 'Mais de um vídeo possível: não atribuir.' }
  return { classe: 'DESCONHECIDA', motivo: 'Nenhum vídeo nosso deste produto na janela.' }
}

// ── P2.18: plano operacional das missões ────────────────────────────────

export type ResponsavelDaMissao = 'TITULAR' | 'TIKTOK' | 'PATRONO' | 'NINGUEM'
export interface LinhaDaMissao {
  id: string
  nome: string
  tipo: string
  atual: number
  exigido: number
  falta: number
  prazo: string
  diasRestantes: number
  situacao: string
  dependencia: string
  proximaAcao: string
  responsavel: ResponsavelDaMissao
}

/**
 * FUNÇÃO PURA. Para cada missão ativa: atual (o que o APP contou — nunca
 * inflado com o que registramos aqui), falta, prazo, de que depende, a
 * próxima ação e quem age. O que registramos e o app ainda não contou vira
 * DEPENDÊNCIA ("conferir no app"), não progresso.
 */
export function planoDasMissoes(p: {
  metas: { id: string; nome: string; tipo: string; fim: Date; quantidadeExigida: number; quantidadeRealizada: number }[]
  analises: { id: string; situacao: string; diasRestantes: number; faltam: number }[]
  amostrasPedidas: number
  amostrasComputadas: number
  publicadas: number
  aguardandoMidia: number
  emProducao: number
  aguardandoAprovacao: number
  temMidiaAutorizada: boolean
}): LinhaDaMissao[] {
  const linhas: LinhaDaMissao[] = []
  for (const m of p.metas) {
    const a = p.analises.find((x) => x.id === m.id)
    if (!a || (a.situacao !== 'EM_ANDAMENTO' && a.situacao !== 'NAO_INICIADA')) continue
    const base = { id: m.id, nome: m.nome, tipo: m.tipo, atual: m.quantidadeRealizada, exigido: m.quantidadeExigida, falta: a.faltam, prazo: m.fim.toISOString(), diasRestantes: a.diasRestantes, situacao: a.situacao }
    if (m.tipo === 'ADICIONAR_PRODUTOS') {
      linhas.push({ ...base, dependencia: 'Só no app: a API de vitrine não está liberada no Brasil.', proximaAcao: `Adicionar ${a.faltam} produto(s) à vitrine no app — use os primeiros de Oportunidades. Depois, atualizar a missão aqui com o número que o app mostrar.`, responsavel: 'TITULAR' })
    } else if (m.tipo === 'SOLICITAR_AMOSTRAS') {
      const naoContadas = Math.max(0, p.amostrasPedidas - Math.max(m.quantidadeRealizada, p.amostrasComputadas))
      linhas.push(naoContadas > 0
        ? { ...base, dependencia: `${p.amostrasPedidas} amostra(s) pedidas registradas aqui; o app ainda não mostrou ${naoContadas} na missão (pode contar só depois da aprovação do vendedor).`, proximaAcao: `Conferir no app se a missão contou as amostras pedidas; quando contar, tocar "O app contou" em cada uma.${a.faltam > p.amostrasPedidas - m.quantidadeRealizada ? ` Se faltar mesmo assim, pedir mais ${a.faltam - (p.amostrasPedidas - m.quantidadeRealizada)} amostra(s) no app.` : ''}`, responsavel: 'TIKTOK' }
        : { ...base, dependencia: 'Pedido de amostra só no app.', proximaAcao: `Pedir ${a.faltam} amostra(s) no app dos produtos recomendados e registrar aqui.`, responsavel: 'TITULAR' })
    } else if (m.tipo === 'VIDEOS_QUALIFICADOS' || m.tipo === 'VIDEOS_COM_PRODUTO') {
      const comProduto = m.tipo === 'VIDEOS_COM_PRODUTO'
      const r: Pick<LinhaDaMissao, 'dependencia' | 'proximaAcao' | 'responsavel'> =
        p.aguardandoAprovacao > 0 ? { dependencia: 'Vídeo pronto esperando a sua aprovação.', proximaAcao: 'Aprovar (ou pedir ajuste) em "Precisa de você" e publicar no app marcando o produto.', responsavel: 'TITULAR' }
          : p.emProducao > 0 ? { dependencia: 'O Patrono está gerando o vídeo.', proximaAcao: 'Aguardar o MP4 e a checagem de qualidade (automático).', responsavel: 'PATRONO' }
            : { dependencia: p.temMidiaAutorizada ? 'Mídia real já enviada; falta o próximo vídeo.' : 'Mídia real do produto: amostra recebida ou produto que você tenha em mãos.', proximaAcao: p.aguardandoMidia > 0 || !p.temMidiaAutorizada ? 'Em Oportunidades, tocar "Tenho este produto em mãos" num produto que você tenha — ou gravar as cenas quando uma amostra chegar.' : 'Pedir ao Patrono a próxima publicação.', responsavel: 'TITULAR' }
      linhas.push({ ...base, ...r, dependencia: `${r.dependencia}${comProduto ? ' O produto é marcado no app ao publicar (a API não tem esse campo).' : ' "Qualificado" segue os critérios do TikTok (confira no app).'}` })
    } else {
      linhas.push({ ...base, dependencia: 'Requisito descrito na missão.', proximaAcao: 'Seguir o requisito da missão no app.', responsavel: 'TITULAR' })
    }
  }
  return linhas.sort((x, y) => new Date(x.prazo).getTime() - new Date(y.prazo).getTime() || y.falta - x.falta)
}

// ── A leitura única ─────────────────────────────────────────────────────

export async function operacaoComercial(workspaceId: string, agora: Date = new Date()) {
  const [amostras, metas, assistidasBrutas, status, resultados, canal, programa, observacoes, midias, vendas] = await Promise.all([
    listarAmostras(workspaceId, agora),
    listarMetasAtivas(workspaceId),
    prisma.publicacaoAssistida.findMany({ where: { workspaceId, demonstracao: false }, orderBy: { createdAt: 'asc' }, take: 60 }),
    statusDosProdutos(workspaceId),
    prisma.videoTikTokResultado.findMany({ where: { workspaceId }, orderBy: { publicadoEm: 'desc' }, take: 200 }),
    estadoDoCanalTikTok(workspaceId),
    prisma.affiliateProgram.findUnique({ where: { workspaceId_platform: { workspaceId, platform: 'tiktok-shop' } } }),
    prisma.observacaoDeMercado.findMany({ where: { workspaceId }, orderBy: { observadoEm: 'asc' }, take: 500, select: { chave: true, nomeProduto: true, observadoEm: true, comissaoExibida: true, rankingPosicao: true } }),
    prisma.midiaDoProduto.count({ where: { workspaceId, status: 'AUTORIZADA', NOT: { origem: 'GERADO_PELO_PATRONO' } } }),
    prisma.sale.findMany({ where: { workspaceId, status: { not: 'CANCELLED' } }, select: { id: true, clickEventId: true, productId: true, date: true }, take: 500 }),
  ])
  const analises = analisarMetas(metas, agora)
  const natal = campanhaAtiva(agora)
  const natalFim = natal ? new Date(natal.fim) : null
  const assistidas: AssistidaParaFila[] = assistidasBrutas.map((a) => ({ id: a.id, estado: a.estado, nomeProduto: a.nomeProduto, candidatoId: a.candidatoId, apresentacao: a.apresentacao, qualityGate: a.qualityGate, publishId: a.publishId, publicadoEm: a.publicadoEm, bloqueio: a.bloqueio, updatedAt: a.updatedAt }))
  const statusLista = [...status.entries()].map(([id, s]) => ({ id, nome: s.nome, status: s.status, motivo: s.motivos[0] ?? null }))
  const fila = filaComercial({ amostras, assistidas, status: statusLista, agora })
  const publicadas = assistidasBrutas.filter((a) => a.estado === 'PUBLICADO')
  const emProducao = assistidasBrutas.filter((a) => !['PUBLICADO', 'REJEITADO'].includes(a.estado)).at(-1) ?? null
  const resultadoDe = (id: string) => resultados.find((r) => r.publicacaoAssistidaId === id) ?? null
  const plano = planoDasDez({
    publicadas: publicadas.map((a) => ({
      ordem: a.ordem, nomeProduto: a.nomeProduto, estrutura: a.estrutura, motivoEscolha: a.motivoEscolha, objetivoDoTeste: a.objetivoDoTeste, apresentacao: a.apresentacao, qualityGate: a.qualityGate,
      aprovadoDePrimeira: a.aprovadoDePrimeira, publicadoEm: a.publicadoEm, urlPublicada: a.urlPublicada, candidatoId: a.candidatoId, resultado: resultadoDe(a.id),
      origem: amostras.some((x) => x.candidatoId && x.candidatoId === a.candidatoId) ? 'amostra' : 'oportunidade',
    })),
    emProducao: emProducao ? { nomeProduto: emProducao.nomeProduto, estrutura: emProducao.estrutura, objetivoDoTeste: emProducao.objetivoDoTeste } : null,
    amostras,
  })
  const agenda = agendaSugerida(fila, analises.map((a) => ({ ...a, fim: metas.find((m) => m.id === a.id)?.fim })), amostras, agora, natalFim)
  const riscos = riscosOperacionais({
    amostras, metas: analises, assistidas, natalFim, agora, observacoes,
    resultados: resultados.map((r) => ({ nomeProduto: r.nomeProduto, publicadoEm: r.publicadoEm, views: r.views, vendas: r.vendas, comissao: r.comissao })),
  })
  const somaOuNull = (xs: (number | null)[]) => (xs.some((x) => x !== null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null)
  const primeiroPublicado = publicadas[0] ?? null
  // Conta de afiliada: o programa marcado como ATIVO pela titular (Meus Programas) — nunca "confirmado por API".
  const contaConfirmada = programa && programa.status === 'ACTIVE' ? { em: programa.updatedAt.toISOString(), fonte: /confirmad[oa] pela titular/i.test(programa.notes ?? '') ? 'confirmado pela titular' : 'marcado como ATIVO pela titular em Meus Programas' } : null
  const caminho = caminhoParaPrimeiraComissao({
    contaAfiliadaConfirmada: contaConfirmada,
    produtosEmJogo: new Set([...amostras.filter((a) => !['REJEITADA', 'CANCELADA'].includes(a.efetivo)).map((a) => a.chave), ...assistidasBrutas.filter((a) => a.estado !== 'REJEITADO').map((a) => a.candidatoId ?? a.nomeProduto)]).size,
    amostrasACaminho: amostras.filter((a) => ['SOLICITADA', 'PENDENTE_APROVACAO', 'APROVADA', 'ENVIADA'].includes(a.efetivo)).length,
    amostrasRecebidas: amostras.filter((a) => a.estado === 'RECEBIDA').length,
    missaoProdutosAdicionados: metas.find((m) => m.tipo === 'ADICIONAR_PRODUTOS')?.quantidadeRealizada ?? null,
    midiaAutorizada: midias > 0,
    videoGerando: assistidas.some((a) => ['VIDEO_NA_FILA', 'GERANDO_VIDEO'].includes(a.estado)),
    videoGerado: assistidas.some((a) => statusReal(a).videoGerado),
    qgAprovado: assistidas.some((a) => statusReal(a).etapas.includes('QUALITY GATE APROVADO')),
    aguardandoAprovacao: assistidas.some((a) => a.estado === 'AGUARDANDO_APROVACAO' && statusReal(a).videoGerado),
    aprovado: assistidas.some((a) => aprovadaOuAlem(a.estado)),
    publicado: primeiroPublicado ? { modo: primeiroPublicado.modoDePublicacao } : null,
    views: somaOuNull(resultados.map((r) => r.views)),
    cliques: somaOuNull(resultados.map((r) => r.cliquesProduto)),
    vendas: somaOuNull(resultados.map((r) => r.vendas)),
    comissao: somaOuNull(resultados.map((r) => r.comissao)),
    canalAutomatico: canal.nivel !== 'BLOQUEADO',
  })
  const videosPorProduto = resultados.map((r) => ({ produtoId: r.produtoId, publicadoEm: r.publicadoEm }))
  const atribuicao = { CONFIRMADA: 0, PROVAVEL: 0, DESCONHECIDA: 0 } as Record<Atribuicao, number>
  for (const r of resultados) if ((r.vendas ?? 0) > 0) atribuicao.CONFIRMADA += 1
  for (const s of vendas) atribuicao[classificarAtribuicao({ origem: 'VENDA', clickEventId: s.clickEventId, produtoId: s.productId, data: s.date }, videosPorProduto).classe] += 1
  const prioridade = priorizarAmostras(amostras)
  return {
    geradoEm: agora.toISOString(),
    fila,
    proxima: proximaExecucao(fila),
    amostras: {
      total: amostras.length,
      pendentesDeAprovacao: amostras.filter((a) => a.efetivo === 'SOLICITADA' || a.efetivo === 'PENDENTE_APROVACAO').length,
      aprovadas: amostras.filter((a) => a.efetivo === 'APROVADA').length,
      enviadas: amostras.filter((a) => a.efetivo === 'ENVIADA').length,
      recebidas: amostras.filter((a) => a.estado === 'RECEBIDA').length,
      comPrazoProximo: amostras.filter((a) => a.alertas.includes('PRAZO_PROXIMO') || a.alertas.includes('ATRASADA')).length,
      missaoComputadas: amostras.filter((a) => a.missao.computada === true).length,
      prioridade: prioridade.map((a) => ({ nome: a.nomeProduto, posicao: a.posicao, porque: a.porque, valor: valorEconomico(a) })),
    },
    plano,
    missoes: planoDasMissoes({
      metas, analises,
      amostrasPedidas: amostras.filter((a) => !['REJEITADA', 'CANCELADA'].includes(a.efetivo)).length,
      amostrasComputadas: amostras.filter((a) => a.missao.computada === true).length,
      publicadas: publicadas.length,
      aguardandoMidia: assistidas.filter((a) => a.estado === 'AGUARDANDO_MIDIA').length,
      emProducao: assistidas.filter((a) => ['VIDEO_NA_FILA', 'GERANDO_VIDEO', 'GERANDO'].includes(a.estado)).length,
      aguardandoAprovacao: assistidas.filter((a) => a.estado === 'AGUARDANDO_APROVACAO' && statusReal(a).videoGerado).length,
      temMidiaAutorizada: midias > 0,
    }),
    agenda,
    riscos,
    caminho,
    atribuicao,
  }
}
