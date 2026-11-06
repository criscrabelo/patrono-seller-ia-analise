/**
 * P2.17.18 — Motor de evidência real do TikTok Shop (observação MANUAL).
 *
 * O app oficial mostra sinais comercialmente importantes (Mais vendidos,
 * Tendências, vendas exibidas, comissão estimada, amostra grátis/reembolsável,
 * estoque, posição no ranking) que nenhuma API liberada para nós entrega.
 * A titular VÊ e registra; o Patrono usa — sem fingir que veio de API.
 *
 * Regras:
 *   - proveniência explícita e nunca misturada: TIKTOK_APP_MANUAL |
 *     TIKTOK_RANKING_MANUAL | USER_PROVIDED aqui; OFICIAL_API vive em
 *     DadoOficialDeProduto e SEMPRE vence (o manual só preenche lacuna);
 *   - é SNAPSHOT: tem data/hora e validade; vencida, não conta;
 *   - o que não foi visto fica null (nunca zero);
 *   - "mais vendido" é evidência de DEMANDA, não decisão: quem decide é a
 *     nota econômica (lib/visoes-de-produtos.ts).
 */
import { prisma } from './prisma'

export const FONTES_MANUAIS = ['TIKTOK_APP_MANUAL', 'TIKTOK_RANKING_MANUAL', 'USER_PROVIDED'] as const
export type FonteManual = (typeof FONTES_MANUAIS)[number]
export const FONTE_OFICIAL = 'OFICIAL_API'
export const ROTULO_DA_FONTE: Record<string, string> = {
  TIKTOK_APP_MANUAL: 'visto no app do TikTok (registro manual)',
  TIKTOK_RANKING_MANUAL: 'ranking do app do TikTok (registro manual)',
  USER_PROVIDED: 'informado pela titular',
  OFICIAL_API: 'API oficial',
}
export const TIPOS_DE_AMOSTRA = ['GRATIS', 'REEMBOLSAVEL', 'NENHUMA'] as const
/** Snapshot manual vale 7 dias (ranking e comissão mudam); depois, só histórico. */
export const VALIDADE_DA_OBSERVACAO_DIAS = 7
const DIA = 24 * 60 * 60 * 1000

export class ErroDeObservacao extends Error {
  constructor(public readonly status: 400 | 404 | 409, mensagem: string) {
    super(mensagem)
  }
}

