import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { desconectarCriadora } from '@/lib/tiktok-shop-oauth'

/** P2.17 — Apaga os tokens da criadora do nosso lado (o cofre não guarda mais nada). */
export async function POST() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session
  const desconectou = await desconectarCriadora({ workspaceId: session.user.workspaceId, userId: session.user.id })
  return NextResponse.json({ desconectado: desconectou })
}
