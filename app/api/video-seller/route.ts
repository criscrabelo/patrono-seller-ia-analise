import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { gerarVideoSeller, BloqueadoPorPoliticaDeCusto } from '@/lib/claude'
import { z } from 'zod'

const schema = z.object({
  nome: z.string().min(1),
  descricao: z.string().optional(),
  publicoAlvo: z.string().optional().default('Público geral'),
  plataforma: z.string().min(1),
  duracao: z.number().positive(),
  objetivo: z.string().min(1),
  estilo: z.string().min(1),
  comando: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const { comando, ...entrada } = parsed.data

  if (comando) {
    const estiloMap: Record<string, string> = {
      anuncio: 'Direto para venda',
      premium: 'luxuoso e sofisticado',
      viral: 'orientado à retenção, com gancho forte e ritmo rápido',
      marketplace: 'demonstrativo e objetivo para marketplace',
      lifestyle: 'lifestyle emocional',
    }
    entrada.estilo = estiloMap[comando] ?? entrada.estilo
  }

  // O workspace da sessão é o que o gate usa para apurar o orçamento do mês.
  try {
    entrada.publicoAlvo = entrada.publicoAlvo.trim() || 'Público geral'
    const output = await gerarVideoSeller(entrada, session.user.workspaceId)
    return NextResponse.json(output, { status: 201 })
  } catch (e) {
    // P2.15.3: com a IA paga desligada (padrão), o bloqueio do custo virava 500 e a tela dizia "a IA demorou".
    if (e instanceof BloqueadoPorPoliticaDeCusto)
      return NextResponse.json({ error: 'O Video Seller usa IA paga, que está desligada. Nada foi cobrado. Para criar conteúdo sem custo, use Gerar Conteúdo.' }, { status: 403 })
    return NextResponse.json({ error: 'Não consegui gerar agora. Nada foi cobrado; tente de novo em instantes.' }, { status: 502 })
  }
}
