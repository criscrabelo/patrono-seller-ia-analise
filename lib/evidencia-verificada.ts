/**
 * Fonte de evidência VERIFICADA (P0.2 — Bloco 3.1, revisão de confiança).
 *
 * ── O PROBLEMA ──────────────────────────────────────────────────────────
 * Antes, promover com `PROVIDER_OFICIAL` exigia apenas que o chamador
 * enviasse `tipoEvidencia: 'PROVIDER_OFICIAL'` e uma referência qualquer.
 * "referência preenchida" não é "referência verificada": uma futura rota
 * pública poderia fabricar `webhook-123` e transformar um relato da
 * proprietária em operação real — exatamente o que toda a cadeia do P0.2
 * existe para impedir.
 *
 * ── TIPO NÃO É FRONTEIRA DE SEGURANÇA ───────────────────────────────────
 * Declarar `ator: 'INTEGRACAO'` no TypeScript não protege nada: em runtime
 * qualquer chamador monta esse objeto. A fronteira precisa ser um FATO do
 * servidor, não um campo do payload.
 *
 * ── COMO ISSO É GARANTIDO AQUI ──────────────────────────────────────────
 * Uma `FonteVerificada` só existe se tiver sido EMITIDA por este módulo, a
 * pedido de um verificador REGISTRADO que consultou a fonte externa e
 * confirmou. As instâncias emitidas ficam num `WeakSet` privado; quem
 * montar um objeto com o mesmo formato não entra nele, e
 * `ehFonteVerificada()` recusa.
 *
 * É uma checagem de RUNTIME, não de tipo: `JSON.parse` de um corpo de
 * requisição nunca vai passar, por mais parecido que seja o formato.
 *
 * ── ESTADO HONESTO DE HOJE ──────────────────────────────────────────────
 * NENHUM verificador está registrado. Não há integração com provider nem
 * importação de conciliação neste repositório. Consequência direta e
 * desejada: `PROVIDER_OFICIAL`, `CONCILIACAO_FINANCEIRA` e
 * `COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL` são INALCANÇÁVEIS por
 * qualquer caminho — inclusive interno. O único caminho de promoção aberto
 * é a correção manual auditada.
 *
 * ── LIMITE QUE NÃO ESCONDO ──────────────────────────────────────────────
 * Este módulo protege contra forja vinda de FORA (payload, query, corpo de
 * webhook não autenticado). Ele não protege contra código do próprio
 * repositório chamando `registrarVerificadorDeEvidencia()` — num processo
 * único isso é inerente. A defesa aí é revisão de código: um verificador
 * novo é uma mudança visível no diff, não um dado de requisição.
 */

import type { EvidenciaDeOperacaoReal } from './proveniencia'

/**
 * Prova de que uma fonte externa confiável confirmou o fato.
 * Só existe emitida por este módulo — ver `WeakSet` abaixo.
 *
 * ── A FONTE DIZ O QUE COMPROVOU, NÃO SÓ QUE É LEGÍTIMA ──────────────────
 * Uma fonte que provasse apenas "fui emitida aqui" seria um cheque em
 * branco: emitida para a venda A do workspace A, promoveria a venda B do
 * workspace B, porque nada nela dizia sobre QUAL objeto foi conferido.
 *
 * Por isso os campos `*Verificado` são gravados no momento da emissão, a
 * partir do `PedidoDeVerificacao` que o verificador realmente examinou — e
 * nunca de uma chamada de promoção posterior. A promoção confere
 * correspondência exata; divergência bloqueia.
 */
export interface FonteVerificada {
  readonly tipo: EvidenciaDeOperacaoReal
  /** Referência externa que o verificador OBTEVE da fonte, não que recebeu. */
  readonly referencia: string
  /** Qual verificador atestou. Vai para a auditoria. */
  readonly verificadorId: string
  readonly verificadaEm: Date
  /** Workspace para o qual esta verificação foi feita. Imutável. */
  readonly workspaceIdVerificado: string
  /** Venda para a qual esta verificação foi feita. Imutável. */
  readonly saleIdVerificado: string
  /** Comissão conferida, quando a evidência é sobre comissão. `null` nos demais tipos. */
  readonly commissionIdVerificado: string | null
  /** Dados adicionais da conferência (nunca credencial). */
  readonly detalhes: Readonly<Record<string, unknown>>
}

/**
 * Registro privado das instâncias legítimas.
 * Não é exportado — é isso que torna a checagem inforjável de fora.
 */
const EMITIDAS = new WeakSet<object>()

export interface PedidoDeVerificacao {
  workspaceId: string
  saleId: string
  /** Obrigatório para evidência sobre uma comissão específica. */
  commissionId?: string | null
  /** O que o chamador ACHA que é a referência. O verificador confirma ou não. */
  referenciaDeclarada?: string | null
}

