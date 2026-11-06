import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { registrarAuditoria } from '@/lib/audit-log'
import { atribuirClique, type ResultadoAtribuicao } from '@/lib/atribuicao-clique'
import type { OrigemDeRegistro } from '@/lib/proveniencia'
import { resumoFinanceiro, valorConfirmado, retratoDaComissao, estadoDaComissao, PREVISTOS, dinheiro } from '@/lib/financeiro'

/**
 * `Sale`/`Commission` são a FONTE ÚNICA de vendas e comissões do MVP.
 *
 * O contador legado em `LinkDinamico` (`conversoes`/`receitaTotal`) está
 * marcado `DEPRECATED_LEGACY` no schema desde a Rodada 4: nenhuma operação
 * nova o incrementa mais, e nenhuma leitura nova o soma. As telas "Meus
 * Links" e "Monetização" migraram para ler o resumo por link calculado
 * aqui (`resumoPorLink`), a partir de `Sale`. A coluna continua existindo
 * no schema só para não quebrar quem já dependia dela antes desta rodada —
 * não é removida enquanto houver esse risco. Nunca somar legado + Sale.
 *
 * Regra de negócio central: venda ≠ comissão.
 * - Uma venda tem estado próprio: PENDING | CONFIRMED | CANCELLED.
 * - Uma comissão tem estado próprio: EXPECTED | CONFIRMED | RECEIVED | REVERSED | CANCELLED.
 * - P2.25: estado e soma de comissão SÓ pela fonte canônica `lib/financeiro.ts`.
 * - Uma venda CANCELLED nunca deve contar como confirmada, e a comissão
 *   associada a ela não entra nos totais de "prevista"/"confirmada"/"recebida"
 *   nem no ranking de produtos vendidos.
 */

export async function resumoVendas(workspaceId: string) {
  const porStatus = await prisma.sale.groupBy({
    by: ['status'],
    where: { workspaceId },
    _count: { status: true },
  })

  const contagem: Record<string, number> = { PENDING: 0, CONFIRMED: 0, CANCELLED: 0 }
  for (const linha of porStatus) contagem[linha.status] = linha._count.status

  return contagem
}

/**
 * Totais de comissão (fonte canônica `resumoFinanceiro`). `prevista` = estimada + não liquidada;
 * `confirmada` = liquidada (ainda não marcada como recebida); `recebida` = dinheiro na conta.
 * Revertida e cancelada ficam fora dos três (revertida aparece à parte).
 */
export async function resumoComissoes(workspaceId: string) {
  const f = await resumoFinanceiro(workspaceId)
  return { prevista: f.previsao, confirmada: f.liquidada, recebida: f.recebida, revertida: f.revertida, detalhe: f }
}

/**
 * Ranking de produtos (substitui o antigo cálculo de "Lucro e Escala" que
 * somava `LinkDinamico.conversoes`/`receitaTotal`). Cliques continuam vindo
 * dos links (fonte de tracking); vendas/receita agora vêm de `Sale`
 * CONFIRMED e da comissão CONFIRMED/RECEIVED associada — nunca de
 * CANCELLED.
 */
export async function lucroEscalaPorProduto(workspaceId: string) {
  const [links, vendasConfirmadas] = await Promise.all([
    prisma.linkDinamico.findMany({
      where: { workspaceId },
      select: { produtoId: true, cliques: true },
    }),
    prisma.sale.findMany({
      where: { workspaceId, status: 'CONFIRMED', productId: { not: null } },
      select: {
        productId: true,
        amount: true,
        product: { select: { nome: true } },
        commissions: { select: { status: true, expectedAmount: true, confirmedAmount: true, receivedAmount: true } },
      },
    }),
  ])

  const cliquesPorProduto = new Map<string, number>()
  for (const l of links) {
    cliquesPorProduto.set(l.produtoId, (cliquesPorProduto.get(l.produtoId) ?? 0) + l.cliques)
  }

  const porProduto = new Map<
    string,
    { nome: string; cliques: number; conversoes: number; receitaTotal: number }
  >()

  for (const venda of vendasConfirmadas) {
    if (!venda.productId || !venda.product) continue
    const atual = porProduto.get(venda.productId) ?? {
      nome: venda.product.nome,
      cliques: cliquesPorProduto.get(venda.productId) ?? 0,
      conversoes: 0,
      receitaTotal: 0,
    }
    atual.conversoes += 1
    // Receita reconhecida = comissão já confirmada/recebida sobre a venda;
    // se ainda não há comissão confirmada, conta o valor previsto para não
    // esconder a venda do ranking enquanto a comissão amadurece.
    const comissaoReconhecida = venda.commissions.reduce((soma, c) => soma + valorConfirmado(c), 0)
    atual.receitaTotal += comissaoReconhecida
    porProduto.set(venda.productId, atual)
  }

  return [...porProduto.entries()].map(([produtoId, p]) => ({ produtoId, ...p }))
}

