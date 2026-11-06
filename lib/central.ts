/**
 * P2.15 (Fase 1) — Command Center: o estado da operação numa leitura só.
 *
 * Responde, nesta ordem, o que a titular precisa saber ao abrir o Patrono:
 *   1. o que o Patrono está fazendo / fez por último (SupervisorRun);
 *   2. o que precisa dela (fila "Precisa de você");
 *   3. o que aconteceu hoje (Event Ledger, em linguagem simples);
 *   4. decisões recentes, com o porquê (Decision Ledger);
 *   5. saúde das integrações e travas de segurança;
 *   6. resultado financeiro (vendas e comissões — fonte única);
 *   7. a próxima melhor ação (uma só).
 * Todas as leituras saem em paralelo: cada ida ao banco custa caro.
 *
 * P2.15.1: o Patrono fala em primeira pessoa e em linguagem de gente; o
 * texto do topo nunca contradiz o estado real (pausa, Safe Mode, último
 * ciclo); repetições do ledger são agrupadas.
 */
import { TIPO_ESCOLHA_DE_PRODUTO } from './aprovacoes'
import type { DomainEvent } from '@prisma/client'
import { prisma } from './prisma'
import { centralPrecisaDeVoce } from './precisa-de-voce-central'
import { estadoDeExecucao } from './kill-switch'
import { politicaAtiva } from './politica'
import { resumoComissoes, resumoVendas } from './vendas-comissoes'
import { contarPublicacoesAtrasadas } from './publicacao-atrasada'

const DIA = 24 * 60 * 60 * 1000
/** Início do dia em Brasília (UTC−3, sem horário de verão desde 2019). */
export function inicioDoDiaEmBrasilia(agora: Date): Date {
  const local = new Date(agora.getTime() - 3 * 60 * 60 * 1000)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 3, 0, 0))
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** FUNÇÃO PURA: evento do ledger → frase do Patrono (null = ruído técnico, não mostra). */
export function frasesDoEvento(e: Pick<DomainEvent, 'tipo' | 'payload'>): string | null {
  const p = (e.payload ?? {}) as Record<string, unknown>
  switch (e.tipo) {
    case 'CANDIDATES_PRESENTED': {
      // `chaves` sai redigido do ledger; `apresentados` é a contagem (P2.15.1).
      const n = typeof p.apresentados === 'number' ? p.apresentados : Array.isArray(p.chaves) ? p.chaves.length : null
      const avaliados = typeof p.avaliados === 'number' ? plural(p.avaliados, 'produto', 'produtos') : 'os produtos'
      if (p.avaliados === 0) return 'Não havia produtos para analisar.'
      if (n === 0) return `Analisei ${avaliados}; nenhum estava apto agora.`
      return `Analisei ${avaliados} e selecionei ${n === null ? 'as melhores oportunidades' : plural(n, 'oportunidade', 'oportunidades')}.`
    }
    case 'PRODUCT_SELECTED':
      return 'Um produto foi escolhido para o próximo conteúdo.'
    case 'APPROVAL_REQUIRED':
      return 'Pedi uma decisão sua.'
    case 'APPROVAL_GRANTED':
      return 'Você aprovou uma decisão.'
    case 'APPROVAL_REJECTED':
      return 'Você recusou uma sugestão.'
    case 'SAFE_MODE_ENTERED':
      return 'Entrei em modo de segurança (só observo).'
    case 'SAFE_MODE_EXITED':
      return 'Saí do modo de segurança.'
    case 'POLICY_CHANGED':
      return 'Suas regras e limites foram atualizados.'
    case 'COST_BLOCKED':
      return 'Bloqueei um gasto que não estava autorizado.'
    case 'COST_RESERVED':
      return 'Reservei orçamento para uma operação autorizada.'
    case 'CONTENT_PUBLISHED':
      return 'Publiquei um conteúdo.'
    case 'ERROR_DETECTED':
      return 'Encontrei um erro e parei com segurança.'
    case 'RUN_STATE_CHANGED':
      return p.para === 'CONCLUIDO' ? 'Concluí um ciclo de trabalho.' : p.para === 'FALHOU' ? 'Um ciclo de trabalho falhou; parei com segurança.' : null
    default:
      return null
  }
}

