/**
 * P2.18.6 — Regras do envio de mídia pelo navegador (FUNÇÕES PURAS, usadas
 * pela rota que emite o token assinado e pelos testes).
 *
 * O caminho começa SEMPRE pelo workspace da sessão (nunca pelo que o
 * navegador diz), e o prefixo enviado pelo cliente é saneado.
 */
export const MAX_IMAGEM = 10 * 1024 * 1024 // 10 MB
export const MAX_VIDEO = 500 * 1024 * 1024 // 500 MB

export function validarEnvio(p: { tipo: string; tamanho: number }): string | null {
  const video = p.tipo.startsWith('video/')
  const imagem = p.tipo.startsWith('image/')
  if (!video && !imagem) return 'Envie apenas fotos ou vídeos.'
  const max = video ? MAX_VIDEO : MAX_IMAGEM
  if (p.tamanho > max) return `Arquivo muito grande (${Math.round(p.tamanho / 1048576)} MB). Máximo: ${Math.round(max / 1048576)} MB.`
  return null
}

const EXTENSOES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }

export function caminhoDeEnvio(p: { workspaceId: string; tipo: string; nome?: string; prefixo?: string; agora?: Date; aleatorio?: string }): { bucket: 'imagens' | 'videos'; path: string } {
  const video = p.tipo.startsWith('video/')
  const ext = EXTENSOES[p.tipo] ?? ((p.nome ?? '').split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) ?? (video ? 'mp4' : 'jpg')
  const prefixo = (p.prefixo ?? 'midias').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'midias'
  const ws = p.workspaceId.replace(/[^a-zA-Z0-9_-]/g, '')
  const aleatorio = p.aleatorio ?? Math.random().toString(36).slice(2, 10)
  return { bucket: video ? 'videos' : 'imagens', path: `ws-${ws}/${prefixo}/${(p.agora ?? new Date()).getTime()}-${aleatorio}.${ext || (video ? 'mp4' : 'jpg')}` }
}