/**
 * Resumo por link (Rodada 4) — substitui a leitura de
 * `LinkDinamico.conversoes`/`receitaTotal` (DEPRECATED_LEGACY) nas telas
 * "Meus Links" e "Monetização". Conversões = Sale CONFIRMED com esse
 * `linkId`; receita = soma dos valores de venda dessas Sales (Sale
 * CANCELLED nunca entra). Cliques continuam vindo do próprio
 * `LinkDinamico.cliques` (fonte de tracking, não muda nesta rodada).
 */
export async function resumoPorLink(workspaceId: string): Promise<Map<string, { conversoes: number; receitaTotal: number; previsao: number }>> {
  const vendas = await prisma.sale.findMany({
    where: { workspaceId, status: 'CONFIRMED', linkId: { not: null } },
    select: {
      linkId: true,
      commissions: { select: { status: true, expectedAmount: true, confirmedAmount: true, receivedAmount: true } },
    },
  })

  const mapa = new Map<string, { conversoes: number; receitaTotal: number; previsao: number }>()
  for (const venda of vendas) {
    if (!venda.linkId) continue
    const atual = mapa.get(venda.linkId) ?? { conversoes: 0, receitaTotal: 0, previsao: 0 }
    atual.conversoes += 1
    // P2.25: mesma régua do ranking por produto (fonte canônica). Receita = só confirmada/recebida;
    // a comissão ainda prevista fica em `previsao` — nunca somada à receita.
    for (const c of venda.commissions) {
      const e = estadoDaComissao(c)
      if (PREVISTOS.includes(e.estado)) atual.previsao += e.valor
      else atual.receitaTotal += valorConfirmado(c)
    }
    mapa.set(venda.linkId, atual)
  }
  return mapa
}

/**
 * "Primeira comissão" — condição de negócio do fluxo aprovado (design_handoff
 * §2: "...Registrar venda/comissão → Primeira comissão"). O handoff não dá
 * uma regra numérica além do nome da etapa; a leitura mais defensável do
 * texto ("comissão", não apenas "venda") é: a etapa se completa quando existe
 * ao menos uma Commission CONFIRMED ou RECEIVED (uma comissão apenas
 * EXPECTED ainda é uma previsão, não uma comissão de fato reconhecida).
 * Documentado como decisão explícita em DOCUMENTACAO-PATRONO-SELLER.md —
 * não é um número inventado, é a leitura mais conservadora do texto
 * disponível, e pode ser revista se o Design especificar outra regra.
 */
export async function primeiraComissao(workspaceId: string) {
  const comissao = await prisma.commission.findFirst({
    where: {
      workspaceId,
      status: { in: ['CONFIRMED', 'RECEIVED'] },
      OR: [{ saleId: null }, { sale: { status: { not: 'CANCELLED' } } }],
    },
    orderBy: { createdAt: 'asc' },
    include: {
      product: { select: { nome: true } },
      sale: { select: { id: true, amount: true, date: true } },
      affiliateProgram: { select: { platform: true } },
    },
  })

  if (!comissao) return { concluida: false as const }

  return {
    concluida: true as const,
    comissao: {
      id: comissao.id,
      status: comissao.status,
      valor: comissao.status === 'RECEIVED' ? comissao.receivedAmount : comissao.confirmedAmount,
      produto: comissao.product?.nome ?? null,
      plataforma: comissao.affiliateProgram?.platform ?? null,
      vendaId: comissao.sale?.id ?? null,
      data: comissao.sale?.date ?? comissao.confirmedAt ?? comissao.receivedAt ?? comissao.createdAt,
    },
  }
}

