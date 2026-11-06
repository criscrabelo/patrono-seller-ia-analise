/**
 * P2.18.1 — Descoberta AUTOMÁTICA diária no TikTok Shop.
 *
 * Antes, a busca oficial (Affiliate Creator API, colaboração aberta) só
 * rodava quando alguém tocava em "Atualizar" em Oportunidades ou no ciclo do
 * supervisor: o Patrono dependia de um clique para descobrir produto. Agora a
 * rotina diária de oportunidades (05:00 UTC) faz a coleta sozinha em todo
 * workspace onde a fonte oficial está liberada.
 *
 * "Liberada" = chaves do app no servidor + flag TIKTOK_SHOP_CATALOGO + conta
 * de criadora conectada. Sem isso, nada vai à rede e o motivo fica no
 * relatório — nunca um produto de exemplo, nunca scraping.
 *
 * A coleta é a MESMA do botão (mesmo motor, mesma deduplicação, mesmo Top 3):
 * não publica, não gera conteúdo, não pede amostra, não gasta.
 */
import { prisma } from './prisma'
import { coletarCandidatos } from './curadoria'
import { conexaoTikTokShopLiberada, PLATAFORMA_CREATOR } from './tiktok-shop-oauth'
import { log } from './observabilidade'

export interface DescobertaDoWorkspace {
  workspaceId: string
  rodou: boolean
  /** null = rodou; texto = por que não rodou (ou o erro). */
  motivo: string | null
  avaliados: number | null
  apresentados: number | null
}

export async function fonteOficialDeDescoberta(
  workspaceId: string,
  env: Record<string, string | undefined> = process.env
): Promise<{ disponivel: true } | { disponivel: false; motivo: string }> {
  if (!(await conexaoTikTokShopLiberada(workspaceId, env))) {
    return { disponivel: false, motivo: 'Fonte oficial do TikTok Shop não liberada (chaves do app no servidor + flag TIKTOK_SHOP_CATALOGO).' }
  }
  const conexao = await prisma.integracao.findUnique({
    where: { workspaceId_plataforma: { workspaceId, plataforma: PLATAFORMA_CREATOR } },
    select: { status: true },
  })
  if (conexao?.status !== 'conectado') return { disponivel: false, motivo: 'Conta de criadora do TikTok Shop não conectada.' }
  return { disponivel: true }
}

export async function rodarDescobertaAutomatica(params: {
  agora: Date
  /** false = ensaio: diz onde rodaria, sem coletar nem gravar. */
  escrever: boolean
  env?: Record<string, string | undefined>
  workspaceIds?: string[]
  coletar?: typeof coletarCandidatos
}): Promise<DescobertaDoWorkspace[]> {
  const coletar = params.coletar ?? coletarCandidatos
  const alvos = params.workspaceIds ?? (await prisma.workspace.findMany({ select: { id: true } })).map((w) => w.id)
  const saida: DescobertaDoWorkspace[] = []
  for (const workspaceId of alvos) {
    // Um workspace com problema não derruba os outros.
    try {
      const fonte = await fonteOficialDeDescoberta(workspaceId, params.env)
      if (!fonte.disponivel) {
        saida.push({ workspaceId, rodou: false, motivo: fonte.motivo, avaliados: null, apresentados: null })
        continue
      }
      if (!params.escrever) {
        saida.push({ workspaceId, rodou: false, motivo: 'Ensaio: a coleta rodaria aqui.', avaliados: null, apresentados: null })
        continue
      }
      const r = await coletar({ workspaceId, agora: params.agora, ator: 'SISTEMA' })
      saida.push({ workspaceId, rodou: true, motivo: null, avaliados: r.avaliados, apresentados: r.apresentados })
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e)
      log('error', 'descoberta_automatica.falhou', { workspaceId, motivo })
      saida.push({ workspaceId, rodou: false, motivo, avaliados: null, apresentados: null })
    }
  }
  return saida
}
