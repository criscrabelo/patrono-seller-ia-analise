import { NextResponse } from 'next/server'
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

/**
 * P1.5.2 — recomprova a conexão que já existe, sem pedir nada à usuária.
 *
 * O problema que isto resolve: uma conta conectada ANTES da P1.5.1 não tem
 * escopo comprovado, e a única saída seria desconectar e reconectar colando
 * o token de novo — ou alguém editar o banco à mão, que é exatamente o que
 * a rodada proíbe.
 *
 * Aqui o Patrono pergunta à Meta sobre o token que já está guardado, com as
 * MESMAS chamadas oficiais do fluxo de conexão (`validarCredenciais` e
 * `debug_token`), e atualiza sozinho: nome da conta, validade, escopos
 * comprovados e o instante da comprovação. Nenhum endpoint novo, nenhuma
 * postagem, nenhum dado inventado.
 */
export async function POST() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const workspaceId = session.user.workspaceId
  const integracao = await prisma.integracao.findUnique({
    where: { workspaceId_plataforma: { workspaceId, plataforma: 'instagram' } },
  })

  if (!integracao?.accessToken || !integracao.accountId) {
    return NextResponse.json(
      { error: 'Instagram não conectado, ou sem o ID da conta.' },
      { status: 400 }
    )
  }

  const extra = (integracao.extraData ?? {}) as Prisma.InputJsonObject & Record<string, unknown>

  // 1. O token ainda funciona? Se não, não adianta comprovar escopo nenhum.
  let nomeDaConta = integracao.accountName
  try {
    const { username } = await validarCredenciaisInstagram({
      accessToken: integracao.accessToken,
      igUserId: integracao.accountId,
    })
    if (username) nomeDaConta = `@${username}`
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Token inválido'
    // Recusado pela Meta: a conexão deixa de valer, e a comprovação antiga
    // some junto. Manter o escopo comprovado aqui seria afirmar permissão
    // de um token que a plataforma já recusou.
    delete extra[CAMPO_DOS_SCOPES]
    delete extra[CAMPO_DA_COMPROVACAO]
    await prisma.integracao.update({
      where: { id: integracao.id },
      data: { status: 'desconectado', extraData: extra, updatedAt: new Date() },
    })
    return NextResponse.json(
      { error: `O Instagram recusou as credenciais guardadas: ${msg}. Reconecte a conta.` },
      { status: 400 }
    )
  }

  // 2. O que a Meta afirma sobre este token: validade e permissões.
  const inspecao = await inspecionarTokenMeta({
    accessToken: integracao.accessToken,
    appId: typeof extra.appId === 'string' ? extra.appId : undefined,
    appSecret: typeof extra.appSecret === 'string' ? extra.appSecret : undefined,
  })

  if (inspecao.scopes) {
    extra[CAMPO_DOS_SCOPES] = inspecao.scopes
    extra[CAMPO_DA_COMPROVACAO] = new Date().toISOString()
  } else {
    delete extra[CAMPO_DOS_SCOPES]
    delete extra[CAMPO_DA_COMPROVACAO]
  }

  await prisma.integracao.update({
    where: { id: integracao.id },
    data: {
      accountName: nomeDaConta,
      status: 'conectado',
      extraData: extra,
      // P2.68: sem prazo confirmado pela Meta apaga a data presumida (antes ficava a estimativa de 59 dias).
      ...(inspecao.semPrazo ? { tokenExpiry: null } : (inspecao.expiraEm ?? inspecao.dataAccessExpiraEm) ? { tokenExpiry: inspecao.expiraEm ?? inspecao.dataAccessExpiraEm } : {}),
      updatedAt: new Date(),
    },
  })

  await registrarAuditoria({
    workspaceId,
    userId: session.user.id,
    action: 'integracao.revalidada',
    entityType: 'Integracao',
    entityId: integracao.id,
    // Quantos, não quais valores sensíveis — e nunca o token.
    metadata: { plataforma: 'instagram', escoposComprovados: inspecao.scopes?.length ?? 0 },
  })

  const autorizacao = await lerAutorizacao({ workspaceId, canal: 'instagram' })
  return NextResponse.json({
    ok: true,
    // `motivo` explica o que a Meta respondeu — sem token, sem header.
    motivo: inspecao.motivo,
    autorizacao: resumoPublicoDaIntegracao(autorizacao),
    preflight: await preflightDePublicacao({ workspaceId, canal: 'instagram' }),
  })
}
