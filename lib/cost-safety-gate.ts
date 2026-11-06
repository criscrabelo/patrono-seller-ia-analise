/**
 * CostSafetyGate — guardião de CUSTO ZERO POR PADRÃO (Rodada 14, P0.1).
 *
 * MOTIVO: a auditoria encontrou quatro integrações que podem gerar cobrança
 * (fal.ai, Anthropic, Resend, Z-API) e NENHUMA verificação de política antes
 * de chamar. O `AI_MONTHLY_BUDGET` estava documentado como teto de custo mas
 * não era lido em lugar nenhum do código. Na prática, quem tivesse a chave
 * configurada gastava sem limite — a única barreira era a ausência da
 * variável de ambiente, que é acidente, não política.
 *
 * O risco cresce na mesma proporção que a autonomia: um Revenue Autopilot que
 * decide "gerar mais conteúdo" chamaria fal.ai em laço, sem teto.
 *
 * ── PRINCÍPIO ──────────────────────────────────────────────────────────
 * Não é um sistema que gasta até bater num teto. É um sistema que NÃO PODE
 * gastar nada por padrão. Liberar é ato deliberado da proprietária.
 *
 * DUAS CHAVES SIMULTÂNEAS para qualquer chamada paga:
 *   PAID_AI_ENABLED=true   E   AI_MONTHLY_BUDGET > 0
 * Só uma delas não libera nada. Um `AI_MONTHLY_BUDGET=50` esquecido num .env
 * de teste não pode virar autorização que ninguém concedeu.
 *
 * ── FAIL-CLOSED EM TUDO ────────────────────────────────────────────────
 * Variável ausente → bloqueado. Provedor desconhecido → bloqueado. Política
 * ilegível → bloqueado. É o oposto do `db-resiliencia`, onde o desconhecido é
 * fatal e para o processo; aqui o desconhecido é simplesmente NEGADO.
 *
 * ── SOBERANIA ──────────────────────────────────────────────────────────
 * Não existe parâmetro de "forçar", "ignorar" ou "prioridade". ML, worker,
 * cron, provider e Autopilot não têm como argumentar com este gate. Mesmo
 * que um modelo decida "gere 500 vídeos", a resposta continua sendo a
 * política. Só as variáveis de ambiente mudam isso.
 *
 * As funções de DECISÃO (`lerPoliticaDeCusto`, `avaliarCusto`) são puras:
 * recebem política e gasto acumulado, não consultam banco. É o que torna
 * "variável ausente", "orçamento estourado" e "workspace A ≠ workspace B"
 * testáveis sem tocar em nada externo.
 *
 * `guardarChamadaPaga()` é o único ponto impuro — ele orquestra decisão,
 * fallback e auditoria. Existe para que os call sites NÃO espalhem `if` de
 * política: cada integração paga chama uma função só.
 */

export type ProvedorPago = 'fal.ai' | 'anthropic' | 'resend' | 'z-api' | 'runway' | 'google-veo' | 'luma' | 'simulado-teste'

/** Catálogo explícito. O que não está aqui é desconhecido — e negado. */
export const PROVEDORES_PAGOS: Record<ProvedorPago, { descricao: string; unidade: string }> = {
  'fal.ai': { descricao: 'Geração de vídeo por IA (Kling)', unidade: 'por vídeo' },
  anthropic: { descricao: 'Geração de texto/roteiro por IA', unidade: 'por token' },
  resend: { descricao: 'Envio de e-mail transacional', unidade: 'por e-mail acima do free tier' },
  'z-api': { descricao: 'Envio de WhatsApp', unidade: 'por instância/mensagem' },
  // P2.42 — vídeo profissional sob demanda (lib/video-pro). Catalogar NÃO libera nada: continuam as duas chaves de
  // ambiente, a política do workspace e o limite por execução. 'simulado-teste' é o mock do TESTE (nunca vai à rede):
  // existe para exercitar o caminho de custo inteiro sem gastar.
  runway: { descricao: 'Geração/transformação de vídeo por IA (Runway API)', unidade: 'por segundo gerado' },
  'google-veo': { descricao: 'Geração de vídeo por IA (Google Veo)', unidade: 'por segundo gerado' },
  luma: { descricao: 'Edição/reenquadramento de vídeo por IA (Luma API)', unidade: 'por segundo gerado' },
  'simulado-teste': { descricao: 'Provedor de vídeo SIMULADO (só TESTE, sem rede, R$ 0)', unidade: 'por segundo gerado (fictício)' },
}

