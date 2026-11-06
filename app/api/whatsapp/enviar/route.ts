import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { normalizarNumero } from '@/lib/whatsapp'
import { iniciarTrabalhoLongo } from '@/lib/trabalho-longo'
import { executorDoEnvio, chaveDoEnvio, intervaloEntreEnvios } from '@/lib/trabalhos-longos/envio-whatsapp'
import { CODIGO_WHATSAPP_BLOQUEADO, envioDeWhatsappPermitido } from '@/lib/transferencia-internacional'
import { conferirConteudoParaWhatsapp } from '@/lib/whatsapp-envio-conferencia'

// 3 s entre números: 11 números já passam do limite síncrono de 30 s da
// Netlify. O envio vira trabalho longo; esta rota valida e registra.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  // P2.11: números e mensagem são dados de TERCEIROS, sem mecanismo de
  // transferência internacional nesta hospedagem. Recusa ANTES de ler o
  // corpo: nada é lido nem gravado na fila.
  const hospedagem = envioDeWhatsappPermitido()
  if (!hospedagem.permitido) {
    return NextResponse.json({ error: hospedagem.motivo, codigo: CODIGO_WHATSAPP_BLOQUEADO }, { status: 403 })
  }

  // P2.15.4: só conteúdo APROVADO, liberado para WhatsApp e sem alerta
  // vermelho (lib/whatsapp-elegibilidade.ts). O conteúdo vem na URL
  // (?conteudoId=) e é conferido ANTES de ler o corpo (números de terceiros).
  // O texto enviado é a legenda aprovada do conteúdo, nunca texto livre.
  // Recusa registrada no audit log.
  const checagem = await conferirConteudoParaWhatsapp({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    conteudoId: req.nextUrl.searchParams.get('conteudoId'),
  })
  if (!checagem.ok) return NextResponse.json({ error: checagem.error }, { status: checagem.status })
  const conteudo = checagem.conteudo

  const integracao = await prisma.integracao.findUnique({
    where: { workspaceId_plataforma: { workspaceId: session.user.workspaceId, plataforma: 'whatsapp' } },
  })
  if (!integracao || integracao.status !== 'conectado' || !integracao.accountId || !integracao.accessToken) {
    return NextResponse.json({ error: 'WhatsApp não configurado. Configure em Integrações.' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({})) as {
    numeros: string[]
    /** Envia junto a 1ª foto do produto do conteúdo (nunca uma URL livre). */
    comFotoDoProduto?: boolean
    delayMs?: number
    chaveDoEnvio?: string
  }

  if (!Array.isArray(body.numeros) || !body.numeros.length) {
    return NextResponse.json({ error: 'Informe os números' }, { status: 400 })
  }
  const mensagemAprovada = conteudo.legendaWhatsapp!.trim()
  const fotoDoProduto = body.comFotoDoProduto ? conteudo.produto.imagens[0] : undefined

  // Filtra e normaliza números (sem repetir: a mesma pessoa recebe uma vez)
  const numerosValidos = [...new Set(
    body.numeros
      .map((n) => normalizarNumero(n))
      .filter((n): n is string => n !== null)
  )]

  if (numerosValidos.length === 0) {
    return NextResponse.json({ error: 'Nenhum número válido encontrado' }, { status: 400 })
  }

  const agora = new Date()
  const pedido = {
    numeros: numerosValidos,
    mensagem: mensagemAprovada,
    ...(fotoDoProduto ? { imagemUrl: fotoDoProduto } : {}),
    delayMs: intervaloEntreEnvios(body.delayMs), // mínimo 1.5s para não ser banido
  }

  // O workspace da sessão é o que o gate usa para apurar o orçamento: o
  // executor envia com o workspace do trabalho, que é este
  // (session.user.workspaceId).
  const r = await iniciarTrabalhoLongo({
    workspaceId: session.user.workspaceId,
    tipo: 'LONGO_ENVIO_WHATSAPP',
    chave: chaveDoEnvio(pedido, agora, body.chaveDoEnvio),
    entityType: 'INTEGRACAO',
    entityId: integracao.id,
    contexto: { pedido },
    executor: executorDoEnvio(),
    origem: req.nextUrl.origin,
    mensagemDeProcessando: `Enviando para ${numerosValidos.length} contato(s). Acompanhe nesta tela.`,
    agora,
  })
  return NextResponse.json(r.resposta.corpo, { status: r.resposta.status })
}
