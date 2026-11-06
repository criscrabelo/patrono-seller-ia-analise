import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { recusaPeloCabecalho } from '@/lib/digital-twin-upload-direto'
import { autorizarEnvioDireto } from '@/lib/digital-twin-upload-direto-servico'

export const dynamic = 'force-dynamic'

/**
 * P2.11, passo ① — autoriza o navegador a enviar UM arquivo direto ao bucket
 * privado. Recebe só metadados (tipo, formato, tamanho); devolve a URL
 * assinada de envio e a intenção assinada que a confirmação exige.
 */
export async function POST(req: NextRequest) {
  // Pelos cabeçalhos, antes de qualquer leitura do corpo.
  const recusa = recusaPeloCabecalho(req.headers.get('content-type'), req.headers.get('content-length'))
  if (recusa) return NextResponse.json({ error: recusa.motivo }, { status: recusa.status })

  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const corpo = await req.json().catch(() => null)
  const r = await autorizarEnvioDireto({ workspaceId: session.user.workspaceId, userId: session.user.id }, corpo)
  return NextResponse.json(r.corpo, { status: r.status })
}
