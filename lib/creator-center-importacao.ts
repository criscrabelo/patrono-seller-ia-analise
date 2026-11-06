/**
 * P2.19 — Importação do relatório de pedidos de afiliado do Creator Center (CSV ou XLSX).
 *
 * - Idempotente: o mesmo arquivo (sha256; com o mesmo mapeamento manual) de novo não grava nada; uma
 *   importação interrompida é RETOMADA (cada linha é idempotente pela chave pedido+SKU).
 * - Duplicidade: a mesma linha em arquivos diferentes atualiza o MESMO pedido; igual = não muda nada.
 * - Auditoria: o arquivo original (texto do CSV ou base64 do XLSX), o formato, o cabeçalho, o mapeamento
 *   e a versão do parser ficam gravados na importação; colunas não reconhecidas ficam em cada pedido.
 * - Histórico: toda criação/mudança grava HistoricoPedidoAfiliadoTikTok com o antes e o depois.
 * - Regressão: arquivo mais antigo (ex.: "estimada" depois de "liquidada") não volta o estado; fica no
 *   histórico como REGRESSAO_IGNORADA.
 * - Espelho em Sale/Commission (fonte única das telas de vendas): LIQUIDADA → venda CONFIRMED e comissão
 *   CONFIRMED com o valor real; ESTIMADA/NAO_LIQUIDADA → venda PENDING e comissão EXPECTED (estimativa
 *   nunca vira receita); CANCELADA → venda CANCELLED (fora de todos os totais). RECEIVED (dinheiro na
 *   conta) continua manual: liquidação ≠ pagamento.
 * - Vínculos SÓ por identificador e só quando a correspondência é ÚNICA: produto pelo id externo do
 *   TikTok Shop; vídeo pelo postId. Sem correspondência única → NAO_VINCULADO (nunca por nome/semelhança).
 */
import { registrarEvento } from './ledger'
import { retratoDaComissao, cadeiaFinanceira, somarFinanceiro } from './financeiro'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { registrarAuditoria } from '@/lib/audit-log'
import type { OrigemDeRegistro } from '@/lib/proveniencia'
import {
  lerArquivoDoCreatorCenter, lerTabelaDoCreatorCenter, ORDEM_DO_ESTADO, VERSAO_DO_PARSER,
  type ArquivoLido, type Campo, type EstadoDaComissao, type LinhaDoPedido,
} from '@/lib/creator-center-csv'
import { ehXlsx, ErroDeXlsx, lerXlsx } from '@/lib/xlsx-leitor'

export const ORIGEM_CREATOR_CENTER = 'CREATOR_CENTER_CSV'
const CAMPOS_RASTREADOS = ['estado', 'statusOriginal', 'comissaoEstimada', 'comissaoLiquidada', 'valorBase', 'taxaComissao', 'quantidade', 'dataPedido', 'dataLiquidacao', 'tipoConteudo', 'conteudoIdExterno', 'lojaNome', 'produtoNome'] as const

export interface ResultadoDaImportacao {
  ok: boolean
  motivo?: string
  repetida?: boolean
  importacaoId?: string
  formato?: 'CSV' | 'XLSX'
  versaoDoParser: string
  linhasTotal: number
  linhasNovas: number
  linhasAtualizadas: number
  linhasIguais: number
  linhasRejeitadas: number
  regressoesIgnoradas: number
  naoVinculados: number
  colunasIgnoradas: string[]
  colunasPossivelmenteRelevantes: string[]
  ocorrencias: { linha: number; tipo: 'REJEITADA' | 'AVISO' | 'REGRESSAO_IGNORADA'; texto: string }[]
  /**
   * P2.29: o orçamento de tempo da requisição acabou antes do fim do arquivo. Nada se perde: o que foi gravado
   * fica, e enviar o MESMO arquivo de novo continua de onde parou (as linhas já gravadas são reconhecidas como
   * iguais sem custo). A tela reenvia sozinha até `continuar` sumir.
   */
  continuar?: boolean
  /** P2.29: linhas válidas já tratadas por esta importação (inclusive em envios anteriores) / total de linhas válidas. */
  progresso?: { tratadas: number; total: number }
}

/** P2.29 — orçamento padrão por requisição: abaixo do limite de 30 s das funções da Netlify, com folga. */
export const ORCAMENTO_DA_IMPORTACAO_MS = 20_000

