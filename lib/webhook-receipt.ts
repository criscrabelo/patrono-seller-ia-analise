/**
 * P2.14.7 (Fase 0A) — Dedupe persistente de webhooks.
 *
 * Um INSERT … ON CONFLICT DO NOTHING na tabela WebhookReceipt: a primeira
 * instância que gravar o (provider, eventoId) processa; todas as outras —
 * inclusive concorrentes em outra função serverless — veem duplicado.
 */
import type { WebhookIdempotencyStore } from './tiktok-webhook'
import { prisma } from './prisma'

export class WebhookReceiptStore implements WebhookIdempotencyStore {
  constructor(private readonly provider: string) {}

  async reivindicar(eventId: string): Promise<boolean> {
    const r = await prisma.webhookReceipt.createMany({ data: [{ provider: this.provider, eventoId: eventId }], skipDuplicates: true })
    return r.count === 1
  }

  async jaProcessado(eventId: string): Promise<boolean> {
    const linha = await prisma.webhookReceipt.findUnique({ where: { provider_eventoId: { provider: this.provider, eventoId: eventId } }, select: { id: true } })
    return !!linha
  }

  async marcarProcessado(eventId: string): Promise<void> {
    await this.reivindicar(eventId)
  }
}