export interface VerificadorDeEvidencia {
  /** Identificador estável, gravado na auditoria. */
  id: string
  tipo: EvidenciaDeOperacaoReal
  /**
   * Consulta a fonte externa e devolve a referência CONFIRMADA, ou `null`
   * quando não conseguir confirmar. Nunca deve ecoar de volta a referência
   * declarada sem ter conferido nada — isso anularia o mecanismo.
   */
  verificar(pedido: PedidoDeVerificacao): Promise<{ referencia: string; detalhes?: Record<string, unknown> } | null>
}

const VERIFICADORES = new Map<string, VerificadorDeEvidencia>()

/**
 * Registra um verificador. Chamado por adaptadores de provider e por
 * importadores de conciliação — código do repositório, revisado, nunca um
 * dado de requisição.
 */
export function registrarVerificadorDeEvidencia(v: VerificadorDeEvidencia): void {
  if (!v?.id || !v?.tipo || typeof v.verificar !== 'function') {
    throw new Error('Verificador de evidência inválido: exige id, tipo e verificar().')
  }
  if (v.tipo === 'CORRECAO_MANUAL_AUDITADA') {
    // Correção manual é decisão humana auditada, não conferência de sistema.
    // Deixar um "verificador" emiti-la criaria um carimbo automático de algo
    // que precisa de responsável, motivo e assinatura.
    throw new Error('CORRECAO_MANUAL_AUDITADA não pode ter verificador automático.')
  }
  VERIFICADORES.set(v.id, v)
}

/** Para boot e testes. Remover verificador só reduz acesso, nunca amplia. */
export function limparVerificadoresDeEvidencia(): void {
  VERIFICADORES.clear()
}

export function listarVerificadoresDeEvidencia(): Array<{ id: string; tipo: EvidenciaDeOperacaoReal }> {
  return [...VERIFICADORES.values()].map((v) => ({ id: v.id, tipo: v.tipo }))
}

/** Tipos que hoje têm verificador registrado — ou seja, que são alcançáveis. */
export function tiposComVerificador(): EvidenciaDeOperacaoReal[] {
  return [...new Set([...VERIFICADORES.values()].map((v) => v.tipo))]
}

/**
 * ÚNICA porta de entrada para uma `FonteVerificada`.
 *
 * Devolve `null` quando não há verificador para o tipo, ou quando o
 * verificador não conseguiu confirmar. Nunca devolve uma fonte "otimista".
 */
export async function verificarEvidencia(
  tipo: EvidenciaDeOperacaoReal,
  pedido: PedidoDeVerificacao
): Promise<FonteVerificada | null> {
  // Sem alvo não há o que vincular, e uma fonte sem alvo seria justamente o
  // cheque em branco que os campos `*Verificado` existem para impedir.
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
  const workspaceIdVerificado = texto(pedido?.workspaceId)
  const saleIdVerificado = texto(pedido?.saleId)
  if (!workspaceIdVerificado || !saleIdVerificado) return null

  const commissionIdVerificado = texto(pedido?.commissionId)
  if (tipo === 'COMISSAO_CONFIRMADA_COM_ORIGEM_VERIFICAVEL' && !commissionIdVerificado) {
    // Evidência sobre comissão precisa dizer QUAL comissão foi conferida.
    // Emitir sem isso produziria um vínculo vazio.
    return null
  }

  const candidatos = [...VERIFICADORES.values()].filter((v) => v.tipo === tipo)
  for (const verificador of candidatos) {
    let confirmacao: { referencia: string; detalhes?: Record<string, unknown> } | null = null
    try {
      confirmacao = await verificador.verificar(pedido)
    } catch (e) {
      // Verificador que falha não confirma nada. Erro não vira permissão.
      console.error(`[evidencia] verificador ${verificador.id} falhou — nada foi confirmado:`, e)
      continue
    }
    if (!confirmacao || typeof confirmacao.referencia !== 'string' || confirmacao.referencia.trim() === '') {
      continue
    }
    const fonte: FonteVerificada = Object.freeze({
      tipo,
      referencia: confirmacao.referencia.trim(),
      verificadorId: verificador.id,
      verificadaEm: new Date(),
      // Vêm do pedido que o verificador examinou, nunca de quem promover
      // depois. É isto que impede reaproveitar a fonte em outro alvo.
      workspaceIdVerificado,
      saleIdVerificado,
      commissionIdVerificado,
      detalhes: Object.freeze({ ...(confirmacao.detalhes ?? {}) }),
    })
    EMITIDAS.add(fonte)
    return fonte
  }
  return null
}

/**
 * Checagem de RUNTIME: este objeto foi emitido por `verificarEvidencia()`?
 *
 * Um objeto com o mesmo formato, vindo de `JSON.parse` de uma requisição,
 * não está no `WeakSet` e é recusado. É isso que impede uma rota pública de
 * fabricar `PROVIDER_OFICIAL`.
 */
export function ehFonteVerificada(valor: unknown): valor is FonteVerificada {
  return typeof valor === 'object' && valor !== null && EMITIDAS.has(valor)
}