const retrato = (l: Pick<LinhaDoPedido, (typeof CAMPOS_RASTREADOS)[number]>) =>
  Object.fromEntries(CAMPOS_RASTREADOS.map((c) => [c, l[c] instanceof Date ? (l[c] as Date).toISOString() : (l[c] ?? null)]))

function statusDaVenda(e: EstadoDaComissao) {
  return e === 'CANCELADA' ? 'CANCELLED' : e === 'LIQUIDADA' ? 'CONFIRMED' : 'PENDING'
}

/** Lê o arquivo (CSV em texto, ou bytes de CSV/XLSX). Nunca grava nada. */
export function lerArquivoEnviado(p: { conteudo?: string; bytes?: Buffer; mapeamentoManual?: Partial<Record<Campo, string>> }): { formato: 'CSV' | 'XLSX'; lido: ArquivoLido; original: string; impressao: string } {
  const manual = p.mapeamentoManual && Object.keys(p.mapeamentoManual).length ? p.mapeamentoManual : undefined
  const sufixo = manual ? `\nmapeamento:${JSON.stringify(Object.entries(manual).sort())}` : ''
  if (p.bytes && ehXlsx(p.bytes)) {
    let tabela
    try { tabela = lerXlsx(p.bytes) } catch (e) {
      if (e instanceof ErroDeXlsx) return { formato: 'XLSX', lido: { ...lerTabelaDoCreatorCenter([]), motivo: `${e.message} Nada foi importado.` }, original: '', impressao: '' }
      throw e
    }
    return { formato: 'XLSX', lido: lerTabelaDoCreatorCenter(tabela, { mapeamentoManual: manual }), original: p.bytes.toString('base64'), impressao: createHash('sha256').update(p.bytes).update(sufixo).digest('hex') }
  }
  const texto = p.conteudo ?? p.bytes?.toString('utf8') ?? ''
  return { formato: 'CSV', lido: lerArquivoDoCreatorCenter(texto, { mapeamentoManual: manual }), original: texto, impressao: createHash('sha256').update(texto.replace(/\r\n/g, '\n') + sufixo).digest('hex') }
}

