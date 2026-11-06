import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { assetsVisiveisParaATitular } from '@/lib/digital-twin-acesso'

/**
 * Lista assets do PRÓPRIO workspace, com URL assinada temporária (nunca pública/permanente).
 * P2.33.1: só para a titular do perfil, só material com consentimento vigente e prévia não vencida.
 */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const r = await assetsVisiveisParaATitular({ workspaceId: session.user.workspaceId, userId: session.user.id })
  if (r.status === 403) return NextResponse.json({ error: r.motivo }, { status: 403 })
  return NextResponse.json(r.assets)
}

/**
 * P2.11 — o upload pela função foi DESATIVADO: foto, vídeo e voz não passam
 * mais pela hospedagem (P2.10). O navegador envia direto ao bucket privado
 * (`assets/url-de-envio` → storage → `assets/confirmar`). Esta resposta não
 * lê o corpo: nenhum byte do arquivo é processado aqui.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Envio por esta rota desativado. Use o envio direto (assets/url-de-envio).', codigo: 'USE_UPLOAD_DIRETO' },
    { status: 410 }
  )
}
