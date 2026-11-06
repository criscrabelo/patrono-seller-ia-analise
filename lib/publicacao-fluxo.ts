/**
 * O fluxo de uma tentativa de publicação (P1.0 — Etapa 2.c).
 *
 * As rotas que publicam — "publicar agora" e o cron do agendamento — chamam
 * daqui. Nenhuma delas repete a sequência, porque repetir é como as duas
 * acabam divergindo: uma ganha uma correção, a outra não.
 *
 * ── ANTES DE CHAMAR O PROVIDER ──────────────────────────────────────────
 *   prepararTentativaDePublicacao()
 *     Publicacao PREPARADA → link rastreado → vínculo validado → DISTRIBUINDO
 *
 * ── DEPOIS ──────────────────────────────────────────────────────────────
 *   confirmarDistribuicao()  em caso de sucesso  → DISTRIBUIDA
 *   registrarFalhaDaTentativa() em falha real    → FALHOU
 *
 * ── O FALLBACK CONTINUA VIVO ────────────────────────────────────────────
 * Sem link rastreado, a publicação acontece do mesmo jeito, com o link
 * direto do produto. A `Publicacao` existe, pode chegar a DISTRIBUIDA, e
 * simplesmente não tem link vinculado — o estado derivado vira
 * NAO_RASTREADA_COM_FALLBACK e as métricas de clique ficam indisponíveis.
 * Publicar sem medir vale mais que não publicar; medir errado, não.
 */

import { prisma } from './prisma'
import { LINK_COMPRA } from './config'
import {
  obterLinkRastreavelDaPublicacao,
  chaveDaTentativaPadrao,
  registrarLacunaDeRastreamento,
  type MotivoSemLinkRastreavel,
  type MotivoSemBasePublica,
} from './link-de-publicacao'
import {
  obterOuCriarPublicacaoDaTentativa,
  vincularLinkAPublicacao,
  reservarEnvio,
  marcarDistribuida,
  marcarFalhou,
  type PublicacaoPersistida,
  type MotivoPublicacaoRecusada,
} from './publicacao-repositorio'
import { avisoDaPublicacao, type AvisoDeRastreamento } from './rastreamento-da-publicacao'

/**
 * Canal onde o post sai → provider que o distribui.
 *
 * São coisas diferentes: a Meta serve Instagram e Facebook, e um dia outro
 * provider pode servir o mesmo canal. Canal desconhecido vira provider
 * desconhecido em vez de palpite.
 */
export const PROVIDER_POR_CANAL: Record<string, string> = {
  instagram: 'META',
  facebook: 'META',
  tiktok: 'TIKTOK',
  youtube: 'YOUTUBE',
  whatsapp: 'WHATSAPP',
}

export function providerDoCanal(canal: string | null | undefined): string {
  const c = (canal ?? '').trim().toLowerCase()
  return PROVIDER_POR_CANAL[c] ?? 'DESCONHECIDO'
}

export interface TentativaPreparada {
  /** `true` quando há publicação registrada — mesmo sem rastreamento. */
  ok: boolean
  publicacao: PublicacaoPersistida | null
  /** O que vai na legenda: rastreado quando dá, direto quando não dá. */
  urlParaDivulgar: string | null
  /** `true` só quando o link do Patrono entrou na legenda. */
  rastreada: boolean
  linkId: string | null
  slug: string | null
  chaveDaTentativa: string
  /** Pronto para a tela. `null` quando não há lacuna. */
  aviso: AvisoDeRastreamento | null
  motivo: MotivoSemLinkRastreavel | MotivoPublicacaoRecusada | null
  explicacao: string
  /** P2.27: a tentativa já estava em envio/publicada — o provider NÃO pode ser chamado de novo. */
  jaEnviada?: string | null
}

/**
 * Prepara tudo o que precede a chamada ao provider.
 *
 * NUNCA lança, e nunca bloqueia a publicação por causa do registro: se a
 * `Publicacao` não puder ser criada, devolve `ok: false` com a URL de
 * fallback mesmo assim — quem chama decide, e a decisão aprovada é publicar.
 */
