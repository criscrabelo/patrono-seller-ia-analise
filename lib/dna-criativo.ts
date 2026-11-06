/**
 * P2.21 — DNA CRIATIVO do resultado de vídeo.
 *
 * Só registra o que tem prova:
 *   - gancho/CTA: classificador único (ml-hook-classifier / ml-cta-classifier); sem segurança → UNKNOWN;
 *   - mídia e formato: o que o render do Patrono usou (`apresentacao.video`);
 *   - texto na tela / narração: o arquivo gerado pelo Patrono tem cenas de texto e é renderizado SEM áudio
 *     (`-an` no renderer) — fato do render; se a titular mudar no app, ela corrige;
 *   - demonstração: foto não demonstra uso (false); vídeo PRÓPRIO em formato de demonstração (true); resto null;
 *   - rosto: o Patrono não sabe (null) até a titular informar.
 * O texto original do gancho continua em `gancho` (nunca é sobrescrito).
 * Valor informado pela titular nunca é sobrescrito pela extração.
 */
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import { classificarGancho, METODO_DO_CLASSIFICADOR } from './ml-hook-classifier'
import { tipoDeCta } from './ml-cta-classifier'

export const VERSAO_DO_DNA = 'DNA@1'
const DEMONSTRA_COM_VIDEO_PROPRIO = new Set(['DEMONSTRACAO', 'UNBOXING', 'TESTE_REAL', 'ANTES_DEPOIS'])
export const CAMPOS_INFORMAVEIS = ['temRosto', 'temDemonstracao', 'temNarracao', 'temTextoNaTela'] as const
export type CampoInformavel = (typeof CAMPOS_INFORMAVEIS)[number]
type Origem = 'CLASSIFICADOR' | 'DERIVADO_DO_RENDER' | 'INFORMADO_PELA_TITULAR'

export interface DnaCriativo {
  tipoDeGancho: string
  confiancaDoGancho: string
  metodoDoGancho: string
  tipoDeCta: string
  formatoDoConteudo: string
  tipoDeMidia: string
  origemDaMidia: string
  temRosto: boolean | null
  temDemonstracao: boolean | null
  temNarracao: boolean | null
  temTextoNaTela: boolean | null
  origemDoDna: Record<string, Origem>
  versaoDoDna: string
}

interface VideoDoRender { situacao?: string; midiaTipo?: string | null; midiaOrigem?: string | null; cenas?: unknown[]; arquivo?: string | null }

/** FUNÇÃO PURA. DNA a partir do que foi publicado (versão final + vídeo do render). */
export function extrairDna(p: { gancho: string; cta: string | null; estrutura: string; video?: VideoDoRender | null; textoNaTela?: string[] | null; formatoAudiovisual?: string | null }): DnaCriativo {
  const g = classificarGancho(p.gancho)
  const v = p.video ?? null
  const gerado = v?.situacao === 'GERADO' && !!v.arquivo
  const origem: Record<string, Origem> = { tipoDeGancho: 'CLASSIFICADOR', tipoDeCta: 'CLASSIFICADOR' }
  const tipoDeMidia = gerado && (v!.midiaTipo === 'IMAGEM' || v!.midiaTipo === 'VIDEO') ? v!.midiaTipo : 'UNKNOWN'
  const formato = !gerado ? 'UNKNOWN' : tipoDeMidia === 'IMAGEM' ? 'IMAGENS_COM_TEXTO' : tipoDeMidia === 'VIDEO' ? 'VIDEO_COM_TEXTO' : 'UNKNOWN'
  let temTextoNaTela: boolean | null = null
  let temNarracao: boolean | null = null
  let temDemonstracao: boolean | null = null
  if (gerado) {
    temTextoNaTela = (v!.cenas?.length ?? 0) > 0 || (p.textoNaTela?.length ?? 0) > 0
    // P2.33.1: narração escolhida na aprovação (gravação real ou voz local) = vídeo COM narração.
    temNarracao = p.formatoAudiovisual === 'NARRACAO_GRAVADA' || p.formatoAudiovisual === 'NARRACAO_VOZ_LOCAL' || p.formatoAudiovisual === 'NARRACAO_VOZ_LICENCIADA'
    origem.temTextoNaTela = 'DERIVADO_DO_RENDER'; origem.temNarracao = 'DERIVADO_DO_RENDER'
    if (tipoDeMidia === 'IMAGEM') { temDemonstracao = false; origem.temDemonstracao = 'DERIVADO_DO_RENDER' }
    else if (tipoDeMidia === 'VIDEO' && v!.midiaOrigem === 'PROPRIO' && DEMONSTRA_COM_VIDEO_PROPRIO.has(p.estrutura)) { temDemonstracao = true; origem.temDemonstracao = 'DERIVADO_DO_RENDER' }
  }
  if (tipoDeMidia !== 'UNKNOWN') origem.tipoDeMidia = 'DERIVADO_DO_RENDER'
  return {
    tipoDeGancho: g.tipo, confiancaDoGancho: g.confianca, metodoDoGancho: g.metodo, tipoDeCta: tipoDeCta(p.cta),
    formatoDoConteudo: formato, tipoDeMidia, origemDaMidia: gerado && v!.midiaOrigem ? v!.midiaOrigem : 'UNKNOWN',
    temRosto: null, temDemonstracao, temNarracao, temTextoNaTela, origemDoDna: origem, versaoDoDna: VERSAO_DO_DNA,
  }
}

