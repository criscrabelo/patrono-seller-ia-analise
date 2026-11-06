/**
 * P2.68 — GESTOR DA OPERAÇÃO: o Patrono como negócio coordenado por objetivo (primeira venda), não como ferramentas
 * soltas. FUNÇÃO PURA sobre fatos registrados; o script `scripts/gestor/rodar-gestor.ts` lê os registros, chama isto
 * e grava as tarefas na fila persistente da P2.63 (uma por vez, com trava e retomada).
 *
 *  - escolhe a OPORTUNIDADE PRINCIPAL pelos portões (lib/ciclo-comercial.ts → priorizarOportunidades), não pela comissão;
 *  - transforma cada pendência em TAREFA para a ferramenta que já existe (nenhuma ferramenta nova);
 *  - acompanha cada campanha pelos critérios verificáveis de etapa (etapaDaCampanha);
 *  - devolve à titular SÓ as decisões indispensáveis: pendências dela que travam a principal (no máximo 3).
 */
import { etapaDaCampanha, portoesDaOportunidade, priorizarOportunidades, type EvidenciasDaCampanha, type FatosDaOportunidade, type Portao, type QuemResolve } from './ciclo-comercial'

/** Ferramenta existente que resolve cada portão/etapa (o gestor distribui; não executa nada sozinho). */
export const FERRAMENTA_DO_PORTAO: Record<Portao, string> = {
  ELEGIBILIDADE: 'Painel oficial do programa no Chrome (leitura) + registro do link em oportunidades.json',
  DIREITOS_DE_MIDIA: 'Termos do programa/produtor (leitura) → manifestoDeDireitos (lib/ciclo-comercial.ts)',
  CANAL: 'Página de links (lib/pagina-de-links.ts → scripts/gestor/gerar-pagina-de-links.ts) ou marcação nativa',
  VIABILIDADE_DE_CONTEUDO: 'Studio (scripts/producao/produzir-video.mjs) + revisão independente (scripts/revisao/) + barreira',
}

export interface TarefaDoGestor { id: string; oportunidade: string; titulo: string; ferramenta: string; quem: QuemResolve; aprovacao: boolean; prioridade: number }
export interface DecisaoIndispensavel { oportunidade: string; decisao: string; porque: string }
export interface RelatorioDoGestor {
  principal: { id: string; nome: string; pendencias: number } | null
  ranking: { id: string; nome: string; pendencias: number; daTitular: number; deTerceiro: number; bloqueio: string | null }[]
  tarefas: TarefaDoGestor[]
  decisoes: DecisaoIndispensavel[]
  campanhas: { id: string; etapaAtual: string | null; falta: string | null; prontaParaATitular: boolean }[]
}

const slug = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
/** id estável: oportunidade + CHAVE da pendência (reescrever o texto não cria tarefa nova nem "resolve" a antiga) */
export const idDaTarefa = (oportunidade: string, chave: string) => `G-${slug(oportunidade)}-${chave}`

/**
 * Re-revisão (defeito novo 1): o que pode ser FECHADO na fila. Uma tarefa do gestor só é resolvida quando a oportunidade
 * AINDA está no registro e, avaliada por INTEIRO (todos os portões, não só o recorte da principal), aquela pendência
 * não existe mais. Oportunidade que saiu do registro → tarefa fica BLOQUEADA para revisão, nunca CONCLUIDA.
 */
export function situacaoDasTarefasDoGestor(ops: FatosDaOportunidade[], idsNaFila: string[]): { resolvidas: string[]; semOportunidade: string[] } {
  const vivas = new Set<string>(), prefixos = new Map<string, string>()
  for (const o of ops) { prefixos.set(`G-${slug(o.id)}-`, o.id); for (const p of portoesDaOportunidade(o)) for (const x of p.pendencias) vivas.add(idDaTarefa(o.id, x.chave)) }
  const resolvidas: string[] = [], semOportunidade: string[] = []
  for (const id of idsNaFila) {
    if (!id.startsWith('G-')) continue
    const dona = [...prefixos.keys()].sort((a, b) => b.length - a.length).find((pre) => id.startsWith(pre))
    if (!dona) semOportunidade.push(id)
    else if (!vivas.has(id)) resolvidas.push(id)
  }
  return { resolvidas, semOportunidade }
}

export function planejarOperacao(ops: FatosDaOportunidade[], campanhas: { id: string; oportunidade: string; evidencias: EvidenciasDaCampanha }[], agora: Date): RelatorioDoGestor {
  const { ordem, principal } = priorizarOportunidades(ops)
  const tarefas: TarefaDoGestor[] = []
  ordem.forEach((o, rank) => {
    // a principal recebe a fila inteira; as demais só tarefas do Patrono que não dependem de ninguém (paralelo)
    for (const p of o.portoes) for (const x of p.pendencias) {
      if (o.fatos.id !== principal && x.quem !== 'PATRONO') continue
      tarefas.push({ id: idDaTarefa(o.fatos.id, x.chave), oportunidade: o.fatos.id, titulo: x.texto, ferramenta: FERRAMENTA_DO_PORTAO[p.portao], quem: x.quem, aprovacao: x.quem === 'TITULAR', prioridade: o.fatos.id === principal ? 1 : 10 + rank })
    }
  })
  const p = ordem.find((o) => o.fatos.id === principal)
  const decisoes: DecisaoIndispensavel[] = (p?.portoes ?? []).flatMap((po) => po.pendencias.filter((x) => x.quem === 'TITULAR').map((x) => ({ oportunidade: p!.fatos.id, decisao: x.texto, porque: `trava o portão ${po.portao} da oportunidade principal` }))).slice(0, 3)
  return {
    principal: p ? { id: p.fatos.id, nome: p.fatos.nome, pendencias: p.pendencias } : null,
    ranking: ordem.map((o) => ({ id: o.fatos.id, nome: o.fatos.nome, pendencias: o.pendencias, daTitular: o.daTitular, deTerceiro: o.deTerceiro, bloqueio: o.fatos.retidoPelaTitular ? 'retida pela titular' : o.deTerceiro ? o.portoes.flatMap((x) => x.pendencias).find((x) => x.quem === 'TERCEIRO')!.texto : null })),
    tarefas,
    decisoes,
    campanhas: campanhas.map((c) => { const e = etapaDaCampanha(c.evidencias, agora); return { id: c.id, etapaAtual: e.atual, falta: e.falta, prontaParaATitular: e.prontaParaATitular } }),
  }
}
