/**
 * P1.9.2 — Confirmação HUMANA de que o link rastreado está na bio.
 *
 * Nenhuma API comprova isso hoje. Por isso quem confirma é uma pessoa, com
 * nome, para UMA URL, e a confirmação fica no `AuditLog`. Sem a flag
 * `--eu-vi-o-link-na-bio`, o script não grava nada.
 *
 * NÃO publica. Depois da confirmação o preflight deixa de bloquear por
 * LINK_NA_BIO_NAO_CONFIRMADO — e continua bloqueando por qualquer outra
 * coisa, inclusive pelo canal desligado.
 *
 * Uso:
 *   npx tsx scripts/confirmar-link-na-bio.ts --workspace <id> --conteudo <id> \
 *     --url "<link rastreado>" --confirmado-por <seu-userId> --eu-vi-o-link-na-bio
 */

import { prisma } from '../lib/prisma'
import { confirmarLinkNaBio } from '../lib/link-na-bio'
import { preflightDePublicacao } from '../lib/preflight-de-publicacao'

function arg(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`)
  return i === -1 ? null : process.argv[i + 1] ?? null
}

async function main() {
  const workspaceId = arg('workspace')
  const contentId = arg('conteudo')
  const url = arg('url')
  const confirmadoPor = arg('confirmado-por')
  if (!workspaceId || !contentId || !url || !confirmadoPor) {
    console.error('Faltam argumentos. Veja o cabeçalho do script.')
    process.exit(1)
  }
  if (!process.argv.includes('--eu-vi-o-link-na-bio')) {
    console.error('Confirme que você ABRIU o perfil e VIU este link na bio: acrescente --eu-vi-o-link-na-bio.')
    process.exit(1)
  }

  const r = await confirmarLinkNaBio({ workspaceId, contentId, canal: 'instagram', url, confirmadoPor })
  console.log(r.ok ? `Confirmado: ${r.explicacao}` : `NÃO confirmado: ${r.explicacao}`)

  const pf = await preflightDePublicacao({ workspaceId, canal: 'instagram', contentId })
  console.log(`preflight: pronto=${pf.pronto} executavelAgora=${pf.executavelAgora} bloqueio=${pf.bloqueio ?? '-'}`)
  console.log(`link na bio: ${pf.link?.estado ?? '-'}`)
  console.log('Nada foi publicado.')
  await prisma.$disconnect()
  if (!r.ok) process.exit(2)
}

main().catch(async (e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e)
  await prisma.$disconnect()
  process.exit(1)
})
