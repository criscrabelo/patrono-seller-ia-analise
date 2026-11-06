import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { arquivoAprovadoParaATitular } from '@/lib/narracao'
import { respostaDeErroDaNarracao } from '@/lib/narracao-http'

export const dynamic = 'force-dynamic'

/**
 * P2.69+ — o arquivo APROVADO (cópia imutável do sha256 liberado, relida e conferida agora) para a titular publicar
 * pelo app. GET só leitura; URL assinada com validade curta. Sem arquivo fixado, `url: null` com o motivo.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  try {
    return NextResponse.json(await arquivoAprovadoParaATitular({ workspaceId: s.user.workspaceId, userId: s.user.id, id }))
  } catch (e) {
    return respostaDeErroDaNarracao(e)
  }
}