export function ehProvedorPagoConhecido(provider: string): provider is ProvedorPago {
  return Object.prototype.hasOwnProperty.call(PROVEDORES_PAGOS, provider)
}

/**
 * TABELA DE CUSTO ESTIMADO — conservadora e central (revisão do P0.1).
 *
 * Sem estimativa, `custoEstimado: null` bloqueava SEMPRE: nem com as duas
 * chaves ligadas a operação passaria. Fail-closed é correto, mas um gate que
 * nunca libera não é política, é interruptor quebrado.
 *
 * Os valores abaixo NÃO são preço oficial de tabela de nenhum fornecedor —
 * são TETOS conservadores, deliberadamente altos, usados só para reservar
 * saldo antes da chamada. Operação sem entrada aqui continua bloqueada.
 *
 * Atualizar preço se faz só neste lugar. Se um fornecedor publicar preço
 * oficial, substitua o teto e registre a fonte no comentário da linha.
 */
export const CUSTO_ESTIMADO_BRL: Record<string, number> = {
  // ── fal.ai: TODA submissao que cria trabalho novo cobra ──
  // Kling v3 pro image-to-video. Teto alto de proposito: e a operacao mais
  // cara do projeto e a mais facil de disparar em laco.
  'fal.ai:gerar-video': 5.0,
  // Composicao de clipes no fal.ai. Existe alternativa local gratuita
  // (concat-video.concatVideos), entao o bloqueio aqui quase nunca custa nada.
  'fal.ai:compor-video': 2.0,
  // Legenda queimada via VEED no fal.ai.
  'fal.ai:adicionar-legenda': 1.0,

  // ── Anthropic: por token. Teto POR CHAMADA, nao por token ──
  // O tamanho exato so se conhece depois da resposta, e depois e tarde.
  'anthropic:gerar-roteiro': 0.5,
  'anthropic:gerar-video-seller': 0.5,
  'anthropic:analisar-compliance': 0.2,

  // ── SEM ESTIMATIVA, DE PROPOSITO ──
  // `resend:enviar-email` e `z-api:enviar-whatsapp` NAO aparecem aqui.
  //
  // As duas operacoes rodam sem contexto de workspace (recuperacao de senha,
  // notificacao de sistema), e sem workspace nao ha como apurar o gasto do
  // mes - o gate bloqueia de qualquer forma. Manter uma estimativa daria a
  // falsa impressao de que basta ligar as duas chaves para libera-las.
  //
  // Elas so poderao ser autorizadas quando existir uma politica explicita de
  // custo de PLATAFORMA (orcamento do sistema, nao de um negocio). Ate la,
  // ficam deliberadamente bloqueadas e registradas na Automation Queue.
}

/**
 * `null` quando não há estimativa confiável — e `null` BLOQUEIA. Nunca
 * devolve 0: inventar custo zero para operação desconhecida é exatamente
 * como não ter teto.
 */
export function estimarCusto(provider: string, operacao: string): number | null {
  const valor = CUSTO_ESTIMADO_BRL[`${provider}:${operacao}`]
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? valor : null
}

