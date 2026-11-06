/**
 * P1.9.2 — A porta única de toda publicação real.
 *
 * ── O QUE A AUDITORIA DESTA RODADA ACHOU ────────────────────────────────
 * Havia DUAS rotas que publicavam no Instagram sem passar por nada do que
 * as rodadas P1.5–P1.9.1 construíram:
 *
 *   app/api/conteudos/[id]/publicar   botão "Publicar" da tela, com sessão
 *   app/api/cron/publicar             agendamento, com CRON_SECRET
 *
 * Nenhuma das duas consultava o preflight, a flag PUBLICACAO_REAL_INSTAGRAM,
 * o direito da mídia ou o link na bio. A manual ainda publicava as IMAGENS
 * DO PRODUTO como carrossel — imagens que, no catálogo de hoje, são fotos de
 * vendedor da Shopee. A flag nunca foi "o único bloqueio": essas rotas a
 * ignoravam.
 *
 * Agora as duas perguntam aqui antes de abrir qualquer conexão com a Meta,
 * e aqui só se responde o que o preflight responde. Uma autoridade.
 */

import { preflightDePublicacao, type RelatorioDePreflight } from './preflight-de-publicacao'
import { capacidadeRealDoAdapter } from './capacidade-real-do-adapter'
import { freioDeEmergencia } from './kill-switch'
import { aprovacaoValidaDoConteudo } from './aprovacao-de-conteudo'

export interface DecisaoDaPorta {
  liberada: boolean
  /** Código estável, para a tela e para o teste. */
  bloqueio: string | null
  /** Em uma frase, para quem clicou. */
  explicacao: string
  preflight: RelatorioDePreflight | null
}

/**
 * Formatos de envio que as rotas oferecem, e que o adapter real NÃO publica.
 * A rota manual aceita `imagens` e `stories`; a capacidade real do Instagram
 * é Reel com vídeo. Oferecer o resto seria publicar pelo lado.
 */
export function envioSuportadoPeloAdapter(canal: string, envio: { tipoMidia: string; destino: string }): boolean {
  const real = capacidadeRealDoAdapter(canal)
  if (!real) return false
  return real.midiaObrigatoria === 'VIDEO' && envio.tipoMidia === 'video' && envio.destino === 'feed'
}

/**
 * Pode publicar ESTA peça, nesta tentativa, agora?
 *
 * `liberada` é exatamente `preflight.executavelAgora`: conta, peça, mídia,
 * copy, preço, flag do canal e link confirmado na bio. Nada é relaxado
 * para quem chama de fora do orquestrador.
 */
export async function autorizarPublicacaoReal(params: {
  workspaceId: string
  contentId: string
  canal: string
  chaveDaTentativa?: string | null
  envio?: { tipoMidia: string; destino: string }
  env?: Record<string, string | undefined>
  agora?: Date
}): Promise<DecisaoDaPorta> {
  const canal = (params.canal ?? '').trim().toLowerCase()

  // P2.14.7: kill switch global e Safe Mode fecham a porta antes de tudo.
  const freio = await freioDeEmergencia(params.workspaceId, params.env)
  if (freio.bloqueado) {
    return { liberada: false, bloqueio: 'SAFE_MODE_OU_KILL_SWITCH', explicacao: freio.motivo ?? 'Publicação bloqueada por segurança.', preflight: null }
  }

  if (params.envio && !envioSuportadoPeloAdapter(canal, params.envio)) {
    return {
      liberada: false,
      bloqueio: 'ENVIO_NAO_SUPORTADO_PELO_ADAPTER',
      explicacao: `O ${canal} só publica Reel com vídeo pelo caminho verificado. Imagens, carrossel e stories não passam pela porta.`,
      preflight: null,
    }
  }

  try {
    const preflight = await preflightDePublicacao({
      workspaceId: params.workspaceId,
      canal,
      contentId: params.contentId,
      chaveDaTentativa: params.chaveDaTentativa,
      env: params.env,
      agora: params.agora,
    })
    // P2.50: só publica o que a titular APROVOU, na versão exata (impressão do material). Fail-closed. Vem DEPOIS do
    // preflight para não mudar os bloqueios que já existiam (flag, direito da mídia, link na bio).
    if (preflight.executavelAgora) {
      const aprovacao = await aprovacaoValidaDoConteudo(params.workspaceId, params.contentId).catch(() => ({ valida: false, motivo: 'Não consegui conferir a aprovação.', impressao: null }))
      if (!aprovacao.valida) return { liberada: false, bloqueio: 'SEM_APROVACAO_VALIDA', explicacao: aprovacao.motivo ?? 'Sem aprovação válida para esta versão.', preflight }
    }
    return {
      liberada: preflight.executavelAgora,
      bloqueio: preflight.executavelAgora ? null : preflight.bloqueio ?? 'NAO_EXECUTAVEL',
      explicacao: preflight.executavelAgora
        ? 'Preflight aprovado.'
        : preflight.oQueFalta ?? 'O preflight não liberou esta publicação.',
      preflight,
    }
  } catch (e) {
    // Fail-closed: preflight que quebra não libera nada.
    console.error('[porta-de-publicacao] preflight falhou — publicação recusada:', e instanceof Error ? e.message : e)
    return {
      liberada: false,
      bloqueio: 'PREFLIGHT_INDISPONIVEL',
      explicacao: 'Não foi possível conferir se a publicação é segura. Nada foi enviado.',
      preflight: null,
    }
  }
}

/** REGRA PERMANENTE. */
export const TODA_PUBLICACAO_PASSA_PELA_PORTA = {
  chave: 'publicacao:porta-unica',
  rotas: ['app/api/conteudos/[id]/publicar/route.ts', 'app/api/cron/publicar/route.ts'],
  autoridade: 'lib/preflight-de-publicacao.ts (executavelAgora)',
  porque:
    'Duas rotas publicavam por fora do preflight, da flag e da regra de direitos. Uma porta só torna impossível um caminho esquecido.',
} as const