export interface LinhaAgrupada { quando: string; texto: string; vezes: number }

/**
 * FUNÇÃO PURA: junta frases iguais seguidas ("Analisei 21 produtos…" três
 * vezes vira uma linha com 3×). A lista chega do mais novo para o mais
 * antigo; `quando` fica com o mais recente do grupo.
 */
export function agruparRepetidas(linhas: { quando: string; texto: string }[]): LinhaAgrupada[] {
  const out: LinhaAgrupada[] = []
  for (const l of linhas) {
    const ultimo = out.at(-1)
    if (ultimo && ultimo.texto === l.texto) ultimo.vezes++
    else out.push({ ...l, vezes: 1 })
  }
  return out
}

/** Canais que a tela de Integrações oferece (mesma ordem e nomes). */
export const CANAIS_CONHECIDOS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  mercadolivre: 'Mercado Livre',
  shopee: 'Shopee',
  hotmart: 'Hotmart',
  amazon: 'Amazon',
  whatsapp: 'WhatsApp',
}
export const nomeDoCanal = (plataforma: string) =>
  CANAIS_CONHECIDOS[plataforma] ?? (plataforma === 'tiktok-shop' ? 'TikTok Shop' : plataforma.charAt(0).toUpperCase() + plataforma.slice(1))

export type SaudeDaIntegracao = { plataforma: string; nome: string; estado: 'OK' | 'ATENCAO' | 'PROBLEMA' | 'DESCONECTADA'; detalhe: string }

/** FUNÇÃO PURA. */
export function saudeDasIntegracoes(lista: { plataforma: string; status: string; tokenExpiry: Date | null }[], agora: Date): SaudeDaIntegracao[] {
  return lista.map((i) => {
    const nome = nomeDoCanal(i.plataforma)
    if (i.status !== 'conectado') return { plataforma: i.plataforma, nome, estado: 'DESCONECTADA', detalhe: 'Não conectada.' }
    if (!i.tokenExpiry) return { plataforma: i.plataforma, nome, estado: 'OK', detalhe: 'Conectada.' }
    const dias = Math.ceil((i.tokenExpiry.getTime() - agora.getTime()) / DIA)
    if (dias <= 0) return { plataforma: i.plataforma, nome, estado: 'PROBLEMA', detalhe: 'Acesso expirado.' }
    if (dias <= 15) return { plataforma: i.plataforma, nome, estado: 'ATENCAO', detalhe: `Acesso vence em ${plural(dias, 'dia', 'dias')}.` }
    return { plataforma: i.plataforma, nome, estado: 'OK', detalhe: `Conectada (acesso válido por mais ${dias} dias).` }
  })
}

export interface ResumoDasIntegracoes {
  /** Conectadas (inclui as que estão para vencer). */
  conectadas: number
  /** Canais oferecidos na tela de Integrações + qualquer outro já registrado. */
  total: number
  comProblema: number
  /** Uma frase para o card. */
  mensagem: string
  /** Só as que importam: com problema primeiro, depois as que funcionam. Desconectadas não entram. */
  destaque: SaudeDaIntegracao[]
}

/**
 * FUNÇÃO PURA: o card de Integrações mostra o estado REAL em uma frase.
 * Antes (P2.15) o card só listava linhas existentes — sem nenhuma linha
 * dizia "Nenhuma conectada." sem dizer de quantas, e linha desconectada
 * aparecia com X vermelho, como se fosse falha.
 */
