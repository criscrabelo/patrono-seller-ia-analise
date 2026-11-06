/**
 * P2.17.10 — Entrada e erros das rotas do modo assistido e dos resultados.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ErroAssistido } from './publicacao-assistida'
import { ErroDeResultado } from './resultados-videos'
import { PRIVACIDADES_TIKTOK } from './tiktok-adaptador'

export const esquemaAlteracoes = z
  .object({
    gancho: z.string().trim().max(150).optional(),
    legenda: z.string().trim().max(2200).optional(),
    hashtags: z.array(z.string().trim().min(2).max(60)).max(5).optional(),
    cta: z.string().trim().max(120).optional(),
    horarioPlanejado: z.string().datetime().nullable().optional(),
  })
  .optional()

// P2.50 (A2): a aprovação diz QUAL versão a titular viu (número + sha256 do vídeo). Versão diferente = recusada.
export const esquemaAprovar = z.object({ alteracoes: esquemaAlteracoes, privacidade: z.enum(PRIVACIDADES_TIKTOK).nullable().optional(), versao: z.number().int().positive('Atualize a tela: falta a versão que você viu.'), sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), versaoEscolhida: z.enum(['ORIGINAL', 'NARRADA']).nullable().optional() })
/** Tentar de novo um envio já aprovado (não é nova aprovação). */
export const esquemaTentarDeNovo = z.object({ privacidade: z.enum(PRIVACIDADES_TIKTOK).nullable().optional() })
// P2.50 (A1): registrar como publicado um vídeo RETIDO exige a confirmação explícita da titular (fica auditada).
export const esquemaPublicadoConfirmado = z.object({ url: z.string().trim().url('Cole o link do vídeo no TikTok.').max(500), confirmoPublicacaoRetida: z.boolean().optional() })
export const esquemaAjuste = z.object({ motivo: z.string().trim().min(3, 'Diga o que ajustar.').max(500), alteracoes: esquemaAlteracoes })
export const esquemaRejeitar = z.object({ motivo: z.string().trim().min(3, 'Diga por que rejeitou.').max(500) })
export const esquemaPublicado = z.object({ url: z.string().trim().url('Cole o link do vídeo no TikTok.').max(500) })

const metrica = z.number().finite().nonnegative().nullable().optional()
export const esquemaMetricas = z.object({
  views: metrica,
  retencaoMedia: metrica,
  tempoMedioSeg: metrica,
  cliquesProduto: metrica,
  ctr: metrica,
  adicoesCarrinho: metrica,
  vendas: metrica,
  comissao: metrica,
  receita: metrica,
})

export function lerCorpo<T>(esquema: z.ZodType<T>, corpo: unknown): { ok: true; dados: T } | { ok: false; resposta: NextResponse } {
  const r = esquema.safeParse(corpo)
  if (r.success) return { ok: true, dados: r.data }
  return { ok: false, resposta: NextResponse.json({ error: r.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 }) }
}

export function respostaDeErroAssistido(e: unknown) {
  if (e instanceof ErroAssistido || e instanceof ErroDeResultado) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error('Erro no modo assistido:', e)
  return NextResponse.json({ error: 'Erro interno no modo assistido.' }, { status: 500 })
}
