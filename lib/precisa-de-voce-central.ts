/**
 * P2.17.11 — CENTRAL ÚNICA "Precisa de você".
 *
 * Regra permanente: SE DEPENDE DA TITULAR → ENTRA AQUI. E SÓ isso: o que o
 * Patrono resolve sozinho (API fora do ar, retentativa, envio desligado no
 * ambiente, espera pela aprovação do TikTok) NÃO vira pendência.
 *
 * Junta, sem duplicar e por workspace:
 *   - os pedidos que já existiam (ApprovalRequest: escolha, exceção, TikTok Shop);
 *   - a publicação assistida aguardando aprovação (e o que ela exigir depois);
 *   - conteúdos aguardando aprovação (antiga tela "Aprovações");
 *   - autorização/login do TikTok e a criação do app (ação externa).
 *
 * Ordem: risco de perder dinheiro → prazo → bloqueia publicação → bloqueia
 * integração → demais. O sininho mostra `itens.length`.
 *
 * Módulos futuros que gerarem dependência humana entram AQUI (uma função
 * `pendenciasDe…` a mais), nunca em pendência escondida dentro de página.
 */
import type { VisaoDaOperacao } from './jornada'
import { prisma } from './prisma'
import { listarPrecisaDeVoce, type ItemPrecisaDeVoce } from './precisa-de-voce'
import { TIPO_ESCOLHA, TIPO_EXCECAO } from './supervisor/ciclo'
import { estadoDoCanalTikTok } from './tiktok-estado-canal'
import { LIMITE_ASSISTIDO, statusReal } from './publicacao-assistida'
import { analisarMetas, listarMetasAtivas } from './metas-tiktok'
import { nomeCurto } from './motor-de-videos-tiktok'
import { listarAmostras, type AmostraDaTela } from './amostras'

export const CATEGORIAS = ['APROVACAO', 'AUTORIZACAO', 'LOGIN_MFA', 'DOCUMENTO', 'REVISAO', 'ACAO_EXTERNA', 'BLOQUEIO_DA_PLATAFORMA'] as const
export type Categoria = (typeof CATEGORIAS)[number]
export const ROTULO_DA_CATEGORIA: Record<Categoria, string> = {
  APROVACAO: 'APROVAÇÃO',
  AUTORIZACAO: 'AUTORIZAÇÃO',
  LOGIN_MFA: 'LOGIN / MFA',
  DOCUMENTO: 'DOCUMENTO',
  REVISAO: 'REVISÃO',
  ACAO_EXTERNA: 'AÇÃO EXTERNA',
  BLOQUEIO_DA_PLATAFORMA: 'BLOQUEIO DA PLATAFORMA',
}

export interface PendenciaDaCentral {
  /** Estável e único: o mesmo fato nunca aparece duas vezes. */
  id: string
  origem: 'PEDIDO' | 'PUBLICACAO_ASSISTIDA' | 'CONTEUDO' | 'INTEGRACAO' | 'AMOSTRA' | 'JORNADA' | 'RECONCILIACAO'
  categoria: Categoria
  titulo: string
  motivo: string
  urgencia: 'ALTA' | 'MEDIA' | 'BAIXA'
  impacto: string
  acao: { rotulo: string; link: string | null }
  criadoEm: string
  // critérios de ordem
  perdeDinheiro: boolean
  prazo: string | null
  bloqueiaPublicacao: boolean
  bloqueiaIntegracao: boolean
  /** Integração futura que NÃO bloqueia a publicação assistida: fica abaixo de tudo que leva à publicação/receita agora. */
  integracaoFutura?: boolean
  /** É a etapa atual da jornada prioritária da Operação (mesma fonte de verdade). */
  foco?: boolean
  /** Pedido existente (decidível pelos botões de sempre). */
  pedido?: ItemPrecisaDeVoce
  /** Publicação assistida (aprovação completa dentro da central). */
  assistida?: {
    id: string
    /** P2.17.12: APROVAR (com o MP4) · MIDIA (fornecer mídia autorizada) · DEMONSTRACAO (teste, não conta). */
    modo: 'APROVAR' | 'MIDIA' | 'DEMONSTRACAO'
    nomeProduto: string
    versao: number
    estado: string
    status: ReturnType<typeof statusReal>
    contador: string
    apresentacao: unknown
    qualityGate: unknown
    motivoEscolha: string
    objetivoDoTeste: string
    vezesQueOProdutoApareceu: number
    imagem: string | null
  }
}

