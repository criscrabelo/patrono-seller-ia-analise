/**
 * Proveniência de registro comercial (P0.2 — Bloco 1).
 *
 * ── O PROBLEMA ──────────────────────────────────────────────────────────
 * `Sale` só tinha `source` ('manual' | 'webhook'), que responde COMO a venda
 * entrou no sistema. Não respondia a pergunta que importa para o ML: ESTA
 * VENDA REPRESENTA OPERAÇÃO COMERCIAL REAL? Uma venda de teste registrada
 * pela tela também é 'manual'. Sem essa distinção, ligar o feature store
 * transformaria em REAL_OPERATION qualquer linha que existisse no banco,
 * incluindo as criadas para testar o próprio sistema.
 *
 * ── A REGRA ─────────────────────────────────────────────────────────────
 * A origem é DECLARADA por quem cria o registro, nunca inferida. Quem chama
 * `registrarResultado()` é obrigado a informar — não há valor padrão no
 * parâmetro, então esquecer não compila. O ônus fica em quem cria dado
 * sintético (seed, teste, demo), que é código nosso, e não na proprietária.
 *
 * ── POR QUE `UNVERIFIED` É O DEFAULT DO BANCO ───────────────────────────
 * Toda linha que já existe passou a valer como "origem não demonstrável".
 * Promover histórico a REAL_OPERATION por conveniência seria ensinar o ML
 * com dado de procedência duvidosa. Perder dado de treino é reversível;
 * modelo contaminado, não. Fail-closed.
 *
 * `UNVERIFIED` não pertence a `MLDataOrigin` de propósito: é um estado do
 * REGISTRO COMERCIAL ("ainda não classificado"), não uma origem de dado de
 * ML. Nada que esteja `UNVERIFIED` pode virar amostra de treino.
 */

import { ML_DATA_ORIGINS, type MLDataOrigin } from './ml-types'

/**
 * Estado de proveniência ainda não estabelecido. Nunca é elegível para ML,
 * nunca é promovido automaticamente, e só sai daqui por correção explícita
 * e auditada de quem tenha como demonstrar a origem.
 */
export const ORIGEM_NAO_VERIFICADA = 'UNVERIFIED' as const

/**
 * Registro relatado pela proprietária pela tela autenticada.
 *
 * ── POR QUE ESTE ESTADO PRECISOU EXISTIR ────────────────────────────────
 * Antes, as rotas autenticadas declaravam `REAL_OPERATION` direto. Mas
 * "veio da tela logada" prova apenas QUEM criou o registro — não prova que a
 * operação comercial aconteceu. Uma venda de treino digitada na tela de
 * verdade é indistinguível de uma venda real por esse critério, e entraria
 * no treino do modelo como se fosse receita.
 *
 * `USER_REPORTED` separa as duas perguntas:
 *   - origem do REGISTRO      → resolvida: foi a proprietária, autenticada;
 *   - EVIDÊNCIA de operação   → ainda não existe.
 *
 * Por isso `ehOperacaoReal('USER_REPORTED') === false`. É um relato de boa-fé,
 * suficiente para a contabilidade da proprietária e para as telas — e
 * insuficiente para ensinar o ML.
 */
export const ORIGEM_RELATADA_PELA_USUARIA = 'USER_REPORTED' as const

/**
 * EVIDÊNCIAS que poderiam promover um registro a `REAL_OPERATION`.
 *
 * Listadas aqui como contrato do que virá, NÃO implementadas nesta rodada:
 * a promoção é o Bloco 3 do P0.2. Enquanto ela não existir, NENHUM caminho
 * de código escreve `REAL_OPERATION` — o valor continua no vocabulário
 * porque é o que o ML consome, mas é inalcançável por rota.
 *
 *   1. confirmação vinda de provider/API/webhook oficial;
 *   2. conciliação financeira (extrato, repasse, fatura);
 *   3. comissão CONFIRMED/RECEIVED com origem verificável;
 *   4. correção manual excepcional e auditada.
 *
 * Note que 1, 3 e 4 já têm onde morar no banco de hoje — `Sale.source`,
 * `Commission.status` e `AuditLog` —, o que é justamente por que esta
 * separação não exigiu coluna nova.
 */
export const EVIDENCIAS_ACEITAS_PARA_OPERACAO_REAL = [
  'PROVIDER_OFICIAL',
  'CONCILIACAO_FINANCEIRA',
  'COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL',
  'CORRECAO_MANUAL_AUDITADA',
] as const

export type EvidenciaDeOperacaoReal = (typeof EVIDENCIAS_ACEITAS_PARA_OPERACAO_REAL)[number]

