/**
 * P2.33.1 — EXCLUSÃO SEGURA de material biométrico (rosto/voz) e das prévias geradas com ele.
 *
 * "Segura" = o registro só sai do banco DEPOIS de o storage confirmar que o objeto não existe mais.
 * Antes, a limpeza apagava o registro mesmo quando a remoção do arquivo falhava — o arquivo ficava
 * órfão no bucket (com rosto/voz) e ninguém mais sabia dele. Agora, falhou a remoção: o registro fica
 * INATIVO (não é mais servido nem usado) e a próxima rodada tenta de novo.
 */
import { prisma } from './prisma'
import { deleteFilePrivado, infoDoObjetoPrivado } from './supabase'
import { BUCKET_DIGITAL_TWIN_PRIVADO } from './digital-twin-store'
import { consentimentosExigidos, type Consentimento } from './digital-twin-consentimento'

export interface PortasDeExclusao {
  apagar(bucket: string, caminho: string): Promise<void>
  existe(bucket: string, caminho: string): Promise<boolean>
}

const PORTAS_REAIS: PortasDeExclusao = {
  apagar: (bucket, caminho) => deleteFilePrivado(bucket, caminho),
  existe: async (bucket, caminho) => (await infoDoObjetoPrivado(bucket, caminho)) !== null,
}

/** Apaga e CONFERE que sumiu. `true` só quando o storage confirma a ausência. */
export async function apagarObjetoComConfirmacao(caminho: string, portas: PortasDeExclusao = PORTAS_REAIS, bucket = BUCKET_DIGITAL_TWIN_PRIVADO): Promise<boolean> {
  try { await portas.apagar(bucket, caminho) } catch { /* confere abaixo: pode já não existir */ }
  try { return !(await portas.existe(bucket, caminho)) } catch { return false }
}

export interface ResultadoDaExclusao { apagados: number; pendentes: number }

/** Apaga (storage + registro) os assets indicados; o que o storage não confirmar fica inativo para nova tentativa. */
export async function excluirAssets(workspaceId: string, ids: string[], portas: PortasDeExclusao = PORTAS_REAIS): Promise<ResultadoDaExclusao> {
  const assets = ids.length ? await prisma.digitalTwinAsset.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, storagePath: true } }) : []
  let apagados = 0
  let pendentes = 0
  for (const a of assets) {
    if (await apagarObjetoComConfirmacao(a.storagePath, portas)) {
      await prisma.digitalTwinAsset.delete({ where: { id: a.id } })
      apagados++
    } else {
      await prisma.digitalTwinAsset.update({ where: { id: a.id }, data: { active: false } })
      pendentes++
    }
  }
  return { apagados, pendentes }
}

/**
 * Retenção: prévias vencidas (e as que ficaram pendentes de remoção) saem do storage e do banco.
 * Referências permanentes (rosto/voz/vídeo de referência) não expiram por esta rotina.
 */
export async function limparPreviasVencidas(agora: Date = new Date(), portas: PortasDeExclusao = PORTAS_REAIS, workspaceId?: string): Promise<ResultadoDaExclusao> {
  const alvo = await prisma.digitalTwinAsset.findMany({
    where: { ...(workspaceId ? { workspaceId } : {}), type: 'GENERATED_PREVIEW', OR: [{ expiresAt: { lte: agora } }, { active: false }] },
    select: { id: true, workspaceId: true },
    take: 500,
  })
  const porWs = new Map<string, string[]>()
  for (const a of alvo) porWs.set(a.workspaceId, [...(porWs.get(a.workspaceId) ?? []), a.id])
  const total: ResultadoDaExclusao = { apagados: 0, pendentes: 0 }
  for (const [ws, ids] of porWs) {
    const r = await excluirAssets(ws, ids, portas)
    total.apagados += r.apagados
    total.pendentes += r.pendentes
  }
  return total
}

/**
 * Revogação: apaga TODAS as prévias que dependem do consentimento revogado e, com `apagarMateriais`
 * (padrão), também o material de origem (rosto/voz/vídeo de referência) daquele consentimento.
 * O registro do consentimento (e da revogação) fica — é a prova de que existiu e foi revogado.
 */
export async function excluirMaterialDoConsentimento(workspaceId: string, consentimento: Consentimento, opcoes: { apagarMateriais?: boolean; portas?: PortasDeExclusao } = {}): Promise<ResultadoDaExclusao> {
  const apagarMateriais = opcoes.apagarMateriais !== false
  const assets = await prisma.digitalTwinAsset.findMany({ where: { workspaceId }, select: { id: true, type: true, purpose: true } })
  const alvo = assets.filter((a) => {
    if (!consentimentosExigidos(a.type, a.purpose).includes(consentimento)) return false
    return a.type === 'GENERATED_PREVIEW' || apagarMateriais
  })
  return excluirAssets(workspaceId, alvo.map((a) => a.id), opcoes.portas)
}