type RegistrarResultadoInput = {
  workspaceId: string
  actorUserId: string
  /**
   * PROVENIÊNCIA — obrigatória e SEM valor padrão (P0.2 Bloco 1).
   *
   * De propósito não tem default: esquecer de declarar não compila. A rota
   * autenticada da proprietária declara `REAL_OPERATION`; seeds declaram
   * `SEED`; testes declaram `TEST_FIXTURE`. Quem cria dado sintético é
   * código nosso — é nele que o ônus deve cair, nunca na proprietária.
   *
   * Nunca inferida a partir de ambiente, host, nome de usuária ou qualquer
   * outro sinal indireto: inferir proveniência é como não ter proveniência.
   */
  dataOrigin: OrigemDeRegistro
  productId: string
  affiliateProgramId?: string | null
  linkId?: string | null
  contentId?: string | null
  date?: Date
  amount?: number | null
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED'
  expectedCommission?: number | null
  notes?: string | null
  // Idempotência persistente (Rodada 4). A tela gera esta chave UMA VEZ por
  // tentativa de envio (ex.: crypto.randomUUID() ao abrir o formulário) e
  // reenvia a MESMA chave em cada retry — clique repetido, timeout, refresh,
  // retry de rede — até o envio ter sucesso. Sem isso, a janela de 5s usada
  // como fallback abaixo não é garantia financeira suficiente (dois envios
  // separados por mais de 5s, ou uma race condition entre duas chamadas
  // simultâneas, ainda poderiam duplicar).
  idempotencyKey?: string | null
}

/**
 * Registra um resultado manual (a tela "Vendas e Comissões" chama isso em
 * "Registrar resultado"): cria a Sale e a Commission (EXPECTED) associada,
 * numa única transação — nunca existe Commission órfã de uma Sale que
 * falhou ao ser criada.
 *
 * Idempotência em duas camadas:
 * 1. Persistente (principal): se `idempotencyKey` é enviada e já existe uma
 *    Sale com essa chave neste workspace, devolve ela — nunca cria outra.
 *    Reforçada por uma constraint UNIQUE no banco (`@@unique([workspaceId,
 *    idempotencyKey])`), então mesmo duas chamadas simultâneas com a mesma
 *    chave (race condition) não conseguem criar duas Sales: a segunda
 *    esbarra na constraint e busca a que a primeira já criou.
 * 2. Best-effort por janela de tempo (fallback, mantido da Rodada 3): sem
 *    chave, uma Sale idêntica (mesmo produto, valor, status) criada nos
 *    últimos 5 segundos ainda é detectada como duplicata — cobre chamadas
 *    antigas que não enviam chave, mas não é garantia forte sozinha.
 */
/**
 * Erro de coerência da cadeia da venda. Separado de erro técnico de
 * propósito: a rota devolve 400 (dado inconsistente enviado), não 500.
 */
export class CadeiaDaVendaInconsistente extends Error {
  constructor(
    public readonly campo: 'linkId' | 'contentId',
    public readonly motivo: 'NAO_ENCONTRADO' | 'OUTRO_WORKSPACE' | 'OUTRO_PRODUTO',
    mensagem: string
  ) {
    super(mensagem)
    this.name = 'CadeiaDaVendaInconsistente'
  }
}

/**
 * Valida a cadeia produto → link → conteúdo ANTES de gravar a venda.
 *
 * ── POR QUE AQUI, E NÃO SÓ NA ROTA ──────────────────────────────────────
 * Este é o ponto único por onde toda venda nasce. Validar só na rota
 * deixaria seeds, scripts e chamadas futuras livres para gravar uma venda
 * apontando para link de outro workspace — e o defeito só apareceria depois,
 * como número errado numa tela.
 *
 * ── POR QUE NÃO BASTA A ATRIBUIÇÃO ──────────────────────────────────────
 * A regra de atribuição recusa clique incoerente, mas isso é tarde demais:
 * a venda já teria sido gravada com `linkId` de outro negócio, e o relatório
 * por link somaria receita no lugar errado. Atribuição protege o CLIQUE;
 * esta função protege a VENDA.
 *
 * ── LINK INATIVO É ACEITO, DE PROPÓSITO ─────────────────────────────────
 * `LinkDinamico.ativo` controla se o link AINDA REDIRECIONA, não se ele já
 * produziu venda. Uma campanha encerrada tem o link desativado e continua
 * gerando comissão semanas depois; recusar o registro obrigaria a
 * proprietária a reativar um link que não deveria mais funcionar, ou a
 * perder a venda. O vínculo histórico vale independentemente de o link
 * estar ativo hoje.
 */