export const ORIGENS_DE_REGISTRO = [
  ...ML_DATA_ORIGINS,
  ORIGEM_RELATADA_PELA_USUARIA,
  ORIGEM_NAO_VERIFICADA,
] as const
export type OrigemDeRegistro = (typeof ORIGENS_DE_REGISTRO)[number]

export function ehOrigemDeRegistro(valor: unknown): valor is OrigemDeRegistro {
  return typeof valor === 'string' && (ORIGENS_DE_REGISTRO as readonly string[]).includes(valor)
}

/**
 * Normaliza o que veio do banco. Valor desconhecido, nulo ou corrompido vira
 * `UNVERIFIED` — nunca `REAL_OPERATION`. Um registro que não se consegue
 * classificar é, por definição, um registro cuja origem não foi demonstrada.
 */
export function normalizarOrigemDeRegistro(valor: unknown): OrigemDeRegistro {
  return ehOrigemDeRegistro(valor) ? valor : ORIGEM_NAO_VERIFICADA
}

/**
 * A única origem que pode alimentar treino/promoção de modelo de produção.
 *
 * Deliberadamente NÃO recebe "modo permissivo", "incluir demo" ou qualquer
 * parâmetro de afrouxamento: se um dia for preciso treinar com dado
 * sintético, isso é um caminho separado e explícito, não um booleano aqui.
 */
export function ehOperacaoReal(valor: unknown): boolean {
  return normalizarOrigemDeRegistro(valor) === 'REAL_OPERATION'
}

/**
 * Origens que uma ROTA pode declarar. `REAL_OPERATION` está fora de
 * propósito: nenhuma rota tem como provar operação comercial, e poder
 * declarar seria o mesmo que não ter a distinção.
 */
export const ORIGENS_DECLARAVEIS_POR_ROTA = [
  ORIGEM_RELATADA_PELA_USUARIA,
  ORIGEM_NAO_VERIFICADA,
] as const

export function podeSerDeclaradaPorRota(valor: unknown): boolean {
  return (ORIGENS_DECLARAVEIS_POR_ROTA as readonly string[]).includes(String(valor))
}

/**
 * Origens que PODEM ser promovidas a `REAL_OPERATION` mediante evidência.
 *
 * Mora aqui, no vocabulário, e não no módulo de promoção, por um motivo
 * prático: este arquivo é puro (só importa tipos) e pode ser usado também
 * na interface. Sem isso, a tela precisaria de uma cópia da lista — e duas
 * cópias da mesma regra divergem no dia seguinte.
 *
 * `lib/promocao-operacao-real.ts` reexporta esta constante; a regra em si
 * continua inteiramente lá.
 */
export const ORIGENS_PROMOVIVEIS = [ORIGEM_RELATADA_PELA_USUARIA, ORIGEM_NAO_VERIFICADA] as const

/**
 * A interface deve oferecer a comprovação manual para esta venda?
 *
 * ── SÓ UX, NUNCA SEGURANÇA ──────────────────────────────────────────────
 * Esconder o botão não autoriza nada: quem decide é o servidor, e a rota
 * recusa do mesmo jeito se alguém chamar direto. Isto existe para não
 * oferecer uma ação que não pode dar certo.
 *
 * ── NA DÚVIDA, ESCONDE ──────────────────────────────────────────────────
 * Diferente de `normalizarOrigemDeRegistro()`, que trata valor ilegível
 * como `UNVERIFIED`, aqui valor ausente ou desconhecido devolve `false`.
 * A assimetria é deliberada e conservadora: o pior caso é esconder uma
 * ação possível num registro corrompido, nunca oferecer uma impossível.
 */
export function podeComprovarManualmente(dataOrigin: unknown): boolean {
  return typeof dataOrigin === 'string' && (ORIGENS_PROMOVIVEIS as readonly string[]).includes(dataOrigin)
}

/** Só para relatório/UI — nunca para decisão. */
export const DESCRICAO_DA_ORIGEM: Record<OrigemDeRegistro, string> = {
  REAL_OPERATION: 'Operação comercial real COMPROVADA por evidência externa (provider, conciliação ou correção auditada). Nenhuma rota pode declarar esta origem — ela só é atingida por promoção com evidência.',
  USER_REPORTED: 'Relatado pela proprietária pela tela autenticada. A origem do registro é conhecida; a operação comercial ainda NÃO foi comprovada. Vale para a contabilidade dela e para as telas — nunca para treinar o ML.',
  TEST_FIXTURE: 'Dado criado por teste automatizado.',
  DEMO: 'Dado criado para demonstração do sistema.',
  SEED: 'Dado criado por script de carga inicial.',
  SYNTHETIC_TEST: 'Dado sintético gerado para validar o motor tecnicamente.',
  UNVERIFIED: 'Origem não demonstrável — registro anterior à exigência de proveniência, ou criado sem declaração. Nunca conta como operação real.',
}

export type { MLDataOrigin }