export async function prepararTentativaDePublicacao(params: {
  workspaceId: string
  contentId: string
  canal: string
  /** Fornecida por quem publica. Sem ela, deriva do agendamento. */
  chaveDaTentativa?: string | null
  /** Destino direto do produto, para o fallback. Lido no servidor. */
  urlDiretaDoProduto?: string | null
  /** Usado só para derivar a chave padrão quando não vier uma. */
  dataAgendamento?: Date | null
  dataOrigin?: string
  env?: Record<string, string | undefined>
  /**
   * P2.27: só quem tem trava PRÓPRIA de fase (ex.: o trabalho longo do Instagram, que sabe se já chamou o
   * publish) pode reentrar numa tentativa já DISTRIBUINDO. Todo o resto recebe `jaEnviada`.
   */
  permitirReentrada?: boolean
}): Promise<TentativaPreparada> {
  const canal = (params?.canal ?? '').trim().toLowerCase()
  const chaveDaTentativa =
    (params?.chaveDaTentativa ?? '').trim() ||
    chaveDaTentativaPadrao({
      contentId: params.contentId,
      canal,
      dataAgendamento: params?.dataAgendamento ?? null,
    })

  const fallback = params?.urlDiretaDoProduto ?? LINK_COMPRA

  // 1. A publicação existe ANTES do provider — é ela que dá identidade à
  //    tentativa, e é por ela que o retry se reconhece.
  const pub = await obterOuCriarPublicacaoDaTentativa({
    workspaceId: params.workspaceId,
    contentId: params.contentId,
    provider: providerDoCanal(canal),
    canal,
    chaveDaTentativa,
    dataOrigin: params?.dataOrigin,
  })
  if (!pub.ok || !pub.publicacao) {
    return {
      ok: false,
      publicacao: null,
      urlParaDivulgar: fallback,
      rastreada: false,
      linkId: null,
      slug: null,
      chaveDaTentativa,
      aviso: avisoDaPublicacao({ rastreado: false, motivo: 'FALHA_AO_CRIAR_LINK' }),
      motivo: pub.motivo,
      explicacao: pub.explicacao,
    }
  }

  // 2. O link rastreado. O destino sai de `Conteudo.produtoId`, no servidor.
  const rastreado = await obterLinkRastreavelDaPublicacao({
    workspaceId: params.workspaceId,
    contentId: params.contentId,
    canal,
    chaveDaTentativa,
    env: params?.env,
  })

  let rastreada = false
  let linkId: string | null = null
  let motivo: MotivoSemLinkRastreavel | MotivoPublicacaoRecusada | null = rastreado.motivo
  let submotivo: MotivoSemBasePublica | null = rastreado.submotivo

  if (rastreado.ok && rastreado.linkId) {
    // 3. O vínculo passa OBRIGATORIAMENTE pelo guard, dentro do repositório.
    const vinculo = await vincularLinkAPublicacao({
      workspaceId: params.workspaceId,
      contentId: params.contentId,
      publicacaoId: pub.publicacao.id,
      linkId: rastreado.linkId,
    })
    if (vinculo.ok) {
      rastreada = true
      linkId = rastreado.linkId
    } else {
      // Vínculo recusado: publica com o link direto. A publicação continua
      // válida; o que se perde é a medição do clique.
      motivo = vinculo.motivo
      submotivo = null
      registrarLacunaDeRastreamento({
        contentId: params.contentId,
        canal,
        motivo: 'FALHA_AO_CRIAR_LINK',
        explicacao: vinculo.explicacao,
      })
    }
  } else if (!rastreado.ok) {
    registrarLacunaDeRastreamento({
      contentId: params.contentId,
      canal,
      motivo: rastreado.motivo!,
      explicacao: rastreado.explicacao,
    })
  }

  // 4. O provider vai ser chamado agora — só por quem RESERVOU o envio (P2.27).
  const reserva = await reservarEnvio({ workspaceId: params.workspaceId, publicacaoId: pub.publicacao.id })
  const reentradaPermitida = !reserva.reservou && params.permitirReentrada === true && reserva.estado === 'DISTRIBUINDO'
  if (!reserva.reservou && !reentradaPermitida) {
    return {
      ok: false, publicacao: pub.publicacao, urlParaDivulgar: null, rastreada, linkId, slug: null, chaveDaTentativa,
      aviso: null, motivo: null, jaEnviada: reserva.estado ?? 'DESCONHECIDO',
      explicacao: reserva.estado === 'DISTRIBUIDA'
        ? 'Esta tentativa já foi publicada: nada foi reenviado.'
        : 'Esta tentativa já está em envio (ou o envio anterior ficou sem confirmação): nada foi reenviado. Confira o perfil antes de tentar de novo.',
    }
  }

  return {
    ok: true,
    publicacao: pub.publicacao,
    urlParaDivulgar: rastreada ? rastreado.urlPublica : (rastreado.urlDestino ?? fallback),
    rastreada,
    linkId,
    slug: rastreada ? rastreado.slug : null,
    chaveDaTentativa,
    aviso: rastreada ? null : avisoDaPublicacao({ rastreado: false, motivo, submotivo }),
    motivo: rastreada ? null : motivo,
    explicacao: rastreada ? 'Publicação preparada com link rastreado.' : rastreado.explicacao,
  }
}

