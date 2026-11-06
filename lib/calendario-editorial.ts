/**
 * P2.53 — CALENDÁRIO EDITORIAL (o "calendário de conteúdo" da proposta do Lovable, integrado à Central de Operação).
 *
 * Não cria entidade nova: lê as publicações da Central (`PublicacaoAssistida`) e mostra cada uma no dia
 * planejado (`horarioPlanejado`), publicado (`publicadoEm`) ou "sem data". A situação de cada peça vem das
 * mesmas regras da Central:
 *  - três controles (técnico, comercial, conformidade) + bloco da campanha → `liberacaoParaPublicacao`;
 *  - aprovação da titular → `estado`.
 * O calendário NÃO aprova, NÃO libera e NÃO publica: a ação é sempre na Operação.
 */
import { liberacaoExibida } from './arquivo-aprovado'

export type SituacaoEditorial =
  | 'EM_PRODUCAO'        // vídeo na fila / gerando
  | 'RETIDO'             // aguardando aprovação, mas os três controles/campanha não liberam
  | 'AGUARDANDO_TITULAR' // controles ok, falta o "sim" da titular
  | 'APROVADO'           // aprovado e liberado, pronto para publicar
  | 'PUBLICANDO'
  | 'PUBLICADO'
  | 'REJEITADO'
  | 'FALHOU'

export const ROTULO_EDITORIAL: Record<SituacaoEditorial, string> = {
  EM_PRODUCAO: 'Em produção',
  RETIDO: 'Retido pelos controles',
  AGUARDANDO_TITULAR: 'Aguardando sua aprovação',
  APROVADO: 'Aprovado',
  PUBLICANDO: 'Publicando',
  PUBLICADO: 'Publicado',
  REJEITADO: 'Rejeitado',
  FALHOU: 'Falhou',
}

export interface PecaEditorial {
  id: string
  titulo: string
  canal: string
  /** ISO do dia em que a peça aparece no calendário; null = sem data definida. */
  quando: string | null
  origemDaData: 'PLANEJADO' | 'PUBLICADO' | 'SEM_DATA'
  situacao: SituacaoEditorial
  rotulo: string
  /** Motivos dos três controles/campanha quando retido. */
  motivos: string[]
  versao: number
  link: string
}

export interface AssistidaParaCalendario {
  id: string
  estado: string
  canal: string
  nomeProduto: string
  versao: number
  horarioPlanejado: Date | null
  publicadoEm: Date | null
  qualityGate: unknown
  apresentacao: unknown
  demonstracao?: boolean
}

/** FUNÇÃO PURA. */
export function pecaEditorial(a: AssistidaParaCalendario): PecaEditorial {
  let situacao: SituacaoEditorial
  let motivos: string[] = []
  // P2.72: a mesma regra exibida na Operação (inclui o sha256 do arquivo gerado)
  const lib = () => liberacaoExibida(a)
  switch (a.estado) {
    case 'VIDEO_NA_FILA':
    case 'GERANDO_VIDEO':
      situacao = 'EM_PRODUCAO'
      break
    case 'AGUARDANDO_APROVACAO': {
      const l = lib()
      situacao = l.liberado ? 'AGUARDANDO_TITULAR' : 'RETIDO'
      motivos = l.liberado ? [] : l.motivos
      break
    }
    case 'APROVADO': {
      // Aprovado pela titular, mas a liberação continua valendo: sem os controles fica retido.
      const l = lib()
      situacao = l.liberado ? 'APROVADO' : 'RETIDO'
      motivos = l.liberado ? [] : l.motivos
      break
    }
    case 'PUBLICANDO': situacao = 'PUBLICANDO'; break
    case 'PUBLICADO': situacao = 'PUBLICADO'; break
    case 'REJEITADO': situacao = 'REJEITADO'; break
    default: situacao = 'FALHOU'
  }
  const quando = a.publicadoEm ?? a.horarioPlanejado
  return {
    id: a.id,
    titulo: a.nomeProduto,
    canal: a.canal,
    quando: quando ? quando.toISOString() : null,
    origemDaData: a.publicadoEm ? 'PUBLICADO' : a.horarioPlanejado ? 'PLANEJADO' : 'SEM_DATA',
    situacao,
    rotulo: ROTULO_EDITORIAL[situacao],
    motivos,
    versao: a.versao,
    link: '/operacao',
  }
}

/** Peças do workspace (sem as de demonstração), da mais próxima para a mais distante; "sem data" no fim. */
export async function calendarioEditorial(workspaceId: string): Promise<PecaEditorial[]> {
  const { prisma } = await import('./prisma')
  const lista = await prisma.publicacaoAssistida.findMany({
    where: { workspaceId, demonstracao: false },
    select: { id: true, estado: true, canal: true, nomeProduto: true, versao: true, horarioPlanejado: true, publicadoEm: true, qualityGate: true, apresentacao: true },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })
  return lista.map(pecaEditorial).sort((x, y) => (x.quando ? 0 : 1) - (y.quando ? 0 : 1) || (x.quando ?? '').localeCompare(y.quando ?? ''))
}
