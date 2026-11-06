import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { validarCredenciaisInstagram, inspecionarTokenMeta } from '@/lib/instagram'
import { registrarAuditoria } from '@/lib/audit-log'
import {
  lerAutorizacao,
  resumoPublicoDaIntegracao,
  CAMPO_DOS_SCOPES,
  CAMPO_DA_COMPROVACAO,
} from '@/lib/autorizacao-da-conta'
import { preflightDePublicacao } from '@/lib/preflight-de-publicacao'
import { z } from 'zod'
import { PLATAFORMAS_TIKTOK_SHOP } from '@/lib/tiktok-shop-evidencia'
import { lerCredenciaisOAuthTikTok, revogarTokenTikTok } from '@/lib/tiktok-oauth'

/**
 * P1.5.1 — nenhuma destas respostas carrega segredo.
 *
 * Antes desta rodada, `GET` devolvia a linha inteira de `Integracao` — com
 * `accessToken`, `refreshToken` e, no caso do Instagram, o `appSecret` da
 * Meta guardado em `extraData`. A tela nunca precisou de nada disso: ela lê
 * plataforma, status, conta e validade. Agora é `resumoPublicoDaIntegracao`
 * que define o que sai, por lista branca.
 */
async function resumoDoWorkspace(workspaceId: string) {
  const integracoes = await prisma.integracao.findMany({
    where: { workspaceId },
    select: { plataforma: true, status: true, accountId: true, accountName: true, tokenExpiry: true },
  })

  return Promise.all(
    integracoes.map(async (i) => {
      const autorizacao = await lerAutorizacao({ workspaceId, canal: i.plataforma })
      return {
        // O que a tela de integrações já consumia.
        plataforma: i.plataforma,
        status: i.status,
        accountId: i.accountId,
        accountName: i.accountName,
        tokenExpiry: i.tokenExpiry,
        // O que a P1.5.1 acrescenta: o que esta conta REALMENTE autorizou.
        autorizacao: resumoPublicoDaIntegracao(autorizacao),
        // O que a P1.5.2 acrescenta: por que ainda não publica, em uma frase.
        preflight: await preflightDePublicacao({ workspaceId, canal: i.plataforma }),
      }
    })
  )
}

export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  return NextResponse.json(await resumoDoWorkspace(session.user.workspaceId))
}

/** P2.15.3: só os canais da tela de Integrações; corpo inválido = 400 (antes, 500). */
const CorpoDaConexao = z.object({
  plataforma: z.string().regex(/^[a-z][a-z-]{1,30}$/),
  accessToken: z.string().max(4000).optional(),
  accountId: z.string().max(200).optional(),
  accountName: z.string().max(200).optional(),
  extraData: z.record(z.unknown()).optional(),
})