export interface PoliticaDeCusto {
  /** `PAID_AI_ENABLED === 'true'`. Qualquer outro valor é `false`. */
  pagoHabilitado: boolean
  /** `AI_MONTHLY_BUDGET`. Ausente, inválido, negativo ou SEM AUTORIZAÇÃO vira 0. */
  orcamentoMensal: number
  /** P2.53: autorização registrada da titular (quem + validade). */
  autorizacao?: AutorizacaoDeOrcamento
  /** P2.53: valor que estava no ambiente, ignorado por falta de autorização. */
  orcamentoInformadoSemAutorizacao?: number
}

export const POLITICA_PADRAO: PoliticaDeCusto = {
  pagoHabilitado: false,
  orcamentoMensal: 0,
}

export type FonteDeEnv = Record<string, string | undefined>

/**
 * Lê a política do ambiente. AUSÊNCIA NUNCA É PERMISSÃO: qualquer variável
 * faltando, ilegível ou negativa resulta na política padrão, que bloqueia.
 */
export function lerPoliticaDeCusto(env: FonteDeEnv = process.env, agora: Date = new Date()): PoliticaDeCusto {
  const pagoHabilitado = env.PAID_AI_ENABLED === 'true'

  const bruto = env.AI_MONTHLY_BUDGET
  let orcamentoMensal = 0
  if (bruto !== undefined && bruto.trim() !== '') {
    const valor = Number(bruto)
    // Não-numérico ou negativo cai em 0 — nunca "libera por engano".
    if (Number.isFinite(valor) && valor > 0) orcamentoMensal = valor
  }

  // P2.53: orçamento ADICIONAL autorizado é R$ 0/mês até a titular assinar.
  // Um valor em AI_MONTHLY_BUDGET sem autorização registrada (quem + validade)
  // NÃO vale: créditos ou chaves disponíveis não são autorização de gasto.
  const autorizacao = lerAutorizacaoDeOrcamento(env, agora)
  if (orcamentoMensal > 0 && !autorizacao.valida) {
    return { pagoHabilitado, orcamentoMensal: 0, autorizacao, orcamentoInformadoSemAutorizacao: orcamentoMensal }
  }
  return { pagoHabilitado, orcamentoMensal, autorizacao }
}

export interface AutorizacaoDeOrcamento {
  valida: boolean
  por: string | null
  /** Validade (AAAA-MM-DD), inclusive. */
  ate: string | null
  motivo: string | null
}

/**
 * P2.53. A autorização de gasto é um ATO da titular, registrado no ambiente do
 * servidor: `AI_BUDGET_AUTORIZADO_POR` (quem) e `AI_BUDGET_AUTORIZADO_ATE`
 * (AAAA-MM-DD, validade). Vencida, ilegível ou incompleta = sem autorização.
 */
export function lerAutorizacaoDeOrcamento(env: FonteDeEnv = process.env, agora: Date = new Date()): AutorizacaoDeOrcamento {
  const por = (env.AI_BUDGET_AUTORIZADO_POR ?? '').trim() || null
  const ate = (env.AI_BUDGET_AUTORIZADO_ATE ?? '').trim() || null
  if (!por || !ate) return { valida: false, por, ate, motivo: 'Sem autorização registrada da titular (AI_BUDGET_AUTORIZADO_POR e AI_BUDGET_AUTORIZADO_ATE).' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ate)) return { valida: false, por, ate, motivo: 'Validade da autorização ilegível (use AAAA-MM-DD).' }
  const fim = new Date(`${ate}T23:59:59.999-03:00`)
  if (!Number.isFinite(fim.getTime())) return { valida: false, por, ate, motivo: 'Validade da autorização ilegível (use AAAA-MM-DD).' }
  if (fim.getTime() < agora.getTime()) return { valida: false, por, ate, motivo: `A autorização de gasto venceu em ${ate}.` }
  return { valida: true, por, ate, motivo: null }
}

export type MotivoBloqueio =
  | 'PROVEDOR_DESCONHECIDO'
  | 'PAGO_NAO_HABILITADO'
  | 'ORCAMENTO_ZERO'
  | 'ORCAMENTO_ESGOTADO'
  | 'CUSTO_EXCEDE_SALDO'
  | 'GASTO_ACUMULADO_INDISPONIVEL'
  /** P2.50 (D3): a mesma chave de idempotência já foi autorizada — não paga duas vezes. */
  | 'CHAMADA_REPETIDA'