export function resumoDasIntegracoes(saude: SaudeDaIntegracao[]): ResumoDasIntegracoes {
  const total = new Set([...Object.keys(CANAIS_CONHECIDOS), ...saude.map((s) => s.plataforma)]).size
  const problema = saude.filter((s) => s.estado === 'PROBLEMA' || s.estado === 'ATENCAO')
  const ok = saude.filter((s) => s.estado === 'OK')
  const conectadas = ok.length + saude.filter((s) => s.estado === 'ATENCAO').length
  const mensagem = problema.length
    ? `${plural(problema.length, 'canal precisa', 'canais precisam')} de atenção.`
    : conectadas === 0
      ? 'Nenhum canal conectado ainda. Analiso e recomendo, mas só publico depois de conectar.'
      : 'Tudo funcionando.'
  return { conectadas, total, comProblema: problema.length, mensagem, destaque: [...problema, ...ok] }
}

export interface EstadoDoPatrono {
  titulo: string
  frase: string
  /** Complemento curto e verdadeiro sobre modo/pausa (nunca contradiz o título). */
  nota: string
  tom: 'ok' | 'pronto' | 'atencao' | 'parado'
}

const MODO_EM_FRASE: Record<string, string> = {
  MANUAL: 'Eu sugiro e você decide.',
  ASSISTED: 'Faço o rotineiro e peço o importante.',
  AUTOMATIC: 'Ajo sozinho dentro das suas regras.',
}

/** FUNÇÃO PURA: o topo do Command Center, conforme o estado real. */
export function estadoDoPatrono(p: {
  globalDesligado: boolean
  safeMode: boolean
  pausado: boolean
  modo: string
  pendencias: number
  ultimoCiclo: { estado: string; ha: number } | null
}): EstadoDoPatrono {
  const notaModo = MODO_EM_FRASE[p.modo] ?? ''
  const notaPausa = p.pausado ? ' Publicação automática desligada por você: nada sai sem sua ordem.' : ''
  const nota = `${notaModo}${notaPausa}`.trim()
  if (p.globalDesligado)
    return { titulo: 'Patrono desligado', frase: 'O desligamento geral está ativo. Não analiso nem ajo até ele ser desfeito.', nota: '', tom: 'parado' }
  if (p.safeMode)
    return { titulo: 'Patrono em modo de segurança', frase: 'Só observo: não publico nem gasto nada até você retomar.', nota: '', tom: 'parado' }
  if (p.ultimoCiclo?.estado === 'FALHOU')
    return { titulo: 'Patrono precisa de atenção', frase: 'Minha última análise falhou e parei com segurança. Rode de novo; se repetir, eu aviso aqui.', nota, tom: 'atencao' }
  const recente = p.ultimoCiclo !== null && p.ultimoCiclo.ha <= DIA
  if (recente && p.pendencias > 0)
    return { titulo: 'Patrono em operação', frase: 'Já analisei as oportunidades. Agora há algo que só você pode resolver.', nota, tom: 'atencao' }
  if (recente)
    return { titulo: 'Patrono em operação', frase: 'Estou analisando oportunidades e só vou pedir sua decisão quando for necessário.', nota, tom: 'ok' }
  if (p.pendencias > 0)
    return { titulo: 'Patrono pronto para trabalhar', frase: 'Há algo esperando por você. Depois disso, sigo analisando sozinho.', nota, tom: 'atencao' }
  return { titulo: 'Patrono pronto para trabalhar', frase: 'Posso analisar oportunidades agora. Você só precisa aprovar quando algo exigir sua decisão.', nota, tom: 'pronto' }
}

export interface ProximaAcao {
  texto: string
  link: string | null
  comando: 'rodar' | null
  /** Rótulo do botão principal (null = nada a fazer). */
  botao: string | null
}

