import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

// Shopee Open Platform – base URL
const SHOPEE_API = 'https://partner.shopeemobile.com/api/v2'

function sign(partnerId: number, partnerKey: string, path: string, timestamp: number, accessToken = '', shopId = 0): string {
  const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex')
}

// GET – retorna credenciais salvas da Shopee (sem expor tokens)
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const integracao = await prisma.integracao.findUnique({
    where: { workspaceId_plataforma: { workspaceId: session.user.workspaceId, plataforma: 'shopee' } },
  })

  if (!integracao) return NextResponse.json(null)

  return NextResponse.json({
    status: integracao.status,
    accountName: integracao.accountName,
    accountId: integracao.accountId,
    // P2.50: só os campos de exibição; qualquer chave secreta futura no extraData nunca vai ao navegador.
    extraData: (({ modo, partnerId, subId }) => ({ modo, partnerId, subId }))((integracao.extraData ?? {}) as { modo?: unknown; partnerId?: unknown; subId?: unknown }),
    updatedAt: integracao.updatedAt,
  })
}

// POST – salva credenciais e testa conexão (modo vendedor) ou só salva (modo afiliado)
export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const { modo, shopId, partnerId, partnerKey, accessToken, nomeLoja, subId } = body

  let status = 'conectado'
  let testeOk = false
  let erroTeste = ''

  // Modo vendedor: testa a conexão com a API Shopee
  if (modo === 'vendedor' && partnerId && partnerKey && accessToken && shopId) {
    try {
      const timestamp = Math.floor(Date.now() / 1000)
      const path = '/shop/get_shop_info'
      const sig = sign(Number(partnerId), partnerKey, path, timestamp, accessToken, Number(shopId))

      const url = `${SHOPEE_API}${path}?partner_id=${partnerId}&timestamp=${timestamp}&access_token=${accessToken}&shop_id=${shopId}&sign=${sig}`
      const res = await fetch(url)
      const data = await res.json()

      if (data.error && data.error !== '') {
        erroTeste = data.message || 'Erro ao conectar com Shopee'
        status = 'erro'
      } else {
        testeOk = true
      }
    } catch {
      erroTeste = 'Falha de rede ao testar conexão'
      status = 'erro'
    }
  }

  if (modo === 'afiliado') testeOk = true

  await prisma.integracao.upsert({
    where: { workspaceId_plataforma: { workspaceId: session.user.workspaceId, plataforma: 'shopee' } },
    update: {
      status,
      accessToken: accessToken ?? null,
      accountId: shopId ? String(shopId) : null,
      accountName: nomeLoja ?? null,
      extraData: { modo, partnerId: partnerId ?? null, subId: subId ?? null },
      updatedAt: new Date(),
    },
    create: {
      userId: session.user.id,
      workspaceId: session.user.workspaceId,
      plataforma: 'shopee',
      status,
      accessToken: accessToken ?? null,
      accountId: shopId ? String(shopId) : null,
      accountName: nomeLoja ?? null,
      extraData: { modo, partnerId: partnerId ?? null, subId: subId ?? null },
    },
  })

  if (status === 'erro') {
    return NextResponse.json({ error: erroTeste }, { status: 400 })
  }

  return NextResponse.json({ success: true, testeOk })
}

// DELETE – desconecta
export async function DELETE() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  await prisma.integracao.updateMany({
    where: { workspaceId: session.user.workspaceId, plataforma: 'shopee' },
    data: { status: 'desconectado', accessToken: null, accountId: null, accountName: null, extraData: {} },
  })

  return NextResponse.json({ success: true })
}