export async function importarCreatorCenter(p: {
  workspaceId: string
  userId: string | null
  nomeArquivo: string
  /** CSV em texto (compatível) ou os bytes do arquivo (CSV ou XLSX). */
  conteudo?: string
  bytes?: Buffer
  mapeamentoManual?: Partial<Record<Campo, string>>
  dataOrigin: OrigemDeRegistro
  agora?: Date
  /** P2.29: tempo máximo desta chamada (sem limite por padrão; a rota usa ORCAMENTO_DA_IMPORTACAO_MS). */
  orcamentoMs?: number
}): Promise<ResultadoDaImportacao> {
  const agora = p.agora ?? new Date()
  const inicio = Date.now()
  const { formato, lido, original, impressao: sha256 } = lerArquivoEnviado(p)
  const vazio = {
    formato, versaoDoParser: VERSAO_DO_PARSER, linhasTotal: 0, linhasNovas: 0, linhasAtualizadas: 0, linhasIguais: 0, linhasRejeitadas: 0, regressoesIgnoradas: 0, naoVinculados: 0,
    colunasIgnoradas: lido.colunasIgnoradas, colunasPossivelmenteRelevantes: lido.colunasPossivelmenteRelevantes, ocorrencias: [] as ResultadoDaImportacao['ocorrencias'],
  }
  if (!lido.ok) return { ok: false, motivo: lido.motivo, ...vazio }

  const ja = await prisma.importacaoCreatorCenter.findUnique({ where: { workspaceId_sha256: { workspaceId: p.workspaceId, sha256 } } })
  if (ja?.concluida) return { ok: true, repetida: true, importacaoId: ja.id, ...vazio, linhasTotal: ja.linhasTotal }

  const ocorrencias: ResultadoDaImportacao['ocorrencias'] = [
    ...lido.rejeitadas.map((r) => ({ linha: r.linha, tipo: 'REJEITADA' as const, texto: r.motivo })),
    ...lido.avisos.map((a) => ({ linha: a.linha, tipo: 'AVISO' as const, texto: a.aviso })),
  ]
  let importacao = ja
  if (!importacao) {
    try {
      importacao = await prisma.importacaoCreatorCenter.create({
        data: {
          workspaceId: p.workspaceId, userId: p.userId, nomeArquivo: p.nomeArquivo.slice(0, 200), sha256, origem: ORIGEM_CREATOR_CENTER,
          dataOrigin: p.dataOrigin, formato, conteudoOriginal: original, cabecalhoOriginal: lido.cabecalho, versaoDoParser: lido.versaoDoParser,
          mapeamento: lido.mapeamento as Prisma.InputJsonValue, colunasIgnoradas: lido.colunasIgnoradas,
          linhasTotal: lido.linhas.length + lido.rejeitadas.length, linhasNovas: 0, linhasAtualizadas: 0, linhasIguais: 0,
          linhasRejeitadas: lido.rejeitadas.length, ocorrencias: [], importadoEm: agora,
        },
      })
    } catch (e) {
      // Duas abas enviando o mesmo arquivo ao mesmo tempo: a segunda usa a importação da primeira.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        importacao = await prisma.importacaoCreatorCenter.findUniqueOrThrow({ where: { workspaceId_sha256: { workspaceId: p.workspaceId, sha256 } } })
        if (importacao.concluida) return { ok: true, repetida: true, importacaoId: importacao.id, ...vazio, linhasTotal: importacao.linhasTotal }
      } else throw e
    }
  }
  const importacaoId = importacao!.id

  // Vínculos: só identificador e só correspondência ÚNICA (duas fichas com o mesmo id = ambíguo = NAO_VINCULADO).
  const externos = [...new Set(lido.linhas.map((l) => l.produtoIdExterno).filter((x): x is string => !!x))]
  const conteudos = [...new Set(lido.linhas.map((l) => l.conteudoIdExterno).filter((x): x is string => !!x))]
  const [produtos, candidatos, videos] = await Promise.all([
    externos.length ? prisma.produto.findMany({ where: { workspaceId: p.workspaceId, providerId: 'tiktok-shop', externalId: { in: externos } }, select: { id: true, externalId: true } }) : [],
    externos.length ? prisma.candidatoDeProduto.findMany({ where: { workspaceId: p.workspaceId, providerId: 'tiktok-shop', externalId: { in: externos } }, select: { id: true, externalId: true } }) : [],
    conteudos.length ? prisma.videoTikTokResultado.findMany({ where: { workspaceId: p.workspaceId, postId: { in: conteudos } }, select: { id: true, postId: true } }) : [],
  ])
  const unico = <T extends { id: string }>(lista: T[], chave: (x: T) => string | null) => {
    const m = new Map<string, string | null>()
    for (const x of lista) { const k = chave(x); if (!k) continue; m.set(k, m.has(k) ? null : x.id) }
    return m
  }
  const produtoPorExterno = unico(produtos, (x) => x.externalId)
  const candidatoPorExterno = unico(candidatos, (x) => x.externalId)
  const videoPorPost = unico(videos, (x) => x.postId)
  const vincular = (l: LinhaDoPedido) => {
    const produtoId = l.produtoIdExterno ? produtoPorExterno.get(l.produtoIdExterno) ?? null : null
    const candidatoId = l.produtoIdExterno ? candidatoPorExterno.get(l.produtoIdExterno) ?? null : null
    const videoResultadoId = l.conteudoIdExterno ? videoPorPost.get(l.conteudoIdExterno) ?? null : null
    return {
      produtoId, candidatoId, videoResultadoId,
      vinculoProduto: !l.produtoIdExterno ? 'SEM_IDENTIFICADOR' : produtoId || candidatoId ? 'VINCULADO_POR_ID_EXTERNO' : 'NAO_VINCULADO',
      vinculoVideo: !l.conteudoIdExterno ? 'SEM_IDENTIFICADOR' : videoResultadoId ? 'VINCULADO_POR_POST_ID' : 'NAO_VINCULADO',
    }
  }

  // P2.29: os pedidos que já existem são lidos de uma vez; a linha IGUAL ao que está gravado não abre transação
  // (não escreve nada — antes custava trava + leitura + commit por linha, e um reenvio de 200 linhas levava 40 s).
  const existentes = new Map<string, { retrato: string; id: string; estado: EstadoDaComissao }>()
  const chaves = lido.linhas.map((l) => l.chave)
  for (let i = 0; i < chaves.length; i += 500) {
    for (const x of await prisma.pedidoAfiliadoTikTok.findMany({ where: { workspaceId: p.workspaceId, chave: { in: chaves.slice(i, i + 500) } } })) {
      existentes.set(x.chave, { retrato: JSON.stringify(retrato({ ...x, estado: x.estado as EstadoDaComissao })), id: x.id, estado: x.estado as EstadoDaComissao })
    }
  }
  // Regressão já registrada por ESTA importação (num envio anterior): reconhecida sem reprocessar (senão a mesma
  // linha consumiria o orçamento a cada envio e a importação em partes nunca terminaria).
  const regressaoJaRegistrada = new Set((await prisma.historicoPedidoAfiliadoTikTok.findMany({ where: { workspaceId: p.workspaceId, importacaoId, tipo: 'REGRESSAO_IGNORADA' }, select: { pedidoId: true } })).map((x) => x.pedidoId))
  const textoDaRegressao = (l: LinhaDoPedido) => `pedido ${l.pedidoId}: o arquivo traz "${l.estado}", mas o Patrono já tem um estado mais avançado; mantido`

  let novas = 0, atualizadas = 0, iguais = 0, regressoes = 0, naoVinculados = 0, parou = false, regressoesJaVistas = 0
  for (const l of lido.linhas) {
    const ligacoes = vincular(l)
    if (ligacoes.vinculoProduto !== 'VINCULADO_POR_ID_EXTERNO') naoVinculados++
    const ja = existentes.get(l.chave)
    if (ja?.retrato === JSON.stringify(retrato(l))) { iguais++; continue }
    if (ja && regressaoJaRegistrada.has(ja.id) && ORDEM_DO_ESTADO[l.estado] < ORDEM_DO_ESTADO[ja.estado]) {
      ocorrencias.push({ linha: l.linha, tipo: 'REGRESSAO_IGNORADA', texto: textoDaRegressao(l) })
      regressoesJaVistas++
      continue
    }
    // Orçamento: pelo menos uma linha por chamada (sempre avança); o resto fica para o próximo envio do mesmo arquivo.
    if (p.orcamentoMs != null && novas + atualizadas + regressoes > 0 && Date.now() - inicio > p.orcamentoMs) { parou = true; continue }
    const extras = l.colunasExtras ? (l.colunasExtras as Prisma.InputJsonValue) : Prisma.DbNull
    const r = await prisma.$transaction(async (tx) => {
      // Duas abas importando o mesmo pedido ao mesmo tempo: a trava serializa a linha (a segunda vê a primeira).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`creator-center:${p.workspaceId}:${l.chave}`}))`
      const atual = await tx.pedidoAfiliadoTikTok.findUnique({ where: { workspaceId_chave: { workspaceId: p.workspaceId, chave: l.chave } } })
      const novo = retrato(l)
      if (atual) {
        const anterior = retrato({ ...atual, estado: atual.estado as EstadoDaComissao })
        if (JSON.stringify(anterior) === JSON.stringify(novo)) return 'IGUAL' as const
        if (ORDEM_DO_ESTADO[l.estado] < ORDEM_DO_ESTADO[atual.estado as EstadoDaComissao]) {
          const ja = await tx.historicoPedidoAfiliadoTikTok.findFirst({ where: { pedidoId: atual.id, importacaoId, tipo: 'REGRESSAO_IGNORADA' }, select: { id: true } })
          if (!ja) await tx.historicoPedidoAfiliadoTikTok.create({ data: { workspaceId: p.workspaceId, pedidoId: atual.id, importacaoId, tipo: 'REGRESSAO_IGNORADA', anterior, novo } })
          return 'REGRESSAO' as const
        }
        await tx.pedidoAfiliadoTikTok.update({ where: { id: atual.id }, data: { ...dadosDaLinha(l), ...ligacoes, colunasExtras: extras, ultimaImportacaoId: importacaoId } })
        await tx.historicoPedidoAfiliadoTikTok.create({ data: { workspaceId: p.workspaceId, pedidoId: atual.id, importacaoId, tipo: 'ATUALIZADO', anterior, novo } })
        await espelharEmVenda(tx, p.workspaceId, atual.id, atual.saleId, l, ligacoes.produtoId, p.dataOrigin, agora, importacaoId, atual.estado)
        await eventoDaComissao(tx, p.workspaceId, atual.id, atual.estado, l, ligacoes.videoResultadoId, importacaoId)
        return 'ATUALIZADA' as const
      }
      const criado = await tx.pedidoAfiliadoTikTok.create({
        data: { workspaceId: p.workspaceId, chave: l.chave, ...dadosDaLinha(l), ...ligacoes, colunasExtras: extras, origem: ORIGEM_CREATOR_CENTER, dataOrigin: p.dataOrigin, primeiraImportacaoId: importacaoId, ultimaImportacaoId: importacaoId },
      })
      await tx.historicoPedidoAfiliadoTikTok.create({ data: { workspaceId: p.workspaceId, pedidoId: criado.id, importacaoId, tipo: 'CRIADO', novo } })
      await espelharEmVenda(tx, p.workspaceId, criado.id, null, l, ligacoes.produtoId, p.dataOrigin, agora, importacaoId, null)
      await eventoDaComissao(tx, p.workspaceId, criado.id, null, l, ligacoes.videoResultadoId, importacaoId)
      return 'NOVA' as const
    }, { timeout: 30_000 })
    if (r === 'NOVA') novas++
    else if (r === 'ATUALIZADA') atualizadas++
    else if (r === 'IGUAL') iguais++
    else { regressoes++; ocorrencias.push({ linha: l.linha, tipo: 'REGRESSAO_IGNORADA', texto: textoDaRegressao(l) }) }
  }

  // P2.29: os números da importação saem do que ela gravou (não do que esta chamada viu): corretos mesmo quando o
  // arquivo foi tratado em vários envios (orçamento de tempo) ou depois de uma queda no meio.
  const [criadosAqui, atualizadosAqui, regressoesAqui] = await Promise.all([
    prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId: p.workspaceId, primeiraImportacaoId: importacaoId } }),
    prisma.historicoPedidoAfiliadoTikTok.findMany({ where: { workspaceId: p.workspaceId, importacaoId, tipo: 'ATUALIZADO' }, distinct: ['pedidoId'], select: { pedidoId: true } }).then((x) => x.length),
    prisma.historicoPedidoAfiliadoTikTok.findMany({ where: { workspaceId: p.workspaceId, importacaoId, tipo: 'REGRESSAO_IGNORADA' }, distinct: ['pedidoId'], select: { pedidoId: true } }).then((x) => x.length),
  ])
  if (parou) {
    // tratadas = as que já batem com o gravado (inclusive as gravadas nos envios anteriores) + as desta chamada
    const tratadas = Math.min(lido.linhas.length, iguais + regressoesJaVistas + novas + atualizadas + regressoes)
    return {
      ok: true, continuar: true, importacaoId, formato, versaoDoParser: lido.versaoDoParser, linhasTotal: lido.linhas.length + lido.rejeitadas.length,
      linhasNovas: criadosAqui, linhasAtualizadas: atualizadosAqui, linhasIguais: 0, linhasRejeitadas: lido.rejeitadas.length, regressoesIgnoradas: regressoesAqui, naoVinculados,
      colunasIgnoradas: lido.colunasIgnoradas, colunasPossivelmenteRelevantes: lido.colunasPossivelmenteRelevantes, ocorrencias, progresso: { tratadas, total: lido.linhas.length },
    }
  }
  novas = criadosAqui; atualizadas = atualizadosAqui; regressoes = regressoesAqui
  iguais = Math.max(0, lido.linhas.length - novas - atualizadas - regressoes)
  await prisma.importacaoCreatorCenter.update({
    where: { id: importacaoId },
    data: { linhasNovas: novas, linhasAtualizadas: atualizadas, linhasIguais: iguais + regressoes, linhasRejeitadas: lido.rejeitadas.length, ocorrencias: ocorrencias as unknown as Prisma.InputJsonValue, concluida: true },
  })
  await registrarAuditoria({
    workspaceId: p.workspaceId, userId: p.userId, action: 'creator_center.importado', entityType: 'ImportacaoCreatorCenter', entityId: importacaoId,
    metadata: { arquivo: p.nomeArquivo, formato, versaoDoParser: lido.versaoDoParser, novas, atualizadas, iguais, regressoes, rejeitadas: lido.rejeitadas.length, naoVinculados },
  })
  return {
    ok: true, importacaoId, formato, versaoDoParser: lido.versaoDoParser, linhasTotal: lido.linhas.length + lido.rejeitadas.length, linhasNovas: novas, linhasAtualizadas: atualizadas,
    linhasIguais: iguais, linhasRejeitadas: lido.rejeitadas.length, regressoesIgnoradas: regressoes, naoVinculados,
    colunasIgnoradas: lido.colunasIgnoradas, colunasPossivelmenteRelevantes: lido.colunasPossivelmenteRelevantes, ocorrencias,
  }
}

