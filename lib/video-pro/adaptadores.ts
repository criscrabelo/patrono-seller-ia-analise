/**
 * P2.42 — Contrato dos adaptadores de geração de vídeo + o SIMULADO (mock) do TESTE.
 *
 * Todo fornecedor (Runway, fal.ai, Veo…) vira o mesmo contrato assíncrono: submeter → consultar → arquivo local.
 * NESTE PROTÓTIPO SÓ EXISTE O MOCK: nenhum adaptador real foi escrito e `criarAdaptador` recusa qualquer outro
 * provedor. Ligar um real exige autorização específica da titular (chave, cobrança, orçamento) e passa pelo executor,
 * que reserva o custo ANTES de submeter.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import ffmpegStatic from 'ffmpeg-static'
import type { ModoDeGeracao, ProvedorDeVideo } from './catalogo'

const exec = promisify(execFile)

export interface PedidoDeGeracao {
  modo: ModoDeGeracao
  modeloId: string
  /** Caminho local da mídia REAL autorizada (foto ou take do produto). */
  midiaReal: string
  prompt: string
  segundos: number
}

export type TipoDeFalha = 'MODERACAO' | 'TECNICA' | 'TEMPO_ESGOTADO'

export interface EstadoDoJob {
  status: 'NA_FILA' | 'PROCESSANDO' | 'CONCLUIDO' | 'FALHOU'
  arquivo?: string
  tipoFalha?: TipoDeFalha
  motivo?: string
  /** Valor COBRADO informado pelo fornecedor, quando ele informa. null = não informado. */
  cobradoUsd?: number | null
  /** Status oficial que prova a NÃO cobrança (ex.: resposta de falha com crédito devolvido). */
  provaDeNaoCobranca?: string
}

export interface AdaptadorDeVideo {
  provedor: ProvedorDeVideo
  submeter(p: PedidoDeGeracao, chaveIdempotencia: string): Promise<{ jobId: string }>
  consultar(jobId: string): Promise<EstadoDoJob>
}

/** Restrições que vão em TODO prompt: só movimento de câmera/luz; o produto fica idêntico à mídia real. */
export function promptSeguro(base: string): string {
  return `${base.trim()} Keep the product EXACTLY as in the reference: same cover, title, text, logo, colors, shape and proportions. ` +
    'Do not add, remove or redraw any text or graphic. Only gentle camera motion and natural lighting. No people added.'
}

// ── Simulado ─────────────────────────────────────────────────────────────────

export type CenarioDoMock = 'SUCESSO' | 'FALHA_TECNICA' | 'MODERACAO' | 'ADULTERADO' | 'TEMPO_ESGOTADO'

/**
 * Mock DETERMINÍSTICO: cada submissão consome o próximo cenário da fila (o último se repete). SUCESSO gera um trecho
 * real com FFmpeg (zoom suave sobre a mídia real, 1080×1920); ADULTERADO recolore e tampa parte do produto — é o que a
 * checagem de fidelidade precisa pegar. MODERACAO devolve prova de não cobrança; FALHA_TECNICA não devolve (conta).
 */
export class AdaptadorMock implements AdaptadorDeVideo {
  readonly provedor = 'simulado-teste' as const
  readonly submetidos: Array<{ chave: string; pedido: PedidoDeGeracao }> = []
  private readonly jobs = new Map<string, { cenario: CenarioDoMock; pedido: PedidoDeGeracao; consultas: number }>()
  private readonly pasta = mkdtempSync(join(tmpdir(), 'videopro-mock-'))

  constructor(private readonly cenarios: CenarioDoMock[] = ['SUCESSO'], private readonly usdPorSegundo = 0.05) {}

  async submeter(p: PedidoDeGeracao, chave: string) {
    // Mesma chave = mesmo job (idempotência do lado do fornecedor, como Runway/fal com request id).
    const ja = this.submetidos.findIndex((s) => s.chave === chave)
    if (ja >= 0) return { jobId: `mock-${ja}` }
    const cenario = this.cenarios[Math.min(this.submetidos.length, this.cenarios.length - 1)]
    const jobId = `mock-${this.submetidos.length}`
    this.submetidos.push({ chave, pedido: p })
    this.jobs.set(jobId, { cenario, pedido: p, consultas: 0 })
    return { jobId }
  }

  async consultar(jobId: string): Promise<EstadoDoJob> {
    const j = this.jobs.get(jobId)
    if (!j) throw new Error('job desconhecido')
    j.consultas++
    if (j.consultas === 1) return { status: 'PROCESSANDO' }
    const cobrado = j.pedido.segundos * this.usdPorSegundo
    switch (j.cenario) {
      case 'FALHA_TECNICA': return { status: 'FALHOU', tipoFalha: 'TECNICA', motivo: 'erro interno simulado', cobradoUsd: null }
      case 'TEMPO_ESGOTADO': return { status: 'PROCESSANDO' }
      case 'MODERACAO': return { status: 'FALHOU', tipoFalha: 'MODERACAO', motivo: 'conteúdo recusado (simulado)', cobradoUsd: 0, provaDeNaoCobranca: `mock:${jobId}:FAILED:moderation:refunded` }
      default: {
        const arquivo = join(this.pasta, `${jobId}.mp4`)
        if (!existsSync(arquivo)) await renderizarTrecho(j.pedido.midiaReal, arquivo, j.pedido.segundos, j.cenario === 'ADULTERADO')
        return { status: 'CONCLUIDO', arquivo, cobradoUsd: cobrado }
      }
    }
  }
}

async function renderizarTrecho(midia: string, saida: string, segundos: number, adulterar: boolean) {
  const bin = process.env.FFMPEG || (ffmpegStatic as unknown as string)
  const fps = 24
  const n = Math.round(segundos * fps)
  const base = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,zoompan=z='1+0.05*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=1080x1920:fps=${fps}`
  // Adulterado: a "IA" recolore a capa e cobre o título a partir de 1/3 do trecho.
  const vf = adulterar ? `${base},hue=h=140:s=1.6:enable='gte(t,${segundos / 3})',drawbox=x=120:y=300:w=840:h=700:color=red@0.9:t=fill:enable='gte(t,${segundos / 3})'` : base
  const ehImagem = /\.(png|jpe?g|webp)$/i.test(midia)
  await exec(bin, ['-hide_banner', '-v', 'error', '-y', ...(ehImagem ? ['-loop', '1'] : []), '-i', midia, '-t', String(segundos), '-vf', `${vf},format=yuv420p`, '-frames:v', String(n), '-c:v', 'libx264', '-preset', 'veryfast', '-an', saida], { maxBuffer: 8 << 20 })
}

export function criarAdaptador(provedor: ProvedorDeVideo, opcoes?: { cenarios?: CenarioDoMock[] }): AdaptadorDeVideo {
  if (provedor === 'simulado-teste') return new AdaptadorMock(opcoes?.cenarios)
  throw new Error(`Integração real com ${provedor} NÃO habilitada neste protótipo: exige autorização específica da titular (conta, cobrança e orçamento).`)
}
