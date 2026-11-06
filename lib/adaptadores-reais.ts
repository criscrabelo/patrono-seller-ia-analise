/**
 * P1.5.2 — a chave que liga um canal de verdade.
 *
 * `ADAPTADORES_LIGADOS` continua `{}`. O que muda aqui é que passa a
 * existir um caminho EXPLÍCITO para ligar um canal, e ele exige as duas
 * coisas ao mesmo tempo:
 *
 *   1. existir implementação nossa para aquele canal  (ADAPTADORES_DISPONIVEIS)
 *   2. o ambiente afirmar, literalmente, que pode publicar  (PUBLICACAO_REAL_<CANAL>=true)
 *
 * Faltando qualquer uma, o canal fica desligado. Uma variável de ambiente
 * sozinha não liga nada: ela não cria o adapter que não existe.
 *
 * ── POR QUE DUAS CONDIÇÕES ──────────────────────────────────────────────
 * Um flag sozinho transformaria "alguém copiou o .env de produção" em
 * "o robô começou a postar". Exigindo implementação registrada, o flag só
 * age onde alguém já escreveu e revisou o caminho.
 *
 * ── A TERCEIRA PORTA NÃO ESTÁ AQUI ──────────────────────────────────────
 * Mesmo ligado, o adapter só é chamado quando o preflight diz PRONTO — com
 * escopo comprovado, mídia autorizada, disclosure e custo zero. Ligar o
 * canal não pula nenhuma dessas.
 */

import { prisma } from './prisma'
import { publicarReelInstagram } from './instagram'
import { higienizar, type AdaptadorDeCanal, type RespostaDoAdaptador } from './distribuicao-orquestrador'
import { avaliarPecaParaOAdapter } from './capacidade-real-do-adapter'
import { adaptadorTikTok } from './tiktok-adaptador'

/** O ambiente afirma que ESTE canal pode publicar de verdade. */
export const VARIAVEL_DE_PUBLICACAO_REAL: Record<string, string> = {
  instagram: 'PUBLICACAO_REAL_INSTAGRAM',
  tiktok: 'PUBLICACAO_REAL_TIKTOK',
  facebook: 'PUBLICACAO_REAL_FACEBOOK',
  youtube: 'PUBLICACAO_REAL_YOUTUBE',
  pinterest: 'PUBLICACAO_REAL_PINTEREST',
}

/**
 * Fail-closed: só a string `true` liga. Ausente, vazia, `1`, `yes` ou
 * qualquer outra coisa deixa desligado — um canal não deve ligar por causa
 * de um valor que alguém achou que significava sim.
 */
export function publicacaoRealHabilitada(
  canal: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  const nome = VARIAVEL_DE_PUBLICACAO_REAL[(canal ?? '').trim().toLowerCase()]
  if (!nome) return false
  return (env?.[nome] ?? '').trim().toLowerCase() === 'true'
}

/**
 * A rede caiu, ou a Meta respondeu?
 *
 * A distinção decide se o retry é seguro. Uma resposta da Graph API — 400,
 * mídia rejeitada, token inválido — significa que o post NÃO foi criado:
 * repetir é seguro. Uma falha de transporte não significa nada: o container
 * pode ter sido publicado e a resposta ter se perdido no caminho.
 *
 * Fail-closed no que não dá para classificar: erro sem mensagem legível é
 * tratado como incerto, porque supor "não saiu" é a suposição que duplica.
 */
export function falhaDeRede(e: unknown): boolean {
  if (e instanceof TypeError) return true
  // `fbFetch` sempre lança `Error`. O que chega aqui sem ser `Error` não
  // veio da API: é inclassificável, e inclassificável é incerto.
  if (!(e instanceof Error)) return true
  const msg = e.message
  if (!msg.trim()) return true
  // `fbFetch` só lança com mensagem da própria API quando houve resposta.
  return /fetch failed|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN|aborted|timeout/i.test(msg)
}

// ── O adapter real do Instagram ─────────────────────────────────────────

/**
 * Publica um Reel pela Graph API oficial, reusando `lib/instagram.ts`.
 *
 * O TOKEN NÃO ENTRA PELO PEDIDO: o adapter o busca no workspace e o usa
 * aqui dentro. É a mesma fronteira do renovador da P1.5.1 — mantendo o
 * segredo no adapter, não há caminho por onde ele chegue a um log, ao
 * contexto de um job ou a uma resposta HTTP.
 */
