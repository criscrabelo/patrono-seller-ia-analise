/**
 * P2.15 (Fase 1) — Copilot determinístico (custo zero, sem IA paga).
 *
 *   texto → Interpretador → Comando tipado → executor → resposta
 *
 * O interpretador é uma interface: hoje, regras e sinônimos em português;
 * amanhã, um LLM pode ocupar o mesmo lugar SEM mudar comandos nem
 * permissões. O Copilot nunca tem atalho que a tela não tenha: toda ação
 * passa pelos mesmos motores (política, travas, aprovação, ledger).
 */
import { estadoDaOperacao, atividadeDeHoje, nomeDoCanal } from './central'
import { resumoComissoes } from './vendas-comissoes'
import { decidirPrecisaDeVoce, listarPrecisaDeVoce } from './precisa-de-voce'
import { executarCiclo, TIPO_EXCECAO } from './supervisor/ciclo'
import { entrarEmSafeMode, sairDoSafeMode } from './kill-switch'
import { listarApresentados } from './curadoria'

export type Comando =
  | { tipo: 'AJUDA' }
  | { tipo: 'STATUS' }
  | { tipo: 'PENDENCIAS' }
  | { tipo: 'HOJE' }
  | { tipo: 'PORQUE'; alvo: string | null }
  | { tipo: 'RODAR' }
  | { tipo: 'DECIDIR'; decisao: 'APROVAR' | 'REJEITAR'; numero: number }
  | { tipo: 'PAUSAR' }
  | { tipo: 'RETOMAR' }
  | { tipo: 'INTEGRACOES' }
  | { tipo: 'RESULTADO' }
  | { tipo: 'DESCONHECIDO'; texto: string }

export interface Interpretador {
  interpretar(texto: string): Comando
}

const normalizar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** Interpretador por regras (PT-BR). Ordem importa: o mais específico primeiro. */
export const interpretadorDeterministico: Interpretador = {
  interpretar(texto: string): Comando {
    const t = normalizar(texto)
    if (!t) return { tipo: 'AJUDA' }
    const decidir = t.match(/^(aprova|aprovar|aprove|sim|rejeita|rejeitar|rejeite|recusar|recusa|nao)\s*(?:o|a|item|pedido|numero|n)?\s*(\d+)$/)
    if (decidir) return { tipo: 'DECIDIR', decisao: /^(aprov|sim)/.test(decidir[1]) ? 'APROVAR' : 'REJEITAR', numero: Number(decidir[2]) }
    if (/\b(ajuda|comandos|o que voce (sabe|consegue) fazer|como (te )?uso)\b/.test(t)) return { tipo: 'AJUDA' }
    if (/\b(pausa|pausar|parar tudo|para tudo|modo de seguranca|safe mode|emergencia)\b/.test(t)) return { tipo: 'PAUSAR' }
    if (/\b(retomar|retoma|sair do (modo de seguranca|safe mode)|voltar a trabalhar|despausar)\b/.test(t)) return { tipo: 'RETOMAR' }
    if (/\b(rodar|roda|rode|atualizar|atualiza|buscar|busca|coletar|analisar|analisa|procurar)\b/.test(t)) return { tipo: 'RODAR' }
    const porque = t.match(/\b(por ?que|porque|explica|explique|motivo)\b\s*(.*)$/)
    if (porque) {
      const alvo = porque[2].replace(/^(o|a|do|da|de|este|esse|esta|essa|produto|escolheu|recomendou|recomenda)\s+/g, '').trim()
      return { tipo: 'PORQUE', alvo: alvo || null }
    }
    if (/\b(precisa de mim|pendenc\w*|pendente\w*|aprovac\w*|aprovar|decis(ao|oes) minha|o que falta)/.test(t)) return { tipo: 'PENDENCIAS' }
    if (/\b(hoje|o que (voce )?fez|o que aconteceu|atividade)\b/.test(t)) return { tipo: 'HOJE' }
    if (/\b(integra\w*|conex\w*|conectad\w*|instagram|tiktok|hotmart|shopee|token\w*|acesso\w*)\b/.test(t)) return { tipo: 'INTEGRACOES' }
    if (/\b(vendas?|comiss\w*|resultado\w*|dinheiro|faturamento|ganhei|receita\w*)\b/.test(t)) return { tipo: 'RESULTADO' }
    if (/\b(status|situacao|como (esta|vai)|o que (voce )?esta fazendo|tudo bem)\b/.test(t)) return { tipo: 'STATUS' }
    return { tipo: 'DESCONHECIDO', texto }
  },
}