/** FUNÇÃO PURA: a UMA próxima melhor ação. Pendência sempre vem antes de tudo. */
export function proximaMelhorAcao(p: {
  pendencias: number
  bloqueado: boolean
  motivoDoBloqueio?: string
  ultimoCicloHa: number | null
  integracoesComProblema: number
  /** Título do pedido mais urgente (quando houver). */
  principal?: string | null
  /** P2.15.4: conteúdos agendados cuja data passou sem publicação real. */
  publicacoesAtrasadas?: number
}): ProximaAcao {
  if (p.pendencias > 0) {
    // Nem todo item é decisão (ex.: configurar o TikTok Shop): a contagem fala em "itens".
    const texto = p.pendencias === 1 && p.principal ? p.principal : `${plural(p.pendencias, 'item precisa', 'itens precisam')} de você.`
    return { texto, link: '/precisa-de-voce', comando: null, botao: p.pendencias === 1 ? 'Ver agora' : 'Ver itens' }
  }
  if ((p.publicacoesAtrasadas ?? 0) > 0)
    return { texto: `${plural(p.publicacoesAtrasadas!, 'publicação está atrasada', 'publicações estão atrasadas')}: a data passou e nada saiu.`, link: '/conteudos', comando: null, botao: 'Ver conteúdos' }
  if (p.integracoesComProblema > 0) return { texto: 'Renovar o acesso de uma integração.', link: '/integracoes', comando: null, botao: 'Abrir Integrações' }
  if (p.ultimoCicloHa === null || p.ultimoCicloHa > DIA) return { texto: 'Analisar as oportunidades agora.', link: null, comando: 'rodar', botao: 'Rodar agora' }
  return { texto: 'Nada pendente. Estou em dia.', link: null, comando: null, botao: null }
}

export interface DecisaoLegivel {
  id: string
  quando: string
  texto: string
  detalhes: string[]
  vezes: number
}

type DecisaoBruta = { id: string; tipo: string; ator: string; decisao: string; explicacao: string[]; entradas: unknown; criadoEm: Date }

const entreAspas = (t: string) => t.match(/"([^"]+)"/)?.[1] ?? null

/** FUNÇÃO PURA: uma decisão do ledger → frase para a titular. */
export function decisaoEmLinguagemSimples(d: Omit<DecisaoBruta, 'id' | 'criadoEm'>): { texto: string; detalhes: string[] } {
  const e = (d.entradas ?? {}) as Record<string, unknown>
  if (d.tipo === 'CURADORIA_APRESENTACAO') {
    const lista = Array.isArray(e.apresentados) ? (e.apresentados as { nome?: string }[]) : []
    const avaliados = typeof e.avaliados === 'number' ? plural(e.avaliados, 'produto', 'produtos') : 'os produtos'
    if (!lista.length) return { texto: `Analisei ${avaliados}; nenhum estava apto agora.`, detalhes: ['Nenhuma ação sua foi necessária.'] }
    const nomes = lista.map((c) => c.nome).filter((n): n is string => !!n)
    return {
      texto: `Analisei ${avaliados} e selecionei ${plural(lista.length, 'oportunidade', 'oportunidades')}.`,
      detalhes: [...(nomes[0] ? [`Em 1º lugar: ${nomes[0]}.`] : []), ...(nomes.length > 1 ? [`Também no Top ${nomes.length}: ${nomes.slice(1).join('; ')}.`] : []), 'Nenhuma ação sua foi necessária.'],
    }
  }
  if (d.tipo === 'ESCOLHA_DE_PRODUTO') {
    const nome = entreAspas(d.decisao)
    if (/bloquead/i.test(d.decisao)) return { texto: `Não escolhi ${nome ? `“${nome}”` : 'o produto'}: suas regras não permitem.`, detalhes: d.explicacao.slice(0, 2) }
    if (d.ator === 'TITULAR') return { texto: `Você escolheu ${nome ? `“${nome}”` : 'um produto'}.`, detalhes: [] }
    return { texto: `Escolhi ${nome ? `“${nome}”` : 'um produto'} dentro das suas regras.`, detalhes: ['Nenhuma ação sua foi necessária.'] }
  }
  if (d.tipo === 'APROVACAO') {
    const titulo = typeof e.titulo === 'string' ? e.titulo : null
    const aprovou = /APROVADA/.test(d.decisao)
    if (e.pedidoTipo === 'EXCECAO') return { texto: titulo ? `${aprovou ? 'Você marcou como resolvido' : 'Você dispensou'}: ${titulo}.` : aprovou ? 'Você marcou um item como resolvido.' : 'Você dispensou um item.', detalhes: [] }
    return { texto: titulo ? `${aprovou ? 'Você aprovou' : 'Você recusou'}: ${titulo}` : aprovou ? 'Você aprovou um pedido.' : 'Você recusou um pedido.', detalhes: [] }
  }
  if (d.tipo === 'RESOLUCAO_POR_EVIDENCIA') {
    const titulo = typeof e.titulo === 'string' ? e.titulo : 'um item'
    return { texto: `Confirmei a conexão e tirei da fila: ${titulo}.`, detalhes: d.explicacao.slice(0, 1) }
  }
  if (d.tipo === 'SAFE_MODE') return { texto: /desligado/i.test(d.decisao) ? 'Você me tirou do modo de segurança.' : 'Entrei em modo de segurança.', detalhes: d.explicacao.slice(0, 1) }
  return { texto: d.decisao, detalhes: d.explicacao.slice(0, 2) }
}

