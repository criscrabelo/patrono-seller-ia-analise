import { NextResponse } from 'next/server'

/**
 * BLOQUEADA PARA PRODUÇÃO ATÉ REVISÃO JURÍDICA (02/10/2026).
 *
 * Esta rota buscava as imagens de produtos da Shopee chamando um endpoint
 * INTERNO do site (`shopee.com.br/api/v4/item/get`) e se apresentando como
 * navegador (User-Agent de Chrome, `Referer` e cabeçalhos do site). Não é
 * API oficial nem de afiliados: é coleta automatizada por um fluxo que a
 * plataforma não oferece a integradores, e que pode violar os termos dela.
 *
 * Além disso, as imagens obtidas assim são fotos do vendedor — sem direito
 * de uso para publicação (ver lib/evidencia-de-midia.ts). O ganho era nulo e
 * o risco, real.
 *
 * Nenhuma tela chamava esta rota. Ela responde 403 a qualquer pedido, sem
 * chave de reativação no ambiente: voltar a funcionar exige mudança de
 * código revisada. O código anterior continua no histórico do git.
 */
const BLOQUEIO = {
  error:
    'A importação automática de imagens da Shopee está desativada: usava um endpoint não oficial da plataforma. Use a mídia do programa de afiliados ou envie a sua própria.',
  bloqueio: 'INTEGRACAO_NAO_OFICIAL_BLOQUEADA',
} as const

export async function POST() {
  return NextResponse.json(BLOQUEIO, { status: 403 })
}

export async function GET() {
  return NextResponse.json(BLOQUEIO, { status: 403 })
}
