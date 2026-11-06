/**
 * P2.11 — Fluxos sem mecanismo de transferência internacional.
 *
 * A P2.10 concluiu que o envio de WhatsApp (números e mensagem de
 * TERCEIROS, que não são parte do contrato com a usuária) não tem
 * mecanismo do art. 33 da LGPD que o sustente nas hospedagens de produção
 * (Netlify e Vercel, ambas com funções nos EUA). Enquanto não houver, o
 * envio NÃO RODA EM NENHUMA HOSPEDAGEM DE PRODUÇÃO.
 *
 * A trava é FAIL-CLOSED: o envio só roda em ambiente LOCAL/TESTE
 * reconhecido explicitamente — `NODE_ENV` declarado como `development` ou
 * `test` E nenhum sinal de plataforma ou nuvem. Qualquer sinal de
 * hospedagem vence: `NODE_ENV=test` num deploy não libera nada.
 *
 * Não existe variável de liberação. Reabrir o envio em produção é mudança
 * deliberada de código, feita depois de existir mecanismo jurídico — nunca
 * um ajuste de painel.
 */

export type Hospedagem = 'netlify' | 'vercel' | 'local' | 'desconhecida'

type Env = Record<string, string | undefined>

function temSinalDaNetlify(env: Env): boolean {
  return (
    env.NETLIFY === 'true' ||
    !!env.NETLIFY_DEV ||
    !!env.NETLIFY_BLOBS_CONTEXT ||
    // Só a Netlify recebe esta variável (P2.2, lib/trabalho-longo.ts).
    env.TRABALHO_LONGO_MODO === 'segundo-plano' ||
    (!!env.CONTEXT && !env.VERCEL_ENV) ||
    (!!env.SITE_ID && !!env.DEPLOY_ID)
  )
}

function temSinalDaVercel(env: Env): boolean {
  return !!env.VERCEL_ENV || env.VERCEL === '1' || !!env.VERCEL_URL || !!env.VERCEL_REGION
}

/** Qualquer outra nuvem ou contêiner gerenciado: nunca é "local". */
function temSinalDeOutraNuvem(env: Env): boolean {
  return [
    'AWS_LAMBDA_FUNCTION_NAME',
    'LAMBDA_TASK_ROOT',
    'AWS_EXECUTION_ENV',
    'K_SERVICE', // Cloud Run
    'FUNCTION_TARGET', // Cloud Functions
    'WEBSITE_SITE_NAME', // Azure
    'RENDER',
    'RAILWAY_ENVIRONMENT',
    'FLY_APP_NAME',
    'DYNO', // Heroku
    'KUBERNETES_SERVICE_HOST',
    'CONTEXT',
    'SITE_ID',
    'DEPLOY_ID',
  ].some((k) => !!env[k])
}

export function hospedagemAtual(env: Env = process.env): Hospedagem {
  if (temSinalDaNetlify(env)) return 'netlify'
  if (temSinalDaVercel(env)) return 'vercel'
  if (temSinalDeOutraNuvem(env)) return 'desconhecida'
  // Local só por declaração explícita: NODE_ENV ausente não conta.
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return 'local'
  return 'desconhecida'
}

export const CODIGO_WHATSAPP_BLOQUEADO = 'WHATSAPP_BLOQUEADO_NA_HOSPEDAGEM'

export const MOTIVO_WHATSAPP_BLOQUEADO =
  'O envio de mensagens de WhatsApp está indisponível: ele trata dados de terceiros ' +
  'e ainda não há mecanismo de transferência internacional aplicável (LGPD, art. 33).'

/** Só testes controlados em máquina local. Nenhuma hospedagem de produção. */
const HOSPEDAGENS_COM_WHATSAPP: readonly Hospedagem[] = ['local']

export function envioDeWhatsappPermitido(env: Env = process.env): { permitido: boolean; hospedagem: Hospedagem; motivo: string } {
  const hospedagem = hospedagemAtual(env)
  const permitido = HOSPEDAGENS_COM_WHATSAPP.includes(hospedagem)
  return { permitido, hospedagem, motivo: permitido ? '' : MOTIVO_WHATSAPP_BLOQUEADO }
}