export interface RespostaDoCopilot {
  comando: Comando['tipo']
  texto: string[]
  sugestoes: string[]
  /** true quando o comando mudou algo (a tela deve recarregar). */
  alterou: boolean
}

export const SUGESTOES_PADRAO = ['Como está a operação?', 'O que precisa de mim?', 'O que você fez hoje?', 'Por que este produto?', 'Rodar agora']

const AJUDA = [
  'Posso responder e agir, sempre dentro das suas regras:',
  '• "como está?" — situação do Patrono;',
  '• "o que precisa de mim?" — decisões pendentes, numeradas;',
  '• "aprovar 1" / "rejeitar 1" — decide um pedido da lista;',
  '• "o que você fez hoje?" — atividade do dia;',
  '• "por que este produto?" — explica a recomendação atual;',
  '• "rodar agora" — analisa os produtos e recomenda (não publica);',
  '• "integrações" — saúde das conexões;',
  '• "resultado" — vendas e comissões;',
  '• "pausar" / "retomar" — modo de segurança.',
]

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
function quando(iso: string, agora: Date): string {
  const min = Math.round((agora.getTime() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora há pouco'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `há ${h} h` : `em ${new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
}

const CONFIANCA_EM_FRASE: Record<string, string> = {
  SEM_HISTORICO_REAL: 'Ainda não há vendas nem cliques medidos deste produto, então a posição vem só do que dá para saber antes de publicar.',
  BAIXA: 'Tenho pouca evidência real sobre ele ainda.',
  MEDIA: 'Já há alguma evidência real a favor dele.',
  ALTA: 'Há boa evidência real a favor dele.',
}

/** Linhas técnicas do ranking (nota, pesos, percentuais) ficam de fora da conversa. */
const LINHA_TECNICA = /score|\/100|\d+%|cobertura|peso|elegíve|ML |base de evidência|empate técnico|sinais de mercado|capacidade de automatizar|sem histórico real|sem base real/i
/** Reescritas de linhas do ranking que importam, mas vêm em jargão. */
const REESCRITAS: Array<[RegExp, string]> = [
  [/^Afinidade da titular/i, 'Você já comprou este produto: isso conta a favor, mas ainda não prova que ele vende.'],
]

/** FUNÇÃO PURA: por que este produto, em linguagem de gente. */
export function explicarCandidato(
  c: { posicao: number | null; nome: string; confianca: string | null; porqueDestaPosicao: string[] | null; riscos: string[] | null },
  total: number
): string[] {
  const motivos = (c.porqueDestaPosicao ?? [])
    .map((l) => REESCRITAS.find(([re]) => re.test(l))?.[1] ?? l)
    .filter((l) => !LINHA_TECNICA.test(l))
    .slice(0, 3)
  // Riscos vêm às vezes com várias frases numa linha e repetem um motivo: uma frase por ponto, sem repetir.
  const semPonto = (t: string) => t.trim().replace(/\.+$/, '')
  const jaDito = new Set(motivos.map(semPonto))
  const atencao = [...new Set((c.riscos ?? []).flatMap((r) => r.split(/(?<=\.)\s+/)).map(semPonto).filter((t) => t && !jaDito.has(t)))]
  return [
    total === 1 ? `“${c.nome}” é a única oportunidade que separei.` : `“${c.nome}” está em ${c.posicao ?? 1}º lugar entre as ${total} oportunidades que separei.`,
    ...(c.confianca && CONFIANCA_EM_FRASE[c.confianca] ? [CONFIANCA_EM_FRASE[c.confianca]] : []),
    ...((c.porqueDestaPosicao ?? []).some((l) => /empate técnico/i.test(l)) ? ['Está empatado com outras opções: a ordem entre eles ainda não quer dizer que este seja melhor.'] : []),
    ...motivos,
    ...(atencao.length ? [`Pontos de atenção: ${atencao.join('; ')}.`] : []),
  ]
}

export async function executarComando(comando: Comando, ctx: { workspaceId: string; userId: string; agora?: Date }): Promise<RespostaDoCopilot> {
  const agora = ctx.agora ?? new Date()
  const r = (texto: string[], alterou = false, sugestoes = SUGESTOES_PADRAO): RespostaDoCopilot => ({ comando: comando.tipo, texto, sugestoes, alterou })

  switch (comando.tipo) {
    case 'AJUDA':
      return r(AJUDA)
    case 'STATUS': {
      const p = await estadoDaOperacao(ctx.workspaceId, agora)
      const e = p.patrono.estado
      const ciclo = p.patrono.ultimoCiclo
      const linhas = [
        `${e.titulo}. ${e.frase}`,
        ...(e.nota ? [e.nota] : []),
        ciclo
          ? `Minha última análise foi ${quando(ciclo.quando, agora)}${ciclo.resumo.length ? `: ${ciclo.resumo.join(' ')}` : '.'}`
          : 'Ainda não fiz nenhuma análise. Diga "rodar agora" e eu começo.',
        p.pendencias === 0 ? 'Nada está esperando você.' : p.pendencias === 1 ? '1 item precisa de você.' : `${p.pendencias} itens precisam de você.`,
        ...(p.publicacoesAtrasadas ? [p.publicacoesAtrasadas === 1 ? 'Atenção: 1 publicação está atrasada — a data passou e nada saiu.' : `Atenção: ${p.publicacoesAtrasadas} publicações estão atrasadas — a data passou e nada saiu.`] : []),
        `Próximo passo: ${p.proximaAcao.texto}`,
      ]
      return r(linhas)
    }
    case 'PENDENCIAS': {
      const itens = await listarPrecisaDeVoce(ctx.workspaceId, agora)
      if (!itens.length) return r(['Nada agora — sigo sozinho e aviso quando algo depender de você.'])
      // Só pedido de aprovação ganha atalho "aprovar N". Item que é tarefa da
      // titular (ex.: configurar o TikTok Shop) não pode ser dado como feito por atalho.
      const aprovaveis = itens.map((i, n) => ({ i, n: n + 1 })).filter(({ i }) => i.tipo !== TIPO_EXCECAO)
      const tarefas = itens.filter((i) => i.tipo === TIPO_EXCECAO && i.podeMarcarResolvido)
      const comEvidencia = itens.filter((i) => !i.podeMarcarResolvido)
      return r(
        [
          itens.length === 1 ? 'Só 1 item precisa de você:' : `${itens.length} itens precisam de você (o mais urgente primeiro):`,
          ...itens.map((i, n) => `${n + 1}. ${i.titulo} — ${i.resumo}${i.risco === 'ALTO' ? ' (urgente)' : ''}`),
          ...(aprovaveis.length ? [`Para decidir, responda "aprovar ${aprovaveis[0].n}" ou "rejeitar ${aprovaveis[0].n}".`] : []),
          ...(tarefas.length ? [`${tarefas.length === 1 ? 'Há 1 item' : `Há ${tarefas.length} itens`} para você fazer. Quando terminar, toque em "Já resolvi" em Precisa de você.`] : []),
          ...(comEvidencia.length ? [`${comEvidencia.length === 1 ? `"${comEvidencia[0].titulo}" sai` : 'Os itens de configuração saem'} da lista sozinho quando a conexão existir de verdade. Para ver os passos, abra Precisa de você e toque em "Ver como fazer".`] : []),
        ],
        false,
        aprovaveis.length ? aprovaveis.slice(0, 2).flatMap(({ n }) => [`aprovar ${n}`, `rejeitar ${n}`]) : SUGESTOES_PADRAO
      )
    }
    case 'DECIDIR': {
      const itens = await listarPrecisaDeVoce(ctx.workspaceId, agora)
      const alvo = itens[comando.numero - 1]
      if (!alvo) return r([`Não há o item ${comando.numero}. Diga "o que precisa de mim?" para ver a lista atual.`])
      if (!alvo.podeMarcarResolvido && comando.decisao === 'APROVAR')
        return r([`"${alvo.titulo}" não sai por aprovação: sai sozinho quando a conexão existir de verdade. Nada foi alterado. Os passos estão em Precisa de você, em "Ver como fazer".`])
      if (alvo.tipo === TIPO_EXCECAO && comando.decisao === 'APROVAR')
        return r([`"${alvo.titulo}" não é uma aprovação: é algo para você fazer. Nada foi alterado. Quando terminar, toque em "Já resolvi" em Precisa de você.`])
      const res = await decidirPrecisaDeVoce({ workspaceId: ctx.workspaceId, userId: ctx.userId, id: alvo.id, decisao: comando.decisao, agora })
      if (res.status === 'PENDENTE') return r([`"${alvo.titulo}": ${res.mensagem}`])
      return r([`"${alvo.titulo}": ${res.status === 'APROVADA' ? 'aprovado' : 'recusado'}. ${res.mensagem}`], true)
    }
    case 'HOJE': {
      const atividade = await atividadeDeHoje(ctx.workspaceId, agora)
      if (!atividade.length) return r(['Hoje ainda não fiz nada. Diga "rodar agora" para eu analisar os produtos.'])
      return r([
        'Hoje eu:',
        ...atividade.map((a) => `${hora(a.quando)} — ${a.texto}${a.vezes > 1 ? ` (${a.vezes} vezes)` : ''}`),
      ])
    }
    case 'PORQUE': {
      const apresentados = await listarApresentados(ctx.workspaceId)
      if (!apresentados.length) return r(['Ainda não tenho produto recomendado. Se o catálogo estiver vazio, cadastre produtos ou informe um em Oportunidades; depois diga "rodar agora".'])
      const alvoNorm = comando.alvo ? normalizar(comando.alvo) : null
      const c = (alvoNorm && apresentados.find((a) => normalizar(a.nome).includes(alvoNorm))) || apresentados[0]
      return r(explicarCandidato(c, apresentados.length))
    }
    case 'RODAR': {
      const res = await executarCiclo({ workspaceId: ctx.workspaceId, userId: ctx.userId, gatilho: 'COPILOT', agora })
      return r(res.resumo.length ? res.resumo : ['Ciclo concluído.'], true)
    }
    case 'PAUSAR': {
      const res = await entrarEmSafeMode({ workspaceId: ctx.workspaceId, motivo: 'Pedido da titular pelo Copilot.', ator: 'TITULAR', userId: ctx.userId, agora })
      return r([res.mudou ? 'Entrei em modo de segurança: continuo observando, mas não publico nem gasto nada.' : 'Já estou em modo de segurança.'], res.mudou)
    }
    case 'RETOMAR': {
      const res = await sairDoSafeMode({ workspaceId: ctx.workspaceId, userId: ctx.userId, motivo: 'Pedido da titular pelo Copilot.', agora })
      return r([res.mudou ? 'Saí do modo de segurança.' : 'Não estou em modo de segurança.'], res.mudou)
    }
    case 'INTEGRACOES': {
      const p = await estadoDaOperacao(ctx.workspaceId, agora)
      const ri = p.resumoIntegracoes
      if (!ri.destaque.length) return r([`Nenhum canal conectado ainda (0 de ${ri.total}). Consigo analisar e recomendar, mas só publico depois de conectar um canal em Integrações.`])
      return r([`${ri.conectadas} de ${ri.total} canais conectados. ${ri.mensagem}`, ...ri.destaque.map((i) => `${nomeDoCanal(i.plataforma)}: ${i.detalhe}`)])
    }
    case 'RESULTADO': {
      const c = (await resumoComissoes(ctx.workspaceId)) as { prevista: number; confirmada: number; recebida: number }
      const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      if (!c.prevista && !c.confirmada && !c.recebida) return r(['Ainda não há comissões registradas. Quando a primeira venda entrar, eu mostro aqui.'])
      return r([`Até agora você recebeu ${brl(c.recebida)}. Já confirmadas e a receber: ${brl(c.confirmada)}. Previstas (vendas ainda não confirmadas): ${brl(c.prevista)}.`])
    }
    case 'DESCONHECIDO':
    default:
      return r(['Ainda não sei responder isso. Posso ajudar com uma destas:'], false)
  }
}

export async function perguntarAoCopilot(texto: string, ctx: { workspaceId: string; userId: string; agora?: Date }, interpretador: Interpretador = interpretadorDeterministico) {
  const comando = interpretador.interpretar(texto)
  return executarComando(comando, ctx)
}

