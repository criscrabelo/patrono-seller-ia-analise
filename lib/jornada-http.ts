import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ErroDaJornada } from './jornada'
import { ErroAssistido } from './publicacao-assistida'
import { ErroDeAmostra } from './amostras'
import { ErroDeResultado } from './resultados-videos'
import { ErroDeCuradoria } from './curadoria'
import { log } from './observabilidade'

const numero = z.number().finite().nonnegative().nullable().optional()

export const esquemaDaResposta = z.object({
  candidatoId: z.string().min(1).max(64),
  resposta: z.string().min(2).max(40).regex(/^[A-Z_]+$/, 'Resposta inválida.'),
  url: z.string().trim().max(500).nullable().optional(),
  /** P2.32: o som que a titular usou no app (opcional; histórico próprio de trilhas). */
  som: z.string().trim().max(120).nullable().optional(),
  numeros: z.object({ views: numero, vendas: numero, comissao: numero }).nullable().optional(),
})

export function respostaDeErroDaJornada(e: unknown) {
  if (e instanceof ErroDaJornada || e instanceof ErroAssistido || e instanceof ErroDeAmostra || e instanceof ErroDeResultado || e instanceof ErroDeCuradoria) {
    return NextResponse.json({ error: e.message }, { status: e.status })
  }
  log('error', 'jornada.erro', { erro: e instanceof Error ? e.message : String(e) })
  return NextResponse.json({ error: 'Erro interno. Nada foi alterado além do que já estava registrado.' }, { status: 500 })
}