async function validarCadeiaDaVenda(input: {
  workspaceId: string
  productId: string
  linkId?: string | null
  contentId?: string | null
}): Promise<void> {
  if (input.linkId) {
    const link = await prisma.linkDinamico.findUnique({
      where: { id: input.linkId },
      select: { workspaceId: true, produtoId: true },
    })
    if (!link) {
      throw new CadeiaDaVendaInconsistente('linkId', 'NAO_ENCONTRADO', 'O link informado não existe.')
    }
    // Mensagem deliberadamente igual para "não existe" e "é de outro
    // workspace": confirmar a existência de um id alheio já vazaria
    // informação sobre o outro negócio.
    if (link.workspaceId !== input.workspaceId) {
      throw new CadeiaDaVendaInconsistente('linkId', 'OUTRO_WORKSPACE', 'O link informado não existe.')
    }
    if (link.produtoId !== input.productId) {
      throw new CadeiaDaVendaInconsistente(
        'linkId',
        'OUTRO_PRODUTO',
        'O link informado é de outro produto — uma venda não pode ser creditada a um link que não aponta para o produto vendido.'
      )
    }
  }

  if (input.contentId) {
    const conteudo = await prisma.conteudo.findUnique({
      where: { id: input.contentId },
      select: { workspaceId: true, produtoId: true },
    })
    if (!conteudo) {
      throw new CadeiaDaVendaInconsistente('contentId', 'NAO_ENCONTRADO', 'O conteúdo informado não existe.')
    }
    if (conteudo.workspaceId !== input.workspaceId) {
      throw new CadeiaDaVendaInconsistente('contentId', 'OUTRO_WORKSPACE', 'O conteúdo informado não existe.')
    }
    if (conteudo.produtoId !== input.productId) {
      throw new CadeiaDaVendaInconsistente(
        'contentId',
        'OUTRO_PRODUTO',
        'O conteúdo informado é de outro produto — creditar a venda a ele distorceria o desempenho por conteúdo.'
      )
    }
  }
}

/**
 * Busca os cliques candidatos e aplica a regra determinística
 * (`lib/atribuicao-clique.ts`). A CONSULTA já filtra por workspace e link —
 * a função pura filtra de novo. A redundância é intencional: se um dia a
 * consulta for alterada por engano, a regra ainda recusa clique de outro
 * negócio.
 *
 * Falha de leitura NÃO derruba o registro da venda: a venda é o fato
 * comercial e não pode ser perdida porque a atribuição falhou. Nesse caso a
 * venda fica sem clique, com o motivo gravado — nunca com clique aproximado.
 */
async function resolverAtribuicao(input: {
  workspaceId: string
  linkId: string | null
  dataDaVenda: Date
}): Promise<ResultadoAtribuicao> {
  if (!input.linkId) {
    return atribuirClique({ ...input, cliques: [] })
  }
  try {
    const cliques = await prisma.eventoLink.findMany({
      where: {
        workspaceId: input.workspaceId,
        linkId: input.linkId,
        tipo: 'clique',
        createdAt: { lt: input.dataDaVenda },
      },
      // Dois bastam para detectar empate no instante mais recente; puxar o
      // histórico inteiro de um link movimentado seria desperdício.
      orderBy: { createdAt: 'desc' },
      take: 2,
      select: { id: true, workspaceId: true, linkId: true, createdAt: true },
    })
    return atribuirClique({ ...input, cliques })
  } catch (e) {
    console.error('[vendas] não foi possível ler os cliques para atribuição — venda segue sem clique atribuído:', e)
    return {
      clickEventId: null,
      metodo: 'AMBIGUO_NAO_ATRIBUIDO',
      explicacao: 'Não foi possível consultar os cliques no momento do registro — a venda ficou sem atribuição, e isso não é suprido por inferência depois.',
    }
  }
}

