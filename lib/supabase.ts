import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export async function uploadFile(
  file: File,
  bucket: string,
  path: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true })

  if (error) throw new Error(`Upload falhou: ${error.message}`)

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path)
  return urlData.publicUrl
}

export async function deleteFile(bucket: string, path: string) {
  const { error } = await supabase.storage.from(bucket).remove([path])
  if (error) throw new Error(`Remoção falhou: ${error.message}`)
}

/** Igual a `uploadFile`, mas para quando já se tem um Buffer (ex.: saída do FFmpeg) em vez de um `File` do navegador. */
export async function uploadBuffer(
  buffer: Buffer,
  bucket: string,
  path: string,
  contentType: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, { upsert: true, contentType })

  if (error) throw new Error(`Upload falhou: ${error.message}`)

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path)
  return urlData.publicUrl
}

// ── Storage PRIVADO (Rodada 7 — Digital Twin) ────────────────────────────
// Rosto/voz/vídeo de referência da proprietária são ativos sensíveis:
// nunca em bucket público, nunca com URL permanente. Usa o client
// service-role (mesmo padrão de app/api/upload/*) porque o client anônimo
// não tem permissão de escrita/leitura num bucket privado.

const supabaseAdmin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder')

/** Upload para um bucket PRIVADO — nunca gera URL pública. */
export async function uploadBufferPrivado(buffer: Buffer, bucket: string, path: string, contentType: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).upload(path, buffer, { upsert: true, contentType })
  if (error) throw new Error(`Upload privado falhou: ${error.message}`)
  return data.path
}

/**
 * P2.69+ — upload SEM sobrescrever (upsert:false), para o caminho imutável do arquivo aprovado
 * (lib/arquivo-aprovado.ts): se o caminho já existe, devolve 'JA_EXISTE' e quem chama confere o conteúdo.
 */
export async function uploadBufferPrivadoSemSobrescrever(buffer: Buffer, bucket: string, path: string, contentType: string): Promise<'CRIADO' | 'JA_EXISTE'> {
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, buffer, { upsert: false, contentType })
  if (!error) return 'CRIADO'
  const status = String((error as { statusCode?: string | number }).statusCode ?? '')
  if (status === '409' || /already exists|duplicate/i.test(error.message)) return 'JA_EXISTE'
  throw new Error(`Upload imutável falhou: ${error.message}`)
}

/** URL assinada temporária — único jeito de acessar um arquivo do bucket privado. */
export async function criarUrlAssinada(bucket: string, path: string, expiraEmSegundos: number = 300): Promise<string> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, expiraEmSegundos)
  if (error || !data) throw new Error(`Falha ao gerar URL assinada: ${error?.message ?? 'sem dados'}`)
  return data.signedUrl
}

/**
 * P2.11 — URL assinada para o NAVEGADOR enviar o arquivo direto ao bucket
 * privado: o arquivo não passa pela função. O token só vale para `path`,
 * sem sobrescrever (sem upsert).
 */
export async function criarUrlDeEnvioPrivado(bucket: string, path: string): Promise<{ signedUrl: string; token: string }> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path)
  if (error || !data) throw new Error(`Falha ao gerar URL de envio: ${error?.message ?? 'sem dados'}`)
  return { signedUrl: data.signedUrl, token: data.token }
}

/** Tamanho e tipo que o storage registrou para o objeto — nunca o conteúdo. `null` se não existe. */
export async function infoDoObjetoPrivado(bucket: string, path: string): Promise<{ tamanho: number | null; mime: string | null } | null> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).info(path)
  if (error || !data) return null
  const d = data as { size?: number | null; contentType?: string | null; metadata?: { size?: number; mimetype?: string } | null }
  return { tamanho: d.size ?? d.metadata?.size ?? null, mime: d.contentType ?? d.metadata?.mimetype ?? null }
}

/**
 * P2.12 — Arquivos (não pastas) diretamente sob `prefixo/`, com as datas e o
 * tamanho que o storage registrou. Lança em qualquer erro: quem limpa nunca
 * decide com uma lista parcial.
 */
export async function listarObjetosPrivados(
  bucket: string,
  prefixo: string
): Promise<{ nome: string; criadoEm: Date | null; atualizadoEm: Date | null; tamanho: number | null }[]> {
  const saida: { nome: string; criadoEm: Date | null; atualizadoEm: Date | null; tamanho: number | null }[] = []
  const pagina = 1000
  for (let offset = 0; ; offset += pagina) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(prefixo, { limit: pagina, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error || !data) throw new Error(`Listagem privada falhou: ${error?.message ?? 'sem dados'}`)
    for (const o of data) {
      if (!o.id) continue // pasta
      const tamanho = (o.metadata as { size?: number } | null)?.size
      saida.push({
        nome: `${prefixo}/${o.name}`,
        criadoEm: o.created_at ? new Date(o.created_at) : null,
        atualizadoEm: o.updated_at ? new Date(o.updated_at) : null,
        tamanho: typeof tamanho === 'number' ? tamanho : null,
      })
    }
    if (data.length < pagina) return saida
  }
}

/** P2.12 — Apaga vários objetos; devolve os caminhos que o storage confirmou apagar. */
export async function apagarObjetosPrivados(bucket: string, caminhos: string[]): Promise<string[]> {
  if (!caminhos.length) return []
  const { data, error } = await supabaseAdmin.storage.from(bucket).remove(caminhos)
  if (error || !data) throw new Error(`Remoção privada falhou: ${error?.message ?? 'sem dados'}`)
  return data.map((o) => o.name)
}

export async function deleteFilePrivado(bucket: string, path: string) {
  const { error } = await supabaseAdmin.storage.from(bucket).remove([path])
  if (error) throw new Error(`Remoção privada falhou: ${error.message}`)
}