export interface ConsultaDeCusto {
  provider: string
  /** Ex.: 'gerar-video', 'gerar-roteiro', 'enviar-email'. Vai para auditoria. */
  operacao: string
  workspaceId: string
  /** Em BRL, quando estimável. `null` = desconhecido (tratado como > 0). */
  custoEstimado: number | null
  /** Gasto já realizado por ESTE workspace no período. Nunca somado entre negócios. */
  gastoAcumulado: number
  politica: PoliticaDeCusto
}

export interface DecisaoDeCusto {
  permitido: boolean
  /** `BLOCKED_BY_COST_POLICY` quando negado. */
  decisao: 'ALLOWED' | 'BLOCKED_BY_COST_POLICY'
  motivo: MotivoBloqueio | null
  /** Texto pronto para log e auditoria. Nunca contém credencial. */
  explicacao: string
  saldoDisponivel: number
}

export function avaliarCusto(consulta: ConsultaDeCusto): DecisaoDeCusto {
  const { politica } = consulta
  const saldoDisponivel = Math.max(0, politica.orcamentoMensal - consulta.gastoAcumulado)

  const negar = (motivo: MotivoBloqueio, explicacao: string): DecisaoDeCusto => ({
    permitido: false,
    decisao: 'BLOCKED_BY_COST_POLICY',
    motivo,
    explicacao,
    saldoDisponivel,
  })

  // 1) Provedor fora do catálogo: negado. Um serviço pago novo não pode
  //    entrar em produção só porque ninguém o cadastrou aqui.
  if (!ehProvedorPagoConhecido(consulta.provider)) {
    return negar(
      'PROVEDOR_DESCONHECIDO',
      `Provedor "${consulta.provider}" não está no catálogo de provedores pagos conhecidos — bloqueado por precaução.`
    )
  }

  // 2) e 3) As DUAS chaves, avaliadas separadamente para o log dizer qual
  //    delas falta — sem isso, diagnosticar exigiria adivinhação.
  if (!politica.pagoHabilitado) {
    return negar(
      'PAGO_NAO_HABILITADO',
      'Serviços pagos não estão habilitados (PAID_AI_ENABLED). Custo zero por padrão — liberar exige ato explícito da proprietária.'
    )
  }
  if (politica.orcamentoMensal <= 0) {
    return negar(
      'ORCAMENTO_ZERO',
      politica.orcamentoInformadoSemAutorizacao
        ? `Orçamento adicional autorizado é R$ 0,00: há R$ ${politica.orcamentoInformadoSemAutorizacao.toFixed(2)} no ambiente, mas ${politica.autorizacao?.motivo ?? 'sem autorização da titular'}`
        : 'Orçamento mensal é R$ 0,00 (AI_MONTHLY_BUDGET). Habilitar serviços pagos sem orçamento não autoriza gasto nenhum.'
    )
  }

  // 4) Orçamento já consumido por ESTE workspace.
  if (saldoDisponivel <= 0) {
    return negar(
      'ORCAMENTO_ESGOTADO',
      `Orçamento mensal de R$ ${politica.orcamentoMensal.toFixed(2)} já foi consumido neste workspace (gasto: R$ ${consulta.gastoAcumulado.toFixed(2)}).`
    )
  }

  // 5) Custo desconhecido é tratado como "não cabe": autorizar o que não se
  //    sabe medir é exatamente como se estoura orçamento.
  if (consulta.custoEstimado === null) {
    return negar(
      'CUSTO_EXCEDE_SALDO',
      'Custo estimado desconhecido para esta operação — bloqueado, porque autorizar gasto não mensurável é como não ter teto.'
    )
  }
  if (consulta.custoEstimado > saldoDisponivel) {
    return negar(
      'CUSTO_EXCEDE_SALDO',
      `Custo estimado de R$ ${consulta.custoEstimado.toFixed(2)} excede o saldo de R$ ${saldoDisponivel.toFixed(2)} neste workspace.`
    )
  }

  return {
    permitido: true,
    decisao: 'ALLOWED',
    motivo: null,
    explicacao: `Autorizado: R$ ${consulta.custoEstimado.toFixed(2)} dentro do saldo de R$ ${saldoDisponivel.toFixed(2)}.`,
    saldoDisponivel,
  }
}


