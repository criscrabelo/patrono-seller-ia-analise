/**
 * Assinatura de requisição da TikTok Shop Open API (Rodada 11).
 *
 * Toda chamada à Open API precisa do parâmetro `sign`. Sem ele, nenhum
 * endpoint oficial responde — é a peça que faltava para o Patrono conseguir
 * ler a Vitrine/Showcase por via oficial (nada de scraping, navegador ou
 * endpoint não documentado).
 *
 * Algoritmo implementado, conforme "Sign your API request" do TikTok Shop
 * Partner Center:
 *
 *   1. pegar todos os parâmetros de query, EXCETO `sign` e `access_token`
 *   2. ordenar as chaves alfabeticamente
 *   3. concatenar `{chave}{valor}` na ordem
 *   4. prefixar com o PATH da requisição
 *   5. se o método não for GET e o content-type não for multipart/form-data,
 *      anexar o corpo BRUTO da requisição
 *   6. envelopar: `app_secret + <string> + app_secret`
 *   7. HMAC-SHA256 com `app_secret` como chave, saída em hex minúsculo
 *
 * ⚠️ CONFIANÇA: MÉDIA. A página oficial do Partner Center é renderizada por
 * JavaScript e não pôde ser lida diretamente nesta rodada — o algoritmo veio
 * de resumo de busca sobre essa documentação. Por isso este módulo é PURO e
 * coberto por vetores fixos: quando as credenciais chegarem, basta conferir
 * contra a ferramenta de teste do Partner Center. NÃO trate como verificado
 * até essa conferência. (Mesma disciplina de
 * `AFFILIATE_PROVIDER_CAPABILITIES`: `sourceType`/`confidence` explícitos.)
 *
 * Este módulo não faz requisição nenhuma e não conhece `fetch` — só devolve
 * a assinatura. O cliente HTTP é o item 3 do plano, que depende de
 * credenciais reais e ainda não foi implementado.
 */

import { createHmac } from 'crypto'

/** Parâmetros que NUNCA entram no cálculo da assinatura. */
const PARAMETROS_EXCLUIDOS = new Set(['sign', 'access_token'])

export interface EntradaAssinatura {
  /** Caminho da requisição, ex.: `/affiliate_creator/202405/showcase/products`. */
  path: string
  /** Query string já resolvida (sem `sign`). Valores são usados como texto. */
  query: Record<string, string | number | boolean | undefined | null>
  /** Método HTTP. GET não assina corpo. */
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /**
   * Corpo BRUTO, exatamente como vai no wire. Reserializar o JSON depois de
   * assinar invalida a assinatura — por isso recebemos a string, nunca um
   * objeto para serializar aqui dentro.
   */
  corpoBruto?: string
  /** `true` quando o envio é multipart — nesse caso o corpo não entra. */
  multipart?: boolean
}

/**
 * Monta a string canônica que será assinada. Exposta separadamente porque é
 * o ponto onde erros de integração aparecem: comparar esta string com a do
 * Partner Center diz na hora se a divergência é de ordenação, de corpo ou de
 * parâmetro indevido.
 */
export function montarStringCanonica(entrada: EntradaAssinatura): string {
  const chaves = Object.keys(entrada.query)
    .filter((k) => !PARAMETROS_EXCLUIDOS.has(k))
    // Valor ausente não vira string "undefined": o parâmetro simplesmente
    // não foi enviado, então não pode entrar no cálculo.
    .filter((k) => entrada.query[k] !== undefined && entrada.query[k] !== null)
    .sort()

  const concatenado = chaves.map((k) => `${k}${String(entrada.query[k])}`).join('')

  const assinaCorpo = entrada.metodo !== 'GET' && !entrada.multipart && !!entrada.corpoBruto
  return `${entrada.path}${concatenado}${assinaCorpo ? entrada.corpoBruto : ''}`
}

/**
 * Assinatura final em hex minúsculo. `appSecret` nunca é logado nem
 * devolvido — só a assinatura sai daqui.
 */
export function assinarRequisicaoTikTokShop(entrada: EntradaAssinatura, appSecret: string): string {
  if (!appSecret) throw new Error('app_secret ausente — impossível assinar a requisição da TikTok Shop Open API.')

  const canonica = montarStringCanonica(entrada)
  const envelopada = `${appSecret}${canonica}${appSecret}`
  return createHmac('sha256', appSecret).update(envelopada, 'utf8').digest('hex')
}

/**
 * Query pronta para o wire: os parâmetros originais mais `sign`. O
 * `access_token` continua fora — ele viaja no header `x-tts-access-token`,
 * e incluí-lo aqui quebraria a assinatura.
 */
export function comAssinatura(
  entrada: EntradaAssinatura,
  appSecret: string
): Record<string, string> {
  const sign = assinarRequisicaoTikTokShop(entrada, appSecret)
  const saida: Record<string, string> = {}
  for (const [k, v] of Object.entries(entrada.query)) {
    if (v === undefined || v === null) continue
    if (PARAMETROS_EXCLUIDOS.has(k)) continue
    saida[k] = String(v)
  }
  saida.sign = sign
  return saida
}
