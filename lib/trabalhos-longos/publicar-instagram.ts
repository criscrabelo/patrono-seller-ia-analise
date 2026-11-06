/**
 * P2.2 — Publicação no Instagram, em segundo plano. UM executor para o
 * "publicar agora" e para o agendado: as duas rotas só registram o pedido.
 *
 * ── A REGRA QUE IMPEDE A PUBLICAÇÃO DUPLICADA ───────────────────────────
 * O único passo que põe algo no ar é o `media_publish`. Por isso:
 *
 *   1. `fase: 'PUBLICANDO'` é gravada no banco ANTES do `media_publish`;
 *   2. o `mediaId` é gravado logo DEPOIS;
 *   3. qualquer execução que encontre (1) sem (2) NÃO chama a Meta de novo
 *      — é `incerto`, e só uma pessoa, olhando o perfil, decide;
 *   4. erro do `media_publish` só é tratado como "não saiu" quando a Meta
 *      respondeu 4xx com erro da Graph API (`metaRecusouComCerteza`).
 *      Rede, timeout e 5xx são `incerto`.
 *
 * Criar container e consultar status não põem nada no ar: repetir é seguro.
 *
 * ── A PORTA ÚNICA ───────────────────────────────────────────────────────
 * `autorizarPublicacaoReal` roda antes de criar o container E de novo
 * imediatamente antes do `media_publish`: a flag desligada no meio do
 * processamento da Meta impede a publicação.
 */
import { createHash } from 'node:crypto'
import { prisma } from '../prisma'
import { capturarSnapshotDePublicacao } from '../ml-captura-publicacao'
import {
  criarContainerReel,
  criarContainerStoryVideo,
  criarContainerImagemFeed,
  criarContainerStoryImagem,
  criarContainerCarrossel,
  statusContainer,
  publicarContainer,
  montarLegenda,
  metaRecusouComCerteza,
} from '../instagram'
import {
  prepararTentativaDePublicacao,
  confirmarDistribuicao,
  registrarFalhaDaTentativa,
  respostaDeRastreamento,
} from '../publicacao-fluxo'
import { autorizarPublicacaoReal } from '../porta-de-publicacao-real'
import { vinculoDoArquivoAprovado, urlConferidaDoArquivoAprovado, hashDoTexto } from '../arquivo-aprovado-vinculo'
import { assetNoCaminhoImutavel } from '../arquivo-aprovado'
import { urlVaiNaLegenda } from '../capacidade-real-do-adapter'
import type { Desfecho, Execucao, ExecutorDeTrabalho, RespostaDoTrabalho } from '../trabalho-longo'

// Prefixo usado para guardar o ID do container do Instagram em videoRequestId.
const PREFIXO_CONTAINER = 'ig:'
const INTERVALO_DE_CONSULTA_MS = 5_000
/** Margem para publicar e registrar depois do FINISHED. */
const MARGEM_PARA_PUBLICAR_MS = 15_000

export interface PedidoDePublicacao {
  conteudoId: string
  tipoMidia: 'video' | 'imagens'
  destino: 'feed' | 'stories'
  chaveDaTentativa: string
  origem: 'manual' | 'agendado'
}

/** A chave do trabalho é a da TENTATIVA: retry reencontra, republicação é outra. */
export function chaveDaPublicacao(p: Pick<PedidoDePublicacao, 'chaveDaTentativa'>): string {
  return `publicar-instagram:${createHash('sha256').update(p.chaveDaTentativa).digest('hex').slice(0, 32)}`
}

/** Portas externas — trocadas por dublês nos testes. Nenhum teste fala com a Meta. */
export interface DependenciasDaPublicacao {
  autorizar: typeof autorizarPublicacaoReal
  criarContainerReel: typeof criarContainerReel
  criarContainerStoryVideo: typeof criarContainerStoryVideo
  criarContainerImagemFeed: typeof criarContainerImagemFeed
  criarContainerStoryImagem: typeof criarContainerStoryImagem
  criarContainerCarrossel: typeof criarContainerCarrossel
  statusContainer: typeof statusContainer
  publicarContainer: typeof publicarContainer
  /** P2.69+: vínculo com o arquivo aprovado (padrão: banco + storage real) */
  vinculoDoArquivo?: typeof vinculoDoArquivoAprovado
  urlDoArquivoAprovado?: (v: { sha256: string; caminho: string }) => Promise<string>
}

