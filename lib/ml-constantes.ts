/**
 * Constantes do ML que módulos de LEITURA precisam conhecer.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE ─────────────────────────────────────────
 * `lib/ml-engine.ts` precisava apenas do nome da família de modelo, e o
 * importava de `lib/ml-training-pipeline.ts`. Um import de constante é um
 * import de módulo: bastava isso para o pipeline de TREINO entrar no grafo
 * de qualquer coisa que usasse o engine — inclusive do cron diário de
 * oportunidades.
 *
 * Nada era treinado por causa disso: `treinarModeloConversao` nunca é
 * chamada de lá. Mas a fronteira ficava indefensável — não dava para
 * escrever "o cron não alcança o treino" como invariante verificável, e
 * invariante que não dá para verificar é promessa.
 *
 * Com a constante aqui, quem só lê não carrega quem treina.
 *
 * Este arquivo é puro e sem import, de propósito.
 */

/**
 * Família do modelo de probabilidade de conversão.
 *
 * Identifica o modelo no registry e nas amostras. Mudar este valor
 * desgarra o histórico do modelo em produção — é chave, não rótulo.
 */
export const CONVERSION_MODEL_FAMILY = 'conversion_probability'
