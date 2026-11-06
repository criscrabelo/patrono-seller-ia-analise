/**
 * P2.12 — Porta real da limpeza de uploads órfãos: perfis e registros no
 * banco (Prisma), objetos no bucket privado (Supabase, service role).
 * A decisão fica em lib/limpeza-uploads-orfaos.ts.
 */
import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import { apagarObjetosPrivados, listarObjetosPrivados } from './supabase'
import { BUCKET_DIGITAL_TWIN_PRIVADO } from './digital-twin-store'
import type { PortaDaLimpeza } from './limpeza-uploads-orfaos'

/** Chave fixa do advisory lock desta rotina (P2.12). */
const CHAVE_DA_TRAVA = 212_000_001

export function portaDaLimpezaReal(): PortaDaLimpeza {
  return {
    async listarPerfis(workspaceId) {
      const perfis = await prisma.digitalTwinProfile.findMany({
        where: workspaceId ? { workspaceId } : {},
        select: { id: true, workspaceId: true },
        orderBy: { workspaceId: 'asc' },
      })
      return perfis.map((p) => ({ workspaceId: p.workspaceId, profileId: p.id }))
    },
    listarObjetos(workspaceId, profileId) {
      // Só o prefixo deste workspace e deste perfil — nada mais é listado.
      return listarObjetosPrivados(BUCKET_DIGITAL_TWIN_PRIVADO, `${workspaceId}/${profileId}`)
    },
    async caminhosRegistrados(caminhos) {
      const registrados = new Set<string>()
      for (let i = 0; i < caminhos.length; i += 500) {
        // Sem filtro de workspace de propósito: registrado em QUALQUER um preserva.
        const linhas = await prisma.digitalTwinAsset.findMany({ where: { storagePath: { in: caminhos.slice(i, i + 500) } }, select: { storagePath: true } })
        for (const l of linhas) registrados.add(l.storagePath)
      }
      return registrados
    },
    apagar(caminhos) {
      return apagarObjetosPrivados(BUCKET_DIGITAL_TWIN_PRIVADO, caminhos)
    },
    async exclusividade(fn) {
      // Trava de transação: funciona no pooler em modo transação
      // (pgbouncer=true) e se solta sozinha no fim, mesmo em erro ou queda.
      return prisma.$transaction(
        async (tx) => {
          const [linha] = await tx.$queryRaw<{ ok: boolean }[]>`select pg_try_advisory_xact_lock(${CHAVE_DA_TRAVA}::bigint) as ok`
          if (!linha?.ok) return { executou: false as const }
          return { executou: true as const, valor: await fn() }
        },
        { maxWait: 10_000, timeout: 120_000 }
      )
    },
    async auditar(workspaceId, quantidade) {
      await registrarAuditoria({
        workspaceId,
        userId: null,
        action: 'digital_twin.uploads_orfaos_removidos',
        entityType: 'Workspace',
        entityId: workspaceId,
        metadata: { quantidade }, // nunca caminhos
      })
    },
  }
}