const DEPENDENCIAS_REAIS: DependenciasDaPublicacao = {
  autorizar: autorizarPublicacaoReal,
  criarContainerReel,
  criarContainerStoryVideo,
  criarContainerImagemFeed,
  criarContainerStoryImagem,
  criarContainerCarrossel,
  statusContainer,
  publicarContainer,
}

function classificarErroDaMeta(raw: string) {
  const lower = raw.toLowerCase()
  const isOAuthError =
    lower.includes('oauth') ||
    lower.includes('access token') ||
    lower.includes('invalid token') ||
    lower.includes('token expired')
  // "API access blocked" = app Meta sem permissão instagram_content_publish
  // ou conta não é Business/Creator
  const isPermissaoError =
    lower.includes('api access blocked') ||
    lower.includes('access blocked') ||
    lower.includes('(#200)') ||
    lower.includes('permissions error') ||
    lower.includes("the user hasn") ||
    lower.includes('application to perform this action')
  const msg = isPermissaoError
    ? 'API access blocked — seu app Meta não tem a permissão "instagram_content_publish" aprovada. ' +
      'Verifique: (1) sua conta Instagram é Business ou Creator (não pessoal); ' +
      '(2) o app no Meta for Developers tem a permissão instagram_content_publish; ' +
      '(3) se o app está em modo desenvolvimento, adicione seu usuário como Tester em Meta → App Roles → Roles.'
    : raw
  return { msg, isOAuthError, isPermissaoError }
}

