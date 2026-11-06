import { NextRequest, NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { prisma } from '@/lib/prisma'
import { gerarConteudo, BloqueadoPorPoliticaDeCusto } from '@/lib/claude'
import { gerarConteudoGratuito } from '@/lib/conteudo-gratuito'
import { dataDaVerificacaoDoPreco } from '@/lib/preco-verificado'
import { z } from 'zod'

const gerarSchema = z.object({
  produtoId: z.string().min(1),
  redeSocial: z.string().min(1),
  duracao: z.number().positive(),
  estilo: z.string().min(1),
  objetivo: z.string().min(1),
})

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const body = await req.json().catch(() => ({}))
  const parsed = gerarSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const { produtoId, redeSocial, duracao, estilo, objetivo } = parsed.data

  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, workspaceId: session.user.workspaceId },
  })

  if (!produto) {
    return NextResponse.json({ error: 'Produto não encontrado' }, { status: 404 })
  }

  const produtoData = {
    nome: produto.nome,
    preco: produto.preco,
    categoria: produto.categoria,
    publicoAlvo: produto.publicoAlvo,
    tipoVenda: produto.tipoVenda,
    origemConteudo: produto.origemConteudo,
    descricao: produto.descricao ?? undefined,
    observacoes: produto.observacoes ?? undefined,
    beneficios: produto.beneficios,
    pontosNegativos: produto.pontosNegativos,
  }
  const configGeracao = { redeSocial, duracao, estilo, objetivo }

  try {
    // FALLBACK GRATUITO EXECUTADO DE VERDADE (revisão do P0.1).
    //
    // Antes, o gate apenas devolvia o NOME da alternativa e a rota quebrava —
    // o que empurraria a proprietária a escrever conteúdo à mão, exatamente a
    // rotina manual que a regra proíbe. Agora, bloqueio de custo cai no
    // preset determinístico e a geração continua funcionando por R$ 0,00.
    let gerado
    let geradoSemIaPaga = false
    let limitacoesDoGratuito: string[] = []
    try {
      gerado = await gerarConteudo(produtoData, configGeracao, session.user.workspaceId)
    } catch (e) {
      if (!(e instanceof BloqueadoPorPoliticaDeCusto)) throw e
      const gratuito = gerarConteudoGratuito({
        nome: produto.nome,
        categoria: produto.categoria,
        preco: produto.preco,
        beneficios: produto.beneficios,
        pontosNegativos: produto.pontosNegativos,
        // P1.9.1: data da verificação real do preço, nunca `updatedAt`.
        precoVerificadoEm: dataDaVerificacaoDoPreco(produto),
      })
      gerado = gratuito.conteudo
      limitacoesDoGratuito = gratuito.limitacoes
      geradoSemIaPaga = true
      console.warn(`[conteudos/gerar] IA paga bloqueada por política de custo — usando preset determinístico gratuito.`)
    }

    const dadosBase = {
      userId: session.user.id,
      workspaceId: session.user.workspaceId,
      produtoId,
      redeSocial,
      duracao,
      estilo,
      objetivo,
      roteiro: gerado.roteiro,
      legendaTiktok: gerado.legendaTiktok,
      legendaInstagram: gerado.legendaInstagram,
      legendaYoutube: gerado.legendaYoutube,
      legendaWhatsapp: gerado.legendaWhatsapp,
      legendaMarketplace: gerado.legendaMarketplace,
      hashtags: gerado.hashtags ?? [],
      textoTela: gerado.textoTela,
      narracao: gerado.narracao,
      trilhaSugerida: gerado.trilhaSugerida,
      promptVideoIA: gerado.promptVideoIA,
      promptCurto: gerado.promptCurto,
      chamadaAcao: gerado.chamadaAcao,
      notaProduto: gerado.notaProduto,
      pontosPositivos: gerado.pontosPositivos ?? [],
      pontosNegativos: gerado.pontosNegativos ?? [],
      veredito: gerado.veredito,
      alertasCompliance: (gerado.alertasCompliance ?? []) as object[],
      status: 'roteiro_gerado',
    }

    let conteudo
    try {
      conteudo = await prisma.conteudo.create({
        data: { ...dadosBase, legendaFacebook: gerado.legendaFacebook },
      })
    } catch (errFacebook) {
      // Fallback: salva sem legendaFacebook caso a coluna ainda não exista no banco
      console.error('[gerar] create com legendaFacebook falhou, tentando sem:', errFacebook)
      conteudo = await prisma.conteudo.create({ data: dadosBase })
    }

    return NextResponse.json(
      {
        ...conteudo,
        legendaFacebook: gerado.legendaFacebook,
        tentativasCompliance: 1,
        // A tela precisa saber que este conteúdo veio do caminho gratuito —
        // as limitações são reais e escondê-las seria enganoso.
        geradoSemIaPaga,
        limitacoesDoGratuito,
      },
      { status: 201 }
    )
  } catch (e) {
    // Captura TUDO (Claude, Prisma, validação) e devolve a mensagem real.
    const msg = e instanceof Error ? e.message : 'Erro desconhecido ao gerar conteúdo'
    console.error('[gerar] erro:', e)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
