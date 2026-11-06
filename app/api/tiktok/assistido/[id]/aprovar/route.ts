import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { aprovarEPublicar } from '@/lib/publicacao-assistida'
import { esquemaAprovar, lerCorpo, respostaDeErroAssistido } from '@/lib/publicacao-assistida-http'

/** APROVAR E PUBLICAR: a titular aprova; o Patrono publica pela porta única oficial. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const corpo = lerCorpo(esquemaAprovar, await req.json().catch(() => ({})))
  if (!corpo.ok) return corpo.resposta
  try {
    const a = await aprovarEPublicar({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      id,
      alteracoes: corpo.dados.alteracoes,
      privacidade: corpo.dados.privacidade ?? null,
      versao: corpo.dados.versao,
      sha256: corpo.dados.sha256 ?? null,
      versaoEscolhida: corpo.dados.versaoEscolhida ?? null,
    })
    return NextResponse.json({ id: a.id, estado: a.estado, bloqueio: a.bloqueio, erro: a.erro })
  } catch (e) {
    return respostaDeErroAssistido(e)
  }
}
