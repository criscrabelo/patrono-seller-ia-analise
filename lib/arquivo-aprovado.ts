/**
 * P2.69+ — ARQUIVO APROVADO IMUTÁVEL (fecha o TOCTOU entre conferir o hash e enviar à plataforma).
 *
 * Antes: o Patrono conferia o sha256 lendo a URL do vídeo e, depois, a plataforma (ou o adaptador) lia a MESMA URL de
 * novo. Se o objeto fosse sobrescrito nesse intervalo, ia ao ar outro arquivo.
 * Agora:
 *  1. os bytes são lidos UMA vez;
 *  2. o sha256 é calculado SOBRE ESSES BYTES e a liberação é decidida com ele;
 *  3. os MESMOS bytes são gravados num caminho DERIVADO DO HASH (`<workspace>/aprovados/<sha256>.mp4`), SEM sobrescrever;
 *     se o caminho já existe, o conteúdo existente é conferido (hash igual) — senão, erro;
 *  4. a plataforma recebe só a URL desse caminho. Como o nome É o hash e nada sobrescreve, o que a plataforma lê é,
 *     por construção, o arquivo aprovado — mesmo que a origem seja trocada depois da leitura.
 */
import { createHash } from 'node:crypto'
import { liberacaoParaPublicacao } from './quality-gate-conformidade'

export const LIMITE_DO_ARQUIVO_APROVADO = 300 * 1024 * 1024
export const PASTA_DOS_APROVADOS = 'aprovados'
/** bucket PRIVADO (o mesmo de lib/digital-twin-store.ts); repetido aqui para não puxar o storage para a lógica pura */
// Production (P2.35): o bucket privado é `midias-privadas`
export const BUCKET_DOS_APROVADOS = 'midias-privadas'

