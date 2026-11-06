/**
 * P2.18.10 — AUTORIZAÇÃO DE MÍDIA DO VENDEDOR (geral ou específica).
 *
 * Mídia do vendedor (origem FORNECEDOR) é BLOQUEADA por padrão: a política do
 * TikTok Shop proíbe usar conteúdo de terceiros sem autorização. Com uma
 * autorização APROVADA e registrada (texto + resposta + prova), ela passa a
 * valer como TERMO DE LICENÇA no mesmo preflight de publicação (origem
 * LICENCIADO, termo `autorizacao-vendedor:<id>`): nenhuma régua paralela.
 *
 * Regras:
 *  - silêncio nunca é autorização; resposta ambígua = PENDENTE_DE_REVISAO;
 *  - GERAL vale para os produtos da MESMA loja (associados a ela); outra loja não reaproveita;
 *  - indício de direito de terceiro (creator/influenciador/música/marca/não é da loja) →
 *    VERIFICAR_DIREITOS_ESPECIFICOS: a geral não basta, só uma ESPECIFICA do produto;
 *  - revogação/expiração: bloqueia o uso FUTURO (conferido a cada uso); publicado fica;
 *  - nada é enviado ao vendedor pelo Patrono: a titular copia a mensagem e registra a resposta.
 */
import type { AutorizacaoDeMidiaDoVendedor } from '@prisma/client'
import { prisma } from './prisma'
import { registrarEvento } from './ledger'

export const MENSAGEM_PADRAO_GERAL = `Olá! Tudo bem?
Sou afiliada dos produtos da sua loja e gostaria de solicitar uma autorização geral para utilização dos conteúdos audiovisuais disponibilizados por vocês na divulgação dos produtos que eu promover como afiliada.
A autorização abrangeria os vídeos e imagens dos produtos da loja que eu estiver efetivamente divulgando, para uso em TikTok, Instagram e outros canais digitais vinculados à minha atuação como afiliada.
Também gostaria de autorização para realizar adaptações necessárias ao formato do conteúdo, como cortes, redimensionamento, inserção de legendas, textos, CTA, identificação de conteúdo afiliado e ajustes de edição, sempre preservando as características e informações verdadeiras dos produtos.
O uso será exclusivamente para finalidade promocional e comercial dos próprios produtos da loja, sem transferência da titularidade dos conteúdos e sem utilização para finalidade diversa.
Se estiver de acordo, peço, por gentileza, que responda:
‘Autorizo o uso dos vídeos e imagens dos produtos da minha loja que forem divulgados por você como afiliada, nos termos desta mensagem.’
Agradeço muito pela parceria!`

export const STATUS_DA_AUTORIZACAO = ['PENDENTE', 'PENDENTE_DE_REVISAO', 'APROVADA', 'NEGADA', 'REVOGADA', 'EXPIRADA'] as const
export type StatusDaAutorizacao = (typeof STATUS_DA_AUTORIZACAO)[number]
export const PREFIXO_DO_TERMO = 'autorizacao-vendedor:'
/** Escopo da mensagem padrão (o que a resposta "Autorizo…" cobre). */
export const ESCOPO_DA_MENSAGEM_GERAL = {
  canaisPermitidos: ['tiktok', 'instagram', 'outros-canais-digitais'],
  tiposDeMidia: ['VIDEO', 'IMAGEM'],
  edicaoPermitida: true, cortesPermitidos: true, legendasPermitidas: true, ctaPermitido: true, usoComercialPermitido: true,
}

/** Proveniência da mídia, no vocabulário da P2.18.10. */
export type ProvenienciaDaMidia = 'USER_OWNED' | 'SELLER_AUTHORIZED' | 'SELLER_SPECIFIC_AUTHORIZATION' | 'PLATFORM_LICENSED' | 'UNKNOWN'

const sem = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Identidade da loja: id oficial quando houver; senão o nome normalizado. Nunca une lojas por semelhança. */
export function chaveDaLoja(p: { provider?: string | null; lojaId?: string | null; lojaNome: string }): string {
  return p.provider && p.lojaId ? `${p.provider}:${p.lojaId}` : `nome:${sem(p.lojaNome)}`
}

