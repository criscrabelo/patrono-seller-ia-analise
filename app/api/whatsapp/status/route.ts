import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { verificarConexao } from '@/lib/whatsapp'
import { envioDeWhatsappPermitido } from '@/lib/transferencia-internacional'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  // P2.11: a tela avisa e desabilita o envio onde ele é recusado.
  const hospedagem = envioDeWhatsappPermitido()
  const envio = hospedagem.permitido ? { envioPermitido: true } : { envioPermitido: false, motivoDoBloqueio: hospedagem.motivo }

  const integracao = await prisma.integracao.findUnique({
    where: { workspaceId_plataforma: { workspaceId: session.user.workspaceId, plataforma: 'whatsapp' } },
  })

  if (!integracao || integracao.status !== 'conectado' || !integracao.accountId || !integracao.accessToken) {
    return NextResponse.json({ configurado: false, ...envio })
  }

  const extra = (integracao.extraData ?? {}) as Record<string, string>

  try {
    const { conectado, numero } = await verificarConexao({
      instanceId: integracao.accountId,
      token: integracao.accessToken,
      clientToken: extra.clientToken,
    })
    return NextResponse.json({ configurado: true, conectado, numero, ...envio })
  } catch {
    return NextResponse.json({ configurado: true, conectado: false, ...envio })
  }
}