const URGENCIA: Record<string, PendenciaDaCentral['urgencia']> = { ALTO: 'ALTA', MEDIO: 'MEDIA', BAIXO: 'BAIXA' }
const PESO_URGENCIA = { ALTA: 0, MEDIA: 1, BAIXA: 2 }

/** FUNÇÃO PURA. Integração futura por último → dinheiro em risco → foco da Operação → prazo → bloqueia publicação → bloqueia integração → urgência → mais antigo. */
export function ordenarPendencias(itens: PendenciaDaCentral[]): PendenciaDaCentral[] {
  return [...itens].sort(
    (a, b) =>
      Number(!!a.integracaoFutura) - Number(!!b.integracaoFutura) ||
      Number(b.perdeDinheiro) - Number(a.perdeDinheiro) ||
      Number(!!b.foco) - Number(!!a.foco) ||
      (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999') ||
      Number(b.bloqueiaPublicacao) - Number(a.bloqueiaPublicacao) ||
      Number(b.bloqueiaIntegracao) - Number(a.bloqueiaIntegracao) ||
      PESO_URGENCIA[a.urgencia] - PESO_URGENCIA[b.urgencia] ||
      a.criadoEm.localeCompare(b.criadoEm)
  )
}

function deUmPedido(p: ItemPrecisaDeVoce): PendenciaDaCentral {
  // Pedido que só sai com evidência (conexão TikTok Shop): ação externa, não "aprovar".
  const tiktokShop = !p.podeMarcarResolvido
  return {
    id: `pedido:${p.id}`,
    origem: 'PEDIDO',
    categoria: tiktokShop ? 'ACAO_EXTERNA' : p.tipo === TIPO_ESCOLHA ? 'APROVACAO' : p.tipo === TIPO_EXCECAO ? 'REVISAO' : 'APROVACAO',
    titulo: p.titulo,
    motivo: p.resumo,
    urgencia: URGENCIA[p.risco] ?? 'MEDIA',
    impacto: tiktokShop ? 'Sem a conexão oficial, o Patrono não busca produtos do TikTok Shop sozinho.' : p.tipo === TIPO_ESCOLHA ? 'Define o próximo produto a trabalhar.' : 'Algo parou e precisa da sua confirmação.',
    acao: { rotulo: p.acoes.aprovar, link: p.link },
    criadoEm: p.criadoEm,
    perdeDinheiro: false,
    prazo: p.expiraEm,
    bloqueiaPublicacao: false,
    bloqueiaIntegracao: tiktokShop,
    integracaoFutura: tiktokShop,
    pedido: p,
  }
}

async function pendenciasDasPublicacoesAssistidas(workspaceId: string, agora: Date): Promise<PendenciaDaCentral[]> {
  const [assistidas, metas, concluidas] = await Promise.all([
    prisma.publicacaoAssistida.findMany({ where: { workspaceId, demonstracao: false, estado: { in: ['AGUARDANDO_MIDIA', 'AGUARDANDO_APROVACAO', 'APROVADO', 'PUBLICANDO', 'FALHOU'] } }, orderBy: { createdAt: 'asc' } }),
    listarMetasAtivas(workspaceId),
    prisma.publicacaoAssistida.count({ where: { workspaceId, demonstracao: false, estado: 'PUBLICADO' } }),
  ])
  if (!assistidas.length) return []
  // P2.29.1: publicação de produto descartado/excluído que PODE já estar no TikTok — uma pendência só, com a
  // orientação da regra canônica (as que com certeza não saíram já foram encerradas por ela).
  const { publicacoesParaConferirDeProdutoInativo, ORIENTACAO_PODE_TER_SAIDO } = await import('./produto-canonico')
  const paraConferir = new Set((await publicacoesParaConferirDeProdutoInativo(workspaceId)).map((x) => x.id))
  const analises = analisarMetas(metas, agora)
  const candidatos = await prisma.candidatoDeProduto.findMany({
    where: { workspaceId, id: { in: assistidas.map((a) => a.candidatoId).filter((x): x is string => !!x) } },
    select: { id: true, imagem: true, imagemAutorizada: true },
  })
  const out: PendenciaDaCentral[] = []
  for (const a of assistidas) {
    const st = statusReal(a)
    const prazoMissao = analises
      .filter((m) => a.metasIds.includes(m.id) && (m.situacao === 'EM_ANDAMENTO' || m.situacao === 'NAO_INICIADA'))
      .map((m) => metas.find((x) => x.id === m.id)!.fim.toISOString())
      .sort()[0] ?? null
    const comMissao = prazoMissao !== null
    const c = candidatos.find((x) => x.id === a.candidatoId)
    const base = {
      origem: 'PUBLICACAO_ASSISTIDA' as const,
      criadoEm: a.createdAt.toISOString(),
      perdeDinheiro: comMissao,
      prazo: prazoMissao,
      bloqueiaPublicacao: true,
      bloqueiaIntegracao: false,
    }
    const dados = {
      id: a.id, nomeProduto: a.nomeProduto, versao: a.versao, estado: a.estado, status: st, contador: `Publicação assistida ${concluidas + 1}/${LIMITE_ASSISTIDO}`,
      apresentacao: a.apresentacao, qualityGate: a.qualityGate, motivoEscolha: a.motivoEscolha, objetivoDoTeste: a.objetivoDoTeste,
      vezesQueOProdutoApareceu: a.vezesQueOProdutoApareceu, imagem: c?.imagemAutorizada ? c.imagem : null,
    }
    if (paraConferir.has(a.id)) {
      out.push({
        ...base,
        id: `assistida:${a.id}:produto-descartado`,
        categoria: 'REVISAO',
        titulo: `Conferir no TikTok: ${a.nomeProduto} (produto descartado)`,
        motivo: `Você descartou este produto, mas a publicação pode já ter saído. ${ORIENTACAO_PODE_TER_SAIDO}`,
        urgencia: 'ALTA',
        impacto: 'Evita apagar o registro de um vídeo que está no ar ou publicá-lo duas vezes.',
        acao: { rotulo: 'Conferir e decidir', link: '/publicacoes-assistidas' },
      })
      continue
    }
    if (a.estado === 'AGUARDANDO_MIDIA') {
      // P2.17.12: UMA pendência só (nunca junto com uma aprovação da mesma publicação).
      out.push({
        ...base,
        id: `assistida:${a.id}:midia`,
        categoria: 'ACAO_EXTERNA',
        titulo: `Fornecer mídia autorizada para ${nomeCurto(a.nomeProduto)}`,
        // P2.17.14: curto na primeira camada; a explicação completa fica em "Ver conteúdo completo".
        motivo: 'Falta uma foto ou vídeo autorizado do produto para o Patrono gerar o vídeo. Sem mídia? Rejeite e ele escolhe outro.',
        urgencia: comMissao ? 'ALTA' : 'MEDIA',
        impacto: 'Sem mídia autorizada não há vídeo — e sem vídeo não há publicação.',
        acao: { rotulo: 'Enviar foto ou vídeo autorizado', link: '/operacao' },
        assistida: { ...dados, modo: 'MIDIA' },
      })
    } else if (a.estado === 'AGUARDANDO_APROVACAO' && st.videoGerado) {
      // Aprovação SÓ com o MP4 (antes dele, a publicação está em AGUARDANDO_MIDIA/VIDEO_NA_FILA/GERANDO_VIDEO).
      out.push({
        ...base,
        id: `assistida:${a.id}:v${a.versao}`,
        categoria: 'APROVACAO',
        titulo: `Publicação assistida ${concluidas + 1}/${LIMITE_ASSISTIDO}: ${a.nomeProduto}`,
        motivo: `${st.principal}. Nada é publicado sem a sua aprovação nas ${LIMITE_ASSISTIDO} primeiras.`,
        urgencia: comMissao ? 'ALTA' : 'MEDIA',
        impacto: comMissao ? 'Ajuda em missão com prazo e recompensa.' : 'Próximo vídeo do plano.',
        acao: { rotulo: 'Assistir, aprovar, pedir ajuste ou rejeitar', link: '/operacao' },
        assistida: { ...dados, modo: 'APROVAR' },
      })
    } else if (a.estado === 'APROVADO' && /arquivo de vídeo/.test(a.bloqueio ?? '')) {
      // Só o que depende da titular: o vídeo (mídia com direito de uso).
      out.push({
        ...base,
        id: `assistida:${a.id}:midia`,
        categoria: 'ACAO_EXTERNA',
        titulo: `Mídia do produto para o vídeo: ${a.nomeProduto}`,
        motivo: 'Aprovado, mas sem arquivo de vídeo. Envie fotos suas do produto (o Patrono monta o vídeo) ou grave os formatos que exigem experiência real.',
        urgencia: comMissao ? 'ALTA' : 'MEDIA',
        impacto: 'Sem o vídeo, a publicação aprovada não sai.',
        acao: { rotulo: 'Abrir a publicação', link: '/publicacoes-assistidas' },
      })
    } else if (a.estado === 'PUBLICANDO' && /caixa de entrada/.test(a.bloqueio ?? '')) {
      out.push({
        ...base,
        id: `assistida:${a.id}:caixa`,
        categoria: 'ACAO_EXTERNA',
        titulo: `Finalizar no app: ${a.nomeProduto}`,
        motivo: 'O rascunho está na sua caixa de entrada do TikTok: marque o produto e toque em Publicar (limitação oficial do TikTok).',
        urgencia: 'ALTA',
        impacto: 'O vídeo só vende depois de publicado com o produto marcado.',
        acao: { rotulo: 'Abrir o TikTok', link: '/publicacoes-assistidas' },
      })
    } else if (a.estado === 'FALHOU' && (a.erro ?? '').startsWith('ENVIO INCERTO')) {
      out.push({
        ...base,
        id: `assistida:${a.id}:incerto`,
        categoria: 'REVISAO',
        titulo: `Conferir o perfil: ${a.nomeProduto}`,
        motivo: 'O envio pode ter chegado ao TikTok sem confirmação. Confira o perfil antes de tentar de novo (evita vídeo duplicado).',
        urgencia: 'ALTA',
        impacto: 'Evita publicação duplicada.',
        acao: { rotulo: 'Conferir e decidir', link: '/publicacoes-assistidas' },
      })
    }
  }
  return out
}

/**
 * P2.17.12 — Demonstrações em TESTE (mídia FIXTURE): aparecem na central
 * para a titular ASSISTIR, numa seção à parte. Não contam no sininho, não
 * entram na ordem 1..10 e não podem ser aprovadas.
 */
export async function demonstracoesDaCentral(workspaceId: string): Promise<PendenciaDaCentral[]> {
  const demos = await prisma.publicacaoAssistida.findMany({ where: { workspaceId, demonstracao: true, estado: { notIn: ['REJEITADO'] } }, orderBy: { createdAt: 'desc' }, take: 3 })
  return demos.map((a) => ({
    id: `demonstracao:${a.id}`,
    origem: 'PUBLICACAO_ASSISTIDA' as const,
    categoria: 'REVISAO' as const,
    titulo: `DEMONSTRAÇÃO (teste): ${a.nomeProduto}`,
    motivo: 'Vídeo gerado sozinho pelo Patrono com mídia FIXTURE (fictícia, gerada pelo Patrono) só para você ver o fluxo. Não conta no sininho e não pode ser publicado.',
    urgencia: 'BAIXA' as const,
    impacto: 'Nenhum: é demonstração.',
    acao: { rotulo: 'Assistir', link: '/precisa-de-voce' },
    criadoEm: a.createdAt.toISOString(),
    perdeDinheiro: false,
    prazo: null,
    bloqueiaPublicacao: false,
    bloqueiaIntegracao: false,
    assistida: {
      id: a.id, modo: 'DEMONSTRACAO' as const, nomeProduto: a.nomeProduto, versao: a.versao, estado: a.estado, status: statusReal(a), contador: 'Demonstração (não conta)',
      apresentacao: a.apresentacao, qualityGate: a.qualityGate, motivoEscolha: a.motivoEscolha, objetivoDoTeste: a.objetivoDoTeste,
      vezesQueOProdutoApareceu: a.vezesQueOProdutoApareceu, imagem: null,
    },
  }))
}

async function pendenciasDeConteudo(workspaceId: string): Promise<PendenciaDaCentral[]> {
  const conteudos = await prisma.conteudo.findMany({
    where: { workspaceId, status: 'aguardando_aprovacao' },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { id: true, createdAt: true, dataAgendamento: true, produto: { select: { nome: true } } },
  })
  return conteudos.map((c) => ({
    id: `conteudo:${c.id}`,
    origem: 'CONTEUDO' as const,
    categoria: 'APROVACAO' as const,
    titulo: `Aprovar conteúdo: ${c.produto.nome}`,
    motivo: 'Conteúdo pronto aguardando a sua aprovação.',
    urgencia: c.dataAgendamento ? 'ALTA' as const : 'MEDIA' as const,
    impacto: c.dataAgendamento ? 'Tem horário agendado.' : 'Sem aprovação, não é publicado.',
    acao: { rotulo: 'Revisar e aprovar', link: `/aprovacao?conteudo=${c.id}` },
    criadoEm: c.createdAt.toISOString(),
    perdeDinheiro: false,
    prazo: c.dataAgendamento?.toISOString() ?? null,
    bloqueiaPublicacao: true,
    bloqueiaIntegracao: false,
  }))
}

async function pendenciasDoTikTok(workspaceId: string, agora: Date): Promise<PendenciaDaCentral[]> {
  const canal = await estadoDoCanalTikTok(workspaceId)
  // A publicação assistida (a titular publica e cola o link) não depende do app do TikTok: nada aqui bloqueia publicar.
  const base = { origem: 'INTEGRACAO' as const, criadoEm: agora.toISOString(), perdeDinheiro: false, prazo: null, bloqueiaPublicacao: false, bloqueiaIntegracao: true, integracaoFutura: true }
  if (!canal.appConfigurado) {
    return [{
      ...base, id: 'tiktok:criar-app', categoria: 'ACAO_EXTERNA', titulo: 'Conferir (ou criar) o app no TikTok for Developers',
      // P2.17.16: sem chaves no servidor ≠ app inexistente. Conferir antes, para não duplicar.
      motivo: 'Primeiro confira em developers.tiktok.com → Manage apps se já existe um app; só crie se não houver. Login Kit + Content Posting API (user.info.basic, video.upload, video.list) e enviar para revisão. Pacote pronto: P2.17.25.',
      urgencia: 'MEDIA', impacto: 'Destrava o envio automático do vídeo, o id/URL publicado e as visualizações.', acao: { rotulo: 'Ver Integrações', link: '/integracoes' },
    }]
  }
  const i = await prisma.integracao.findUnique({ where: { workspaceId_plataforma: { workspaceId, plataforma: 'tiktok' } }, select: { status: true, tokenExpiry: true, refreshToken: true } })
  if (i && (i.status === 'expirado' || (i.tokenExpiry && i.tokenExpiry.getTime() <= agora.getTime() && !i.refreshToken))) {
    return [{ ...base, id: 'tiktok:login', categoria: 'LOGIN_MFA', titulo: 'Entrar de novo no TikTok', motivo: 'A autorização venceu e não dá para renovar sozinha.', urgencia: 'ALTA', impacto: 'Sem ela, nada é enviado ao TikTok.', acao: { rotulo: 'Reconectar', link: '/integracoes' } }]
  }
  if (!canal.conectado) {
    return [{ ...base, id: 'tiktok:conectar', categoria: 'AUTORIZACAO', titulo: 'Conectar o TikTok', motivo: 'O app está aprovado; falta a sua autorização.', urgencia: 'ALTA', impacto: 'Destrava o envio automático do vídeo.', acao: { rotulo: 'Conectar TikTok', link: '/integracoes' } }]
  }
  if (!canal.escopos.includes('video.upload')) {
    return [{ ...base, id: 'tiktok:escopo', categoria: 'AUTORIZACAO', titulo: 'Reconectar o TikTok autorizando rascunhos', motivo: 'A conexão não tem o escopo video.upload.', urgencia: 'MEDIA', impacto: 'Sem ele, o Patrono não envia o rascunho.', acao: { rotulo: 'Reconectar', link: '/integracoes' } }]
  }
  return []
}

/** A central inteira, ordenada. `itens.length` é o número do sininho. */
/**
 * P2.17.17 — Amostras: SÓ quando a titular precisa agir (recebida → gravar as
 * cenas; prazo próximo/atrasado). Aguardando vendedor/logística NÃO entra.
 * Se a publicação assistida do produto já pede algo, a pendência é dela (não duplica).
 */
export function pendenciasDasAmostras(amostras: AmostraDaTela[], agora: Date): PendenciaDaCentral[] {
  return amostras
    .filter((a) => a.acaoDaTitular)
    .map((a) => ({
      id: `amostra:${a.id}`,
      origem: 'AMOSTRA' as const,
      categoria: 'ACAO_EXTERNA' as const,
      titulo: `${a.acaoDaTitular!.titulo}: ${nomeCurto(a.nomeProduto)}`,
      motivo: [a.acaoDaTitular!.motivo, ...a.alertasDetalhe].join(' '),
      urgencia: a.acaoDaTitular!.urgente ? ('ALTA' as const) : ('MEDIA' as const),
      impacto: a.prazo ? `Prazo ${a.prazo.confirmado ? 'confirmado' : 'estimado'}: ${new Date(a.prazo.em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Sem o vídeo, a amostra não vira venda.` : 'Sem o vídeo, a amostra não vira venda.',
      acao: { rotulo: 'Ver cenas do kit', link: '/tiktok-metas#amostras' },
      criadoEm: a.datas.recebidaEm ?? agora.toISOString(),
      perdeDinheiro: a.alertas.includes('ATRASADA') || a.alertas.includes('PRAZO_PROXIMO'),
      prazo: a.prazo?.em ?? null,
      bloqueiaPublicacao: true,
      bloqueiaIntegracao: false,
    }))
}

/**
 * P2.17.24 — Missões que SÓ a titular move (ação no app por limitação oficial):
 *   - "Produtos adicionados" em risco perto do prazo → adicionar à vitrine no app;
 *   - "Amostras solicitadas": já há pedidos registrados, mas o app ainda não
 *     confirmou a contagem → conferir no app (pedido ≠ missão computada).
 * Missão de vídeo NÃO entra aqui: quem move é o Patrono (vídeos).
 */
export function pendenciasDasMissoes(
  analises: ReturnType<typeof analisarMetas>,
  amostras: { missao: { computada: boolean | null }; efetivo: string }[],
  agora: Date
): PendenciaDaCentral[] {
  const out: PendenciaDaCentral[] = []
  for (const m of analises) {
    if (m.situacao !== 'EM_ANDAMENTO' && m.situacao !== 'NAO_INICIADA') continue
    const base = { origem: 'INTEGRACAO' as const, criadoEm: agora.toISOString(), perdeDinheiro: true, prazo: new Date(agora.getTime() + m.diasRestantes * 24 * 60 * 60 * 1000).toISOString(), bloqueiaPublicacao: false, bloqueiaIntegracao: false }
    if (m.tipo === 'ADICIONAR_PRODUTOS' && (m.risco === 'ALTO' || m.risco === 'MEDIO') && m.diasRestantes <= 10) {
      out.push({ ...base, id: `missao:${m.id}`, categoria: 'ACAO_EXTERNA', titulo: `Missão: adicionar ${m.faltam} produto(s) à vitrine`, motivo: `O Patrono indica o produto na Operação; você só adiciona no app (manual por limitação oficial). ${m.recompensaTexto}.`, urgencia: m.risco === 'ALTO' ? 'ALTA' : 'MEDIA', impacto: 'Recompensa da missão em jogo.', acao: { rotulo: 'Abrir a Operação', link: '/operacao' } })
    }
    if (m.tipo === 'SOLICITAR_AMOSTRAS' && m.faltam > 0) {
      const pedidas = amostras.filter((a) => !['REJEITADA', 'CANCELADA'].includes(a.efetivo)).length
      const semConfirmacao = amostras.filter((a) => a.missao.computada === null && !['REJEITADA', 'CANCELADA'].includes(a.efetivo)).length
      if (pedidas > 0 && semConfirmacao > 0) {
        out.push({ ...base, perdeDinheiro: false, id: `missao:${m.id}:conferir`, categoria: 'REVISAO', titulo: 'Conferir no app se a missão contou as amostras', motivo: `${pedidas} amostra(s) pedida(s); a missão registrada está em ${Math.round(m.progresso * 100)}% e o app ainda não confirmou a contagem (pedido ≠ missão computada). Marque em cada amostra quando o app contar.`, urgencia: 'BAIXA', impacto: 'Evita contar missão que o TikTok não contou.', acao: { rotulo: 'Ver amostras', link: '/tiktok-metas#amostras' } })
      }
    }
  }
  return out
}

/**
 * P2.18.5 — A ação humana da JORNADA prioritária (fonte única: o motor da
 * jornada). Mídia e aprovação de vídeo já entram pela publicação assistida;
 * aqui só o que não tem outra porta (aprovar produto, vitrine, amostra,
 * recebimento, publicar, resultado). Uma por vez: a atenção é uma só.
 */
export async function pendenciaDaJornada(workspaceId: string, agora: Date): Promise<PendenciaDaCentral[]> {
  return (await focoDaJornada(workspaceId, agora)).itens
}

/** A jornada prioritária da Operação (mesma fonte de verdade): a pendência dela e a publicação em foco. */
async function focoDaJornada(workspaceId: string, agora: Date, visaoPronta?: VisaoDaOperacao | null): Promise<{ itens: PendenciaDaCentral[]; assistidaId: string | null }> {
  const { carregarOperacao, visaoDaOperacao } = await import('./jornada')
  // P2.26: quem já carregou a Operação (o HOJE) passa a visão pronta — a mesma decisão, sem carregar duas vezes.
  const j = (visaoPronta ?? visaoDaOperacao(await carregarOperacao(workspaceId, agora))).prioritaria
  const assistidaId = j?.acao ? j.assistida?.id ?? null : null
  if (!j?.acao || ['FORNECER_MIDIA_REAL', 'APROVAR_VIDEO', 'MARCAR_PRODUTO'].includes(j.acao.tipo)) return { itens: [], assistidaId }
  return { assistidaId, itens: [{
    id: `jornada:${j.candidatoId}:${j.acao.tipo}`,
    origem: 'JORNADA',
    categoria: j.acao.tipo === 'APROVAR_PRODUTO' ? 'APROVACAO' : 'ACAO_EXTERNA',
    titulo: `${j.acao.rotulo}: ${nomeCurto(j.produto.nome)}`,
    motivo: j.acao.instrucao,
    urgencia: j.prazo ? 'ALTA' : 'MEDIA',
    impacto: j.missao ?? j.depois,
    acao: { rotulo: 'Abrir a Operação', link: '/operacao' },
    criadoEm: agora.toISOString(),
    perdeDinheiro: !!j.missao,
    prazo: j.prazo,
    bloqueiaPublicacao: ['PUBLICAR_VIDEO', 'CONFIRMAR_RESULTADO_MANUAL'].includes(j.acao.tipo),
    bloqueiaIntegracao: false,
    foco: true,
  }] }
}

/**
 * P2.28 — O que a reconciliação NÃO pôde resolver sozinha e só a titular decide (importação que não terminou ou
 * terminou com alertas, produto descartado com publicação pendente, envio sem confirmação). Lê a última rodada
 * (não recalcula) e confere se ainda vale — o que já foi resolvido some na hora. A publicação incerta não entra
 * aqui: ela já aparece pela própria publicação assistida (FALHOU com ENVIO INCERTO).
 */
export async function pendenciasDaReconciliacao(workspaceId: string, agora: Date): Promise<PendenciaDaCentral[]> {
  const { ultimaReconciliacao } = await import('./reconciliacao')
  const r = await ultimaReconciliacao(workspaceId)
  if (!r) return []
  // A publicação incerta e a de produto descartado que pode ter saído aparecem pela própria publicação (ao vivo).
  const itens = r.achados.filter((a) => a.desfecho === 'PRECISA_DE_VOCE' && a.tipo !== 'PUBLICACAO_INCERTA' && a.tipo !== 'PRODUTO_ARQUIVADO_ATIVO')
  const ultimaImportacao = await prisma.importacaoCreatorCenter.findFirst({ where: { workspaceId, concluida: true }, orderBy: { importadoEm: 'desc' }, select: { id: true } })
  const vale = async (a: (typeof itens)[number]) => {
    if (a.tipo === 'IMPORTACAO_INCOMPLETA') return !!(await prisma.importacaoCreatorCenter.findFirst({ where: { id: a.entidade.id, workspaceId, concluida: false }, select: { id: true } }))
    if (a.tipo === 'IMPORTACAO_COM_ALERTAS') return ultimaImportacao?.id === a.entidade.id
    if (a.tipo === 'PRODUTO_ARQUIVADO_ATIVO') return !!(await prisma.publicacaoAssistida.findFirst({ where: { id: a.entidade.id, workspaceId, estado: { notIn: ['PUBLICADO', 'REJEITADO', 'PUBLICANDO'] } }, select: { id: true } }))
    if (a.tipo === 'TRABALHO_LONGO_ABANDONADO') return !!(await prisma.automationJob.findFirst({ where: { id: a.entidade.id, workspaceId, estado: 'WAITING' }, select: { id: true } }))
    return true
  }
  const out: PendenciaDaCentral[] = []
  for (const a of itens) {
    if (!(await vale(a))) continue
    out.push({
      id: `reconciliacao:${a.chave}`, origem: 'RECONCILIACAO', categoria: 'REVISAO', titulo: a.texto.split(' — ')[0], motivo: a.texto,
      urgencia: a.gravidade, impacto: a.tipo.startsWith('IMPORTACAO') ? 'Sem isso, a comissão do relatório não fica completa.' : a.tipo === 'PRODUTO_ARQUIVADO_ATIVO' ? 'Evita publicar um produto que você descartou.' : 'Evita repetir algo que pode já ter acontecido.',
      acao: a.acao ?? { rotulo: 'Ver', link: '/precisa-de-voce' }, criadoEm: r.em.toISOString(),
      perdeDinheiro: a.tipo.startsWith('IMPORTACAO'), prazo: null, bloqueiaPublicacao: false, bloqueiaIntegracao: false,
    })
  }
  void agora
  return out
}

export async function centralPrecisaDeVoce(workspaceId: string, agora = new Date(), visaoPronta?: VisaoDaOperacao | null): Promise<PendenciaDaCentral[]> {
  const [pedidosTodos, assistidas, conteudos, tiktok, amostras, jornada, reconciliacao] = await Promise.all([
    listarPrecisaDeVoce(workspaceId, agora),
    pendenciasDasPublicacoesAssistidas(workspaceId, agora),
    pendenciasDeConteudo(workspaceId),
    pendenciasDoTikTok(workspaceId, agora),
    listarAmostras(workspaceId, agora).catch(() => [] as AmostraDaTela[]),
    focoDaJornada(workspaceId, agora, visaoPronta).catch(() => ({ itens: [] as PendenciaDaCentral[], assistidaId: null })),
    pendenciasDaReconciliacao(workspaceId, agora).catch(() => [] as PendenciaDaCentral[]),
  ])
  // P2.18.5: aprovar o produto é etapa da JORNADA (uma porta só): o pedido antigo de escolha não duplica aqui.
  const pedidos = pedidosTodos.filter((p) => p.tipo !== TIPO_ESCOLHA)
  const missoes = pendenciasDasMissoes(analisarMetas(await listarMetasAtivas(workspaceId), agora), amostras, agora)
  const todos = [...pedidos.map(deUmPedido), ...assistidas, ...conteudos, ...tiktok, ...pendenciasDasAmostras(amostras, agora), ...missoes, ...jornada.itens, ...reconciliacao]
  // Mesma prioridade da Operação: a publicação da jornada prioritária é o foco (não a mais antiga).
  if (jornada.assistidaId) for (const p of todos) if (p.assistida?.id === jornada.assistidaId) p.foco = true
  // Nunca duplicar: o mesmo id aparece uma vez só.
  const unicos = [...new Map(todos.map((p) => [p.id, p])).values()]
  return ordenarPendencias(unicos)
}