/**
 * FUNÇÃO PURA. A resposta do vendedor autoriza nos termos da mensagem?
 * APROVADA só com a afirmação inequívoca; negativa → NEGADA; o resto → PENDENTE_DE_REVISAO.
 */
export function classificarResposta(resposta: string | null | undefined): Extract<StatusDaAutorizacao, 'APROVADA' | 'NEGADA' | 'PENDENTE_DE_REVISAO' | 'PENDENTE'> {
  const t = sem(resposta ?? '')
  if (!t) return 'PENDENTE' // silêncio não é autorização
  if (/\b(nao autorizo|nao autorizamos|nao permitimos|nao permito|nao pode|proibido|negado|nao concordo)\b/.test(t)) return 'NEGADA'
  const afirma = /\bautoriz(o|amos)\b/.test(t)
  const objeto = /(videos?|imagens?|fotos?|conteudos?)/.test(t)
  const condicional = /\b(mas|porem|desde que|exceto|somente se|so se|apenas se|com excecao|nao pode|nao podem|talvez|vou ver|depois)\b/.test(t)
  if (afirma && objeto && !condicional) return 'APROVADA'
  return 'PENDENTE_DE_REVISAO'
}

export const INDICIOS_DE_TERCEIRO = ['CREATOR_TERCEIRO', 'INFLUENCIADOR', 'MUSICA_LICENCIADA', 'MARCA_DE_TERCEIRO', 'NAO_PARECE_DA_LOJA'] as const
export type IndicioDeTerceiro = (typeof INDICIOS_DE_TERCEIRO)[number]

export interface PedidoDeUso {
  candidatoId: string
  canal: string
  tipoDeMidia: 'VIDEO' | 'IMAGEM'
  /** O Patrono vai cortar/legendar/pôr texto e CTA (sempre, no vídeo gerado). */
  edita: boolean
  indicios?: IndicioDeTerceiro[]
}

/** FUNÇÃO PURA. Esta autorização cobre este uso agora? Devolve o motivo quando não cobre. */
export function cobre(a: Pick<AutorizacaoDeMidiaDoVendedor, 'status' | 'tipo' | 'candidatoIds' | 'canaisPermitidos' | 'tiposDeMidia' | 'edicaoPermitida' | 'cortesPermitidos' | 'legendasPermitidas' | 'ctaPermitido' | 'usoComercialPermitido' | 'evidenciaUrl' | 'respostaDoVendedor' | 'validaAte' | 'dataRevogacao'>, u: PedidoDeUso, agora: Date): { ok: true } | { ok: false; motivo: string } {
  if (a.status !== 'APROVADA') return { ok: false, motivo: `Autorização ${a.status.toLowerCase().replace(/_/g, ' ')}.` }
  if (a.dataRevogacao) return { ok: false, motivo: 'Autorização revogada.' }
  if (a.validaAte && a.validaAte.getTime() < agora.getTime()) return { ok: false, motivo: 'Autorização expirada.' }
  if (!a.respostaDoVendedor?.trim() && !a.evidenciaUrl?.trim()) return { ok: false, motivo: 'Sem prova registrada (resposta ou print).' }
  if (!a.candidatoIds.includes(u.candidatoId)) return { ok: false, motivo: a.tipo === 'ESPECIFICA' ? 'A autorização específica é de outro produto.' : 'O produto não é desta loja (sem associação).' }
  if ((u.indicios ?? []).length && a.tipo !== 'ESPECIFICA') return { ok: false, motivo: `VERIFICAR_DIREITOS_ESPECIFICOS: indício de direito de terceiro (${u.indicios!.join(', ').toLowerCase()}). A autorização geral da loja não basta.` }
  const canalOk = a.canaisPermitidos.includes(u.canal) || a.canaisPermitidos.includes('outros-canais-digitais')
  if (!canalOk) return { ok: false, motivo: `Canal ${u.canal} fora do escopo autorizado.` }
  if (!a.tiposDeMidia.includes(u.tipoDeMidia)) return { ok: false, motivo: `${u.tipoDeMidia === 'VIDEO' ? 'Vídeo' : 'Imagem'} fora do escopo autorizado.` }
  if (u.edita && !(a.edicaoPermitida && a.cortesPermitidos && a.legendasPermitidas && a.ctaPermitido)) return { ok: false, motivo: 'Edição (cortes, legenda, texto, CTA) não autorizada.' }
  if (!a.usoComercialPermitido) return { ok: false, motivo: 'Uso comercial não autorizado.' }
  return { ok: true }
}

