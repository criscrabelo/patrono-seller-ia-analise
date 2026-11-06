import { NextRequest, NextResponse } from 'next/server'
import { STATUS_ATRASADA, MOTIVO_SEM_VIDEO, MOTIVO_SEM_CANAL } from '@/lib/publicacao-atrasada'
import { prisma } from '@/lib/prisma'
import { renovarTokenInstagram, inspecionarTokenMeta } from '@/lib/instagram'
import { precisaConferir, conferirERenovar } from '@/lib/instagram-renovacao'
import { autorizarPublicacaoReal } from '@/lib/porta-de-publicacao-real'
import { chaveDaTentativaPadrao } from '@/lib/link-de-publicacao'
import { iniciarTrabalhoLongo, buscarTrabalho, modoDeExecucao } from '@/lib/trabalho-longo'
import { executorDaPublicacao, chaveDaPublicacao } from '@/lib/trabalhos-longos/publicar-instagram'
import { chamadaDeOutroAgendador, RESPOSTA_DE_OUTRO_AGENDADOR } from '@/lib/agendador'
import { autorizacaoDeRotinaValida } from '@/lib/segredo-de-rotina'

// Endpoint chamado pelo agendador para publicar os conteúdos cuja data de
// agendamento já chegou.
// - Sem vídeo (ou sem Instagram conectado): fica "Publicação atrasada" com o motivo — NUNCA "publicado" (P2.15.4).
// - Com vídeo + Instagram conectado: registra o trabalho de publicação do
//   Reels. P2.2: quem fala com a Meta é o executor de trabalho longo — o
//   MESMO do "publicar agora", com a MESMA chave. Esta rota não espera o
//   Instagram processar: na Netlify isso estouraria o limite de 30 s.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Segurança: este endpoint não tem sessão de usuária (quem chama é o
  // agendador, não uma pessoa logada) — isso NÃO significa que pode
  // aceitar chamadas públicas sem autenticação própria. Exige sempre o
  // segredo, tanto faz se CRON_SECRET está configurado ou não: se não
  // estiver, a rota se recusa a rodar em vez de ficar aberta por padrão.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/publicar] CRON_SECRET não configurado — recusando executar.')
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const auth = req.headers.get('authorization')
  if (!autorizacaoDeRotinaValida(auth, secret)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  if (chamadaDeOutroAgendador(req.headers)) {
    return NextResponse.json(RESPOSTA_DE_OUTRO_AGENDADOR, { status: 409 })
  }

  const agora = new Date()

  // ── Tokens do Instagram: renovação na janela de 15 dias e reconferência diária dos sem prazo (P2.69) ──
  // Regras em lib/instagram-renovacao.ts: token sem prazo não é trocado; inválido vira "desconectado" (alerta);
  // Meta sem resposta não decide nada; validade só a informada pela Meta.
  const candidatos = await prisma.integracao.findMany({ where: { plataforma: 'instagram', status: 'conectado' } })
  let tokensRenovados = 0
  let tokensFalha = 0
  for (const integ of candidatos) {
    const i = { id: integ.id, accessToken: integ.accessToken, tokenExpiry: integ.tokenExpiry, extraData: (integ.extraData ?? null) as Record<string, unknown> | null }
    if (!precisaConferir(i, agora)) continue
    try {
      const r = await conferirERenovar(i, agora, {
        inspecionar: inspecionarTokenMeta,
        renovar: renovarTokenInstagram,
        atualizar: (id, dados) => prisma.integracao.update({ where: { id }, data: dados as never }),
      })
      if (r === 'RENOVADO') tokensRenovados++
      if (r === 'FALHOU') tokensFalha++
    } catch {
      tokensFalha++
    }
  }

  const devidos = await prisma.conteudo.findMany({
    where: { status: 'agendado', dataAgendamento: { lte: agora } },
  })

  // P2.15.4: sem vídeo ou sem canal o conteúdo NÃO saiu — fica "Publicação atrasada", nunca "publicado".
  let atrasados = 0
  // GATILHO A (P0.2 Bloco 4.1): a amostra de ML nasce quando um CANAL
  // confirma a distribuição — nunca quando o conteúdo é marcado como
  // publicado só dentro do app. Os dois caminhos internos abaixo (sem
  // vídeo, sem Instagram conectado) não produzem amostra; a captura mora
  // no executor, depois do mediaId.

  // P1.9.2: agendado que a porta não liberou. Continua `agendado`, intacto.
  let bloqueadosPelaPorta = 0
  const trabalhos: string[] = []

  for (const c of devidos) {
    // Sem vídeo: publicação apenas dentro do app.
    if (!c.videoUrl) {
      // Sem vídeo não há nada a distribuir: não saiu. Nenhuma amostra de ML nasce daqui.
      await prisma.conteudo.update({
        where: { id: c.id },
        data: { status: STATUS_ATRASADA, erroPublicacao: MOTIVO_SEM_VIDEO },
      })
      atrasados++
      continue
    }

    // Com vídeo: precisa do Instagram conectado para publicar o Reels.
    const integracao = await prisma.integracao.findUnique({
      where: { workspaceId_plataforma: { workspaceId: c.workspaceId, plataforma: 'instagram' } },
    })
    if (
      !integracao ||
      integracao.status !== 'conectado' ||
      !integracao.accessToken ||
      !integracao.accountId
    ) {
      // Sem canal conectado o conteúdo não circulou. Nenhuma amostra de ML nasce daqui.
      await prisma.conteudo.update({
        where: { id: c.id },
        data: { status: STATUS_ATRASADA, erroPublicacao: MOTIVO_SEM_CANAL },
      })
      atrasados++
      continue
    }

    // P1.9.2: A PORTA ÚNICA, a mesma da rota manual. Sem `executavelAgora`
    // o agendado não sai — e não é marcado publicado: ele não circulou. O
    // executor confere de novo antes de falar com a Meta.
    // P1.0 Etapa 2.c: a chave da tentativa deriva do agendamento, entao uma
    // reexecucao do cron reencontra a mesma Publicacao, o mesmo link — e,
    // agora, o mesmo trabalho.
    const chaveDaTentativa = chaveDaTentativaPadrao({
      contentId: c.id,
      canal: 'instagram',
      dataAgendamento: c.dataAgendamento,
    })
    const porta = await autorizarPublicacaoReal({
      workspaceId: c.workspaceId,
      contentId: c.id,
      canal: 'instagram',
      chaveDaTentativa,
      envio: { tipoMidia: 'video', destino: 'feed' },
      agora,
    })
    if (!porta.liberada) {
      bloqueadosPelaPorta++
      await prisma.conteudo.update({
        where: { id: c.id },
        data: { erroPublicacao: `Bloqueado pelo preflight (${porta.bloqueio}): ${porta.explicacao}` },
      })
      continue
    }

    // Mesmo trabalho que o "publicar agora" usaria para esta tentativa: o
    // que já saiu não sai de novo, o que está incerto não é repetido, e
    // falha recusada pela Meta é retomada na próxima execução.
    const r = await iniciarTrabalhoLongo({
      workspaceId: c.workspaceId,
      tipo: 'LONGO_PUBLICAR_INSTAGRAM',
      chave: chaveDaPublicacao({ chaveDaTentativa }),
      entityType: 'CONTEUDO',
      entityId: c.id,
      contexto: { pedido: { conteudoId: c.id, tipoMidia: 'video', destino: 'feed', chaveDaTentativa, origem: 'agendado' } },
      executor: executorDaPublicacao(),
      origem: req.nextUrl.origin,
      mensagemDeProcessando: 'Publicação agendada em andamento.',
      agora,
    })
    trabalhos.push(r.trabalhoId)
  }

  // Situação de cada trabalho ao fim desta execução. Em segundo plano, a
  // maioria ainda está PENDING/RUNNING: o resultado aparece na próxima.
  const contagem: Record<string, number> = {}
  let publicacoesSemRastreamento = 0
  for (const id of trabalhos) {
    const t = await buscarTrabalho(id)
    if (!t) continue
    contagem[t.estado] = (contagem[t.estado] ?? 0) + 1
    if (t.contexto?.rastreada === false) publicacoesSemRastreamento++
  }

  return NextResponse.json({
    ok: true,
    modo: modoDeExecucao(),
    atrasados,
    trabalhosDePublicacao: trabalhos.length,
    publicadosInstagram: contagem.SUCCEEDED ?? 0,
    emAndamento: (contagem.PENDING ?? 0) + (contagem.RUNNING ?? 0),
    falhas: contagem.FAILED_RETRYABLE ?? 0,
    aguardandoVerificacaoHumana: contagem.WAITING ?? 0,
    publicacoesSemRastreamento,
    bloqueadosPelaPorta,
    tokensRenovados,
    tokensFalha,
    executadoEm: agora.toISOString(),
  })
}
