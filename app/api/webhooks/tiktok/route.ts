import { NextRequest, NextResponse } from 'next/server'
import {
  processarWebhookTikTok,
  lerCabecalhoDeAssinatura,
  TAMANHO_MAXIMO_DO_CORPO,
} from '@/lib/tiktok-webhook'
import { WebhookReceiptStore } from '@/lib/webhook-receipt'
import { aplicarEventoDoWebhook } from '@/lib/tiktok-acompanhamento'

// P2.14.7: dedupe PERSISTENTE (tabela WebhookReceipt) — sobrevive a
// reinício e vale entre instâncias serverless (antes era um Set em memória).
const store = new WebhookReceiptStore('tiktok')

/**
 * Rota PÚBLICA (exceção exata no middleware): quem chama é o servidor do
 * TikTok, sem sessão. Por isso toda recusa acontece aqui, nesta ordem, e
 * NENHUMA RECUSA grava nada:
 *   1. app sem segredo configurado → recusa;
 *   2. cabeçalho `Tiktok-Signature` ausente ou fora do formato oficial →
 *      recusa ANTES de ler o corpo;
 *   3. corpo maior que o limite → recusa;
 *   4. assinatura, janela de tempo e JSON (lib/tiktok-webhook.ts).
 * Só um evento com assinatura VÁLIDA e dentro da janela grava — e apenas o
 * recibo de dedupe (provider + id do evento, sem payload), uma vez.
 */
export async function POST(req: NextRequest) {
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET
  if (!clientSecret) {
    return NextResponse.json({ error: 'TikTok não configurado.' }, { status: 400 })
  }

  const cabecalho = lerCabecalhoDeAssinatura(req.headers.get('tiktok-signature'))
  if (!cabecalho) {
    return NextResponse.json({ error: 'Assinatura ausente ou fora do formato oficial.' }, { status: 401 })
  }

  const declarado = Number(req.headers.get('content-length') ?? 0)
  if (declarado > TAMANHO_MAXIMO_DO_CORPO) {
    return NextResponse.json({ error: 'Corpo grande demais.' }, { status: 413 })
  }
  const corpoCru = await req.text()
  if (Buffer.byteLength(corpoCru) > TAMANHO_MAXIMO_DO_CORPO) {
    return NextResponse.json({ error: 'Corpo grande demais.' }, { status: 413 })
  }

  const resultado = await processarWebhookTikTok({
    corpoCru,
    timestampHeader: cabecalho.timestamp,
    assinaturaHeader: cabecalho.assinatura,
    clientSecret,
    store,
  })

  if (!resultado.aceito) {
    return NextResponse.json({ error: resultado.motivo }, { status: 401 })
  }
  // P2.17.10: evento de publicação (post.publish.*) atualiza a publicação
  // correspondente. Já autenticado e deduplicado acima; falha aqui não
  // devolve erro ao TikTok (o acompanhamento por status cobre).
  if (!resultado.duplicado) {
    try {
      await aplicarEventoDoWebhook(JSON.parse(corpoCru))
    } catch (e) {
      console.error('[webhook/tiktok] evento não aplicado:', e instanceof Error ? e.message : String(e))
    }
  }
  return NextResponse.json({ ok: true, duplicado: resultado.duplicado })
}
