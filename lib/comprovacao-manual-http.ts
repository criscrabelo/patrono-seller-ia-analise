/**
 * Tradução do resultado da comprovação manual para HTTP.
 *
 * Separada da rota de propósito: é a única decisão que a rota toma, e
 * decisão precisa ser testável sem subir servidor nem mockar sessão.
 *
 * Isto NÃO é a regra de promoção. Quem decide se a venda pode ser
 * comprovada é `promoverPorCorrecaoManual()`; aqui só se escolhe o código
 * de status que corresponde ao que ela respondeu.
 */

import type { ResultadoDaPromocao } from './promocao-operacao-real'

export interface RespostaHttp {
  status: number
  /** `true` quando a resposta é de sucesso (promovida ou reenvio idempotente). */
  ok: boolean
  motivo: string | null
}

export function respostaHttpDaComprovacao(resultado: ResultadoDaPromocao): RespostaHttp {
  // Venda de outro workspace chega aqui como VENDA_NAO_ENCONTRADA, e é
  // devolvida como 404 — indistinguível de uma venda que não existe.
  // Responder 403 confirmaria que ela existe em algum lugar.
  if (resultado?.motivo === 'VENDA_NAO_ENCONTRADA') {
    return { status: 404, ok: false, motivo: 'VENDA_NAO_ENCONTRADA' }
  }

  // Reenvio da mesma comprovação não é erro: é a idempotência funcionando.
  if (resultado?.promovido || resultado?.idempotente) {
    return { status: 200, ok: true, motivo: null }
  }

  // Recusa por regra de negócio — motivo ausente, motivo curto, referência
  // vazia, origem sintética, responsável inválido, já era real.
  return { status: 422, ok: false, motivo: resultado?.motivo ?? null }
}