function dadosDaLinha(l: LinhaDoPedido) {
  return {
    pedidoId: l.pedidoId, skuId: l.skuId, produtoIdExterno: l.produtoIdExterno, produtoNome: l.produtoNome, lojaNome: l.lojaNome,
    quantidade: l.quantidade, valorBase: l.valorBase, taxaComissao: l.taxaComissao, tipoConteudo: l.tipoConteudo, conteudoIdExterno: l.conteudoIdExterno,
    estado: l.estado, statusOriginal: l.statusOriginal, comissaoEstimada: l.comissaoEstimada, comissaoLiquidada: l.comissaoLiquidada,
    dataPedido: l.dataPedido, dataLiquidacao: l.dataLiquidacao,
  }
}

async function espelharEmVenda(
  tx: Prisma.TransactionClient, workspaceId: string, pedidoAfiliadoId: string, saleId: string | null,
  l: LinhaDoPedido, produtoId: string | null, dataOrigin: OrigemDeRegistro, agora: Date, importacaoId: string, estadoAnterior: string | null,
) {
  const nota = `Creator Center (${ORIGEM_CREATOR_CENTER}) · pedido ${l.pedidoId} · comissão ${l.estado}`
  const venda = { productId: produtoId, amount: l.valorBase, date: l.dataPedido ?? agora, status: statusDaVenda(l.estado), notes: nota }
  const idSale = saleId
    ? (await tx.sale.update({ where: { id: saleId }, data: venda })).id
    : (await tx.sale.upsert({
        where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: `creator-center:${l.chave}` } },
        create: { workspaceId, ...venda, source: 'creator_center_csv', dataOrigin, idempotencyKey: `creator-center:${l.chave}`, attributionMethod: 'CREATOR_CENTER_RELATORIO' },
        update: venda,
      })).id
  if (!saleId) await tx.pedidoAfiliadoTikTok.update({ where: { id: pedidoAfiliadoId }, data: { saleId: idSale } })
  const atual = await tx.commission.findFirst({ where: { workspaceId, saleId: idSale } })
  const liquidada = l.estado === 'LIQUIDADA'
  const cancelada = l.estado === 'CANCELADA'
  // P2.25: cancelada depois de liquidada/recebida = REVERTIDA, e os valores confirmados FICAM (histórico não se apaga).
  const jaConfirmada = atual?.status === 'CONFIRMED' || atual?.status === 'RECEIVED' || atual?.status === 'REVERSED' || estadoAnterior === 'LIQUIDADA'
  const status = cancelada
    ? jaConfirmada ? 'REVERSED' : 'CANCELLED'
    // RECEIVED (pagamento) é manual: nunca é rebaixado nem criado pela importação.
    : atual?.status === 'RECEIVED' ? 'RECEIVED' : liquidada ? 'CONFIRMED' : 'EXPECTED'
  const dados = {
    productId: produtoId,
    expectedAmount: l.comissaoEstimada ?? (cancelada ? atual?.expectedAmount ?? null : null),
    expectedAt: l.dataPedido,
    confirmedAmount: liquidada ? l.comissaoLiquidada : cancelada ? atual?.confirmedAmount ?? null : null,
    confirmedAt: liquidada ? l.dataLiquidacao ?? agora : cancelada ? atual?.confirmedAt ?? null : null,
    status,
    notes: nota,
  }
  const salvo = atual
    ? await tx.commission.update({ where: { id: atual.id }, data: dados })
    : await tx.commission.create({ data: { workspaceId, saleId: idSale, ...dados } })
  const antes = atual ? retratoDaComissao(atual) : null
  const depois = retratoDaComissao(salvo)
  if (JSON.stringify(antes) !== JSON.stringify(depois)) {
    await tx.historicoDeComissao.upsert({
      where: { workspaceId_chave: { workspaceId, chave: `creator-center:${importacaoId}:${l.chave}` } },
      create: { workspaceId, commissionId: salvo.id, origem: 'CREATOR_CENTER', chave: `creator-center:${importacaoId}:${l.chave}`, anterior: antes ?? Prisma.DbNull, novo: depois, motivo: `pedido ${l.pedidoId}: ${estadoAnterior ?? 'novo'} → ${l.estado}` },
      update: {},
    })
  }
}