// ── Ponto de entrada único das integrações pagas ────────────────────────

import { registrarAuditoria } from './audit-log'
import { escolherFallback, type Fallback } from './cost-fallback'

/**
 * Ações de auditoria. Ficam AQUI (e não no módulo de reserva) porque são
 * constantes puras: `cost-safety-reserva.ts` as importa, e assim o ciclo de
 * import fica em uma direção só — quem precisa de Postgres depende de quem
 * só decide, nunca o contrário.
 */
export const ACAO_AUDIT_BLOQUEIO = 'custo.bloqueado_por_politica'
export const ACAO_AUDIT_AUTORIZADO = 'custo.autorizado'

export interface ResultadoGuarda {
  permitido: boolean
  decisao: DecisaoDeCusto
  /** Alternativa gratuita escolhida quando a chamada foi bloqueada. */
  fallback: Fallback | null
}

/**
 * Chamado ANTES de qualquer requisição que possa gerar cobrança.
 *
 * Quando nega, registra em `AuditLog` com timestamp, workspace, provedor,
 * operação, motivo, custo estimado, fallback e decisão — NUNCA com chave de
 * API ou token (a função sequer os recebe como parâmetro).
 *
 * Quando autoriza, a RESERVA é gravada dentro da mesma transação que leu o
 * saldo (ver `cost-safety-reserva.ts`). É por isso que duas chamadas
 * simultâneas não conseguem ultrapassar o teto: a segunda só lê o gasto
 * depois que a primeira já gravou o dela.
 */
