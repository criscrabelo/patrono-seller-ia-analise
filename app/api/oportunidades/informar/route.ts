import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { lerEntradaInformada } from '@/lib/informar-produto-entrada'
import { coletarCandidatos, informarProduto, listarApresentados, ultimaColeta } from '@/lib/curadoria'
import { candidatosParaTela, respostaDeErro, ultimaColetaParaTela } from '@/lib/curadoria-http'

// P2.14.5.13: "Informar produto" — fallback, não o fluxo principal.
// Obrigatórios: nome e link. Nada é completado: o que não vier fica vazio.
// P2.17.1: a leitura da entrada (link colado com texto, título longo do
// TikTok Shop, mensagem por campo) fica em lib/informar-produto-entrada.ts.

export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  let body: unknown
  try {
    body = await req.json().catch(() => ({}))
  } catch {
    return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })
  }
  const parsed = lerEntradaInformada(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.mensagem, campos: parsed.campos }, { status: 400 })
  }

  try {
    const { workspaceId, id: userId } = session.user
    await informarProduto({ workspaceId, userId, dados: { ...parsed.dados, imagem: parsed.dados.imagem || null } })
    // Entra no ranking junto com o catálogo. P2.17.4 (auditoria): se a coleta
    // falhar, o produto JÁ foi salvo — responder erro faria a titular tentar de
    // novo e receber "já informado". Responde sucesso com o aviso.
    let resumo: Awaited<ReturnType<typeof coletarCandidatos>> | null = null
    let aviso: string | null = null
    try {
      resumo = await coletarCandidatos({ workspaceId, userId })
    } catch {
      aviso = 'Produto salvo. O ranking não pôde ser atualizado agora; ele entra na próxima atualização de candidatos.'
    }
    const [candidatos, ultima] = await Promise.all([listarApresentados(workspaceId), ultimaColeta(workspaceId)])
    return NextResponse.json(
      { resumo, aviso, candidatos: await candidatosParaTela(workspaceId, candidatos), ultimaColeta: ultimaColetaParaTela(ultima) },
      { status: 201 }
    )
  } catch (e) {
    return respostaDeErro(e)
  }
}