/**
 * P2.28 — Situação de UMA importação, sem tratar parcial como sucesso completo:
 * INCOMPLETA (começou e não terminou) · IMPORTADO_COM_ALERTAS (linhas recusadas, pedidos sem vínculo, coluna
 * relevante não reconhecida, regressão ignorada) · IMPORTADO. Com linhas válidas, recusadas, sem vínculo,
 * colunas desconhecidas e a próxima ação.
 */
export async function situacaoDaImportacao(workspaceId: string, importacaoId: string) {
  const i = await prisma.importacaoCreatorCenter.findFirst({ where: { id: importacaoId, workspaceId } })
  if (!i) return null
  const { colunasRelevantesNaoReconhecidas } = await import('@/lib/creator-center-csv')
  const [gravadas, naoVinculados] = await Promise.all([
    prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId, OR: [{ primeiraImportacaoId: i.id }, { ultimaImportacaoId: i.id }] } }),
    prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId, ultimaImportacaoId: i.id, vinculoProduto: { not: 'VINCULADO_POR_ID_EXTERNO' } } }),
  ])
  const relevantes = colunasRelevantesNaoReconhecidas(i.colunasIgnoradas)
  const regressoes = ((i.ocorrencias as { tipo?: string }[] | null) ?? []).filter((o) => o.tipo === 'REGRESSAO_IGNORADA').length
  const alertas: string[] = []
  if (!i.concluida) alertas.push(`começou e não terminou (${gravadas} de ${i.linhasTotal} linhas gravadas)`)
  if (i.linhasRejeitadas) alertas.push(`${i.linhasRejeitadas} linha(s) recusada(s)`)
  if (naoVinculados) alertas.push(`${naoVinculados} pedido(s) sem vínculo`)
  if (relevantes.length) alertas.push(`coluna(s) que parecem importantes e não foram reconhecidas: ${relevantes.join(', ')}`)
  if (regressoes) alertas.push(`${regressoes} linha(s) mais antigas que o já registrado (mantido o estado mais novo)`)
  const situacao = !i.concluida ? 'INCOMPLETA' as const : alertas.length ? 'IMPORTADO_COM_ALERTAS' as const : 'IMPORTADO' as const
  const proximaAcao = !i.concluida
    ? 'Envie o mesmo arquivo de novo: a importação retoma de onde parou e nada duplica.'
    : naoVinculados ? 'Revise os IDs de produto: pedidos sem vínculo contam no total, mas não são atribuídos a produto/vídeo.'
    : i.linhasRejeitadas ? 'Veja as linhas recusadas abaixo e corrija no arquivo, se forem pedidos reais.'
    : relevantes.length ? 'Se essas colunas trazem comissão ou estado do pedido, indique no mapeamento manual.'
    : regressoes ? 'Nada a fazer: o Patrono manteve o estado mais recente de cada pedido.' : 'Nada a fazer.'
  return {
    importacaoId: i.id, nomeArquivo: i.nomeArquivo, importadoEm: i.importadoEm, situacao,
    linhasValidas: i.linhasNovas + i.linhasAtualizadas + i.linhasIguais, linhasRecusadas: i.linhasRejeitadas, naoVinculados,
    colunasDesconhecidas: i.colunasIgnoradas, colunasRelevantesNaoReconhecidas: relevantes, alertas, proximaAcao,
  }
}

