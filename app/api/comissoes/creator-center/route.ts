import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { ORIGEM_RELATADA_PELA_USUARIA } from '@/lib/proveniencia'
import { APELIDOS, type Campo } from '@/lib/creator-center-csv'
import { importarCreatorCenter, resumoCreatorCenter, situacaoDaImportacao, ORCAMENTO_DA_IMPORTACAO_MS } from '@/lib/creator-center-importacao'
import { flagLigada } from '@/lib/feature-flags'

/** P2.29.1: a importação financeira fica DESLIGADA até o Gate B (flag IMPORTACAO_CREATOR_CENTER). */
const MENSAGEM_IMPORTACAO_DESLIGADA = 'A importação do relatório do Creator Center ainda está desligada: ela é liberada depois da conferência do primeiro pedido elegível real. Nada foi importado.'

export const dynamic = 'force-dynamic'
// P2.29: a importação respeita um orçamento (ORCAMENTO_DA_IMPORTACAO_MS) abaixo deste limite; o que não couber
// volta com `continuar: true` e a tela reenvia o MESMO arquivo (retoma de onde parou, sem duplicar).
export const maxDuration = 30

/**
 * P2.19 — IMPORTAR RELATÓRIO DO CREATOR CENTER (pedidos de afiliado, CSV ou XLSX).
 * GET  → comissão estimada / não liquidada / liquidada (+ recebida, marcada pela titular) e últimas importações.
 * POST { nomeArquivo, conteudo (CSV em texto) | conteudoBase64 (CSV ou XLSX), mapeamentoManual? } → importa (idempotente).
 * A origem do registro é USER_REPORTED: a titular enviou o arquivo; nunca vira REAL_OPERATION aqui.
 */
export async function GET() {
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  const ws = s.user.workspaceId
  // P2.28: a última importação (inclusive a que não terminou) com a situação real — parcial não é sucesso completo.
  const ultima = await prisma.importacaoCreatorCenter.findFirst({ where: { workspaceId: ws }, orderBy: { importadoEm: 'desc' }, select: { id: true } })
  const [resumo, importacoes, situacaoDaUltima, importacaoAtiva] = await Promise.all([
    resumoCreatorCenter(ws),
    prisma.importacaoCreatorCenter.findMany({
      where: { workspaceId: ws, concluida: true }, orderBy: { importadoEm: 'desc' }, take: 10,
      select: { id: true, nomeArquivo: true, importadoEm: true, origem: true, formato: true, versaoDoParser: true, linhasTotal: true, linhasNovas: true, linhasAtualizadas: true, linhasIguais: true, linhasRejeitadas: true, colunasIgnoradas: true },
    }),
    ultima ? situacaoDaImportacao(ws, ultima.id) : Promise.resolve(null),
    flagLigada('IMPORTACAO_CREATOR_CENTER', ws),
  ])
  return NextResponse.json({ resumo, importacoes, situacaoDaUltima, importacaoAtiva })
}

const TAMANHO_MAXIMO = 3_000_000
const CAMPOS = Object.keys(APELIDOS) as [Campo, ...Campo[]]
const esquema = z.object({
  nomeArquivo: z.string().trim().min(1).max(200).refine((n) => /\.(csv|txt|xlsx)$/i.test(n), 'Envie o relatório em CSV ou XLSX (exportado do Creator Center).'),
  conteudo: z.string().max(TAMANHO_MAXIMO, 'Arquivo grande demais (máximo de 3 MB).').optional(),
  conteudoBase64: z.string().max(Math.ceil(TAMANHO_MAXIMO * 4 / 3) + 4, 'Arquivo grande demais (máximo de 3 MB).').optional(),
  mapeamentoManual: z.record(z.enum(CAMPOS), z.string().trim().min(1).max(200)).optional(),
}).refine((d) => (d.conteudo != null) !== (d.conteudoBase64 != null), 'Envie o arquivo.')

export async function POST(req: NextRequest) {
  const s = await exigirSessao()
  if (s instanceof NextResponse) return s
  if (!(await flagLigada('IMPORTACAO_CREATOR_CENTER', s.user.workspaceId))) return NextResponse.json({ error: MENSAGEM_IMPORTACAO_DESLIGADA, desligada: true }, { status: 403 })
  const c = esquema.safeParse(await req.json().catch(() => ({})))
  if (!c.success) return NextResponse.json({ error: c.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 })
  const bytes = c.data.conteudoBase64 != null ? Buffer.from(c.data.conteudoBase64, 'base64') : undefined
  if (bytes && bytes.length === 0) return NextResponse.json({ error: 'O arquivo está vazio.' }, { status: 422 })
  if (c.data.conteudo != null && c.data.conteudo.trim() === '') return NextResponse.json({ error: 'O arquivo está vazio.' }, { status: 422 })
  const r = await importarCreatorCenter({
    workspaceId: s.user.workspaceId, userId: s.user.id, nomeArquivo: c.data.nomeArquivo, conteudo: c.data.conteudo, bytes,
    mapeamentoManual: c.data.mapeamentoManual as Partial<Record<Campo, string>> | undefined, dataOrigin: ORIGEM_RELATADA_PELA_USUARIA,
    orcamentoMs: ORCAMENTO_DA_IMPORTACAO_MS,
  })
  if (!r.ok) return NextResponse.json({ error: r.motivo, colunasIgnoradas: r.colunasIgnoradas, colunasPossivelmenteRelevantes: r.colunasPossivelmenteRelevantes }, { status: 422 })
  // P2.28: o resultado diz se foi completo ou "IMPORTADO COM ALERTAS" (com números e a próxima ação).
  return NextResponse.json({ ...r, situacao: r.importacaoId ? await situacaoDaImportacao(s.user.workspaceId, r.importacaoId) : null })
}