export async function registrarResultado(input: RegistrarResultadoInput) {
  // Antes de QUALQUER coisa — inclusive antes do atalho de idempotência.
  // Um reenvio com cadeia inconsistente tem de falhar igual ao primeiro
  // envio; devolver a venda anterior calada esconderia o erro de quem chama.
  await validarCadeiaDaVenda(input)

  if (input.idempotencyKey) {
    const existente = await prisma.sale.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey } },
      include: { commissions: true },
    })
    if (existente) {
      return { sale: existente, commission: existente.commissions[0] ?? null, duplicado: true }
    }
  } else {
    const janela = new Date(Date.now() - 5000)
    const duplicata = await prisma.sale.findFirst({
      where: {
        workspaceId: input.workspaceId,
        productId: input.productId,
        amount: input.amount ?? null,
        status: input.status,
        createdAt: { gte: janela },
      },
      orderBy: { createdAt: 'desc' },
      include: { commissions: true },
    })
    if (duplicata) {
      return { sale: duplicata, commission: duplicata.commissions[0] ?? null, duplicado: true }
    }
  }

  const dataDaVenda = input.date ?? new Date()
  const atribuicao = await resolverAtribuicao({
    workspaceId: input.workspaceId,
    linkId: input.linkId ?? null,
    dataDaVenda,
  })

  try {
    const { sale, commission } = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          workspaceId: input.workspaceId,
          productId: input.productId,
          affiliateProgramId: input.affiliateProgramId ?? null,
          linkId: input.linkId ?? null,
          contentId: input.contentId ?? null,
          date: dataDaVenda,
          amount: dinheiro(input.amount),
          status: input.status,
          source: 'manual',
          // Declarada por quem chama, nunca inferida aqui.
          dataOrigin: input.dataOrigin,
          // `null` quando a atribuição não foi inequívoca; o método diz por quê.
          clickEventId: atribuicao.clickEventId,
          attributionMethod: atribuicao.metodo,
          notes: input.notes ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      })

      const commission = await tx.commission.create({
        data: {
          workspaceId: input.workspaceId,
          saleId: sale.id,
          productId: input.productId,
          affiliateProgramId: input.affiliateProgramId ?? null,
          expectedAmount: dinheiro(input.expectedCommission),
          status: 'EXPECTED',
          expectedAt: new Date(),
        },
      })

      await tx.auditLog.create({
        data: {
          workspaceId: input.workspaceId,
          userId: input.actorUserId,
          action: 'venda.criada',
          entityType: 'Sale',
          entityId: sale.id,
          metadata: {
            productId: input.productId,
            status: sale.status,
            amount: sale.amount,
            // Proveniência e atribuição entram na auditoria: são justamente
            // as informações que decidem se esta venda pode, um dia, ensinar
            // o ML. Precisam ser rastreáveis desde o instante do registro.
            dataOrigin: sale.dataOrigin,
            linkId: sale.linkId,
            clickEventId: sale.clickEventId,
            attributionMethod: sale.attributionMethod,
            atribuicaoExplicacao: atribuicao.explicacao,
          },
        },
      })

      return { sale, commission }
    })

    return { sale, commission, duplicado: false }
  } catch (e) {
    // Race condition: duas chamadas com a MESMA idempotencyKey chegaram ao
    // mesmo tempo. A constraint única do banco rejeita a segunda — em vez
    // de propagar o erro, busca e devolve a Sale que a primeira criou.
    const violouUnicidade = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    if (violouUnicidade && input.idempotencyKey) {
      const existente = await prisma.sale.findUnique({
        where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey } },
        include: { commissions: true },
      })
      if (existente) {
        return { sale: existente, commission: existente.commissions[0] ?? null, duplicado: true }
      }
    }
    throw e
  }
}

/** Altera o status de uma venda (PENDING/CONFIRMED/CANCELLED), com auditoria. */
export async function atualizarStatusVenda(params: {
  workspaceId: string
  saleId: string
  actorUserId: string
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED'
  notes?: string | null
}) {
  const atual = await prisma.sale.findFirst({
    where: { id: params.saleId, workspaceId: params.workspaceId },
  })
  if (!atual) return null

  const sale = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.update({
      where: { id: params.saleId },
      data: { status: params.status, ...(params.notes !== undefined && { notes: params.notes }) },
    })
    // P2.25: venda cancelada leva a comissão junto (REVERSED se já estava confirmada/recebida, CANCELLED se
    // era só previsão), com o antes/depois no histórico. Reativar a venda devolve o estado anterior.
    if (atual.status !== params.status && (params.status === 'CANCELLED' || atual.status === 'CANCELLED')) {
      const coms = await tx.commission.findMany({ where: { workspaceId: params.workspaceId, saleId: sale.id } })
      for (const c of coms) {
        let novo: string | null = null
        if (params.status === 'CANCELLED' && !['REVERSED', 'CANCELLED'].includes(c.status)) novo = c.status === 'EXPECTED' ? 'CANCELLED' : 'REVERSED'
        if (atual.status === 'CANCELLED' && ['REVERSED', 'CANCELLED'].includes(c.status)) {
          const ultimo = await tx.historicoDeComissao.findFirst({ where: { commissionId: c.id, origem: 'VENDA_CANCELADA' }, orderBy: { registradoEm: 'desc' } })
          novo = (ultimo?.anterior as { status?: string } | null)?.status ?? (c.status === 'REVERSED' ? 'CONFIRMED' : 'EXPECTED')
        }
        if (!novo || novo === c.status) continue
        const salvo = await tx.commission.update({ where: { id: c.id }, data: { status: novo } })
        await tx.historicoDeComissao.create({
          data: { workspaceId: params.workspaceId, commissionId: c.id, origem: params.status === 'CANCELLED' ? 'VENDA_CANCELADA' : 'VENDA_REATIVADA', anterior: retratoDaComissao(c), novo: retratoDaComissao(salvo), motivo: `venda ${atual.status} → ${params.status}` },
        })
      }
    }
    return sale
  })

  await registrarAuditoria({
    workspaceId: params.workspaceId,
    userId: params.actorUserId,
    action: params.status === 'CANCELLED' ? 'venda.cancelada' : 'venda.alterada',
    entityType: 'Sale',
    entityId: sale.id,
    metadata: { statusAnterior: atual.status, statusNovo: sale.status },
  })

  return sale
}

