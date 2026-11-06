/**
 * P2.15 (Fase 1) — Ciclo do Patrono Supervisor.
 *
 * Um ciclo faz, sozinho, tudo o que é seguro fazer sem a titular:
 *   1. confere as travas (kill switch / Safe Mode) e a política ativa;
 *   2. diagnostica a saúde da operação (integrações, catálogo) e transforma
 *      problema real em UMA exceção em "Precisa de você" (idempotente);
 *   3. descobre, valida e ranqueia (curadoria);
 *   4. decide: se a política permite, escolhe o melhor produto sozinho; se
 *      não, pede UMA aprovação clara; se bloqueia, registra o porquê;
 *   5. registra cada passo no Decision/Event Ledger com o mesmo correlationId.
 *
 * Fase 1: NUNCA publica nem gasta. A máquina de estados para em CONCLUIDO
 * depois de DECIDINDO; CRIANDO/PUBLICANDO ficam para quando a camada de
 * aprovação e política estiver validada em uso real.
 */
import { TIPO_ESCOLHA_DE_PRODUTO, cancelarPedidosPendentes } from '../aprovacoes'
import type { CandidatoDeProduto, EstadoDoRun } from '@prisma/client'
import { prisma } from '../prisma'
import { comContexto, log } from '../observabilidade'
import { registrarDecisao, registrarEvento } from '../ledger'
import { avaliarAcao, politicaAtiva } from '../politica'
import { estadoDeExecucao, killSwitchGlobalAtivo } from '../kill-switch'
import { solicitarAprovacao, type Risco } from '../aprovacoes'
import { coletarCandidatos, escolherCandidato, listarApresentados, FONTE_TITULAR } from '../curadoria'
import { iniciarRun, transitar, type RunConhecido } from './run'
import { CHAVE_TIKTOK_SHOP, evidenciaDoTikTokShop } from '../tiktok-shop-evidencia'
import { situacaoDaAffiliateApi } from '../elegibilidade-tiktok-shop'
import { PRODUTO_ATIVO } from '../produto-canonico'

export const TIPO_ESCOLHA = TIPO_ESCOLHA_DE_PRODUTO
export const TIPO_EXCECAO = 'EXCECAO'

export interface Excecao {
  chave: string
  titulo: string
  resumo: string
  porque: string[]
  risco: Risco
  /** Para onde a titular vai para resolver (rota interna). */
  link: string
}

export interface ResultadoDoCiclo {
  runId: string | null
  estadoFinal: string
  resumo: string[]
  apresentados: number
  excecoes: number
  pedidoDeAprovacao: { id: string; titulo: string; status: string } | null
  escolhaAutomatica: { candidatoId: string; nome: string } | null
}

const DIA = 24 * 60 * 60 * 1000