// ── Operação (banco) ────────────────────────────────────────────────────

export class ErroDeAutorizacao extends Error {
  constructor(public readonly status: 400 | 404 | 409, mensagem: string) {
    super(mensagem)
  }
}

/** A autorização (geral da loja do produto, ou específica do produto) que vale para este uso — ou o motivo. */
export async function autorizacaoParaUso(workspaceId: string, u: PedidoDeUso, agora = new Date()): Promise<{ autorizacao: AutorizacaoDeMidiaDoVendedor | null; motivo: string }> {
  const todas = await prisma.autorizacaoDeMidiaDoVendedor.findMany({ where: { workspaceId, candidatoIds: { has: u.candidatoId } }, orderBy: [{ tipo: 'desc' }, { dataAprovacao: 'desc' }] })
  if (!todas.length) return { autorizacao: null, motivo: 'Autorização necessária: nenhuma autorização do vendedor para este produto.' }
  let motivo = ''
  for (const a of todas) {
    const r = cobre(a, u, agora)
    if (r.ok) return { autorizacao: a, motivo: `Autorização ${a.tipo === 'GERAL' ? 'geral da loja' : 'específica'} APROVADA (${a.lojaNome}).` }
    motivo ||= r.motivo
  }
  return { autorizacao: null, motivo }
}

/** Situação para a tela ("MÍDIA DO VENDEDOR: Autorização geral APROVADA" / "Autorização necessária"). */
export async function situacaoDaMidiaDoVendedor(workspaceId: string, candidatoId: string, agora = new Date()) {
  const r = await autorizacaoParaUso(workspaceId, { candidatoId, canal: 'tiktok', tipoDeMidia: 'VIDEO', edita: true }, agora)
  const pendente = r.autorizacao ? null : await prisma.autorizacaoDeMidiaDoVendedor.findFirst({ where: { workspaceId, candidatoIds: { has: candidatoId }, status: { in: ['PENDENTE', 'PENDENTE_DE_REVISAO'] } }, orderBy: { createdAt: 'desc' } })
  return {
    autorizada: !!r.autorizacao,
    rotulo: r.autorizacao ? `Autorização ${r.autorizacao.tipo === 'GERAL' ? 'geral' : 'específica'}: APROVADA` : pendente ? `Autorização ${pendente.status === 'PENDENTE' ? 'solicitada: aguardando resposta' : 'em revisão'}` : 'Autorização necessária',
    motivo: r.motivo,
    autorizacaoId: r.autorizacao?.id ?? pendente?.id ?? null,
    loja: r.autorizacao?.lojaNome ?? pendente?.lojaNome ?? null,
    mensagem: MENSAGEM_PADRAO_GERAL,
  }
}

/**
 * SOLICITAR (registra o pedido; a titular envia a mensagem pelo app). Se a loja
 * já tem uma GERAL aprovada/pendente, só associa o produto a ela — não pede de novo.
 */