export const adaptadorInstagram: AdaptadorDeCanal = {
  canal: 'instagram',
  publicar: async (pedido): Promise<RespostaDoAdaptador> => {
    if (!pedido.assetUrl) {
      // Reel sem vídeo não é falha transitória: repetir não cria o arquivo.
      return {
        ok: false,
        publicacaoExternaId: null,
        erro: 'A peça não tem vídeo renderizado — o Instagram não aceita Reel sem mídia.',
        fatal: true,
      }
    }

    // P1.9.1. A MESMA avaliação que o preflight fez. Se o preflight aprovou,
    // isto passa; se discordarem, alguém mudou uma ponta sem a outra.
    const avaliacao = avaliarPecaParaOAdapter({
      canal: 'instagram',
      formato: pedido.formato ?? null,
      assetUrl: pedido.assetUrl,
    })
    if (!avaliacao.aceita) {
      return {
        ok: false,
        publicacaoExternaId: null,
        erro: avaliacao.explicacao.join(' '),
        fatal: true,
      }
    }

    const integracao = await prisma.integracao.findFirst({
      where: { workspaceId: pedido.workspaceId, plataforma: 'instagram', status: 'conectado' },
      select: { accessToken: true, accountId: true },
    })
    if (!integracao?.accessToken || !integracao.accountId) {
      return {
        ok: false,
        publicacaoExternaId: null,
        erro: 'A conta do Instagram não está conectada neste workspace.',
        fatal: true,
      }
    }

    try {
      const id = await publicarReelInstagram({
        accessToken: integracao.accessToken,
        igUserId: integracao.accountId,
        videoUrl: pedido.assetUrl,
        legenda: pedido.legenda,
      })
      return { ok: true, publicacaoExternaId: id, erro: null }
    } catch (e) {
      // A mensagem da Meta costuma trazer a URL chamada, e a URL costuma
      // trazer o token. Higienizar aqui é a última chance antes do log.
      return {
        ok: false,
        publicacaoExternaId: null,
        erro: higienizar(e instanceof Error ? e.message : String(e)),
        envioIncerto: falhaDeRede(e),
      }
    }
  },
}

/**
 * Canais que TÊM implementação real hoje.
 *
 * TikTok não está aqui de propósito. `TikTokPublisher` existe e faz Direct
 * Post, mas o registro de capacidades diz `autoPublish: false` para a
 * plataforma e o app não passou pela auditoria: registrá-lo seria oferecer
 * uma ação que o preflight bloqueia de qualquer forma, e convidar alguém a
 * ligar o flag achando que resolveria.
 */
export const ADAPTADORES_DISPONIVEIS: Record<string, AdaptadorDeCanal> = {
  instagram: adaptadorInstagram,
  // P2.17.10: rascunho/Direct Post oficiais. Continua DESLIGADO até
  // PUBLICACAO_REAL_TIKTOK=true — e o preflight exige conta, escopo e mídia.
  tiktok: adaptadorTikTok,
}

export const CANAIS_SEM_ADAPTER_DISPONIVEL = {
  facebook: 'Nenhum adapter escrito.',
  youtube: 'Nenhum adapter escrito.',
  pinterest: 'Nenhum adapter escrito.',
} as const

/**
 * O registro que o executor usa. Vazio enquanto ninguém ligar nada.
 *
 * Esta é a ÚNICA função que produz adapters ligados em produção. Quem
 * quiser ligar um canal mexe no ambiente, não no código.
 */
export function adaptadoresHabilitados(
  env: Record<string, string | undefined> = process.env
): Record<string, AdaptadorDeCanal> {
  const ligados: Record<string, AdaptadorDeCanal> = {}
  for (const [canal, adapter] of Object.entries(ADAPTADORES_DISPONIVEIS)) {
    if (publicacaoRealHabilitada(canal, env)) ligados[canal] = adapter
  }
  return ligados
}

/** Por que um canal está desligado — para a tela e para o preflight. */
export function motivoDeAdapterDesligado(
  canal: string,
  env: Record<string, string | undefined> = process.env
): string | null {
  const c = (canal ?? '').trim().toLowerCase()
  if (!ADAPTADORES_DISPONIVEIS[c]) {
    return (
      (CANAIS_SEM_ADAPTER_DISPONIVEL as Record<string, string>)[c] ??
      `Não há adapter implementado para ${c}.`
    )
  }
  if (!publicacaoRealHabilitada(c, env)) {
    return `O adapter de ${c} existe e está desligado. Ligue com ${VARIAVEL_DE_PUBLICACAO_REAL[c]}=true.`
  }
  return null
}

/** REGRA PERMANENTE: ligar o canal não pula nenhuma porta anterior. */
export const LIGAR_NAO_AUTORIZA = {
  chave: 'adaptadores:ligar-nao-autoriza',
  condicoesParaLigar: ['implementação registrada', 'PUBLICACAO_REAL_<CANAL>=true'],
  condicoesQueContinuamValendo: [
    'escopo comprovado',
    'token válido',
    'app não reprovado',
    'mídia autorizada',
    'disclosure presente',
    'custo R$ 0,00',
  ],
  porque:
    'O flag diz "pode usar o canal", não "pode publicar qualquer coisa". Quem decide o que sai continua sendo o preflight.',
} as const
