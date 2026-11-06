/**
 * P2.42 — Executor de UM trecho profissional (IA paga sob demanda), com custo previsível.
 *
 * Ordem, sem atalho:
 *   1. modelo do catálogo + modo que preserva o produto (texto→vídeo não existe aqui);
 *   2. ESTIMATIVA antes de gerar (pior caso com todas as tentativas);
 *   3. LIMITE RÍGIDO POR EXECUÇÃO: pior caso não cabe → nada é reservado nem enviado;
 *   4. por tentativa: reserva no Cost Governor (duas chaves + orçamento mensal/diário + Safe Mode + limite de
 *      aprovação; idempotente por execução+tentativa) → submete → acompanha → confirma o custo;
 *   5. checagem LOCAL de fidelidade; reprovado = tentativa perdida (custo conta) e o trecho não é usado;
 *   6. qualquer bloqueio/falha final → `fallback` = montagem local com a filmagem real (R$ 0). O fluxo atual não muda.
 * Falha cobrada × não cobrada: a reserva só é CANCELADA com prova oficial do fornecedor; sem prova, fica cobrada.
 */
import { modelo as lerModelo } from './catalogo'
import { estimarExecucao, verificarLimiteDaExecucao, proximaTentativaCabe, CAMBIO_PADRAO, brl, type Cambio, type EstimativaDeExecucao } from './orcamento'
import { promptSeguro, type AdaptadorDeVideo, type PedidoDeGeracao, type EstadoDoJob } from './adaptadores'
import { checarFidelidade, type LimitesDeFidelidade, type ResultadoDeFidelidade } from './fidelidade'
import { decidirFidelidade, produtoTemInscricoes } from './inscricoes'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { reservarCusto, confirmarCusto, cancelarReserva } from '../cost-governor'
import { prisma } from '../prisma'
import type { FonteDeEnv } from '../cost-safety-gate'

export const FALLBACK_LOCAL = 'Montagem local com a filmagem real do produto (FFmpeg, R$ 0) — fluxo atual'

export interface Tentativa {
  n: number
  reserva: string
  status: 'APROVADA' | 'REPROVADA_FIDELIDADE' | 'FALHOU' | 'TEMPO_ESGOTADO' | 'BLOQUEADA' | 'AGUARDA_CONFERENCIA_DE_INSCRICOES'
  custoCentavos: number
  cobrada: boolean
  detalhe?: string
  fidelidade?: ResultadoDeFidelidade
}