export async function solicitarAutorizacao(p: { workspaceId: string; userId: string; candidatoId: string; lojaNome: string; lojaId?: string | null; provider?: string | null; vendedorNome?: string | null; tipo?: 'GERAL' | 'ESPECIFICA'; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const tipo = p.tipo ?? 'GERAL'
  if (!p.lojaNome.trim()) throw new ErroDeAutorizacao(400, 'Informe a loja.')
  const lojaChave = chaveDaLoja({ provider: p.provider, lojaId: p.lojaId, lojaNome: p.lojaNome })
  if (tipo === 'GERAL') {
    const existente = await prisma.autorizacaoDeMidiaDoVendedor.findFirst({ where: { workspaceId: p.workspaceId, lojaChave, tipo: 'GERAL', status: { in: ['APROVADA', 'PENDENTE', 'PENDENTE_DE_REVISAO'] } }, orderBy: { createdAt: 'desc' } })
    if (existente) {
      if (!existente.candidatoIds.includes(p.candidatoId)) await prisma.autorizacaoDeMidiaDoVendedor.update({ where: { id: existente.id }, data: { candidatoIds: { push: p.candidatoId } } })
      return prisma.autorizacaoDeMidiaDoVendedor.findUniqueOrThrow({ where: { id: existente.id } })
    }
  }
  const a = await prisma.autorizacaoDeMidiaDoVendedor.create({
    data: {
      workspaceId: p.workspaceId, lojaChave, lojaId: p.lojaId ?? null, lojaNome: p.lojaNome.trim(), vendedorNome: p.vendedorNome ?? null, tipo, candidatoIds: [p.candidatoId], status: 'PENDENTE',
      ...ESCOPO_DA_MENSAGEM_GERAL, textoDaAutorizacao: MENSAGEM_PADRAO_GERAL, dataSolicitacao: agora,
    },
  })
  await registrarEvento({ workspaceId: p.workspaceId, tipo: 'MEDIA_AUTHORIZATION_REQUESTED', chaveIdempotencia: `autorizacao-midia:${a.id}:solicitada`, entidadeTipo: 'AutorizacaoDeMidiaDoVendedor', entidadeId: a.id, payload: { loja: a.lojaNome, tipo, userId: p.userId, enviadaPeloPatrono: false } })
  return a
}

/** REGISTRAR RESPOSTA (texto colado e/ou print). Classifica; silêncio continua PENDENTE. */
export async function registrarResposta(p: { workspaceId: string; userId: string; id: string; resposta?: string | null; evidenciaUrl?: string | null; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const a = await prisma.autorizacaoDeMidiaDoVendedor.findFirst({ where: { id: p.id, workspaceId: p.workspaceId } })
  if (!a) throw new ErroDeAutorizacao(404, 'Autorização não encontrada.')
  if (['REVOGADA', 'EXPIRADA'].includes(a.status)) throw new ErroDeAutorizacao(409, `Esta autorização está ${a.status.toLowerCase()}: peça uma nova.`)
  const resposta = (p.resposta ?? '').trim() || null
  const evidenciaUrl = (p.evidenciaUrl ?? '').trim() || null
  if (!resposta && !evidenciaUrl) throw new ErroDeAutorizacao(400, 'Cole a resposta do vendedor ou envie o print.')
  // Só o print, sem o texto: alguém precisa ler — fica em revisão (o Patrono não "lê" imagem como autorização).
  const status = resposta ? classificarResposta(resposta) : 'PENDENTE_DE_REVISAO'
  const r = await prisma.autorizacaoDeMidiaDoVendedor.update({
    where: { id: a.id },
    data: { respostaDoVendedor: resposta ?? a.respostaDoVendedor, evidenciaUrl: evidenciaUrl ?? a.evidenciaUrl, status, dataAprovacao: status === 'APROVADA' ? agora : null },
  })
  await registrarEvento({ workspaceId: p.workspaceId, tipo: status === 'APROVADA' ? 'MEDIA_AUTHORIZED' : 'MEDIA_AUTHORIZATION_RESPONSE', chaveIdempotencia: `autorizacao-midia:${a.id}:resposta:${agora.toISOString()}`, entidadeTipo: 'AutorizacaoDeMidiaDoVendedor', entidadeId: a.id, payload: { status, comPrint: !!evidenciaUrl, userId: p.userId } })
  if (status === 'APROVADA') await reavaliarMidiasDoVendedor(p.workspaceId, r.candidatoIds, agora)
  return r
}

/** A titular confirma, depois de ler, uma resposta em revisão (ex.: só o print). */
export async function confirmarRevisao(p: { workspaceId: string; userId: string; id: string; aprovar: boolean; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const a = await prisma.autorizacaoDeMidiaDoVendedor.findFirst({ where: { id: p.id, workspaceId: p.workspaceId, status: 'PENDENTE_DE_REVISAO' } })
  if (!a) throw new ErroDeAutorizacao(409, 'Nada em revisão nesta autorização.')
  if (!a.respostaDoVendedor && !a.evidenciaUrl) throw new ErroDeAutorizacao(409, 'Sem prova registrada.')
  const r = await prisma.autorizacaoDeMidiaDoVendedor.update({ where: { id: a.id }, data: { status: p.aprovar ? 'APROVADA' : 'NEGADA', dataAprovacao: p.aprovar ? agora : null, observacoes: `${a.observacoes ? `${a.observacoes} · ` : ''}Revisada pela titular em ${agora.toISOString()}.` } })
  await registrarEvento({ workspaceId: p.workspaceId, tipo: p.aprovar ? 'MEDIA_AUTHORIZED' : 'MEDIA_AUTHORIZATION_RESPONSE', chaveIdempotencia: `autorizacao-midia:${a.id}:revisao:${agora.toISOString()}`, entidadeTipo: 'AutorizacaoDeMidiaDoVendedor', entidadeId: a.id, payload: { status: r.status, userId: p.userId, revisadaPelaTitular: true } })
  if (p.aprovar) await reavaliarMidiasDoVendedor(p.workspaceId, r.candidatoIds, agora)
  return r
}

/** Associa outro produto à loja (para reaproveitar a autorização GERAL). */
export async function associarProdutoALoja(p: { workspaceId: string; id: string; candidatoId: string }) {
  const a = await prisma.autorizacaoDeMidiaDoVendedor.findFirst({ where: { id: p.id, workspaceId: p.workspaceId, tipo: 'GERAL' } })
  if (!a) throw new ErroDeAutorizacao(404, 'Autorização geral não encontrada.')
  if (!a.candidatoIds.includes(p.candidatoId)) await prisma.autorizacaoDeMidiaDoVendedor.update({ where: { id: a.id }, data: { candidatoIds: { push: p.candidatoId } } })
  if (a.status === 'APROVADA') await reavaliarMidiasDoVendedor(p.workspaceId, [p.candidatoId], new Date())
}

/**
 * REVOGAR: bloqueia o uso FUTURO. Mídias que dependiam dela voltam a BLOQUEADA;
 * publicações ainda não feitas que usam essas mídias voltam a pedir mídia.
 * O que já foi publicado não muda.
 */
export async function revogarAutorizacao(p: { workspaceId: string; userId: string; id: string; motivo?: string; agora?: Date }) {
  const agora = p.agora ?? new Date()
  const a = await prisma.autorizacaoDeMidiaDoVendedor.findFirst({ where: { id: p.id, workspaceId: p.workspaceId } })
  if (!a) throw new ErroDeAutorizacao(404, 'Autorização não encontrada.')
  if (a.status === 'REVOGADA') return a
  const r = await prisma.autorizacaoDeMidiaDoVendedor.update({ where: { id: a.id }, data: { status: 'REVOGADA', dataRevogacao: agora, observacoes: `${a.observacoes ? `${a.observacoes} · ` : ''}Revogada: ${p.motivo ?? 'pedido do vendedor/titular'}.` } })
  await registrarEvento({ workspaceId: p.workspaceId, tipo: 'MEDIA_AUTHORIZATION_REVOKED', chaveIdempotencia: `autorizacao-midia:${a.id}:revogada`, entidadeTipo: 'AutorizacaoDeMidiaDoVendedor', entidadeId: a.id, payload: { motivo: p.motivo ?? null, userId: p.userId } })
  await reavaliarMidiasDoVendedor(p.workspaceId, a.candidatoIds, agora)
  return r
}

/**
 * Reação a qualquer mudança de autorização: cada mídia do vendedor desses
 * produtos é reclassificada (AUTORIZADA ↔ BLOQUEADA) pela autorização vigente.
 * Publicação em andamento cujo vídeo usa mídia que perdeu o direito volta a pedir mídia.
 */
export async function reavaliarMidiasDoVendedor(workspaceId: string, candidatoIds: string[], agora: Date) {
  if (!candidatoIds.length) return { autorizadas: 0, bloqueadas: 0 }
  const { reclassificarMidiaDoVendedor } = await import('./midia-do-produto')
  const midias = await prisma.midiaDoProduto.findMany({ where: { workspaceId, candidatoId: { in: candidatoIds }, origem: 'FORNECEDOR' } })
  let autorizadas = 0
  let bloqueadas = 0
  for (const m of midias) {
    const r = await reclassificarMidiaDoVendedor(m, agora)
    if (r === 'AUTORIZADA') autorizadas++
    else bloqueadas++
  }
  // Publicações ainda não feitas que usam mídia agora bloqueada: voltam a pedir mídia (o arquivo antigo não é usado).
  const semDireito = new Set(midias.filter((m) => m.status === 'AUTORIZADA').map((m) => m.id))
  const agoraBloqueadas = await prisma.midiaDoProduto.findMany({ where: { id: { in: [...semDireito] }, status: { not: 'AUTORIZADA' } }, select: { id: true } })
  if (agoraBloqueadas.length) {
    const ids = new Set(agoraBloqueadas.map((m) => m.id))
    const assistidas = await prisma.publicacaoAssistida.findMany({ where: { workspaceId, candidatoId: { in: candidatoIds }, demonstracao: false, estado: { in: ['VIDEO_NA_FILA', 'GERANDO_VIDEO', 'AGUARDANDO_APROVACAO', 'APROVADO', 'FALHOU'] } } })
    for (const a of assistidas) {
      const ap = a.apresentacao as { video?: { midiaId?: string | null; midiaIds?: string[] | null } } & Record<string, unknown>
      // P2.50 (A3): o render usa TODAS as mídias (midiaIds), não só a principal: qualquer uma revogada derruba o vídeo.
      const usadas = [ap.video?.midiaId, ...(ap.video?.midiaIds ?? [])].filter((x): x is string => !!x)
      if (!usadas.some((m) => ids.has(m))) continue
      const historico = [...((a.historico as unknown[] | null) ?? []), { em: agora.toISOString(), versao: a.versao, acao: 'AUTORIZACAO_DE_MIDIA_REVOGADA', detalhe: 'A mídia do vendedor perdeu a autorização: o vídeo não pode ir ao ar. Envie outra mídia (ou peça nova autorização).' }]
      await prisma.publicacaoAssistida.updateMany({
        where: { id: a.id, estado: a.estado },
        data: { estado: 'AGUARDANDO_MIDIA', versaoFinal: undefined, apresentacao: { ...ap, video: { arquivo: null, situacao: 'FALTA_MIDIA_AUTORIZADA', explicacao: 'A autorização da mídia do vendedor foi revogada.', tentativas: 0 } } as never, historico: historico as never },
      })
    }
  }
  return { autorizadas, bloqueadas }
}

/** FUNÇÃO PURA. A proveniência de uma mídia, no vocabulário da P2.18.10. */
export function provenienciaDaMidia(m: { origem: string; evidencia: unknown }, autorizacao: Pick<AutorizacaoDeMidiaDoVendedor, 'tipo'> | null): ProvenienciaDaMidia {
  if (m.origem === 'PROPRIO') return 'USER_OWNED'
  if (m.origem === 'FORNECEDOR') return autorizacao ? (autorizacao.tipo === 'ESPECIFICA' ? 'SELLER_SPECIFIC_AUTHORIZATION' : 'SELLER_AUTHORIZED') : 'UNKNOWN'
  if (m.origem === 'LICENCIADO' || m.origem === 'GERADO_PELO_PATRONO') return 'PLATFORM_LICENSED'
  return 'UNKNOWN'
}