/**
 * Resumo para a tela: os estados separados. Só a LIQUIDADA é receita confirmada; RECEBIDA (dinheiro na
 * conta) vem da comissão marcada como recebida pela titular, e é mostrada à parte.
 */
export async function resumoCreatorCenter(workspaceId: string) {
  const [porEstado, ultima, naoVinculados, canonico] = await Promise.all([
    prisma.pedidoAfiliadoTikTok.groupBy({ by: ['estado'], where: { workspaceId }, _count: { _all: true } }),
    prisma.importacaoCreatorCenter.findFirst({ where: { workspaceId, concluida: true }, orderBy: { importadoEm: 'desc' }, select: { id: true, nomeArquivo: true, importadoEm: true, origem: true, formato: true, versaoDoParser: true, linhasTotal: true } }),
    prisma.pedidoAfiliadoTikTok.count({ where: { workspaceId, vinculoProduto: { not: 'VINCULADO_POR_ID_EXTERNO' } } }),
    // P2.25: valores pela fonte canônica (comissão espelhada + estado do pedido), a mesma de todas as telas.
    cadeiaFinanceira(workspaceId).then((c) => somarFinanceiro(c.elos.filter((e) => e.origem === 'CREATOR_CENTER').map((e) => ({ id: e.comissaoId, estado: e.estado, valor: e.valor })))),
  ])
  const de = (e: EstadoDaComissao) => porEstado.find((x) => x.estado === e)
  const arred = (n: number | null | undefined) => Math.round((n ?? 0) * 100) / 100
  return {
    estimada: { pedidos: de('ESTIMADA')?._count._all ?? 0, valor: canonico.estimada },
    naoLiquidada: { pedidos: de('NAO_LIQUIDADA')?._count._all ?? 0, valor: canonico.naoLiquidada },
    /** Liquidada inclui a que a titular já marcou como recebida (é a mesma comissão, contada uma vez). */
    liquidada: { pedidos: de('LIQUIDADA')?._count._all ?? 0, valor: arred(canonico.liquidada + canonico.recebida) },
    cancelada: { pedidos: de('CANCELADA')?._count._all ?? 0 },
    /** Era liquidada/recebida e foi cancelada/reembolsada: fora da receita, mostrada à parte. */
    revertida: { pedidos: canonico.quantidade.REVERTIDA, valor: canonico.revertida },
    /** Dinheiro na conta, marcado pela titular (a importação nunca marca). */
    recebida: { pedidos: canonico.quantidade.RECEBIDA, valor: canonico.recebida },
    /** Receita confirmada = só a liquidada. Estimada e não liquidada são previsão. */
    receitaConfirmada: canonico.confirmada,
    previsao: canonico.previsao,
    naoVinculados,
    ultimaImportacao: ultima,
  }
}

