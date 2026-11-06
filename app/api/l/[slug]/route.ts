import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { destinoPublico, hostsDoApp } from '@/lib/destino-publico'
import { tipoDoCliqueDaRequisicao } from '@/lib/clique-real'

export const dynamic = 'force-dynamic'

/**
 * Redirecionamento do link dinâmico — e registro do clique.
 *
 * ── O QUE MUDOU (P0.2 Bloco 2) ──────────────────────────────────────────
 * Antes o clique era gravado em "fire and forget": a promessa era disparada
 * sem `await` e terminava em `.catch(() => {})`. Duas consequências reais:
 *
 *  1. Em ambiente serverless a função pode ser congelada assim que a
 *     resposta é devolvida — a escrita simplesmente não acontece, sem erro
 *     em lugar nenhum.
 *  2. Qualquer falha era engolida em silêncio. Um clique perdido não deixava
 *     rastro, e depois seria impossível distinguir "ninguém clicou" de
 *     "o registro falhou".
 *
 * Clique é a primeira evidência do ciclo de receita: perder um em silêncio
 * contamina toda a leitura que vem depois. Agora a escrita é aguardada e
 * acontece numa transação — o contador e o evento nascem juntos ou não
 * nascem. Se falhar, o erro vai para o log do servidor.
 *
 * ── O REDIRECT NUNCA É BLOQUEADO ────────────────────────────────────────
 * A pessoa que clicou não pode ficar sem produto porque o nosso banco
 * falhou. Se o registro der erro, o redirecionamento acontece do mesmo
 * jeito — perdemos a métrica, não a venda.
 *
 * ── SEM RASTREAMENTO DE PESSOA ──────────────────────────────────────────
 * Só é gravado o que já era gravado: link, plataforma e `referer`. Nenhum
 * IP, cookie, fingerprint ou identificador de visitante — atribuição aqui é
 * entre VENDA e LINK, nunca entre venda e pessoa.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const link = await prisma.linkDinamico.findUnique({
    where: { slug },
    select: { id: true, ativo: true, urlDestino: true, plataforma: true, workspaceId: true },
  })

  if (!link || !link.ativo) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  // P2.50: só clique de compradora conta; robô de pré-visualização e a própria titular ficam com outro tipo.
  const tipoDoClique = tipoDoCliqueDaRequisicao(req.headers)
  try {
    await prisma.$transaction([
      prisma.linkDinamico.update({
        where: { id: link.id },
        data: { cliques: { increment: tipoDoClique === 'clique' ? 1 : 0 } },
      }),
      prisma.eventoLink.create({
        data: {
          // `workspaceId` vem do LINK, nunca da requisição: quem clica não
          // está autenticado e não pode influenciar a qual negócio o evento
          // pertence.
          workspaceId: link.workspaceId,
          linkId: link.id,
          tipo: tipoDoClique,
          plataforma: link.plataforma,
          referer: req.headers.get('referer') ?? undefined,
        },
      }),
    ])
  } catch (e) {
    // Visível no log da operação. Um clique não registrado é uma lacuna
    // conhecida, não um número silenciosamente errado.
    console.error(`[link] falha ao registrar clique do link ${link.id} — o redirecionamento seguiu normalmente:`, e)
  }

  // P2.50: defesa final — destino antigo inválido (interno, http, o próprio Patrono) não é seguido.
  if (!destinoPublico(link.urlDestino, { hostsDoApp: hostsDoApp() }).ok) return NextResponse.json({ error: 'Este link está com destino inválido.' }, { status: 410 })
  return NextResponse.redirect(link.urlDestino)
}
