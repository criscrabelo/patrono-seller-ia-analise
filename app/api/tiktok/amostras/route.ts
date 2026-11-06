import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { ErroDeAmostra, listarAmostras, registrarAmostra, respostasDaOperacao, type DadosDaAmostra } from '@/lib/amostras'
import { kitParaTela } from '@/lib/kits-de-amostras'

export const dynamic = 'force-dynamic'

/** P2.17.17 — Amostras como operação: ciclo, prazos, prioridade, kits e as 5 perguntas. */
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const amostras = await listarAmostras(session.user.workspaceId)
  const respostas = respostasDaOperacao(amostras)
  return NextResponse.json({
    amostras: amostras.map((a) => ({ ...a, kit: kitParaTela(a.chave, a.estado === 'RECEBIDA') })),
    respostas: { ...respostas, fila: respostas.fila.map((f) => ({ id: f.id, nomeProduto: f.nomeProduto, posicao: f.posicao, porque: f.porque, efetivo: f.efetivo })) },
  })
}

/** Registra uma amostra que a titular JÁ pediu no app (idempotente pelo produto). Nunca pede amostra ao TikTok. */
export async function POST(req: Request) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const dados = (await req.json().catch(() => null)) as DadosDaAmostra | null
  if (!dados) return NextResponse.json({ erro: 'Corpo inválido.' }, { status: 400 })
  try {
    const r = await registrarAmostra({ workspaceId: session.user.workspaceId, userId: session.user.id, dados })
    return NextResponse.json({ id: r.amostra.id, criada: r.criada }, { status: r.criada ? 201 : 200 })
  } catch (e) {
    if (e instanceof ErroDeAmostra) return NextResponse.json({ erro: e.message }, { status: e.status })
    throw e
  }
}