export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const lido = CorpoDaConexao.safeParse(await req.json().catch(() => null))
  if (!lido.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  const body = lido.data
  // P2.15.3: TikTok Shop só conecta pelo fluxo oficial (OAuth). Gravar "conectado"
  // por aqui fabricaria evidência e tiraria da fila um item que exige conexão real.
  if ((PLATAFORMAS_TIKTOK_SHOP as readonly string[]).includes(body.plataforma))
    return NextResponse.json({ error: 'O TikTok Shop só pode ser conectado pela autorização oficial do TikTok.' }, { status: 403 })
  // P2.17.10: o TikTok (publicação) também — token colado à mão não comprova escopo nem conta.
  if (body.plataforma === 'tiktok')
    return NextResponse.json({ error: 'O TikTok só pode ser conectado pela autorização oficial (Integrações → Conectar TikTok).' }, { status: 403 })
  const { plataforma, accessToken, accountId } = body
  let { accountName } = body
  const extraData = (body.extraData ?? {}) as Prisma.InputJsonObject & Record<string, unknown>

  let tokenExpiry: Date | null | undefined

  if (plataforma === 'instagram' && accessToken) {
    // Confere com a Meta se o token realmente funciona ANTES de salvar como
    // conectado — senão a tela mostraria "conectado / válido por 59d" para um
    // token morto, e a falha só apareceria na hora de publicar.
    if (!accountId) {
      return NextResponse.json(
        { error: 'Informe o Instagram Business Account ID (ou Instagram User ID).' },
        { status: 400 }
      )
    }
    try {
      const { username } = await validarCredenciaisInstagram({ accessToken, igUserId: accountId })
      if (username && !accountName) accountName = `@${username}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Token inválido'
      return NextResponse.json(
        {
          error:
            `O Instagram recusou essas credenciais: ${msg}. ` +
            'Confira se o token é de longa duração (não o de 1 hora) e se o ID da conta está correto.',
        },
        { status: 400 }
      )
    }

    // P1.5.1: a MESMA chamada oficial que já descobria a validade também diz
    // quais permissões a conta concedeu. Guardar isso agora é o que permite
    // comprovar o escopo depois, em vez de assumi-lo por causa do token.
    const inspecao = await inspecionarTokenMeta({
      accessToken,
      appId: typeof extraData.appId === 'string' ? extraData.appId : undefined,
      appSecret: typeof extraData.appSecret === 'string' ? extraData.appSecret : undefined,
    })
    // P2.68: token que a Meta confirma SEM PRAZO fica sem data (null), nunca com 59 dias presumidos.
    tokenExpiry = inspecao.semPrazo ? null : inspecao.expiraEm ?? inspecao.dataAccessExpiraEm ?? new Date(Date.now() + 59 * 24 * 60 * 60 * 1000)

    if (inspecao.scopes) {
      extraData[CAMPO_DOS_SCOPES] = inspecao.scopes
      extraData[CAMPO_DA_COMPROVACAO] = new Date().toISOString()
    } else {
      // Não conseguimos comprovar: apaga qualquer comprovação antiga em vez
      // de deixá-la valer para um token que talvez seja outro.
      delete extraData[CAMPO_DOS_SCOPES]
      delete extraData[CAMPO_DA_COMPROVACAO]
    }
  }

  const integracao = await prisma.integracao.upsert({
    where: { workspaceId_plataforma: { workspaceId: session.user.workspaceId, plataforma } },
    update: { accessToken, accountId, accountName, extraData, status: 'conectado', tokenExpiry, updatedAt: new Date() },
    create: { userId: session.user.id, workspaceId: session.user.workspaceId, plataforma, accessToken, accountId, accountName, extraData, status: 'conectado', tokenExpiry },
  })

  await registrarAuditoria({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    action: 'integracao.conectada',
    entityType: 'Integracao',
    entityId: integracao.id,
    metadata: { plataforma },
  })

  const autorizacao = await lerAutorizacao({ workspaceId: session.user.workspaceId, canal: plataforma })
  return NextResponse.json({
    plataforma: integracao.plataforma,
    status: integracao.status,
    accountId: integracao.accountId,
    accountName: integracao.accountName,
    tokenExpiry: integracao.tokenExpiry,
    autorizacao: resumoPublicoDaIntegracao(autorizacao),
  })
}

export async function DELETE(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const { searchParams } = new URL(req.url)
  const plataforma = searchParams.get('plataforma')
  if (!plataforma) return NextResponse.json({ error: 'Plataforma obrigatória' }, { status: 400 })

  // P2.17.26: no TikTok, revoga também a autorização na plataforma (best-effort; os tokens são apagados aqui de qualquer jeito).
  let revogadoNoTikTok: boolean | null = null
  if (plataforma === 'tiktok') {
    const creds = lerCredenciaisOAuthTikTok()
    const atual = await prisma.integracao.findUnique({ where: { workspaceId_plataforma: { workspaceId: session.user.workspaceId, plataforma } }, select: { accessToken: true } })
    if (creds && atual?.accessToken) revogadoNoTikTok = await revogarTokenTikTok(creds, atual.accessToken)
  }
  await prisma.integracao.updateMany({
    where: { workspaceId: session.user.workspaceId, plataforma },
    data: { status: 'desconectado', accessToken: null, refreshToken: null, accountId: null, accountName: null },
  })
  if (revogadoNoTikTok !== null) await registrarAuditoria({ workspaceId: session.user.workspaceId, userId: session.user.id, action: 'tiktok.autorizacao_revogada', entityType: 'Integracao', entityId: session.user.workspaceId, metadata: { revogadoNoTikTok } })

  return NextResponse.json({ success: true })
}