/**
 * Sucesso do provider. O id externo é normalizado dentro do repositório.
 *
 * GATILHO DO ML (Etapa 2.d): ao chegar em DISTRIBUIDA, a amostra
 * `publication_v1` é capturada — prospectiva, sem rótulo. A captura é
 * carregada sob demanda e NUNCA derruba a publicação: se o ML falhar, o
 * post continua publicado e a lacuna vai para o log.
 */
export async function confirmarDistribuicao(params: {
  workspaceId: string
  publicacaoId: string
  publicacaoExternaId?: string | null
  distribuidaEm?: Date | null
  /** P2.50 (P3): quem confirmou — o provider (API/webhook) ou a titular colando o link. */
  confirmadoPor?: 'PROVIDER' | 'TITULAR'
}) {
  const r = await marcarDistribuida({
    workspaceId: params.workspaceId,
    publicacaoId: params.publicacaoId,
    publicacaoExternaId: params?.publicacaoExternaId,
    distribuidaEm: params?.distribuidaEm ?? new Date(),
    resultado: params.confirmadoPor === 'TITULAR' ? 'PUBLICADO_CONFIRMADO_PELA_TITULAR' : 'PUBLICADO',
  })

  if (r.ok && r.publicacao?.estado === 'DISTRIBUIDA') {
    try {
      const { capturarSnapshotDaPublicacao } = await import('./ml-geracao-publicacao')
      await capturarSnapshotDaPublicacao({
        workspaceId: params.workspaceId,
        publicacaoId: params.publicacaoId,
      })
    } catch (e) {
      console.error(`[publicacao-fluxo] captura de amostra falhou para ${params.publicacaoId}:`, e)
    }
  }

  return r
}

/**
 * P2.17.10 — Envio aceito pelo canal, confirmação assíncrona. Grava a
 * referência do envio (ex.: `publish_id` do TikTok) na evidência e mantém a
 * publicação em DISTRIBUINDO. Nunca marca DISTRIBUIDA: isso só acontece com
 * o id público do post (`confirmarDistribuicao`).
 */
export async function registrarEnvioPendente(params: {
  workspaceId: string
  publicacaoId: string
  canal: string
  referencia: string
  modo: 'RASCUNHO' | 'DIRETO'
  agora?: Date
}): Promise<{ ok: boolean }> {
  const r = await prisma.publicacao.updateMany({
    where: { id: params.publicacaoId, workspaceId: params.workspaceId, estado: 'DISTRIBUINDO' },
    data: {
      evidencia: {
        tipo: 'ENVIO_PENDENTE',
        canal: params.canal,
        referencia: params.referencia,
        modo: params.modo,
        enviadoEm: (params.agora ?? new Date()).toISOString(),
        etapa: 'ENVIADO',
      },
    },
  })
  return { ok: r.count === 1 }
}

/** Falha REAL do provider — não "ainda processando". */
export async function registrarFalhaDaTentativa(params: {
  workspaceId: string
  publicacaoId: string
}) {
  return marcarFalhou({ workspaceId: params.workspaceId, publicacaoId: params.publicacaoId })
}

/** O que a resposta HTTP devolve sobre rastreamento. Sem detalhe interno. */
export function respostaDeRastreamento(t: TentativaPreparada) {
  return t.rastreada
    ? { rastreado: true, estado: 'RASTREADA', slug: t.slug, publicacaoId: t.publicacao?.id ?? null, aviso: null }
    : {
        rastreado: false,
        estado: 'NAO_RASTREADA_COM_FALLBACK',
        motivo: t.motivo,
        publicacaoId: t.publicacao?.id ?? null,
        aviso: t.aviso,
      }
}