export async function guardarChamadaPaga(params: {
  provider: string
  operacao: string
  /**
   * `null` quando quem chama não tem workspace em mãos. Com serviços pagos
   * habilitados isso BLOQUEIA: sem workspace não há como apurar o gasto do
   * mês, e assumir zero criaria um teto de mentira. `AuditLog` tem FK para
   * `Workspace` — inventar um id criaria dado falso.
   */
  workspaceId: string | null
  /** Sobrescreve a tabela central. Só quando o custo real for conhecido. */
  custoEstimado?: number | null
  /**
   * P2.50 (D3): identifica a operação LÓGICA (ex.: um clipe de uma geração).
   * Se já houve autorização com a mesma chave, a repetição é negada
   * (`CHAMADA_REPETIDA`): nem reserva de novo, nem chama o provedor de novo.
   */
  chaveIdempotencia?: string | null
  env?: FonteDeEnv
  agora?: Date
}): Promise<ResultadoGuarda> {
  const politica = lerPoliticaDeCusto(params.env ?? process.env, params.agora)
  const custoEstimado =
    params.custoEstimado !== undefined ? params.custoEstimado : estimarCusto(params.provider, params.operacao)

  const negar = (explicacao: string): DecisaoDeCusto => ({
    permitido: false,
    decisao: 'BLOCKED_BY_COST_POLICY',
    motivo: 'GASTO_ACUMULADO_INDISPONIVEL',
    explicacao,
    saldoDisponivel: 0,
  })

  // Caminho rápido: com a política desligada a resposta já é não, e não há
  // por que abrir transação. É o caminho MAIS COMUM — custo zero por padrão.
  if (!politica.pagoHabilitado || politica.orcamentoMensal <= 0) {
    const decisao = avaliarCusto({
      provider: params.provider,
      operacao: params.operacao,
      workspaceId: params.workspaceId ?? 'nao-informado',
      custoEstimado,
      gastoAcumulado: 0,
      politica,
    })
    return registrarBloqueio(params, decisao, custoEstimado)
  }

  // Daqui para baixo os serviços pagos ESTÃO habilitados.
  if (!params.workspaceId) {
    return registrarBloqueio(
      params,
      negar(
        'Serviços pagos habilitados, mas a chamada não informou workspace — sem workspace não há como apurar o gasto do mês, e assumir zero criaria um teto de mentira.'
      ),
      custoEstimado
    )
  }

  // P2.14.7: kill switch global e Safe Mode vencem qualquer orçamento.
  const { freioDeEmergencia } = await import('./kill-switch')
  const freio = await freioDeEmergencia(params.workspaceId, params.env ?? process.env)
  if (freio.bloqueado) {
    return registrarBloqueio(params, negar(freio.motivo ?? 'Gasto bloqueado por segurança.'), custoEstimado)
  }

  const fallback = escolherFallback(params.provider, params.operacao)

  try {
    const { reservarOrcamento } = await import('./cost-safety-reserva')
    const r = await reservarOrcamento({
      provider: params.provider,
      operacao: params.operacao,
      workspaceId: params.workspaceId,
      custoEstimado,
      politica,
      agora: params.agora,
      chaveIdempotencia: params.chaveIdempotencia ?? null,
      fallbackTipo: fallback.tipo,
      fallbackAlternativa: fallback.alternativa,
      pendenciaDeAutomacao: fallback.pendenciaDeAutomacao,
    })
    return { permitido: r.permitido, decisao: r.decisao, fallback: r.permitido ? null : fallback }
  } catch (e) {
    // Cobre `GastoAcumuladoIndisponivel` (registro de reserva ilegível) e
    // qualquer falha da transação. Não saber quanto já se gastou BLOQUEIA.
    const detalhe = e instanceof Error ? e.message : String(e)
    console.error('[cost-safety-gate] reserva atômica falhou — bloqueando por precaução:', detalhe)
    return registrarBloqueio(params, negar('Não foi possível apurar/reservar o orçamento do mês com segurança: ' + detalhe), custoEstimado)
  }
}

/**
 * Registra um BLOQUEIO fora de transação. Usado no caminho rápido (política
 * desligada) e quando a reserva atômica não pôde sequer ser tentada.
 * Nunca registra AUTORIZAÇÃO: autorizar só acontece dentro da transação.
 */
async function registrarBloqueio(
  params: { provider: string; operacao: string; workspaceId: string | null },
  decisao: DecisaoDeCusto,
  custoEstimado: number | null
): Promise<ResultadoGuarda> {
  const fallback = escolherFallback(params.provider, params.operacao)

  if (!params.workspaceId) {
    // Sem workspace não dá para gravar em `AuditLog` (FK). Fica no log do
    // processo, que é onde a operação consegue ver.
    console.warn(
      `[cost-safety-gate] ${decisao.decisao} provider=${params.provider} operacao=${params.operacao} motivo=${decisao.motivo} — ${decisao.explicacao}`
    )
    return { permitido: false, decisao, fallback }
  }

  await registrarAuditoria({
    workspaceId: params.workspaceId,
    action: ACAO_AUDIT_BLOQUEIO,
    entityType: 'CostSafetyGate',
    entityId: `${params.provider}:${params.operacao}`,
    metadata: {
      provider: params.provider,
      operacao: params.operacao,
      motivo: decisao.motivo,
      explicacao: decisao.explicacao,
      custoEstimado,
      saldoDisponivel: decisao.saldoDisponivel,
      decisao: decisao.decisao,
      fallbackTipo: fallback.tipo,
      fallbackAlternativa: fallback.alternativa,
      pendenciaDeAutomacao: fallback.pendenciaDeAutomacao,
    },
  })

  return { permitido: false, decisao, fallback }
}
