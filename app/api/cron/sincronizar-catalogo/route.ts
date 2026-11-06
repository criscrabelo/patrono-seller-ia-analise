import { NextRequest, NextResponse } from 'next/server'
import { chamadaDeOutroAgendador, RESPOSTA_DE_OUTRO_AGENDADOR } from '@/lib/agendador'
import { prisma } from '@/lib/prisma'
import { lerCredenciaisTikTokShop, TikTokShopAffiliateCapabilityProbe } from '@/lib/tiktok-shop-provider'
import { autorizacaoDeRotinaValida } from '@/lib/segredo-de-rotina'

/**
 * SHOWCASE_SYNC — sincronização periódica da Vitrine/Showcase (Rodada 13).
 *
 * AUTOMATION FIRST: a proprietária nunca aperta botão para importar produto,
 * preço ou imagem. Esta rota é chamada pelo agendador (Vercel Cron), não por
 * uma pessoa logada.
 *
 * POR QUE AQUI E NÃO NA FILA `DigitalTwinJob`: aquele modelo exige
 * `profileId` apontando para um `DigitalTwinProfile`. Sincronizar catálogo
 * não tem perfil de Digital Twin — forçar um seria modelagem errada e
 * quebraria em workspace que ainda não criou perfil. Quando existir uma fila
 * genérica de jobs (modelo próprio, migration própria), o corpo desta rota
 * migra para lá sem mudar nada do executor.
 *
 * ESTADO ATUAL: a Affiliate API do TikTok Shop é "inactive by default" e
 * depende de aprovação de Account/Partner Manager. Enquanto a capability não
 * for `AVAILABLE`, esta rota responde HONESTAMENTE que não sincronizou e por
 * quê — nunca finge sucesso nem inventa produto. Todo o resto do caminho
 * (paginação, adaptação, reconciliação, execução, auditoria, features) já
 * está pronto e testado; falta só o transporte HTTP, que exige credencial.
 */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Mesmo padrão de `cron/publicar`: sem sessão de usuária, mas NUNCA aberto.
  // Se o segredo não estiver configurado, a rota se recusa a rodar em vez de
  // ficar pública por omissão.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/sincronizar-catalogo] CRON_SECRET não configurado — recusando executar.')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  if (!autorizacaoDeRotinaValida(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  // P2.2: um agendador por vez — ver lib/agendador.ts.
  if (chamadaDeOutroAgendador(req.headers)) {
    return NextResponse.json(RESPOSTA_DE_OUTRO_AGENDADOR, { status: 409 })
  }

  const credenciais = lerCredenciaisTikTokShop()

  // Um workspace por vez, isolado: multi-business exige que a sincronização
  // de um negócio jamais toque o catálogo de outro.
  const integracoes = await prisma.integracao.findMany({
    where: { plataforma: 'tiktok-shop', status: 'conectado' },
    select: { workspaceId: true, userId: true, accessToken: true },
  })

  const resultados: Array<Record<string, unknown>> = []

  for (const integracao of integracoes) {
    const capability = new TikTokShopAffiliateCapabilityProbe().calcular({
      appConfigured: !!credenciais,
      creatorAutorizado: !!integracao.accessToken,
      // NUNCA assumido: só vira `true` quando a aprovação real for
      // registrada. Uma conta brasileira recém-registrada para aqui, em
      // AFFILIATE_API_APPROVAL_REQUIRED.
      affiliateApiAprovada: process.env.TIKTOK_SHOP_AFFILIATE_APROVADA === 'true',
      regiaoSuportada: true,
      erro: null,
    })

    if (capability !== 'AVAILABLE') {
      resultados.push({
        workspaceId: integracao.workspaceId,
        sincronizado: false,
        capability,
        motivo:
          'Affiliate API do TikTok Shop ainda não disponível para esta conta — a sincronização não foi executada. Nenhum produto foi criado, alterado ou inativado.',
      })
      continue
    }

    // Quando a capability for AVAILABLE, é aqui que entra o cliente HTTP
    // assinado (único item que depende de credencial real):
    //   percorrerPaginas(cursor => clienteTikTokShop.lerVitrine(cursor), { maxPaginas })
    //     -> adaptarCatalogoDoTikTokShop(brutos)
    //     -> executarSincronizacaoDeCatalogo({ ..., paginacaoCompleta })
    resultados.push({
      workspaceId: integracao.workspaceId,
      sincronizado: false,
      capability,
      motivo:
        'Cliente HTTP assinado ainda não implementado — depende das credenciais reais para ser validado contra a ferramenta de teste do Partner Center.',
    })
  }

  return NextResponse.json({
    executadoEm: new Date().toISOString(),
    workspacesAvaliados: integracoes.length,
    resultados,
  })
}