/**
 * P2.22 — COMMISSION_CONFIRMED só quando o pedido PASSA a LIQUIDADA (reimportar o mesmo arquivo não muda
 * estado → não emite); LIQUIDADA → CANCELADA (reembolso depois da liquidação) é COMMISSION_REVERSED. O estado
 * só avança (ORDEM_DO_ESTADO), então cada pedido confirma no máximo uma vez e reverte no máximo uma vez.
 * Grava na MESMA transação do pedido.
 */
async function eventoDaComissao(tx: Prisma.TransactionClient, workspaceId: string, pedidoId: string, estadoAnterior: string | null, l: { estado: string; pedidoId: string; comissaoLiquidada?: number | null; comissaoEstimada?: number | null; produtoIdExterno?: string | null; conteudoIdExterno?: string | null }, videoResultadoId: string | null, importacaoId: string) {
  const base = { pedido: l.pedidoId, produtoIdExterno: l.produtoIdExterno ?? null, postId: l.conteudoIdExterno ?? null, videoResultadoId, importacaoId }
  if (l.estado === 'LIQUIDADA' && estadoAnterior !== 'LIQUIDADA') {
    await registrarEvento({ workspaceId, tipo: 'COMMISSION_CONFIRMED', chaveIdempotencia: `comissao:${pedidoId}:confirmada`, entidadeTipo: 'PedidoAfiliadoTikTok', entidadeId: pedidoId, payload: { ...base, comissaoLiquidada: l.comissaoLiquidada ?? null, de: estadoAnterior } }, tx)
  } else if (estadoAnterior === 'LIQUIDADA' && l.estado === 'CANCELADA') {
    await registrarEvento({ workspaceId, tipo: 'COMMISSION_REVERSED', chaveIdempotencia: `comissao:${pedidoId}:revertida`, entidadeTipo: 'PedidoAfiliadoTikTok', entidadeId: pedidoId, payload: { ...base, de: estadoAnterior } }, tx)
  }
}
