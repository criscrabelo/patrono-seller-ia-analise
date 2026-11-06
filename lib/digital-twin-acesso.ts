/**
 * P2.33.1 — QUEM vê o material biométrico do Digital Twin.
 *
 * Só a titular do perfil (ownerUserId = usuária da sessão), só do próprio workspace, só material ATIVO,
 * com o consentimento do tipo VIGENTE e — para prévias — ainda dentro da validade. Mais ninguém (outro
 * membro do workspace, outra conta) recebe URL, nem assinada. A URL assinada dura 5 minutos.
 * SÓ LEITURA: listar nunca apaga nem altera nada (a limpeza é rotina explícita).
 */
import { prisma } from './prisma'
import { criarUrlAssinada } from './supabase'
import { BUCKET_DIGITAL_TWIN_PRIVADO } from './digital-twin-store'
import { consentimentosDoPerfil, podeUsarMaterial } from './digital-twin-consentimento'

export interface AssetVisivel { id: string; type: string; mimeType: string; purpose: string | null; createdAt: Date; url: string }

export type ResultadoDoAcesso = { status: 200; assets: AssetVisivel[] } | { status: 403; motivo: string }

export async function assetsVisiveisParaATitular(
  sessao: { workspaceId: string; userId: string },
  opcoes: { agora?: Date; assinar?: (caminho: string) => Promise<string> } = {},
): Promise<ResultadoDoAcesso> {
  const agora = opcoes.agora ?? new Date()
  const assinar = opcoes.assinar ?? ((c: string) => criarUrlAssinada(BUCKET_DIGITAL_TWIN_PRIVADO, c, 300))
  const c = await consentimentosDoPerfil(sessao.workspaceId)
  if (!c.profileId) return { status: 200, assets: [] }
  if (c.ownerUserId !== sessao.userId) return { status: 403, motivo: 'Só a titular do perfil vê o próprio rosto e voz.' }
  const assets = await prisma.digitalTwinAsset.findMany({
    where: { workspaceId: sessao.workspaceId, profileId: c.profileId, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: agora } }] },
    orderBy: { createdAt: 'desc' },
  })
  const visiveis = assets.filter((a) => podeUsarMaterial(a.type, a.purpose, { userId: sessao.userId, imagem: c.imagem, voz: c.voz, agora }).ok)
  return {
    status: 200,
    assets: await Promise.all(visiveis.map(async (a) => ({ id: a.id, type: a.type, mimeType: a.mimeType, purpose: a.purpose, createdAt: a.createdAt, url: await assinar(a.storagePath) }))),
  }
}
