import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { classificarLinkShopee } from '@/lib/link-shopee'

const SHOPEE_API = 'https://partner.shopeemobile.com/api/v2'

function sign(partnerId: number, partnerKey: string, path: string, timestamp: number, accessToken: string, shopId: number) {
  const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex')
}

function gerarSlug(nome: string, plataforma: string) {
  const base = nome.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').substring(0, 30)
  const seq = Math.floor(Math.random() * 900 + 100)
  return `${base}-${plataforma}-${seq}`
}

// POST – gera links de afiliado para todos os produtos Shopee cadastrados
export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const { acao } = body // 'gerar_links' | 'sincronizar_produtos'

  const integracao = await prisma.integracao.findUnique({
    where: { workspaceId_plataforma: { workspaceId: session.user.workspaceId, plataforma: 'shopee' } },
  })

  if (!integracao || integracao.status !== 'conectado') {
    return NextResponse.json({ error: 'Shopee não conectada' }, { status: 400 })
  }

  if (acao === 'gerar_links') {
    // Gera links rastreáveis (/api/l/slug, no domínio configurado) para todos os produtos Shopee
    const produtos = await prisma.produto.findMany({
      where: {
        workspaceId: session.user.workspaceId,
        status: 'ativo',
        linkProduto: { not: null },
      },
    })

    const shopeeProds = produtos.filter(p =>
      p.linkProduto?.includes('shopee.com.br') || p.linkProduto?.includes('shope.ee')
    )

    let criados = 0
    let jaExistiam = 0
    let naoVerificados = 0
    let recusados = 0

    for (const prod of shopeeProds) {
      // Verifica se já existe link Shopee para este produto
      const existing = await prisma.linkDinamico.findFirst({
        where: { workspaceId: session.user.workspaceId, produtoId: prod.id, plataforma: 'shopee' },
      })

      if (existing) { jaExistiam++; continue }

      // P2.50 (16b): nenhum parâmetro de afiliado é inventado. Só o link curto
      // gerado no portal de afiliados é `afiliado`; o resto fica `nao_verificado`.
      const link = classificarLinkShopee(prod.linkProduto)
      if (!link.ok) { recusados++; continue }
      if (link.tipo === 'nao_verificado') naoVerificados++

      await prisma.linkDinamico.create({
        data: {
          userId: session.user.id,
          workspaceId: session.user.workspaceId,
          produtoId: prod.id,
          slug: gerarSlug(prod.nome, 'shopee'),
          plataforma: 'shopee',
          urlDestino: link.urlDestino,
          tipo: link.tipo,
          // P2.50: a taxa real vem do programa (sem fonte oficial aqui): desconhecida, nunca 10% fixo.
          comissao: null,
          precoAtual: prod.preco,
        },
      })
      criados++
    }

    return NextResponse.json({
      criados,
      jaExistiam,
      naoVerificados,
      recusados,
      total: shopeeProds.length,
      ...(naoVerificados > 0 && {
        aviso: `${naoVerificados} link(s) apontam para a página do produto, não para o link de afiliado. Gere o link no portal affiliate.shopee.com.br (s.shopee.com.br) e atualize o produto para a comissão ser atribuída.`,
      }),
    })
  }

  if (acao === 'sincronizar_produtos') {
    // P2.15.4: a assinatura oficial exige a Partner Key, que nunca foi guardada
    // (o código assinava com o access token). Nenhuma tela chama esta ação.
    // Em vez de chamar a Shopee com assinatura errada, responde indisponível.
    return NextResponse.json({ error: 'A sincronização do catálogo da Shopee ainda não está disponível. Use "Gerar links" ou cadastre os produtos.' }, { status: 501 })
  }


  return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
}