/** FUNÇÃO PURA: problemas reais de operação → exceções (sem I/O). */
export function diagnosticar(p: {
  agora: Date
  integracoes: { plataforma: string; status: string; tokenExpiry: Date | null }[]
  produtosAtivos: number
  informadosAbertos: number
  /** Descoberta oficial no TikTok Shop ainda não habilitada (app + autorização da criadora). */
  tiktokShopPendente?: boolean
}): Excecao[] {
  const out: Excecao[] = []
  for (const i of p.integracoes) {
    if (i.status !== 'conectado' || !i.tokenExpiry) continue
    const dias = Math.ceil((i.tokenExpiry.getTime() - p.agora.getTime()) / DIA)
    const nome = i.plataforma === 'instagram' ? 'Instagram' : i.plataforma
    const dia = i.tokenExpiry.toISOString().slice(0, 10)
    if (dias <= 0) {
      out.push({
        chave: `excecao:token-expirado:${i.plataforma}:${dia}`,
        titulo: `O acesso ao ${nome} expirou`,
        resumo: `Sem renovar, o Patrono não consegue ler nem publicar no ${nome}.`,
        porque: [`O acesso venceu em ${i.tokenExpiry.toLocaleDateString('pt-BR')}.`],
        risco: 'ALTO',
        link: '/integracoes',
      })
    } else if (dias <= 15) {
      out.push({
        chave: `excecao:token-expirando:${i.plataforma}:${dia}`,
        titulo: `Renovar o acesso ao ${nome}`,
        resumo: `Faltam ${dias} dia(s) para o acesso ao ${nome} vencer. Renovar leva um clique em Integrações.`,
        porque: [`O acesso vence em ${i.tokenExpiry.toLocaleDateString('pt-BR')}.`],
        risco: 'MEDIO',
        link: '/integracoes',
      })
    }
  }
  if (p.produtosAtivos === 0 && p.informadosAbertos === 0) {
    out.push({
      chave: 'excecao:catalogo-vazio',
      titulo: 'Nenhum produto para analisar',
      resumo: 'Cadastre produtos ou informe um produto em Oportunidades para o Patrono ter o que ranquear.',
      porque: ['O catálogo está vazio e não há produto informado em aberto.'],
      risco: 'MEDIO',
      link: '/oportunidades',
    })
  }
  if (p.tiktokShopPendente) {
    // Estratégico e de uma vez só: chave fixa — se a titular ignorar, não volta.
    out.push({
      chave: CHAVE_TIKTOK_SHOP,
      titulo: 'Liberar a descoberta automática no TikTok Shop',
      resumo: 'Para eu achar produtos sozinho, sem depender do catálogo, o TikTok Shop precisa liberar um acesso oficial e você autorizar a sua conta de criadora. Só você pode fazer; o item sai daqui sozinho quando a conexão existir.',
      porque: [
        'A descoberta oficial é a API "Creator Search Open Collaboration Product" (escopo 1021508).',
        'Sem ela, o Patrono só ranqueia produtos já cadastrados ou informados por você.',
        'Não usamos raspagem de dados: só a API oficial.',
      ],
      risco: 'BAIXO',
      link: '/integracoes',
    })
  }
  return out
}

function riscoDe(c: Pick<CandidatoDeProduto, 'nivelDeRisco'>): Risco {
  return c.nivelDeRisco === 'ALTO' ? 'ALTO' : c.nivelDeRisco === 'MEDIO' ? 'MEDIO' : 'BAIXO'
}

