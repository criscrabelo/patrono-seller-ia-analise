import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { z } from 'zod'
import { promoverPorCorrecaoManual } from '@/lib/promocao-operacao-real'
import { obterDossieDaOperacao } from '@/lib/dossie-operacao'
import { respostaHttpDaComprovacao } from '@/lib/comprovacao-manual-http'

export const dynamic = 'force-dynamic'

/**
 * Comprovação manual auditada de uma venda real.
 *
 * ── A ROTA NÃO DECIDE NADA ──────────────────────────────────────────────
 * Ela só transporta. Quem valida motivo, referência, responsável, origem
 * promovível e idempotência é `promoverPorCorrecaoManual()` — a mesma
 * função usada em qualquer outro caminho. Replicar a regra aqui criaria uma
 * segunda versão dela, e duas versões da mesma regra é o mesmo que nenhuma.
 *
 * Por isso o schema abaixo só confere TIPO (string), nunca conteúdo: dizer
 * "motivo curto demais" é decisão do core, não da rota.
 *
 * ── O QUE A ROTA GARANTE ────────────────────────────────────────────────
 * O workspace e o responsável saem SEMPRE da sessão. Um cliente que envie
 * `workspaceId` ou `responsavelUserId` no corpo está mandando campos que
 * simplesmente não são lidos — o schema os descarta e o código nunca os
 * consulta. Sem isso, qualquer pessoa autenticada assinaria uma comprovação
 * em nome de outra, ou em outro negócio.
 */
const schema = z.object({
  motivo: z.string(),
  referencia: z.string(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const { id: saleId } = await params
  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Informe o motivo e a referência da comprovação.' }, { status: 400 })
  }

  const resultado = await promoverPorCorrecaoManual({
    // Da SESSÃO, sempre. Nunca do corpo da requisição.
    workspaceId: session.user.workspaceId,
    responsavelUserId: session.user.id,
    saleId,
    motivo: parsed.data.motivo,
    referencia: parsed.data.referencia,
  })

  // A tradução para HTTP é a única decisão desta rota, e mora numa função
  // pura (`lib/comprovacao-manual-http.ts`) para poder ser testada de
  // verdade, sem subir servidor.
  const resposta = respostaHttpDaComprovacao(resultado)
  if (resposta.status === 404) {
    return NextResponse.json({ error: 'Venda não encontrada' }, { status: 404 })
  }
  if (!resposta.ok) {
    // O motivo nomeado vai junto para a tela poder explicar o que faltou,
    // sem que ela precise conhecer a regra.
    return NextResponse.json(
      { ok: false, motivo: resposta.motivo, erro: resultado.explicacao },
      { status: resposta.status }
    )
  }

  // Sucesso (ou reenvio idempotente): devolve o estado JÁ atualizado, para a
  // tela não precisar pedir "atualize a página".
  const dossie = await obterDossieDaOperacao(session.user.workspaceId, saleId)
  return NextResponse.json({
    ok: true,
    promovido: resultado.promovido,
    idempotente: resultado.idempotente,
    explicacao: resultado.explicacao,
    origemAnterior: resultado.origemAnterior,
    origemNova: resultado.origemNova,
    veredito: resultado.veredito,
    dossie,
  })
}
