import { NextRequest, NextResponse } from 'next/server'
import { exigirSessaoEFlag, respostaDeErroFase1 } from '@/lib/api-fase1'
import { centralPrecisaDeVoce, demonstracoesDaCentral } from '@/lib/precisa-de-voce-central'
import { assinarMidiasPrivadasNaResposta, SEM_CACHE } from '@/lib/midia-privada'

// P2.15: só o que SÓ a titular pode decidir (a fila se limpa antes de listar).
// P2.17.11: a central ÚNICA — pedidos + publicação assistida + conteúdos +
// autorizações. `?contar=1` devolve só o número do sininho.
export async function GET(req: NextRequest) {
  const s = await exigirSessaoEFlag('CENTRAL_DE_APROVACOES')
  if (s instanceof NextResponse) return s
  try {
    const itens = await centralPrecisaDeVoce(s.workspaceId)
    if (req.nextUrl.searchParams.get('contar') === '1') return NextResponse.json({ total: itens.length })
    // P2.17.12: demonstrações (teste) vêm à parte e NÃO somam no total do sininho.
    return NextResponse.json(await assinarMidiasPrivadasNaResposta({ total: itens.length, itens, demonstracoes: await demonstracoesDaCentral(s.workspaceId) }, s.workspaceId), { headers: SEM_CACHE })
  } catch (e) {
    return respostaDeErroFase1(e)
  }
}
