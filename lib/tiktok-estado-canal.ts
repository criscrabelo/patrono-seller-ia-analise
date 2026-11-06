/**
 * P2.17.10 — Em que nível de automação o TikTok está NESTE workspace, e por quê.
 * Sem rede e sem segredo: lê configuração, a linha da integração e as flags.
 *
 *   AUTOMATICO                  — publica sozinho (Direct Post auditado) — sem produto marcado
 *   SEMIAUTOMATICO              — o Patrono envia o rascunho; a titular marca o produto e publica
 *   MANUAL_POR_LIMITACAO        — o TikTok não oferece a etapa por API (produto marcado no Brasil)
 *   BLOQUEADO                   — falta algo para enviar qualquer coisa
 */
import { prisma } from './prisma'
import { lerCredenciaisOAuthTikTok } from './tiktok-oauth'
import { lerScopesComprovados, aprovacaoDoApp } from './autorizacao-da-conta'
import { publicacaoRealHabilitada } from './adaptadores-reais'

export type NivelDoCanal = 'AUTOMATICO' | 'SEMIAUTOMATICO' | 'MANUAL_POR_LIMITACAO' | 'BLOQUEADO'

export interface EstadoDoCanalTikTok {
  appConfigurado: boolean
  conectado: boolean
  conta: string | null
  escopos: string[]
  envioLigado: boolean
  appAuditado: boolean | null
  nivel: NivelDoCanal
  frase: string
  /** O que falta, com o dono de cada item. */
  bloqueios: { quem: 'TIKTOK' | 'TITULAR' | 'AMBIENTE'; texto: string }[]
  /** Vídeo com produto marcado (TikTok Shop) por API: limitação oficial hoje. */
  produtoMarcado: string
}

export const PRODUTO_MARCADO_POR_API =
  'BLOQUEADO PELO TIKTOK — falta a Affiliate Creator API (Post Shoppable Video) liberada para criadora do Brasil. Até lá, marcar o produto é manual por limitação oficial.'

export async function estadoDoCanalTikTok(workspaceId: string, env: Record<string, string | undefined> = process.env): Promise<EstadoDoCanalTikTok> {
  const appConfigurado = !!lerCredenciaisOAuthTikTok()
  const i = await prisma.integracao.findUnique({
    where: { workspaceId_plataforma: { workspaceId, plataforma: 'tiktok' } },
    select: { status: true, accountName: true, tokenExpiry: true, extraData: true, refreshToken: true },
  })
  const vencidoSemRenovacao = !!i?.tokenExpiry && i.tokenExpiry.getTime() <= Date.now() && !i.refreshToken
  const conectado = i?.status === 'conectado' && !vencidoSemRenovacao
  const escopos = conectado ? lerScopesComprovados(i?.extraData) ?? [] : []
  const envioLigado = publicacaoRealHabilitada('tiktok', env)
  const appAuditado = aprovacaoDoApp('tiktok', env)

  const bloqueios: EstadoDoCanalTikTok['bloqueios'] = []
  if (!appConfigurado) bloqueios.push({ quem: 'TIKTOK', texto: 'BLOQUEADO PELO TIKTOK — falta o app aprovado no TikTok for Developers (Login Kit + Content Posting API).' })
  else if (!conectado) bloqueios.push({ quem: 'TITULAR', texto: 'Falta autorizar a sua conta do TikTok (Integrações → Conectar TikTok).' })
  else if (!escopos.includes('video.upload')) bloqueios.push({ quem: 'TITULAR', texto: 'A conexão não tem o escopo video.upload: reconecte autorizando o envio de rascunhos.' })
  if (!envioLigado) bloqueios.push({ quem: 'AMBIENTE', texto: 'Envio real ao TikTok desligado neste ambiente (PUBLICACAO_REAL_TIKTOK).' })

  const podeRascunho = appConfigurado && conectado && escopos.includes('video.upload') && envioLigado
  const podeDireto = podeRascunho && escopos.includes('video.publish') && appAuditado === true
  const nivel: NivelDoCanal = podeDireto ? 'AUTOMATICO' : podeRascunho ? 'SEMIAUTOMATICO' : 'BLOQUEADO'
  const frase =
    nivel === 'AUTOMATICO'
      ? 'Publica sozinho (Direct Post auditado). Vídeo com produto do TikTok Shop continua dependendo de marcação no app.'
      : nivel === 'SEMIAUTOMATICO'
        ? 'Envio automático do rascunho; você só marca o produto e toca em Publicar no app (limitação oficial).'
        : bloqueios[0]?.texto ?? 'Indisponível.'
  return {
    appConfigurado,
    conectado,
    conta: conectado ? i?.accountName ?? null : null,
    escopos,
    envioLigado,
    appAuditado,
    nivel,
    frase,
    bloqueios,
    produtoMarcado: PRODUTO_MARCADO_POR_API,
  }
}