/**
 * FUNÇÃO PURA: decisões recentes em linguagem simples, repetições juntas
 * ("3 análises seguidas com o mesmo resultado" vira uma linha) e no máximo
 * `limite` linhas.
 */
export function decisoesLegiveis(lista: DecisaoBruta[], limite = 4): DecisaoLegivel[] {
  const out: DecisaoLegivel[] = []
  let chaveAnterior: string | null = null
  for (const d of lista) {
    // Aprovar uma escolha de produto já aparece como "Você escolheu …": não repete.
    if (d.tipo === 'APROVACAO' && (d.entradas as Record<string, unknown> | null)?.pedidoTipo === TIPO_ESCOLHA_DE_PRODUTO) continue
    const { texto, detalhes } = decisaoEmLinguagemSimples(d)
    const chave = `${texto}|${detalhes[0] ?? ''}`
    const ultimo = out.at(-1)
    if (ultimo && chave === chaveAnterior) {
      ultimo.vezes++
      continue
    }
    if (out.length >= limite) break
    out.push({ id: d.id, quando: d.criadoEm.toISOString(), texto, detalhes, vezes: 1 })
    chaveAnterior = chave
  }
  for (const d of out) {
    // Mesmo 1º lugar em análises seguidas: diz que manteve, em vez de repetir.
    const lider = d.detalhes[0]?.match(/^Em 1º lugar: (.+)\.$/)?.[1]
    if (d.vezes > 1 && lider) d.detalhes[0] = `Mantive “${lider}” em 1º lugar nas ${d.vezes} análises.`
  }
  return out
}

/**
 * P2.15.6 — O estado da operação SEM decisões, eventos e financeiro: tudo o
 * que "Como está?" do Copilot precisa, em paralelo (a fila leva 2 idas). O
 * painel completo reaproveita esta mesma leitura.
 */