export function executorDaPublicacao(dep: DependenciasDaPublicacao = DEPENDENCIAS_REAIS): ExecutorDeTrabalho {
  return async (e: Execucao): Promise<Desfecho> => {
    const ctx = e.trabalho.contexto
    const pedido = ctx.pedido as PedidoDePublicacao
    const workspaceId = e.trabalho.workspaceId
    const agendado = pedido.origem === 'agendado'

    // Já saiu: devolve o mesmo resultado, sem tocar na Meta.
    if (typeof ctx.mediaId === 'string') {
      return { fim: 'concluido', resposta: (ctx.respostaDeSucesso as RespostaDoTrabalho) ?? { status: 200, corpo: { ok: true, mediaId: ctx.mediaId } } }
    }

    // A execução anterior chegou ao `media_publish` e não voltou.
    if (ctx.fase === 'PUBLICANDO') {
      const msg =
        'Não foi possível confirmar se o Instagram publicou. Confira o perfil antes de tentar de novo — ' +
        'o Patrono não repete esta publicação sozinho para não duplicar o post.'
      await prisma.conteudo.update({ where: { id: pedido.conteudoId }, data: { erroPublicacao: msg } })
      return { fim: 'incerto', erro: 'media_publish sem confirmação', resposta: { status: 409, corpo: { error: msg, incerto: true } } }
    }

    const conteudo = await prisma.conteudo.findFirst({
      where: { id: pedido.conteudoId, workspaceId },
      include: { produto: { select: { linkProduto: true, imagens: true } } },
    })
    if (!conteudo) {
      return { fim: 'falhou', erro: 'Conteúdo não encontrado', resposta: { status: 404, corpo: { error: 'Conteúdo não encontrado' } } }
    }

    const { tipoMidia, destino } = pedido
    const ehVideo = tipoMidia === 'video'
    // P2.69+: peça de publicação assistida só sai como o VÍDEO aprovado, do caminho imutável do sha256 (decidido pelo
    // banco, não por quem pediu). Imagens do produto ou outro arquivo contornariam a barreira profissional.
    const vinculo = await (dep.vinculoDoArquivo ?? vinculoDoArquivoAprovado)(workspaceId, conteudo.id)
    // a peça (legenda + vídeo) tem de ser a do arquivo aprovado atual: Conteudo de uma versão anterior é recusado
    const pecaDoAprovado = !vinculo.aplica || vinculo.erro !== undefined || assetNoCaminhoImutavel(conteudo.videoUrl, workspaceId, vinculo.sha256)
    if (vinculo.aplica && (vinculo.erro !== undefined || !ehVideo || !pecaDoAprovado)) {
      const msg = vinculo.erro ?? (!ehVideo ? 'Peça de publicação assistida: só o vídeo aprovado pode ser publicado.' : 'A peça não é a do arquivo aprovado atual (sha256): nada foi enviado.')
      return { fim: 'falhou', erro: msg, resposta: { status: 409, corpo: { error: msg } } }
    }
    // revisão P2.72 (MÉDIA 2): a legenda que vai ao Instagram tem de ser o texto aprovado (com #publi e aviso de IA)
    if (vinculo.aplica && vinculo.erro === undefined && hashDoTexto(conteudo.legendaInstagram) !== vinculo.textoSha256) {
      const msg = 'A legenda do Instagram não é o texto aprovado: nada foi enviado.'
      return { fim: 'falhou', erro: msg, resposta: { status: 409, corpo: { error: msg } } }
    }
    // sha do arquivo aprovado ao qual um container reaproveitado tem de pertencer (null = peça comum)
    const shaDoVinculo = vinculo.aplica && vinculo.erro === undefined ? vinculo.sha256 : null
    const imagens = conteudo.produto?.imagens ?? []

    const integracao = await prisma.integracao.findUnique({
      where: { workspaceId_plataforma: { workspaceId, plataforma: 'instagram' } },
    })
    if (!integracao || integracao.status !== 'conectado' || !integracao.accessToken || !integracao.accountId) {
      return {
        fim: 'falhou',
        erro: 'Instagram não conectado',
        resposta: { status: 400, corpo: { error: 'Conecte o Instagram em Integrações antes de publicar.' } },
      }
    }
    const accessToken = integracao.accessToken
    const igUserId = integracao.accountId

    // P1.9.2: A PORTA ÚNICA. Nenhuma conexão com a Meta abre sem `executavelAgora`.
    const conferirPorta = async () =>
      dep.autorizar({
        workspaceId,
        contentId: conteudo.id,
        canal: 'instagram',
        chaveDaTentativa: pedido.chaveDaTentativa,
        envio: { tipoMidia, destino },
      })
    const porta = await conferirPorta()
    if (!porta.liberada) {
      if (agendado) {
        await prisma.conteudo.update({
          where: { id: conteudo.id },
          data: { erroPublicacao: `Bloqueado pelo preflight (${porta.bloqueio}): ${porta.explicacao}` },
        })
      }
      return {
        fim: 'falhou',
        erro: `porta: ${porta.bloqueio}`,
        resposta: { status: 409, corpo: { error: porta.explicacao, bloqueio: porta.bloqueio } },
      }
    }

    // P1.0 Etapa 2.c: a tentativa passa pela AUTORIDADE CENTRAL. Ela cria ou
    // reusa a Publicacao, obtem o link rastreado, valida o vinculo pelo guard
    // e move o estado para DISTRIBUINDO — tudo antes de falar com a Meta.
    const tentativa = await prepararTentativaDePublicacao({
      workspaceId,
      contentId: conteudo.id,
      canal: 'instagram',
      chaveDaTentativa: pedido.chaveDaTentativa,
      urlDiretaDoProduto: conteudo.produto?.linkProduto ?? null,
      dataAgendamento: conteudo.dataAgendamento,
      // Este trabalho tem trava própria por fase (container persistido; fase PUBLICANDO = incerto).
      permitirReentrada: true,
    })
    await e.salvar({ rastreada: tentativa.rastreada })

    // P1.9.2: a legenda é a que o preflight aprovou — com CTA e hashtags já
    // dentro. URL só onde ela é clicável (no Instagram, o link vai na bio).
    const legenda = urlVaiNaLegenda('instagram')
      ? montarLegenda(conteudo.legendaInstagram, [], null, tentativa.urlParaDivulgar)
      : (conteudo.legendaInstagram ?? '').trim()

    const falhaDoProvider = async (raw: string): Promise<Desfecho> => {
      // Falha REAL do provider, ANTES do media_publish: nada foi ao ar.
      const { msg, isOAuthError, isPermissaoError } = classificarErroDaMeta(raw)
      if (tentativa.publicacao) {
        await registrarFalhaDaTentativa({ workspaceId, publicacaoId: tentativa.publicacao.id })
      }
      await Promise.all([
        prisma.conteudo.update({ where: { id: conteudo.id }, data: { erroPublicacao: msg } }),
        // Só o clique humano desconecta: o agendado nunca desligava a integração.
        isOAuthError && !agendado
          ? prisma.integracao.updateMany({
              where: { workspaceId, plataforma: 'instagram' },
              data: { status: 'desconectado', accessToken: null },
            })
          : Promise.resolve(),
      ])
      return {
        fim: 'falhou',
        erro: msg,
        resposta: { status: 502, corpo: { error: msg, oauthError: isOAuthError, permissaoError: isPermissaoError } },
      }
    }

    // ── Container: reaproveita o que já existe ────────────────────────
    // revisão P2.72 (MÉDIA 1): na peça assistida o container só é reaproveitado se foi criado com ESTE arquivo aprovado
    // (o sha vai junto: `ig:<container>@<sha256>`); de outra versão, cria um novo
    let containerId = typeof ctx.containerId === 'string' && (shaDoVinculo === null || ctx.containerSha === shaDoVinculo) ? ctx.containerId : null
    const vri = conteudo.videoRequestId
    if (!containerId && ehVideo && vri && vri.startsWith(PREFIXO_CONTAINER)) {
      const [id, sha] = vri.slice(PREFIXO_CONTAINER.length).split('@')
      if (shaDoVinculo === null || sha === shaDoVinculo) containerId = id
    }
    if (!containerId) {
      if (ehVideo && !conteudo.videoUrl) {
        return {
          fim: 'falhou',
          erro: 'sem vídeo',
          resposta: { status: 400, corpo: { error: 'Este conteúdo não tem vídeo. Gere o vídeo ou escolha publicar as imagens.' } },
        }
      }
      // URL assinada AGORA a partir do caminho imutável, depois de reconferir o sha256 (a gravada pode ter vencido)
      let videoUrl = conteudo.videoUrl
      if (vinculo.aplica && vinculo.erro === undefined) {
        try {
          videoUrl = await (dep.urlDoArquivoAprovado ?? (async (v) => urlConferidaDoArquivoAprovado(v, (await import('../arquivo-aprovado-real')).PORTAS_REAIS_DO_ARQUIVO_APROVADO)))(vinculo)
        } catch (err) {
          const msg = `Arquivo aprovado não conferido: ${err instanceof Error ? err.message : String(err)}. Nada foi enviado.`
          return { fim: 'falhou', erro: msg, resposta: { status: 409, corpo: { error: msg } } }
        }
      }
      try {
        if (tipoMidia === 'video' && destino === 'feed') {
          containerId = await dep.criarContainerReel({ accessToken, igUserId, videoUrl: videoUrl!, legenda })
        } else if (tipoMidia === 'video' && destino === 'stories') {
          containerId = await dep.criarContainerStoryVideo({ accessToken, igUserId, videoUrl: videoUrl! })
        } else if (tipoMidia === 'imagens' && destino === 'feed') {
          containerId = imagens.length > 1
            ? await dep.criarContainerCarrossel({ accessToken, igUserId, imageUrls: imagens, legenda })
            : await dep.criarContainerImagemFeed({ accessToken, igUserId, imageUrl: imagens[0], legenda })
        } else {
          // imagens + stories — publica a imagem de capa (primeira)
          containerId = await dep.criarContainerStoryImagem({ accessToken, igUserId, imageUrl: imagens[0] })
        }
      } catch (err) {
        // Container não publicado não vai ao ar: no pior caso, expira sozinho.
        return falhaDoProvider(err instanceof Error ? err.message : 'Falha ao criar a mídia no Instagram')
      }
      await e.salvar({ containerId, containerSha: shaDoVinculo, fase: 'AGUARDANDO_META' })
      if (ehVideo) {
        await prisma.conteudo.update({ where: { id: conteudo.id }, data: { videoRequestId: PREFIXO_CONTAINER + containerId + (shaDoVinculo ? `@${shaDoVinculo}` : '') } })
      }
    }

    // ── Processamento na Meta: só leitura ─────────────────────────────
    let status = 'IN_PROGRESS'
    while (e.restanteMs() > MARGEM_PARA_PUBLICAR_MS + INTERVALO_DE_CONSULTA_MS) {
      await e.dormir(INTERVALO_DE_CONSULTA_MS)
      try {
        status = await dep.statusContainer({ accessToken, containerId })
      } catch (err) {
        if (metaRecusouComCerteza(err)) return falhaDoProvider(err instanceof Error ? err.message : 'Falha no Instagram')
        console.warn('[publicar] consulta de status falhou; tenta de novo:', err instanceof Error ? err.message : err)
        continue
      }
      if (status === 'FINISHED' || status === 'ERROR' || status === 'EXPIRED') break
    }

    if (status === 'ERROR' || status === 'EXPIRED') {
      // Falha REAL do provider — a midia nao vai ao ar. O próximo pedido cria
      // container novo.
      await e.salvar({ containerId: null, fase: null })
      await prisma.conteudo.update({ where: { id: conteudo.id }, data: { videoRequestId: null } })
      const r = await falhaDoProvider(`O Instagram não conseguiu processar a mídia (${status}).`)
      return r
    }

    if (status !== 'FINISHED') {
      const msg = 'A mídia ainda está sendo processada pelo Instagram. O Patrono continua acompanhando.'
      if (!agendado) await prisma.conteudo.update({ where: { id: conteudo.id }, data: { erroPublicacao: msg } })
      return { fim: 'continuar', resposta: { status: 202, corpo: { ok: false, processando: true, mensagem: msg } } }
    }

    // ── O único passo que põe algo no ar ──────────────────────────────
    const portaFinal = await conferirPorta()
    if (!portaFinal.liberada) {
      return {
        fim: 'falhou',
        erro: `porta: ${portaFinal.bloqueio}`,
        resposta: { status: 409, corpo: { error: portaFinal.explicacao, bloqueio: portaFinal.bloqueio } },
      }
    }

    await e.salvar({ fase: 'PUBLICANDO' })
    let mediaId: string
    try {
      mediaId = await dep.publicarContainer({ accessToken, igUserId, containerId })
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Falha ao publicar no Instagram'
      if (metaRecusouComCerteza(err)) {
        // A Meta respondeu e recusou: não saiu. Volta para antes do publish.
        await e.salvar({ fase: 'AGUARDANDO_META' })
        return falhaDoProvider(raw)
      }
      const msg =
        `Sem confirmação do Instagram (${raw}). A publicação pode ter saído: confira o perfil antes de tentar de novo — ` +
        'o Patrono não repete sozinho para não duplicar o post.'
      await prisma.conteudo.update({ where: { id: conteudo.id }, data: { erroPublicacao: msg } })
      return { fim: 'incerto', erro: raw, resposta: { status: 502, corpo: { error: msg, incerto: true } } }
    }
    await e.salvar({ mediaId, fase: 'PUBLICADO' })

    // FINISHED → publicado. Daqui para baixo é só registro.
    const agora = new Date()
    await prisma.conteudo.update({
      where: { id: conteudo.id },
      data: {
        status: 'publicado',
        dataPublicacao: agora,
        publicacaoExternaId: mediaId,
        erroPublicacao: null,
        videoRequestId: null,
      },
    })
    // A distribuicao esta CONFIRMADA pelo canal: id externo e instante reais.
    if (tentativa.publicacao) {
      await confirmarDistribuicao({
        workspaceId,
        publicacaoId: tentativa.publicacao.id,
        publicacaoExternaId: mediaId,
        distribuidaEm: agora,
      })
    }
    // GATILHO A (P0.2 Bloco 4.1): DISTRIBUIÇÃO REAL — o canal devolveu
    // `mediaId`. É aqui, e só aqui, que a amostra de produção nasce. Nunca
    // lança; publicar não pode falhar por causa do ML.
    const captura = await capturarSnapshotDePublicacao({ workspaceId, contentId: conteudo.id, agora })

    const resposta: RespostaDoTrabalho = {
      status: 200,
      corpo: {
        ok: true,
        mediaId,
        // A lacuna viaja na resposta com FRASE PRONTA. A `explicacao` interna
        // fica de fora: ela cita o valor de PUBLIC_BASE_URL e o caminho que
        // falhou — diagnostico de servidor, nao texto de tela.
        rastreamento: respostaDeRastreamento(tentativa),
        amostraCapturada: captura.capturado,
      },
    }
    await e.salvar({ respostaDeSucesso: resposta })
    return { fim: 'concluido', resposta }
  }
}
