import { NextRequest, NextResponse } from 'next/server'
import { assinarMidiasPrivadasNaResposta, SEM_CACHE } from '@/lib/midia-privada'
import { z } from 'zod'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { registrarMidia, midiasDoProduto, DECLARACOES_OBRIGATORIAS } from '@/lib/midia-do-produto'
import { INDICIOS_DE_TERCEIRO } from '@/lib/autorizacao-midia-vendedor'
import { avancarVideo } from '@/lib/publicacao-assistida'
import { lerCorpo, respostaDeErroAssistido } from '@/lib/publicacao-assistida-http'
import { registrarAuditoria } from '@/lib/audit-log'

/**
 * P2.17.12 — FONTE ÚNICA de mídia por produto.
 *
 * POST: a titular declara uma foto/vídeo do produto que ela já enviou ao
 * storage do projeto (upload direto do navegador). O servidor grava QUEM
 * declarou e QUANDO (nunca vem do corpo), classifica pela régua do
 * preflight e, se a publicação assistida estava aguardando mídia, o vídeo
 * passa a ser gerado sozinho.
 *
 * GET ?assistidaId= : as mídias daquele produto, com status e motivo.
 */
const esquemaDoItem = z.object({
  url: z.string().trim().url().max(1000),
  tipo: z.enum(['IMAGEM', 'VIDEO']),
  origem: z.enum(['PROPRIO', 'LICENCIADO', 'FORNECEDOR', 'PLATAFORMA', 'DESCONHECIDA']),
  titularidade: z.string().trim().min(3, 'Diga de quem é o arquivo.').max(300),
  direitoDeUso: z.string().trim().min(3, 'Diga qual é o direito de uso.').max(300),
  descricao: z.string().trim().min(3, 'Descreva o arquivo.').max(300),
  termoDeLicenca: z.string().trim().max(300).nullable().optional(),
  // P2.50 (Codex 5): prazo (AAAA-MM-DD, vale até o fim do dia) e canais do direito — opcionais.
  validaAte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.').nullable().optional(),
  canaisPermitidos: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/)).max(10).nullable().optional(),
  declaracoes: z.object(Object.fromEntries(DECLARACOES_OBRIGATORIAS.map((k) => [k, z.boolean().optional()]))).partial().nullable().optional(),
  // P2.18.10: mídia do vendedor — indícios de direito de terceiro (a geral da loja não basta).
  indicios: z.array(z.enum(INDICIOS_DE_TERCEIRO)).max(5).nullable().optional(),
})
// P2.18: um arquivo (como antes) OU um lote de 1 a 10 (fotos/vídeos do mesmo
// produto). No lote, todos são registrados ANTES de gerar o vídeo — assim o
// vídeo usa todos, e não só o primeiro.
const esquema = z.union([
  esquemaDoItem.extend({ assistidaId: z.string().min(1) }),
  z.object({ assistidaId: z.string().min(1), itens: z.array(esquemaDoItem).min(1).max(10) }),
])

async function assistidaDoWorkspace(workspaceId: string, id: string) {
  return prisma.publicacaoAssistida.findFirst({ where: { id, workspaceId, demonstracao: false } })
}

export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const corpo = lerCorpo(esquema, await req.json().catch(() => ({})))
  if (!corpo.ok) return corpo.resposta
  const itens = 'itens' in corpo.dados ? corpo.dados.itens : [corpo.dados]
  try {
    const a = await assistidaDoWorkspace(session.user.workspaceId, corpo.dados.assistidaId)
    if (!a) return NextResponse.json({ error: 'Publicação não encontrada.' }, { status: 404 })
    const registradas: Awaited<ReturnType<typeof registrarMidia>>[] = []
    for (const d of itens) {
      const midia = await registrarMidia({
        workspaceId: session.user.workspaceId,
        produtoId: a.produtoId,
        candidatoId: a.candidatoId,
        nomeProduto: a.nomeProduto,
        declaracao: {
          url: d.url, tipo: d.tipo, origem: d.origem, titularidade: d.titularidade, direitoDeUso: d.direitoDeUso, descricao: d.descricao,
          termoDeLicenca: d.termoDeLicenca ?? null, declaracoes: d.declaracoes ?? null, indicios: d.indicios ?? null,
          validaAte: d.validaAte ? new Date(`${d.validaAte}T23:59:59.999-03:00`) : null, canaisPermitidos: d.canaisPermitidos ?? null,
          declaradoPor: session.user.id, declaradoEm: new Date(),
        },
      })
      await registrarAuditoria({ workspaceId: session.user.workspaceId, userId: session.user.id, action: 'midia.declarada', entityType: 'MidiaDoProduto', entityId: midia.id, metadata: { status: midia.status, origem: midia.origem, tipo: midia.tipo, assistidaId: a.id } })
      registradas.push(midia)
    }
    // Autorizada + publicação esperando mídia → o Patrono gera o vídeo sozinho (uma vez, com o lote todo).
    const depois = registradas.some((m) => m.status === 'AUTORIZADA') ? await avancarVideo(a, req.nextUrl.origin) : a
    const resumo = (m: Awaited<ReturnType<typeof registrarMidia>>) => ({ id: m.id, status: m.status, motivo: m.motivoStatus })
    // `midia` = a primeira (compatível com a tela antiga); `midias` = todas do lote.
    return NextResponse.json({ midia: resumo(registradas[0]), midias: registradas.map(resumo), assistida: { id: depois.id, estado: depois.estado } }, { status: 201 })
  } catch (e) {
    return respostaDeErroAssistido(e)
  }
}

export async function GET(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const id = req.nextUrl.searchParams.get('assistidaId') ?? ''
  const a = id ? await assistidaDoWorkspace(session.user.workspaceId, id) : null
  if (!a) return NextResponse.json({ error: 'Publicação não encontrada.' }, { status: 404 })
  return NextResponse.json(await assinarMidiasPrivadasNaResposta({ itens: await midiasDoProduto({ workspaceId: session.user.workspaceId, produtoId: a.produtoId, candidatoId: a.candidatoId }) }, session.user.workspaceId), { headers: SEM_CACHE })
}
