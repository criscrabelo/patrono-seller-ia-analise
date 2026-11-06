import { NextResponse } from 'next/server'
import { ErroDeNarracao } from './narracao'

/** Erro de narração → resposta com o status e a frase para a titular. Nada interno vaza. */
export function respostaDeErroDaNarracao(e: unknown) {
  if (e instanceof ErroDeNarracao) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error('Erro na narração:', e instanceof Error ? e.message : e)
  return NextResponse.json({ error: 'Não consegui preparar a narração agora.' }, { status: 500 })
}
