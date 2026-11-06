import type { NextConfig } from 'next'

/**
 * P2.18 — Cabeçalhos de segurança em TODAS as respostas.
 *
 * Contra embutir o Patrono em página de terceiros (clickjacking):
 * `frame-ancestors 'none'` (padrão atual) + `X-Frame-Options: DENY` (para
 * navegadores antigos que ignoram CSP). Nenhuma tela do Patrono é aberta
 * dentro de iframe: os OAuth (TikTok/Instagram/TikTok Shop) são
 * redirecionamentos de página inteira, e o link /go/ redireciona — nada
 * disso é afetado. A CSP aqui tem SÓ `frame-ancestors`: não restringe
 * scripts/estilos/imagens, então não quebra o Next, o Supabase Storage nem
 * a barra de Preview da Netlify (que é injetada na página, não a enquadra).
 */
export const CABECALHOS_DE_SEGURANCA = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Microfone só no próprio site: a gravação de voz do Digital Twin usa getUserMedia.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
]

const nextConfig: NextConfig = {
  // P2.18: não anunciar a tecnologia do servidor.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: CABECALHOS_DE_SEGURANCA }]
  },
  // P2.1: empacotado pelo webpack, o `ffmpeg-static` resolve o caminho do
  // binário a partir da pasta do CHUNK da rota (`.next/server/app/...`), onde
  // ele não existe — o render falhava com "binário não encontrado". Fora do
  // bundle, o pacote é carregado de `node_modules` e acha o próprio binário.
  // Validado no Linux da Netlify: ffmpeg 7.0.2 executou e renderizou.
  serverExternalPackages: ['ffmpeg-static'],
  // A2/npm audit: o projeto não usa next/image. O otimizador (/_next/image) ficava aberto sem login e é
  // a superfície das RCE de imagem (AVIF/SVG) do Next. Desligado: o endpoint deixa de existir.
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // O binário do FFmpeg é referenciado por caminho (ffmpeg-static), e o
  // rastreamento de arquivos do Next não o segue. Sem isto, as rotas que
  // renderizam vídeo sobem sem o binário. Só muda o que entra no pacote da
  // função; não muda comportamento.
  outputFileTracingIncludes: {
    '/api/conteudos/[id]/adicionar-legenda': ['./node_modules/ffmpeg-static/ffmpeg'],
    '/api/conteudos/[id]/gerar-video': ['./node_modules/ffmpeg-static/ffmpeg'],
    '/api/conteudos/[id]/video-status': ['./node_modules/ffmpeg-static/ffmpeg'],
    '/api/digital-twin': ['./node_modules/ffmpeg-static/ffmpeg'],
    // P2.17.12: o vídeo do modo assistido é gerado sozinho (trabalho longo
    // na requisição) quando o Patrono prepara, corrige ou recebe a mídia.
    '/api/tiktok/assistido': ['./node_modules/ffmpeg-static/ffmpeg'],
    '/api/tiktok/assistido/[id]/ajuste': ['./node_modules/ffmpeg-static/ffmpeg'],
    '/api/tiktok/assistido/[id]/rejeitar': ['./node_modules/ffmpeg-static/ffmpeg'],
    '/api/midias': ['./node_modules/ffmpeg-static/ffmpeg'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '110mb',
    },
  },
}

export default nextConfig
