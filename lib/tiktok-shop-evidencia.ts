/**
 * P2.15.3 — TikTok Shop: o item "Liberar a descoberta automática" só sai de
 * "Precisa de você" com EVIDÊNCIA real no sistema — nunca pela palavra de
 * ninguém (botão, Copilot ou API).
 *
 * Evidência = uma Integracao do TikTok Shop (linha `tiktok-shop` ou a futura
 * `tiktok-shop-creator`, P2.14.5.14 §6.8) com status `conectado`, token
 * guardado e não vencido. P2.17: o callback OAuth grava `tiktok-shop-creator`
 * só depois da autorização real da criadora; sem app aprovado ele responde
 * 501 e o item fica pendente — de propósito.
 */
import { prisma } from './prisma'

export const CHAVE_TIKTOK_SHOP = 'estrategia:tiktok-shop-descoberta'
export const PLATAFORMAS_TIKTOK_SHOP = ['tiktok-shop', 'tiktok-shop-creator'] as const

/** Itens que nenhum clique tira da fila: só a evidência real. */
export function exigeEvidencia(chave: string): boolean {
  return chave === CHAVE_TIKTOK_SHOP
}

/** O que a titular faz, em ordem (resumo de P2.14.5.14 §6, sem segredo). */
export const PASSOS_TIKTOK_SHOP = [
  'Entre no TikTok Shop Partner Center (partner.tiktokshop.com) — não é o TikTok for Developers.',
  'Cadastre a empresa como parceira (Service Partner / App Developer) e crie um app do tipo Affiliate, região Brasil.',
  'Peça a liberação da Affiliate API e o escopo "Read Creator Affiliate Collaborations" (1021508). Ela vem desligada e depende de aprovação do TikTok.',
  'Com o app aprovado, guarde App Key, App Secret e o link de autorização do app direto nas variáveis do site — nunca cole em conversa.',
  'Depois disso, em Integrações aparece "Conectar TikTok Shop": você toca, entra com a sua conta de criadora e autoriza. Quando a conexão estiver ativa, este item sai sozinho.',
]

/** FUNÇÃO PURA: há evidência válida? Devolve a frase da evidência ou null. */
export function avaliarEvidencia(
  integracoes: { plataforma: string; status: string; temToken: boolean; tokenExpiry: Date | null; refreshValido?: boolean }[],
  agora: Date
): string | null {
  const valida = integracoes.find(
    (i) =>
      (PLATAFORMAS_TIKTOK_SHOP as readonly string[]).includes(i.plataforma) &&
      i.status === 'conectado' &&
      i.temToken &&
      // P2.17.4 (auditoria): access token vencido com refresh ainda válido continua
      // sendo conexão real (renova na próxima coleta) — a pendência não volta à toa.
      (!i.tokenExpiry || i.tokenExpiry.getTime() > agora.getTime() || i.refreshValido === true)
  )
  return valida ? `Integração ${valida.plataforma} conectada, com acesso válido.` : null
}

export async function evidenciaDoTikTokShop(workspaceId: string, agora = new Date()): Promise<string | null> {
  const linhas = await prisma.integracao.findMany({
    where: { workspaceId, plataforma: { in: [...PLATAFORMAS_TIKTOK_SHOP] } },
    select: { plataforma: true, status: true, accessToken: true, refreshToken: true, tokenExpiry: true, extraData: true },
  })
  return avaliarEvidencia(
    linhas.map((l) => {
      const fim = (l.extraData as { refreshExpiraEm?: string | null } | null)?.refreshExpiraEm
      const refreshValido = !!l.refreshToken && (!fim || new Date(fim).getTime() > agora.getTime())
      return { plataforma: l.plataforma, status: l.status, temToken: !!l.accessToken, tokenExpiry: l.tokenExpiry, refreshValido }
    }),
    agora
  )
}