export interface PortasDoArquivoAprovado {
  /** lê a origem (URL ou caminho privado) — uma vez */
  baixar(origem: string): Promise<Buffer>
  /** grava SEM sobrescrever; devolve JA_EXISTE se o caminho já tem objeto */
  subirSemSobrescrever(caminho: string, bytes: Buffer): Promise<'CRIADO' | 'JA_EXISTE'>
  /** lê um objeto já gravado (para conferir quando JA_EXISTE) */
  ler(caminho: string): Promise<Buffer>
  /** URL de leitura do caminho imutável (assinada, com validade) */
  urlDeLeitura(caminho: string): Promise<string>
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')
export const caminhoImutavel = (workspaceId: string, sha: string) => {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('sha256 inválido')
  if (!/^[A-Za-z0-9_-]+$/.test(workspaceId)) throw new Error('workspace inválido')
  return `${workspaceId}/${PASTA_DOS_APROVADOS}/${sha}.mp4`
}

export interface ArquivoFixado { sha256: string; caminho: string; url: string; criado: boolean; tamanho: number }

export async function fixarArquivoAprovado(p: { workspaceId: string; origem: string }, portas: PortasDoArquivoAprovado): Promise<ArquivoFixado> {
  if (!p.origem) throw new Error('sem arquivo de origem')
  const bytes = await portas.baixar(p.origem) // ← a ÚNICA leitura da origem
  if (!bytes.length) throw new Error('arquivo vazio')
  if (bytes.length > LIMITE_DO_ARQUIVO_APROVADO) throw new Error('arquivo acima do limite')
  const sha = sha256(bytes)
  const caminho = caminhoImutavel(p.workspaceId, sha)
  const r = await portas.subirSemSobrescrever(caminho, bytes)
  if (r === 'JA_EXISTE') {
    // outra publicação (ou tentativa) já fixou: o objeto existente TEM de ser este mesmo arquivo
    const existente = await portas.ler(caminho)
    if (sha256(existente) !== sha) throw new Error('o caminho imutável contém outro arquivo: publicação recusada')
  }
  return { sha256: sha, caminho, url: await portas.urlDeLeitura(caminho), criado: r === 'CRIADO', tamanho: bytes.length }
}

/** O `assetUrl` é a URL assinada de `<bucket privado>/<workspace>/aprovados/<sha>.mp4`, no storage DESTE projeto. */
export function assetNoCaminhoImutavel(assetUrl: string | null | undefined, workspaceId: string, sha: string | null, env: Record<string, string | undefined> = process.env): boolean {
  if (!assetUrl || !sha) return false
  let esperado: string
  try { esperado = caminhoImutavel(workspaceId, sha) } catch { return false }
  try {
    const u = new URL(assetUrl)
    const projeto = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    return u.protocol === 'https:' && u.host === projeto.host && decodeURIComponent(u.pathname) === `/storage/v1/object/sign/${BUCKET_DOS_APROVADOS}/${esperado}`
  } catch {
    return false
  }
}

/** estados em que o arquivo aprovado pode sair (pela API ou pelas mãos da titular) */
export const ESTADOS_COM_ARQUIVO_VALIDO = new Set(['APROVADO', 'FALHOU', 'PUBLICANDO'])

/**
 * Revisão P2.69+ (3ª rodada, achado 1): o registro só vale para a versão e a escolha ATUAIS, num estado de envio.
 * Regeração, ajuste, nova aprovação ou revogação mudam versão/escolha/estado e o registro antigo deixa de valer.
 */
export function registroDoArquivoValido(a: { workspaceId: string; estado: string; versao: number; apresentacao: unknown }): { sha256: string; caminho: string; textoSha256: string } | null {
  const ap = a.apresentacao as { versaoEscolhida?: string; video?: { arquivo?: string | null }; narracao?: { videoPath?: string | null } | null; arquivoAprovado?: { sha256?: unknown; caminho?: unknown; versao?: unknown; versaoEscolhida?: unknown; origem?: unknown; textoSha256?: unknown } | null } | null
  const aa = ap?.arquivoAprovado
  if (!aa || !ESTADOS_COM_ARQUIVO_VALIDO.has(a.estado)) return null
  const narrada = ap?.versaoEscolhida === 'NARRADA'
  if (aa.versao !== a.versao || aa.versaoEscolhida !== (narrada ? 'NARRADA' : 'ORIGINAL')) return null
  // 4ª revisão, achado 8: vídeo gerado de novo na MESMA versão (mídia revogada e trocada) → o registro antigo não vale
  const origemAtual = narrada ? ap?.narracao?.videoPath ?? null : ap?.video?.arquivo ?? null
  if (!origemAtual || aa.origem !== origemAtual) return null
  // registro sem o texto aprovado (anterior à P2.72) não vale: libera de novo
  if (typeof aa.textoSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(aa.textoSha256)) return null
  try {
    if (typeof aa.sha256 === 'string' && aa.caminho === caminhoImutavel(a.workspaceId, aa.sha256)) return { sha256: aa.sha256, caminho: aa.caminho, textoSha256: aa.textoSha256 }
  } catch { /* inválido */ }
  return null
}


/**
 * P2.72 (revisão do porte, MÉDIA 1) — a liberação que a TELA mostra é a mesma que decide o envio: os três controles,
 * o sha256 do arquivo gerado na checagem e, depois da aprovação, o arquivo aprovado fixado desta versão. Assim a tela
 * nunca mostra "liberado" com o download recusando. Sem `workspaceId` (calendário), só os dois primeiros.
 */
export function liberacaoExibida(a: { workspaceId?: string; estado: string; versao: number; apresentacao: unknown; qualityGate: unknown; bloqueio?: string | null }): { liberado: boolean; motivos: string[] } {
  const sha = (a.apresentacao as { video?: { sha256?: string | null } } | null)?.video?.sha256 ?? null
  const { motivos } = liberacaoParaPublicacao(a.qualityGate as never, sha)
  if (!((a.qualityGate ?? {}) as { arquivo?: { sha256?: string | null } }).arquivo?.sha256) motivos.push('A checagem do arquivo não tem o sha256 do vídeo gerado: gere o vídeo de novo para provar que é o mesmo arquivo.')
  if (!motivos.length && a.workspaceId && ESTADOS_COM_ARQUIVO_VALIDO.has(a.estado) && !registroDoArquivoValido({ workspaceId: a.workspaceId, estado: a.estado, versao: a.versao, apresentacao: a.apresentacao })) {
    motivos.push(a.bloqueio?.startsWith('PUBLICAÇÃO RETIDA') ? a.bloqueio : 'O arquivo aprovado desta versão ainda não foi fixado e conferido.')
  }
  return { liberado: motivos.length === 0, motivos }
}