export interface ResultadoDoTrecho {
  /** P2.84: AGUARDA_CONFERENCIA_DE_INSCRICOES = similaridade aprovou, mas o produto tem inscrições: o trecho NÃO entra no
   *  vídeo até uma pessoa conferir as inscrições no arquivo (sha256) — similaridade não aprova sozinha (caso ia-heroi). */
  status: 'GERADO' | 'BLOQUEADO' | 'AGUARDA_APROVACAO_DE_GASTO' | 'FALHOU' | 'AGUARDA_CONFERENCIA_DE_INSCRICOES'
  arquivo?: string
  estimativa: EstimativaDeExecucao | null
  tentativas: Tentativa[]
  gastoCentavos: number
  motivo?: string
  fallback?: string
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
const usdParaCentavos = (usd: number, c: Cambio) => Math.ceil(usd * c.brlPorUsd * (1 + c.margem) * 100)

export async function gerarTrechoProfissional(p: {
  workspaceId: string
  /** Identifica a execução (ex.: `${publicacaoId}:cena3`). Repetir a mesma execução não cobra de novo. */
  execucaoId: string
  pedido: PedidoDeGeracao
  adaptador: AdaptadorDeVideo
  limiteExecucaoCentavos: number
  tentativasMax?: number
  taxaDeRefacao?: number
  cambio?: Cambio
  env?: FonteDeEnv
  intervaloMs?: number
  maxConsultas?: number
  limitesFidelidade?: LimitesDeFidelidade
  /** P2.84: só `true` declarado na ficha do produto dispensa a conferência humana das inscrições */
  semInscricoes?: boolean
}): Promise<ResultadoDoTrecho> {
  const cambio = p.cambio ?? CAMBIO_PADRAO
  const tentativasMax = p.tentativasMax ?? 3
  const nada = (motivo: string, estimativa: EstimativaDeExecucao | null = null): ResultadoDoTrecho => ({ status: 'BLOQUEADO', estimativa, tentativas: [], gastoCentavos: 0, motivo, fallback: FALLBACK_LOCAL })

  let m
  try { m = lerModelo(p.pedido.modeloId) } catch (e) { return nada((e as Error).message) }
  if (!m.modos.includes(p.pedido.modo)) return nada(`O modelo ${m.rotulo} não faz ${p.pedido.modo}.`)
  if (m.provedor !== p.adaptador.provedor) return nada(`Adaptador (${p.adaptador.provedor}) não corresponde ao modelo (${m.provedor}).`)
  if (p.pedido.segundos > m.maxSegundos) return nada(`Trecho de ${p.pedido.segundos}s passa do máximo do modelo (${m.maxSegundos}s).`)

  const estimativa = estimarExecucao({ modelo: m, segundos: p.pedido.segundos, tentativasMax, taxaDeRefacao: p.taxaDeRefacao ?? 0.3, cambio })
  const limite = verificarLimiteDaExecucao(estimativa, p.limiteExecucaoCentavos)
  if (!limite.cabe) return nada(limite.motivo, estimativa)

  const pedido = { ...p.pedido, segundos: estimativa.segundosPorTentativa, prompt: promptSeguro(p.pedido.prompt) }
  const tentativas: Tentativa[] = []
  let gasto = 0

  for (let n = 1; n <= tentativasMax; n++) {
    if (!proximaTentativaCabe(gasto, estimativa.centavosPorTentativa, p.limiteExecucaoCentavos)) {
      return { status: 'BLOQUEADO', estimativa, tentativas, gastoCentavos: gasto, motivo: `Limite por execução (${brl(p.limiteExecucaoCentavos)}) atingido.`, fallback: FALLBACK_LOCAL }
    }
    const chave = `videopro:${p.execucaoId}:t${n}`
    const r = await reservarCusto({ workspaceId: p.workspaceId, provider: m.provedor, operacao: `gerar-trecho:${m.id}`, estimadoCentavos: estimativa.centavosPorTentativa, chaveIdempotencia: chave, env: p.env })
    if (r.status === 'EXIGE_APROVACAO') return { status: 'AGUARDA_APROVACAO_DE_GASTO', estimativa, tentativas, gastoCentavos: gasto, motivo: r.motivos.join(' '), fallback: FALLBACK_LOCAL }
    if (r.status === 'BLOQUEADO') {
      tentativas.push({ n, reserva: r.id ?? '-', status: 'BLOQUEADA', custoCentavos: 0, cobrada: false, detalhe: r.motivos.join(' ') })
      return { status: 'BLOQUEADO', estimativa, tentativas, gastoCentavos: gasto, motivo: r.motivos.join(' '), fallback: FALLBACK_LOCAL }
    }
    // Reserva repetida (execução retomada): reaproveita o resultado já registrado, sem submeter de novo.
    if (r.repetida) {
      const linha = await prisma.costLedger.findUnique({ where: { id: r.id } })
      if (linha && linha.status !== 'RESERVADO') {
        const c = linha.status === 'CONFIRMADO' ? Math.max(linha.realCentavos ?? 0, linha.estimadoCentavos) : 0
        gasto += c
        tentativas.push({ n, reserva: r.id, status: 'FALHOU', custoCentavos: c, cobrada: c > 0, detalhe: 'tentativa já registrada (execução retomada)' })
        continue
      }
    }

    const { jobId } = await p.adaptador.submeter(pedido, chave)
    let estado: EstadoDoJob = { status: 'NA_FILA' }
    for (let k = 0; k < (p.maxConsultas ?? 120); k++) {
      estado = await p.adaptador.consultar(jobId)
      if (estado.status === 'CONCLUIDO' || estado.status === 'FALHOU') break
      if (p.intervaloMs ?? 5000) await esperar(p.intervaloMs ?? 5000)
    }

    if (estado.status === 'FALHOU' && estado.provaDeNaoCobranca) {
      await cancelarReserva({ workspaceId: p.workspaceId, id: r.id, provaDeNaoCobranca: estado.provaDeNaoCobranca })
      tentativas.push({ n, reserva: r.id, status: 'FALHOU', custoCentavos: 0, cobrada: false, detalhe: `${estado.tipoFalha}: ${estado.motivo} (não cobrada, prova: ${estado.provaDeNaoCobranca})` })
      continue
    }
    // Sem prova de não cobrança: conta como cobrada (valor informado pelo fornecedor, ou a reserva inteira).
    const real = typeof estado.cobradoUsd === 'number' ? usdParaCentavos(estado.cobradoUsd, cambio) : estimativa.centavosPorTentativa
    await confirmarCusto({ workspaceId: p.workspaceId, id: r.id, realCentavos: real })
    gasto += real
    if (estado.status !== 'CONCLUIDO' || !estado.arquivo) {
      const st = estado.status === 'FALHOU' ? 'FALHOU' : 'TEMPO_ESGOTADO'
      tentativas.push({ n, reserva: r.id, status: st, custoCentavos: real, cobrada: true, detalhe: estado.motivo ?? 'sem resultado no prazo' })
      continue
    }
    const fid = await checarFidelidade({ midiaReal: p.pedido.midiaReal, gerado: estado.arquivo, limites: p.limitesFidelidade })
    if (!fid.aprovado) {
      tentativas.push({ n, reserva: r.id, status: 'REPROVADA_FIDELIDADE', custoCentavos: real, cobrada: true, detalhe: fid.motivos.join(' '), fidelidade: fid })
      continue
    }
    const sha256 = createHash('sha256').update(readFileSync(estado.arquivo)).digest('hex')
    const dec = decidirFidelidade({ aprovadoPelaSimilaridade: true, produtoTemInscricoes: produtoTemInscricoes({ semInscricoes: p.semInscricoes }), sha256 })
    if (dec.decisao !== 'APROVADO') {
      // não gera outra tentativa: o arquivo pode estar certo; quem decide é a conferência das inscrições
      tentativas.push({ n, reserva: r.id, status: 'AGUARDA_CONFERENCIA_DE_INSCRICOES', custoCentavos: real, cobrada: true, detalhe: dec.motivo, fidelidade: fid })
      return { status: 'AGUARDA_CONFERENCIA_DE_INSCRICOES', arquivo: estado.arquivo, estimativa, tentativas, gastoCentavos: gasto, motivo: dec.motivo, fallback: FALLBACK_LOCAL }
    }
    tentativas.push({ n, reserva: r.id, status: 'APROVADA', custoCentavos: real, cobrada: true, fidelidade: fid })
    return { status: 'GERADO', arquivo: estado.arquivo, estimativa, tentativas, gastoCentavos: gasto }
  }
  return { status: 'FALHOU', estimativa, tentativas, gastoCentavos: gasto, motivo: `Nenhuma das ${tentativasMax} tentativa(s) foi aprovada.`, fallback: FALLBACK_LOCAL }
}

/** Registro de consumo do mês (CostLedger): por provedor/operação/status, real quando conhecido. */
export async function consumoDoMes(workspaceId: string, agora: Date = new Date()) {
  const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1))
  const linhas = await prisma.costLedger.findMany({ where: { workspaceId, criadoEm: { gte: inicio } }, select: { provider: true, operacao: true, status: true, estimadoCentavos: true, realCentavos: true } })
  const porChave = new Map<string, { provider: string; operacao: string; status: string; quantidade: number; centavos: number }>()
  let totalCentavos = 0
  for (const l of linhas) {
    const k = `${l.provider}|${l.operacao}|${l.status}`
    const it = porChave.get(k) ?? { provider: l.provider, operacao: l.operacao, status: l.status, quantidade: 0, centavos: 0 }
    // O que CONTA no orçamento: reservado (estimado) e confirmado (o maior entre real e estimado — conservador).
    const c = l.status === 'CONFIRMADO' ? Math.max(l.realCentavos ?? 0, l.estimadoCentavos) : l.status === 'RESERVADO' ? l.estimadoCentavos : 0
    it.quantidade++
    it.centavos += c
    totalCentavos += c
    porChave.set(k, it)
  }
  return { totalCentavos, linhas: [...porChave.values()] }
}
