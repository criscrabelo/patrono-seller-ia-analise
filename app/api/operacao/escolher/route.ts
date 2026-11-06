import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSessaoEFlag } from '@/lib/api-fase1'
import { buscarProdutosParaEscolher, escolherProduto, visaoDaOperacao } from '@/lib/jornada'
import { respostaDeErroDaJornada } from '@/lib/jornada-http'
import { registrarAuditoria } from '@/lib/audit-log'
import { assinarMidiasPrivadasNaResposta, SEM_CACHE } from '@/lib/midia-privada'

export const dynamic = 'force-dynamic'

/**
 * "ESCOLHER OUTRO PRODUTO" na Operação.
 * GET ?q=nome → produtos que o Patrono já conhece (em mãos primeiro). Só leitura.
 * POST { candidatoId, emMaos } → o produto vira a jornada prioritária, sem recusar os outros.
 */
export async function GET(req: NextRequest) {
  const s = await exigirSessaoEFlag('CENTRAL_DE_APROVACOES')
  if (s instanceof NextResponse) return s
  try {
    const termo = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 80)
    return NextResponse.json({ produtos: await buscarProdutosParaEscolher(s.workspaceId, termo) })
  } catch (e) {
    return respostaDeErroDaJornada(e)
  }
}

const esquema = z.object({ candidatoId: z.string().min(1).max(64), emMaos: z.boolean() })

export async function POST(req: NextRequest) {
  const s = await exigirSessaoEFlag('CENTRAL_DE_APROVACOES')
  if (s instanceof NextResponse) return s
  const corpo = esquema.safeParse(await req.json().catch(() => ({})))
  if (!corpo.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  try {
    const ctx = await escolherProduto({ workspaceId: s.workspaceId, userId: s.userId, ...corpo.data })
    await registrarAuditoria({ workspaceId: s.workspaceId, userId: s.userId, action: 'jornada.escolha', entityType: 'JornadaOperacional', entityId: corpo.data.candidatoId, metadata: { emMaos: corpo.data.emMaos } })
    return NextResponse.json(await assinarMidiasPrivadasNaResposta(visaoDaOperacao(ctx), s.workspaceId), { headers: SEM_CACHE })
  } catch (e) {
    return respostaDeErroDaJornada(e)
  }
}