export async function estadoDaOperacao(workspaceId: string, agora = new Date()) {
  const [ultimoRun, fila, integracoes, seguranca, politica, publicacoesAtrasadas] = await Promise.all([
    prisma.supervisorRun.findFirst({ where: { workspaceId }, orderBy: { iniciadoEm: 'desc' } }),
    // P2.17.11: a central ÚNICA (o mesmo número do sininho).
    centralPrecisaDeVoce(workspaceId, agora).then((itens) =>
      itens.map((i) => ({ titulo: i.titulo, resumo: i.motivo, risco: i.urgencia === 'ALTA' ? 'ALTO' : i.urgencia === 'MEDIA' ? 'MEDIO' : 'BAIXO' }))
    ),
    prisma.integracao.findMany({ where: { workspaceId }, select: { plataforma: true, status: true, tokenExpiry: true } }),
    estadoDeExecucao(workspaceId),
    politicaAtiva(workspaceId),
    contarPublicacoesAtrasadas(workspaceId, agora),
  ])
  const saude = saudeDasIntegracoes(integracoes, agora)
  const resumoIntegracoes = resumoDasIntegracoes(saude)
  const checkpoint = (ultimoRun?.checkpoint ?? {}) as Record<string, unknown>
  const pendencias = fila.length
  const principal = fila[0] ?? null // a fila já vem por prioridade
  const porRisco = { ALTO: 0, MEDIO: 0, BAIXO: 0 } as Record<'ALTO' | 'MEDIO' | 'BAIXO', number>
  for (const i of fila) if (i.risco in porRisco) porRisco[i.risco as keyof typeof porRisco]++
  const ultimoCicloHa = ultimoRun ? agora.getTime() - ultimoRun.iniciadoEm.getTime() : null
  return {
    patrono: {
      modo: politica.regras.autonomia.padrao,
      politicaVersao: politica.versao,
      bloqueado: seguranca.acoesIrreversiveisBloqueadas,
      safeMode: seguranca.safeMode,
      pausado: seguranca.pausado,
      motivoDoBloqueio: seguranca.motivoDoBloqueio ?? null,
      ultimoCiclo: ultimoRun
        ? { estado: ultimoRun.estado, quando: ultimoRun.iniciadoEm.toISOString(), resumo: Array.isArray(checkpoint.resumo) ? (checkpoint.resumo as string[]) : [] }
        : null,
      estado: estadoDoPatrono({
        globalDesligado: seguranca.global,
        safeMode: seguranca.safeMode,
        pausado: seguranca.pausado,
        modo: politica.regras.autonomia.padrao,
        pendencias,
        ultimoCiclo: ultimoRun && ultimoCicloHa !== null ? { estado: ultimoRun.estado, ha: ultimoCicloHa } : null,
      }),
    },
    pendencias,
    precisaDeVoce: {
      total: pendencias,
      porRisco,
      principal: principal ? { titulo: principal.titulo, resumo: principal.resumo, risco: principal.risco } : null,
    },
    integracoes: saude,
    resumoIntegracoes,
    publicacoesAtrasadas,
    proximaAcao: proximaMelhorAcao({
      pendencias,
      bloqueado: seguranca.acoesIrreversiveisBloqueadas,
      motivoDoBloqueio: seguranca.motivoDoBloqueio,
      ultimoCicloHa,
      integracoesComProblema: resumoIntegracoes.comProblema,
      principal: principal?.titulo ?? null,
      publicacoesAtrasadas,
    }),
  }
}

/** P2.15.6 — "O que você fez hoje?": só os eventos do dia (uma ida). */
export async function atividadeDeHoje(workspaceId: string, agora = new Date()) {
  const eventosHoje = await prisma.domainEvent.findMany({
    where: { workspaceId, ocorridoEm: { gte: inicioDoDiaEmBrasilia(agora) } },
    orderBy: { ocorridoEm: 'desc' },
    take: 40,
    select: { tipo: true, payload: true, ocorridoEm: true },
  })
  return agruparRepetidas(
    eventosHoje
      .map((e) => ({ quando: e.ocorridoEm.toISOString(), texto: frasesDoEvento(e) }))
      .filter((a): a is { quando: string; texto: string } => !!a.texto)
  ).slice(0, 8)
}

export async function painelCentral(workspaceId: string, agora = new Date()) {
  const [estado, atividade, decisoes, vendas, comissoes] = await Promise.all([
    estadoDaOperacao(workspaceId, agora),
    atividadeDeHoje(workspaceId, agora),
    prisma.decisionRecord.findMany({ where: { workspaceId }, orderBy: { criadoEm: 'desc' }, take: 20, select: { id: true, tipo: true, ator: true, decisao: true, explicacao: true, entradas: true, criadoEm: true } }),
    resumoVendas(workspaceId),
    resumoComissoes(workspaceId),
  ])
  const { patrono, pendencias, precisaDeVoce, integracoes, resumoIntegracoes, publicacoesAtrasadas, proximaAcao } = estado
  return {
    patrono,
    pendencias,
    precisaDeVoce,
    atividadeHoje: atividade,
    decisoesRecentes: decisoesLegiveis(decisoes),
    integracoes,
    resumoIntegracoes,
    publicacoesAtrasadas,
    financeiro: { vendas, comissoes },
    proximaAcao,
  }
}
export type PainelCentral = Awaited<ReturnType<typeof painelCentral>>