/** DNA de uma publicação assistida (o que `concluirPublicacaoAssistida` grava junto com o resultado). */
export function dnaDaAssistida(a: { apresentacao: unknown; versaoFinal: unknown }, final: { gancho: string; cta: string; estrutura: string }) {
  const ap = (a.apresentacao ?? {}) as { video?: VideoDoRender; textoNaTela?: string[]; formatoAudiovisual?: string }
  const d = extrairDna({ gancho: final.gancho, cta: final.cta, estrutura: final.estrutura, video: ap.video ?? null, textoNaTela: ap.textoNaTela ?? null, formatoAudiovisual: ap.formatoAudiovisual ?? null })
  return { ...d, origemDoDna: d.origemDoDna as unknown as Prisma.InputJsonValue }
}

/**
 * Garante o DNA dos resultados do workspace (idempotente, seguro em paralelo):
 *   - sem DNA → extrai (da publicação assistida, quando houver);
 *   - DNA com classificador antigo → reclassifica só gancho/CTA;
 *   - nunca mexe no que a titular informou nem no texto original.
 * Cada update é condicional ao estado lido (duas execuções simultâneas não gravam duas vezes).
 */
export async function garantirDnaDosResultados(workspaceId: string): Promise<{ extraidos: number; reclassificados: number }> {
  const pendentes = await prisma.videoTikTokResultado.findMany({
    where: { workspaceId, OR: [{ versaoDoDna: null }, { metodoDoGancho: { not: METODO_DO_CLASSIFICADOR } }] },
    select: { id: true, gancho: true, ctaTexto: true, estrutura: true, publicacaoAssistidaId: true, versaoDoDna: true, metodoDoGancho: true, origemDoDna: true, temRosto: true, temDemonstracao: true, temNarracao: true, temTextoNaTela: true },
    take: 500,
  })
  if (!pendentes.length) return { extraidos: 0, reclassificados: 0 }
  const ids = pendentes.map((p) => p.publicacaoAssistidaId).filter((x): x is string => !!x)
  const assistidas = new Map((ids.length ? await prisma.publicacaoAssistida.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, apresentacao: true } }) : []).map((a) => [a.id, a]))
  let extraidos = 0, reclassificados = 0
  for (const r of pendentes) {
    const ap = r.publicacaoAssistidaId ? ((assistidas.get(r.publicacaoAssistidaId)?.apresentacao ?? {}) as { video?: VideoDoRender; textoNaTela?: string[]; formatoAudiovisual?: string }) : {}
    const d = extrairDna({ gancho: r.gancho, cta: r.ctaTexto, estrutura: r.estrutura, video: ap.video ?? null, textoNaTela: ap.textoNaTela ?? null, formatoAudiovisual: ap.formatoAudiovisual ?? null })
    const origemAtual = (r.origemDoDna ?? {}) as Record<string, Origem>
    if (r.versaoDoDna == null) {
      const dados: Prisma.VideoTikTokResultadoUpdateManyMutationInput = { ...d, origemDoDna: d.origemDoDna as unknown as Prisma.InputJsonValue }
      const origemFinal = { ...d.origemDoDna }
      for (const c of CAMPOS_INFORMAVEIS) if (origemAtual[c] === 'INFORMADO_PELA_TITULAR') { delete (dados as Record<string, unknown>)[c]; origemFinal[c] = 'INFORMADO_PELA_TITULAR' }
      dados.origemDoDna = origemFinal as unknown as Prisma.InputJsonValue
      const n = await prisma.videoTikTokResultado.updateMany({ where: { id: r.id, versaoDoDna: null }, data: dados })
      extraidos += n.count
    } else {
      const n = await prisma.videoTikTokResultado.updateMany({ where: { id: r.id, metodoDoGancho: r.metodoDoGancho }, data: { tipoDeGancho: d.tipoDeGancho, confiancaDoGancho: d.confiancaDoGancho, metodoDoGancho: d.metodoDoGancho, tipoDeCta: d.tipoDeCta } })
      reclassificados += n.count
    }
  }
  return { extraidos, reclassificados }
}

/** A titular informa o que o Patrono não sabe (ex.: aparece rosto). `null` volta a UNKNOWN. */
export async function informarDna(p: { workspaceId: string; userId: string | null; id: string; valores: Partial<Record<CampoInformavel, boolean | null>> }) {
  const atual = await prisma.videoTikTokResultado.findFirst({ where: { id: p.id, workspaceId: p.workspaceId }, select: { id: true, origemDoDna: true } })
  if (!atual) return null
  const origem = { ...((atual.origemDoDna ?? {}) as Record<string, Origem>) }
  const dados: Record<string, boolean | null> = {}
  for (const c of CAMPOS_INFORMAVEIS) {
    if (!(c in p.valores)) continue
    const v = p.valores[c]
    if (v !== null && typeof v !== 'boolean') continue
    dados[c] = v ?? null
    if (v === null) delete origem[c]
    else origem[c] = 'INFORMADO_PELA_TITULAR'
  }
  if (!Object.keys(dados).length) return atual
  const r = await prisma.videoTikTokResultado.update({ where: { id: atual.id }, data: { ...dados, origemDoDna: origem as unknown as Prisma.InputJsonValue } })
  await registrarAuditoria({ workspaceId: p.workspaceId, userId: p.userId ?? undefined, action: 'tiktok.dna_informado', entityType: 'VideoTikTokResultado', entityId: r.id, metadata: { campos: Object.keys(dados) } })
  return r
}
