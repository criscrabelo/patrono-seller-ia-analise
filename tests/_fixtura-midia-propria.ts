/**
 * P1.9.1 — A peça de Instagram que o preflight aceita de verdade.
 *
 * Antes desta rodada, "peça pronta" nos testes era qualquer `videoUrl` com
 * produto `Proprio`. O preflight passou a exigir o que o adapter real e a
 * regra de direitos exigem: vídeo em custódia própria, registro de direito
 * do ARQUIVO, legenda com CTA para a bio. Esta fixtura monta isso uma vez,
 * para os testes não reinventarem — e para nenhum deles aprovar de novo uma
 * peça que não iria ao ar.
 *
 * Não é suíte de teste: o nome não termina em `.test.ts`.
 */

import { textoDisclosure } from '../lib/creative-factory'
import { TIPO_EVIDENCIA_DE_MIDIA } from '../lib/evidencia-de-midia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validarReel } from '../lib/validacao-de-reel'
import { gerarLinkParaABio, situacaoDoLinkNaBio, confirmarLinkNaBio } from '../lib/link-na-bio'

/** Storage fictício do "projeto". Só existe no `env` dos testes. */
export const SUPABASE_DE_TESTE = 'https://projeto-de-teste.supabase.co'

/** Um vídeo no storage do projeto: custódia própria. */
export const VIDEO_PROPRIO_URL = `${SUPABASE_DE_TESTE}/storage/v1/object/public/midia/teste/video.mp4`

/** O mínimo de `env` para a custódia ser verificável. */
export const ENV_DE_CUSTODIA = { NEXT_PUBLIC_SUPABASE_URL: SUPABASE_DE_TESTE }

/** Legenda de Instagram que passa nas regras de copy: CTA para a bio e disclosure. */
export const LEGENDA_PUBLICAVEL = `Produto de teste — confira o preço atual.\n\nLink na bio.\n\n${textoDisclosure('afiliado')}`

/** O registro de direito do arquivo, como `lib/peca-com-midia-propria.ts` o grava. */
export function evidenciaDeMidiaPropria(assetUrl: string = VIDEO_PROPRIO_URL): object {
  return {
    tipo: TIPO_EVIDENCIA_DE_MIDIA,
    severidade: 'verde',
    origem: 'PROPRIO',
    assetUrl,
    formato: 'VIDEO_PROPRIO',
    declaradoPor: 'usuario-de-teste',
    declaradoEm: '2026-10-01T12:00:00.000Z',
    descricao: 'Vídeo gravado pela dona para o teste.',
    mensagem: 'Direito do arquivo declarado como PROPRIO.',
  }
}

// ── P1.9.2: o arquivo validado e as declarações de quem enviou ──────────

/** MP4 REAL, gerado pelo FFmpeg: 1080×1920, 12 s, H.264 + AAC. */
export const REEL_VALIDO = validarReel(readFileSync(join(__dirname, 'fixtures', 'reel', 'vertical.mp4')))

/** As três declarações que só quem enviou pode fazer. */
export const DECLARACOES_COMPLETAS = {
  gravadoPelaPropriaDona: true,
  semMusicaDeTerceiros: true,
  semTerceirosNemCriancas: true,
} as const

// ── P1.9.2: o passo humano da bio, feito pelo caminho real ──────────────

/**
 * Gera o link rastreado da tentativa e o CONFIRMA na bio, pelas mesmas
 * funções que o script de confirmação usa — inclusive o AuditLog. Para os
 * testes de distribuição que não estão testando a bio em si.
 */
export async function confirmarLinkNaBioParaTeste(p: {
  workspaceId: string
  contentId: string
  chaveDaTentativa: string
  userId: string
  env?: Record<string, string | undefined>
  canal?: string
}): Promise<string> {
  const canal = p.canal ?? 'instagram'
  await gerarLinkParaABio({ workspaceId: p.workspaceId, contentId: p.contentId, canal, chaveDaTentativa: p.chaveDaTentativa, env: p.env })
  const sit = await situacaoDoLinkNaBio({
    workspaceId: p.workspaceId, contentId: p.contentId, canal, chaveDaTentativa: p.chaveDaTentativa, env: p.env,
  })
  if (!sit?.url) throw new Error('a tentativa não tem link para a bio')
  const r = await confirmarLinkNaBio({
    workspaceId: p.workspaceId, contentId: p.contentId, canal, url: sit.url,
    confirmadoPor: p.userId, chaveDaTentativa: p.chaveDaTentativa, env: p.env,
  })
  if (!r.ok) throw new Error(r.explicacao)
  return sit.url
}