export async function executarCiclo(p: {
  workspaceId: string
  /** Quem disparou (titular no botão / Copilot). Escolhas automáticas usam o dono do workspace. */
  userId: string
  gatilho?: 'MANUAL' | 'COPILOT' | 'AGENDADO'
  agora?: Date
  env?: Record<string, string | undefined>
}): Promise<ResultadoDoCiclo> {
  const agora = p.agora ?? new Date()
  const env = p.env ?? process.env
  const resumo: string[] = []

  if (killSwitchGlobalAtivo(env)) {
    return { runId: null, estadoFinal: 'CANCELADO', resumo: ['O desligamento geral está ativo: não rodei.'], apresentados: 0, excecoes: 0, pedidoDeAprovacao: null, escolhaAutomatica: null }
  }

  // P2.15.6: política e travas em paralelo (independentes); o run depende do modo da política.
  const [politica, seguranca] = await Promise.all([politicaAtiva(p.workspaceId), estadoDeExecucao(p.workspaceId, env)])
  const modo = politica.regras.autonomia.padrao
  const run = await iniciarRun({ workspaceId: p.workspaceId, chave: `ciclo:${agora.toISOString()}`, modo })

  return comContexto({ correlationId: run.correlationId, runId: run.id, workspaceId: p.workspaceId, ator: 'PATRONO' }, async () => {
    // P2.15.6: o ciclo conhece o próprio run — cada transição é UMA ida ao banco, sem reler.
    let atual: RunConhecido = run
    let estado = run.estado
    const ir = async (para: EstadoDoRun | EstadoDoRun[], checkpoint?: Record<string, unknown>) => {
      const r = await transitar({ workspaceId: p.workspaceId, runId: run.id, de: estado, para, checkpoint, env, atual })
      atual = r
      estado = r.estado
    }
    try {
      await ir('DESCOBRINDO', { gatilho: p.gatilho ?? 'MANUAL', politicaVersao: politica.versao, modo })

      // ── Saúde da operação → exceções (só o que exige a titular) ──
      // P2.15.6: roda EM PARALELO com a coleta (não dependem uma da outra);
      // dentro, as leituras e os pedidos de cada exceção também saem juntos.
      const tratarExcecoes = async () => {
        const [integracoes, produtosAtivos, informadosAbertos, evidenciaTikTokShop] = await Promise.all([
          prisma.integracao.findMany({ where: { workspaceId: p.workspaceId }, select: { plataforma: true, status: true, tokenExpiry: true } }),
          prisma.produto.count({ where: { workspaceId: p.workspaceId, ...PRODUTO_ATIVO } }),
          prisma.candidatoDeProduto.count({ where: { workspaceId: p.workspaceId, fonte: FONTE_TITULAR, produtoId: null, status: { in: ['NOVO', 'APRESENTADO'] } } }), // sem cadastro: o status já é a fonte
          evidenciaDoTikTokShop(p.workspaceId, agora),
        ])
        // P2.17.1: a flag TIKTOK_SHOP_CATALOGO só LIBERA a conexão; quem tira o
        // item de "Precisa de você" é a evidência real (conta conectada, token válido).
        // P2.18.3: enquanto a Affiliate API estiver bloqueada por elegibilidade, não pedir à titular um onboarding que sabidamente viola o requisito.
        const tiktokShopPendente = !evidenciaTikTokShop && !situacaoDaAffiliateApi(agora).bloqueada
        const excecoes = diagnosticar({ agora, integracoes, produtosAtivos, informadosAbertos, tiktokShopPendente })
        await Promise.all(
          excecoes.map((e) =>
            solicitarAprovacao({
              workspaceId: p.workspaceId, tipo: TIPO_EXCECAO, chave: e.chave, titulo: e.titulo, resumo: e.resumo, porque: e.porque,
              fatos: { risco: e.risco }, acaoProposta: { link: e.link }, agora,
            })
          )
        )
        return excecoes
      }

      // ── Descobrir, validar, ranquear (curadoria) ──
      const [excecoes, coleta] = await Promise.all([tratarExcecoes(), coletarCandidatos({ workspaceId: p.workspaceId, userId: p.userId, agora })])
      if (excecoes.length) resumo.push(excecoes.length === 1 ? 'Encontrei 1 ponto que precisa de você.' : `Encontrei ${excecoes.length} pontos que precisam de você.`)
      // P2.15.6: VALIDANDO → RANQUEANDO → DECIDINDO não têm trabalho entre si: um evento por passo, uma ida só.
      // …e a leitura dos apresentados corre junto (só depende da coleta).
      const [, apresentados] = await Promise.all([
        ir(['VALIDANDO', 'RANQUEANDO', 'DECIDINDO'], { avaliados: coleta.avaliados, bloqueados: coleta.bloqueados }),
        listarApresentados(p.workspaceId),
      ])
      resumo.push(
        coleta.avaliados === 0
          ? 'Não havia produtos para analisar.'
          : `Analisei ${coleta.avaliados} ${coleta.avaliados === 1 ? 'produto' : 'produtos'} e selecionei ${coleta.apresentados} ${coleta.apresentados === 1 ? 'oportunidade' : 'oportunidades'}.`
      )

      const melhor = apresentados[0]
      let pedido: ResultadoDoCiclo['pedidoDeAprovacao'] = null
      let escolhaAutomatica: ResultadoDoCiclo['escolhaAutomatica'] = null

      if (!melhor) {
        resumo.push('Nenhum produto está apto para recomendar agora.')
      } else {
        const fatos = { risco: riscoDe(melhor), categoria: melhor.categoria, preco: melhor.preco }
        const avaliacao = avaliarAcao(politica.regras, { tipo: 'ESCOLHER_PRODUTO', ...fatos }, seguranca)
        // Um pedido de escolha por vez: recomendações anteriores ainda pendentes saem da fila.
        // P2.15.6: corre junto com a decisão (não depende dela); é aguardado no fim do bloco.
        const cancelamentoDosAnteriores = cancelarPedidosPendentes({ workspaceId: p.workspaceId, filtro: { tipo: TIPO_ESCOLHA, NOT: { chave: `escolha:${melhor.id}` } }, motivo: 'Substituído por recomendação mais recente.' })
        cancelamentoDosAnteriores.catch(() => {}) // o erro, se houver, sai no await abaixo

        if (avaliacao.resultado === 'BLOQUEAR') {
          await registrarDecisao({ workspaceId: p.workspaceId, tipo: 'ESCOLHA_DE_PRODUTO', ator: 'PATRONO', decisao: `Não escolheu "${melhor.nome}": bloqueado pela política.`, explicacao: avaliacao.motivos, entidadeTipo: 'CandidatoDeProduto', entidadeId: melhor.id, politicaVersao: politica.versao, chaveIdempotencia: `ciclo:${run.id}:bloqueio` })
          resumo.push(`Não escolhi “${melhor.nome}”: ${avaliacao.motivos.join(' ')}`)
        } else if (avaliacao.resultado === 'PERMITIR') {
          await escolherCandidato({ workspaceId: p.workspaceId, userId: p.userId, candidatoId: melhor.id, agora, ator: 'PATRONO', regra: `politica:v${politica.versao}` })
          escolhaAutomatica = { candidatoId: melhor.id, nome: melhor.nome }
          resumo.push(`Escolhi sozinho “${melhor.nome}”, dentro das suas regras. Nenhuma ação sua foi necessária.`)
        } else {
          const ap = await solicitarAprovacao({
            workspaceId: p.workspaceId,
            tipo: TIPO_ESCOLHA,
            chave: `escolha:${melhor.id}`,
            titulo: `Escolher "${melhor.nome}"?`,
            resumo: `É o melhor entre ${coleta.apresentados} apresentado(s). Aprovar cadastra o produto para o próximo conteúdo — nada é gerado nem publicado.`,
            porque: [...(melhor.porqueDestaPosicao ?? []).slice(0, 2), ...avaliacao.motivos.map((m) => `Pede você porque: ${m}`)],
            fatos,
            acaoProposta: { candidatoId: melhor.id },
            entidadeTipo: 'CandidatoDeProduto',
            entidadeId: melhor.id,
            expiraEm: melhor.validoAte,
            agora,
          })
          // Regra da titular pode ter resolvido o pedido na hora.
          if (ap.status === 'APROVADA') {
            await escolherCandidato({ workspaceId: p.workspaceId, userId: p.userId, candidatoId: melhor.id, agora, ator: 'PATRONO', regra: ap.decididoPorRegraId ? `ApprovalRule:${ap.decididoPorRegraId}` : null })
            escolhaAutomatica = { candidatoId: melhor.id, nome: melhor.nome }
            resumo.push(`Escolhi “${melhor.nome}” seguindo uma regra sua.`)
          } else if (ap.status === 'PENDENTE') {
            pedido = { id: ap.id, titulo: ap.titulo, status: ap.status }
            resumo.push(`Recomendo “${melhor.nome}”. Falta só a sua aprovação em Precisa de você.`)
          } else {
            resumo.push(`Você já tinha decidido sobre “${melhor.nome}”; mantive a sua decisão.`)
          }
        }
        await cancelamentoDosAnteriores
      }

      await ir('CONCLUIDO', { resumo })
      log('info', 'supervisor.ciclo.concluido', { runId: run.id, apresentados: coleta.apresentados, excecoes: excecoes.length })
      return { runId: run.id, estadoFinal: 'CONCLUIDO', resumo, apresentados: coleta.apresentados, excecoes: excecoes.length, pedidoDeAprovacao: pedido, escolhaAutomatica }
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e)
      log('error', 'supervisor.ciclo.falhou', { runId: run.id, erro: mensagem })
      await registrarEvento({ workspaceId: p.workspaceId, tipo: 'ERROR_DETECTED', chaveIdempotencia: `ciclo:${run.id}:erro`, entidadeTipo: 'SupervisorRun', entidadeId: run.id, payload: { erro: mensagem.slice(0, 300) } }).catch(() => {})
      if (estado !== 'CONCLUIDO' && estado !== 'FALHOU' && estado !== 'CANCELADO') {
        await transitar({ workspaceId: p.workspaceId, runId: run.id, de: estado, para: 'FALHOU', erro: mensagem.slice(0, 500), env }).catch(() => {})
      }
      throw e
    }
  })
}