/** A comissão mudou entre a leitura e a gravação (outra aba/processo): recarregar e tentar de novo. */
export class ComissaoAlteradaEmParalelo extends Error {
  constructor() {
    super('A comissão foi alterada por outra ação ao mesmo tempo. Recarregue e tente de novo.')
    this.name = 'ComissaoAlteradaEmParalelo'
  }
}

/** Altera o status/valores de uma comissão (EXPECTED/CONFIRMED/RECEIVED), com auditoria e histórico. */
export async function atualizarComissao(params: {
  workspaceId: string
  commissionId: string
  actorUserId: string
  status: 'EXPECTED' | 'CONFIRMED' | 'RECEIVED'
  confirmedAmount?: number | null
  receivedAmount?: number | null
  notes?: string | null
}) {
  const atual = await prisma.commission.findFirst({
    where: { id: params.commissionId, workspaceId: params.workspaceId },
  })
  if (!atual) return null

  // P2.25: compare-and-set (duas abas não se sobrescrevem em silêncio) + antes/depois no histórico.
  const commission = await prisma.$transaction(async (tx) => {
    const mudou = await tx.commission.updateMany({
      where: { id: params.commissionId, status: atual.status, updatedAt: atual.updatedAt },
      data: {
      status: params.status,
      ...(params.confirmedAmount !== undefined && {
        confirmedAmount: dinheiro(params.confirmedAmount),
        confirmedAt: new Date(),
      }),
      ...(params.receivedAmount !== undefined && {
        receivedAmount: dinheiro(params.receivedAmount),
        receivedAt: new Date(),
      }),
      ...(params.notes !== undefined && { notes: params.notes }),
      },
    })
    if (mudou.count === 0) throw new ComissaoAlteradaEmParalelo()
    const salvo = await tx.commission.findUniqueOrThrow({ where: { id: params.commissionId } })
    await tx.historicoDeComissao.create({
      data: { workspaceId: params.workspaceId, commissionId: salvo.id, origem: 'MANUAL', anterior: retratoDaComissao(atual), novo: retratoDaComissao(salvo), motivo: `${atual.status} → ${salvo.status}` },
    })
    return salvo
  })

  const action =
    params.status === 'RECEIVED'
      ? 'comissao.recebida'
      : params.status === 'CONFIRMED'
        ? 'comissao.confirmada'
        : 'comissao.alterada'

  await registrarAuditoria({
    workspaceId: params.workspaceId,
    userId: params.actorUserId,
    action,
    entityType: 'Commission',
    entityId: commission.id,
    metadata: { statusAnterior: atual.status, statusNovo: commission.status },
  })

  // GATILHO C (P0.2 Bloco 4.1): comissão reconhecida → reavalia a venda pela
  // autoridade e, se agora for elegível, rotula a amostra.
  //
  // Por que não basta o gatilho da promoção: uma venda pode ser promovida
  // ANTES da comissão ser reconhecida. Naquele instante a autoridade diz
  // inelegível e nada é escrito — corretamente. Sem este gatilho, a amostra
  // ficaria sem rótulo para sempre, esperando alguém mandar "atualizar ML".
  if ((params.status === 'CONFIRMED' || params.status === 'RECEIVED') && commission.saleId) {
    const { rotularAmostraDeOperacaoReal } = await import('@/lib/promocao-operacao-real')
    await rotularAmostraDeOperacaoReal(params.workspaceId, commission.saleId)
  }

  return commission
}
