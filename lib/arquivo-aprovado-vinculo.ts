/**
 * P2.69+ (revisão independente, achados 11/12) — o vínculo com o arquivo aprovado não depende de quem chama.
 *
 * Toda peça (Conteudo) que nasceu de uma publicação assistida só sai pelo arquivo FIXADO no caminho imutável do
 * sha256 liberado (`apresentacao.arquivoAprovado`). Qualquer canal (TikTok pela porta única, Instagram pelo trabalho
 * longo, fila) pergunta aqui; sem o registro, recusa. A dispensa dos testes legados nunca vale em Production.
 */
import { createHash } from 'node:crypto'
import { prisma } from './prisma'
import { caminhoImutavel, type PortasDoArquivoAprovado } from './arquivo-aprovado'

// revisão P2.72 (BAIXA 3): a dispensa dos testes legados só existe DENTRO do executor de testes (node:test marca o
// processo com NODE_TEST_CONTEXT) — nunca num servidor, Preview ou script, com ou sem PATRONO_AMBIENTE
export const dispensaLegadaAtiva = (env: Record<string, string | undefined> = process.env) =>
  process.env.PATRONO_TESTE_LEGADO_SEM_TRES_CONTROLES === 'true' && process.env.NODE_TEST_CONTEXT !== undefined
  && process.env.PATRONO_AMBIENTE !== 'producao' && env.PATRONO_AMBIENTE !== 'producao'

/**
 * Revisão P2.72 (MÉDIA 2): o texto comercial aprovado (a legenda da versão final) entra no vínculo junto com o
 * arquivo. Quem envia recalcula sobre o texto que vai sair; outro texto (PATCH, legenda de outro canal) é recusado.
 */
export function hashDoTexto(t: string | null | undefined): string {
  return createHash('sha256').update((t ?? '').replace(/\r\n/g, '\n').trim(), 'utf8').digest('hex')
}

export { ESTADOS_COM_ARQUIVO_VALIDO, registroDoArquivoValido } from './arquivo-aprovado'
import { registroDoArquivoValido } from './arquivo-aprovado'

export type VinculoDoArquivo = { aplica: false } | { aplica: true; sha256: string; caminho: string; textoSha256: string; erro?: undefined } | { aplica: true; erro: string }

/** Lê do BANCO (não do chamador) se a peça exige arquivo aprovado e qual é. */
export async function vinculoDoArquivoAprovado(workspaceId: string, conteudoId: string, env?: Record<string, string | undefined>): Promise<VinculoDoArquivo> {
  const a = await prisma.publicacaoAssistida.findFirst({ where: { workspaceId, conteudoId }, select: { workspaceId: true, estado: true, versao: true, apresentacao: true } })
  if (!a || dispensaLegadaAtiva(env)) return { aplica: false }
  // P2.33.1 + revisão P2.69+ (achado 14): a versão NARRADA (voz da titular) NUNCA sai pela API — só pelo app, pela titular
  if ((a.apresentacao as { versaoEscolhida?: string } | null)?.versaoEscolhida === 'NARRADA') return { aplica: true, erro: 'Versão narrada: a própria titular publica pelo app; nada é enviado pela API.' }
  const r = registroDoArquivoValido(a)
  if (r) return { aplica: true, ...r }
  return { aplica: true, erro: 'Peça de publicação assistida sem arquivo aprovado fixado (sha256 + caminho imutável): nada é enviado.' }
}

/** URL NOVA (assinada agora) do arquivo aprovado, depois de reler o objeto e conferir o sha256. */
export async function urlConferidaDoArquivoAprovado(v: { sha256: string; caminho: string }, portas: Pick<PortasDoArquivoAprovado, 'ler' | 'urlDeLeitura'>): Promise<string> {
  const bytes = await portas.ler(v.caminho)
  if (createHash('sha256').update(bytes).digest('hex') !== v.sha256) throw new Error('o objeto no caminho imutável não confere com o sha256 aprovado')
  return portas.urlDeLeitura(v.caminho)
}

/**
 * P2.72 — o arquivo APROVADO para a titular publicar pelo app: só a cópia imutável da versão atual, relida e conferida
 * (sha256) agora. Sem registro válido (retida, outra versão, regerada), nada para baixar.
 */
export async function arquivoAprovadoParaATitular(p: { workspaceId: string; id: string }): Promise<{ url: string | null; motivo: string | null }> {
  const a = await prisma.publicacaoAssistida.findFirst({ where: { id: p.id, workspaceId: p.workspaceId }, select: { workspaceId: true, estado: true, versao: true, apresentacao: true } })
  if (!a) return { url: null, motivo: 'Publicação não encontrada.' }
  const r = registroDoArquivoValido(a)
  if (!r) return { url: null, motivo: 'O vídeo só fica disponível depois que os controles liberam o arquivo aprovado desta versão.' }
  const { PORTAS_REAIS_DO_ARQUIVO_APROVADO } = await import('./arquivo-aprovado-real')
  try {
    return { url: await urlConferidaDoArquivoAprovado(r, PORTAS_REAIS_DO_ARQUIVO_APROVADO), motivo: null }
  } catch {
    return { url: null, motivo: 'O arquivo aprovado não pôde ser conferido agora (sha256). Nada para baixar.' }
  }
}