/** FUNÇÃO PURA. Nome comparável: sem acento, minúsculo, só letras/números. */
export function nomeNormalizado(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** FUNÇÃO PURA. Identidade do produto entre amostra, observação e candidato. */
export function chaveDeProduto(p: { productIdExterno?: string | null; nome: string }): string {
  return p.productIdExterno ? `tiktok-shop:${p.productIdExterno}` : `nome:${nomeNormalizado(p.nome)}`
}

/** As chaves possíveis de um candidato (id do TikTok Shop e/ou nome). */
export function chavesDoCandidato(c: { providerId: string | null; externalId: string | null; nome: string }): string[] {
  const k = [`nome:${nomeNormalizado(c.nome)}`]
  if (c.providerId === 'tiktok-shop' && c.externalId) k.unshift(`tiktok-shop:${c.externalId}`)
  return k
}

export interface DadosDaObservacao {
  nomeProduto: string
  productIdExterno?: string | null
  candidatoId?: string | null
  fonte: string
  observadoEm?: string | Date | null
  rankingCategoria?: string | null
  rankingPosicao?: number | null
  vendasExibidas?: number | null
  vendasExibidasTexto?: string | null
  comissaoExibida?: number | null
  comissaoPercentualExibida?: number | null
  preco?: number | null
  estoque?: number | null
  tipoDeAmostra?: string | null
  observacao?: string | null
}

const inteiroOuNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** FUNÇÃO PURA. Recusa API fingida, número negativo e observação vazia. */
export function validarObservacao(d: DadosDaObservacao): string | null {
  if (!d.nomeProduto?.trim()) return 'Informe o produto.'
  if (d.fonte === FONTE_OFICIAL) return 'Dado de API oficial não entra como observação manual (vem do enriquecimento oficial).'
  if (!(FONTES_MANUAIS as readonly string[]).includes(d.fonte)) return 'Fonte inválida.'
  if (d.tipoDeAmostra && !(TIPOS_DE_AMOSTRA as readonly string[]).includes(d.tipoDeAmostra)) return 'Tipo de amostra inválido.'
  for (const [k, v] of Object.entries({ rankingPosicao: d.rankingPosicao, vendasExibidas: d.vendasExibidas, comissaoExibida: d.comissaoExibida, comissaoPercentualExibida: d.comissaoPercentualExibida, preco: d.preco, estoque: d.estoque })) {
    if (v !== null && v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) return `Valor inválido em ${k}.`
  }
  if (d.rankingPosicao !== null && d.rankingPosicao !== undefined && d.rankingPosicao < 1) return 'A posição no ranking começa em 1.'
  const algumSinal = [d.rankingPosicao, d.vendasExibidas, d.vendasExibidasTexto, d.comissaoExibida, d.comissaoPercentualExibida, d.preco, d.estoque, d.tipoDeAmostra].some((v) => v !== null && v !== undefined && v !== '')
  if (!algumSinal) return 'Registre ao menos um sinal visto no app (ranking, vendas, comissão, preço, estoque ou amostra).'
  return null
}

export async function registrarObservacao(p: { workspaceId: string; userId: string | null; dados: DadosDaObservacao; agora?: Date }) {
  const erro = validarObservacao(p.dados)
  if (erro) throw new ErroDeObservacao(400, erro)
  const agora = p.agora ?? new Date()
  const d = p.dados
  const observadoEm = d.observadoEm ? new Date(d.observadoEm) : agora
  if (Number.isNaN(observadoEm.getTime()) || observadoEm.getTime() > agora.getTime() + 60_000) throw new ErroDeObservacao(400, 'Data da observação inválida.')
  return prisma.observacaoDeMercado.create({
    data: {
      workspaceId: p.workspaceId,
      chave: chaveDeProduto({ productIdExterno: d.productIdExterno, nome: d.nomeProduto }),
      candidatoId: d.candidatoId ?? null,
      nomeProduto: d.nomeProduto.trim(),
      fonte: d.fonte,
      observadoEm,
      validaAte: new Date(observadoEm.getTime() + VALIDADE_DA_OBSERVACAO_DIAS * DIA),
      rankingCategoria: d.rankingCategoria?.trim() || null,
      rankingPosicao: inteiroOuNull(d.rankingPosicao),
      vendasExibidas: inteiroOuNull(d.vendasExibidas),
      vendasExibidasTexto: d.vendasExibidasTexto?.trim() || null,
      comissaoExibida: inteiroOuNull(d.comissaoExibida),
      comissaoPercentualExibida: inteiroOuNull(d.comissaoPercentualExibida),
      preco: inteiroOuNull(d.preco),
      estoque: inteiroOuNull(d.estoque),
      tipoDeAmostra: d.tipoDeAmostra ?? null,
      observacao: d.observacao?.trim() || null,
      registradoPorUserId: p.userId,
    },
  })
}

export interface SinaisObservados {
  fonte: string
  observadoEm: string
  validaAte: string
  rankingCategoria: string | null
  rankingPosicao: number | null
  vendas: number | null
  vendasTexto: string | null
  comissaoValor: number | null
  comissaoPercentual: number | null
  preco: number | null
  estoque: number | null
  tipoDeAmostra: string | null
  aviso: string
}

type Linha = Awaited<ReturnType<typeof prisma.observacaoDeMercado.findMany>>[number]

/**
 * FUNÇÃO PURA. Junta as observações VÁLIDAS de um produto, a mais recente
 * primeiro, campo a campo (um registro pode ter só a comissão, outro só o
 * ranking). Vencidas não contam. Nada encontrado → null.
 */
export function sinaisVigentes(linhas: Linha[], agora: Date): SinaisObservados | null {
  const validas = linhas.filter((l) => l.validaAte.getTime() >= agora.getTime()).sort((a, b) => b.observadoEm.getTime() - a.observadoEm.getTime())
  if (!validas.length) return null
  const primeiro = <T>(f: (l: Linha) => T | null): T | null => {
    for (const l of validas) {
      const v = f(l)
      if (v !== null && v !== undefined) return v
    }
    return null
  }
  const maisRecente = validas[0]
  return {
    fonte: maisRecente.fonte,
    observadoEm: maisRecente.observadoEm.toISOString(),
    validaAte: maisRecente.validaAte.toISOString(),
    rankingCategoria: primeiro((l) => (l.rankingPosicao !== null ? l.rankingCategoria : null)),
    rankingPosicao: primeiro((l) => l.rankingPosicao),
    vendas: primeiro((l) => l.vendasExibidas),
    vendasTexto: primeiro((l) => l.vendasExibidasTexto),
    comissaoValor: primeiro((l) => l.comissaoExibida),
    comissaoPercentual: primeiro((l) => l.comissaoPercentualExibida),
    preco: primeiro((l) => l.preco),
    estoque: primeiro((l) => l.estoque),
    tipoDeAmostra: primeiro((l) => l.tipoDeAmostra),
    aviso: `Snapshot ${ROTULO_DA_FONTE[maisRecente.fonte] ?? maisRecente.fonte}; pode ter mudado no app.`,
  }
}

/** Sinais vigentes por chave de produto (uma ida ao banco). */
export async function sinaisPorChave(workspaceId: string, chaves: string[], agora: Date = new Date()): Promise<Map<string, SinaisObservados>> {
  if (!chaves.length) return new Map()
  const linhas = await prisma.observacaoDeMercado.findMany({ where: { workspaceId, chave: { in: [...new Set(chaves)] }, validaAte: { gte: agora } } })
  const porChave = new Map<string, Linha[]>()
  for (const l of linhas) porChave.set(l.chave, [...(porChave.get(l.chave) ?? []), l])
  const out = new Map<string, SinaisObservados>()
  for (const [k, ls] of porChave) {
    const s = sinaisVigentes(ls, agora)
    if (s) out.set(k, s)
  }
  return out
}

/**
 * FUNÇÃO PURA. Demanda (0–1) a partir da POSIÇÃO no ranking "Mais vendidos":
 * 1º = 1; cai devagar (posição 10 ≈ 0,53; 50 ≈ 0,40). Só existe com posição.
 */
export function demandaPelaPosicao(posicao: number | null): number | null {
  if (posicao === null || posicao < 1) return null
  return Math.round((1 / (1 + Math.log10(posicao) * 0.9)) * 100) / 100
}
