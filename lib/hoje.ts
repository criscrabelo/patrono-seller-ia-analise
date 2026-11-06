/**
 * P2.26 — "HOJE" OPERACIONAL: ao abrir o Patrono, a titular sabe na hora "o que eu preciso fazer agora?".
 *
 * Não tem motor próprio. Junta três fontes que já são únicas:
 *   - a decisão da Operação (P2.24, `decidirAgora` via `visaoDaOperacao`): o que fazer e POR QUÊ;
 *   - a central "Precisa de você" (o mesmo número do sininho): o que mais espera por ela;
 *   - o dinheiro canônico (P2.25, `lib/financeiro.ts`): confirmado separado de previsão.
 *
 * Resposta, nesta ordem: (1) a ação da jornada, se é dela; (2) senão, a primeira pendência da central;
 * (3) senão, o que o Patrono está fazendo (nada para ela agora); (4) senão, nada pendente.
 */
import type { VisaoDaOperacao } from './jornada'
import type { PendenciaDaCentral } from './precisa-de-voce-central'
import type { SomaFinanceira } from './financeiro'

export const PERGUNTA_DO_HOJE = 'O que eu preciso fazer agora?'

export interface HojeOperacional {
  geradoEm: string
  pergunta: typeof PERGUNTA_DO_HOJE
  resposta: {
    /** FAZER = é com você; AGUARDAR = o Patrono/terceiro está fazendo; NADA = nada pendente. */
    tipo: 'FAZER' | 'AGUARDAR' | 'NADA'
    titulo: string
    produto: string | null
    porque: string[]
    tempoEstimado: string | null
    link: string
    botao: string
    origem: 'JORNADA' | 'CENTRAL' | 'NENHUMA'
  }
  /** O que vem depois (e por que não vem antes). */
  depois: { titulo: string; porqueNao: string }[]
  /** Pendências esperando por ela — o MESMO número do sininho. */
  esperandoVoce: number
  /** Prazo real mais próximo (missão/campanha), quando houver. */
  prazo: { titulo: string; em: string } | null
  /** Dinheiro pela fonte canônica: confirmado nunca se mistura com previsão. */
  dinheiro: { confirmada30d: number; previsao: number; revertida30d: number } | null
  /** Restrição da plataforma que muda o que dá para fazer hoje (quota oficial). */
  restricao: string | null
}

/** FUNÇÃO PURA. `visao` = null quando a Operação não está liberada para a conta. */
export function montarHoje(p: { visao: VisaoDaOperacao | null; central: PendenciaDaCentral[]; dinheiro30d: SomaFinanceira | null; dinheiroAberto: SomaFinanceira | null; agora: Date }): HojeOperacional {
  const v = p.visao
  const decisao = v?.agora ?? null
  const top = v?.prioritaria ?? null
  const ehDela = !!top && top.espera === 'AGUARDANDO_CRISTIANE'
  const primeira = p.central[0] ?? null
  let resposta: HojeOperacional['resposta']
  if (decisao && ehDela) {
    resposta = { tipo: 'FAZER', titulo: decisao.titulo, produto: top!.produto.nome, porque: decisao.porque, tempoEstimado: top!.acao?.tempoEstimado || null, link: '/operacao', botao: 'FAZER AGORA', origem: 'JORNADA' }
  } else if (primeira) {
    resposta = { tipo: 'FAZER', titulo: primeira.titulo, produto: null, porque: [primeira.motivo, primeira.impacto].filter((x) => !!x), tempoEstimado: null, link: primeira.acao.link ?? '/precisa-de-voce', botao: (primeira.acao.rotulo || 'Resolver').toUpperCase(), origem: 'CENTRAL' }
  } else if (decisao) {
    resposta = { tipo: 'AGUARDAR', titulo: decisao.titulo, produto: top?.produto.nome ?? null, porque: ['nenhuma ação sua agora', ...decisao.porque], tempoEstimado: null, link: '/operacao', botao: 'VER A OPERAÇÃO', origem: 'JORNADA' }
  } else {
    resposta = { tipo: 'NADA', titulo: 'Nada pendente agora', produto: null, porque: ['nenhuma jornada ativa e nada esperando por você'], tempoEstimado: null, link: v ? '/operacao' : '/oportunidades', botao: v ? 'ABRIR A OPERAÇÃO' : 'VER OPORTUNIDADES', origem: 'NENHUMA' }
  }
  // "Depois": o resto da decisão; quando a resposta veio da central, a ação da jornada vira o primeiro "depois".
  const depois = resposta.origem === 'CENTRAL' && decisao ? [{ titulo: decisao.titulo, porqueNao: 'a pendência acima vem antes' }, ...decisao.alternativas] : decisao?.alternativas ?? []
  const prazoV = v?.hoje.prazoMaisProximo ?? null
  const prazoC = p.central.filter((x) => x.prazo).sort((a, b) => a.prazo!.localeCompare(b.prazo!))[0] ?? null
  const prazo = prazoV ? { titulo: prazoV.titulo, em: prazoV.fim } : prazoC ? { titulo: prazoC.titulo, em: prazoC.prazo! } : null
  return {
    geradoEm: p.agora.toISOString(),
    pergunta: PERGUNTA_DO_HOJE,
    resposta,
    depois: depois.slice(0, 2).map((x) => ({ titulo: x.titulo, porqueNao: x.porqueNao })),
    esperandoVoce: p.central.length,
    prazo,
    dinheiro: p.dinheiro30d && p.dinheiroAberto ? { confirmada30d: p.dinheiro30d.confirmada, previsao: p.dinheiroAberto.previsao, revertida30d: p.dinheiro30d.revertida } : null,
    restricao: v?.hoje.quota && v.hoje.quota.resultado === 'BLOQUEADA' ? v.hoje.quota.texto : null,
  }
}

const DIA = 86_400_000

/** Carrega e monta. Cada fonte que falhar vira "sem dado", nunca derruba a resposta. */
export async function hojeOperacional(workspaceId: string, agora: Date = new Date()): Promise<HojeOperacional> {
  const [{ flagLigada }, { carregarOperacao, visaoDaOperacao }, { centralPrecisaDeVoce }, { resumoFinanceiro }, { log }] = await Promise.all([
    import('./feature-flags'), import('./jornada'), import('./precisa-de-voce-central'), import('./financeiro'), import('./observabilidade'),
  ])
  const falhou = (fonte: string) => (e: unknown) => { log('error', 'hoje.fonte_falhou', { workspaceId, fonte, erro: String(e).slice(0, 300) }); return null }
  const operacaoLiberada = await flagLigada('CENTRAL_DE_APROVACOES', workspaceId).catch(() => false)
  // A central recebe a visão já carregada: a Operação é carregada UMA vez (mesma decisão, metade do trabalho).
  const visaoECentral = (operacaoLiberada ? carregarOperacao(workspaceId, agora).then(visaoDaOperacao).catch(falhou('operacao')) : Promise.resolve(null))
    .then(async (visao) => ({ visao, central: await centralPrecisaDeVoce(workspaceId, agora, visao).catch(falhou('central')) }))
  const [{ visao, central }, dinheiro30d, dinheiroAberto] = await Promise.all([
    visaoECentral,
    resumoFinanceiro(workspaceId, { periodoDaVenda: { desde: new Date(agora.getTime() - 30 * DIA), ate: agora } }).catch(falhou('financeiro')),
    resumoFinanceiro(workspaceId).catch(falhou('financeiro')),
  ])
  return montarHoje({ visao, central: central ?? [], dinheiro30d, dinheiroAberto, agora })
}
