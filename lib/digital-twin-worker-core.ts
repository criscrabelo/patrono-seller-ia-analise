/**
 * Núcleo do Patrono Generation Worker (Rodada 8, regra 10) — lógica de
 * processamento de UM job, separada do loop de polling (`worker/digital-
 * twin-worker.ts`) para ser testável sem precisar rodar um processo
 * contínuo. Roda fora do request HTTP (Vercel/servidor web não é lugar
 * adequado para workload longo de IA).
 *
 * Decide entre `DIGITAL_TWIN` (voz clonada + lip-sync) e o fallback real
 * `MOTION_GRAPHICS`/`PRODUCT_ONLY` (só FFmpeg, sem GPU) conforme o que
 * está de fato disponível — nunca finge sucesso na cadeia que falta.
 */

import { verificarDisponibilidadeChatterbox, ChatterboxVoiceCloneProvider } from './chatterbox-adapter'
import { verificarDisponibilidadeMuseTalk, MuseTalkLipSyncProvider } from './lipsync-provider'
import { detectarCapacidadesRuntime, classificarRuntime } from './digital-twin-runtime'
import { selecionarCreativePresenterMode, type CreativePresenterMode } from './creative-presenter-mode'
import { deveAbortarPorKillSwitch, type DigitalTwinJobType, type DigitalTwinJobState } from './digital-twin-job'
import { carregarContextoDigitalTwin, listarAssetsDigitalTwin, BUCKET_DIGITAL_TWIN_PRIVADO } from './digital-twin-store'
import { gerarPreviaDeVoz } from './digital-twin-voice-job'
import { gerarPreviaLipSync, gerarPreviaVozSomente } from './digital-twin-lipsync-job'
import { gerarPresetTikTokDigitalTwinV1 } from './digital-twin-tiktok-preset'
import { avaliarDigitalTwinQualityGate } from './digital-twin-quality-gate'
import { produtoPodeAparecerNoVideo } from './media-rights-produto'
import { avaliarPreco, dataDaVerificacaoDoPreco } from './preco-verificado'
import { fonteDaImagemDoProduto, fonteDoPatrono, registrarDerivacao } from './cadeia-de-direitos'
import { criarUrlAssinada, uploadBufferPrivado } from './supabase'
import { baixarComRetomada } from './digital-twin-model-cache'
import { calcularExpiracaoPreview } from './digital-twin-retention'
import { RendererFFmpeg } from './renderer-ffmpeg'
import type { RendererProvider } from './creative-factory'
import { prisma } from './prisma'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFile, unlink } from 'fs/promises'

/**
 * Texto do AI Content Disclosure aplicado na legenda. `decidirAIContentDisclosure()`
 * só diz SE é necessário e por quê — não traz um texto público pronto. Como o
 * gate exige `aiDisclosureAplicado`, o texto precisa existir de fato em algum
 * lugar que a proprietária vá publicar; é este.
 */
const AI_DISCLOSURE_TEXTO = 'Conteúdo com voz gerada por inteligência artificial.'

/** Terceiro kill switch (regra 34) — lido direto do banco a cada job, nunca cacheado. */
async function workerEstaPausado(profileId: string): Promise<boolean> {
  const profile = await prisma.digitalTwinProfile.findUnique({ where: { id: profileId }, select: { workerPaused: true } })
  return profile?.workerPaused ?? false
}

export interface JobDeProducao {
  id: string
  workspaceId: string
  profileId: string
  mediaAssetUrl: string
  overlayTexto: string
  legenda: string
  /**
   * Finalidade real do job (regra 31 da Retomada da Rodada 9) — antes,
   * `DIGITAL_TWIN`/`VOICE_ONLY` sempre caíam no mesmo placeholder "não
   * implementado", independente do que o job realmente pedia.
   * `VOICE_PREVIEW`/`AVATAR_PREVIEW` agora chamam de verdade os pipelines
   * já existentes (`gerarPreviaDeVoz`/`gerarPreviaLipSync`/
   * `gerarPreviaVozSomente`). `PRODUCT_PREVIEW`/`PUBLISH` continuam fora
   * do escopo desta retomada (prioridade explícita: voz e avatar primeiro).
   */
  jobType: DigitalTwinJobType
  /**
   * Conteúdo ligado ao job. É dele que saem o roteiro falado e o PRODUTO
   * real — sem isso, `PRODUCT_PREVIEW` não tem sobre o que falar.
   */
  contentId?: string | null
}

export interface ResultadoProcessamento {
  sucesso: boolean
  modo: CreativePresenterMode
  status: 'READY' | 'FAILED' | 'ABORTED_KILL_SWITCH'
  motivo: string
  contentUrl?: string
}

/**
 * Detecta o que está realmente disponível AGORA (nunca cacheado por muito
 * tempo — providers podem ficar disponíveis/indisponíveis entre execuções).
 */
export async function detectarCapacidadesDeGeracao() {
  const [chatterbox, musetalk, runtime] = await Promise.all([
    verificarDisponibilidadeChatterbox(),
    verificarDisponibilidadeMuseTalk(),
    detectarCapacidadesRuntime(),
  ])
  const classe = classificarRuntime(runtime)
  return {
    chatterboxDisponivel: chatterbox.available,
    musetalkDisponivel: musetalk.available,
    runtimeClasse: classe,
    digitalTwinDisponivel: chatterbox.available && musetalk.available && (classe === 'GPU_READY' || classe === 'GPU_LIMITED'),
    vozClonadaDisponivel: chatterbox.available,
  }
}

/**
 * Processa um job de verdade. Quando `DIGITAL_TWIN`/`VOICE_ONLY` não têm
 * provider disponível, cai para `MOTION_GRAPHICS` — que RODA de verdade
 * neste ambiente (FFmpeg, sem GPU) — em vez de falhar o job inteiro só
 * porque a parte mais avançada não está pronta.
 */
export async function processarJobDeVerdade(
  job: JobDeProducao,
  renderer: RendererProvider = new RendererFFmpeg()
): Promise<ResultadoProcessamento> {
  const contexto = await carregarContextoDigitalTwin(job.workspaceId)
  const workerPausado = await workerEstaPausado(job.profileId)
  const abortoKillSwitch = deveAbortarPorKillSwitch({
    proximaEtapa: 'GENERATING_VOICE',
    profile: contexto.profile,
    voiceProfile: contexto.voiceProfile,
    identityConsent: contexto.identityConsent,
    voiceConsent: contexto.voiceConsent,
    workerPaused: workerPausado,
  })

  const capacidades = await detectarCapacidadesDeGeracao()
  const modo = selecionarCreativePresenterMode({
    digitalTwinDisponivel: capacidades.digitalTwinDisponivel && !abortoKillSwitch.abortar,
    vozClonadaDisponivel: capacidades.vozClonadaDisponivel && !abortoKillSwitch.abortar,
    motionGraphicsDisponivel: true, // FFmpeg sempre disponível nesta stack
  })

  if ((modo === 'DIGITAL_TWIN' || modo === 'VOICE_ONLY') && abortoKillSwitch.abortar) {
    return { sucesso: false, modo, status: 'ABORTED_KILL_SWITCH', motivo: abortoKillSwitch.motivo ?? 'Kill switch ativo.' }
  }

  // P2.33.1 — narração de uma publicação assistida com a voz da titular (Chatterbox local). Nunca cai em
  // outro modo: sem voz disponível ou com kill switch, o job falha com o motivo (a versão original segue).
  if (job.jobType === 'NARRATION') {
    if (abortoKillSwitch.abortar) return { sucesso: false, modo: 'VOICE_ONLY', status: 'ABORTED_KILL_SWITCH', motivo: abortoKillSwitch.motivo ?? 'Kill switch ativo.' }
    if (!capacidades.vozClonadaDisponivel) return { sucesso: false, modo: 'VOICE_ONLY', status: 'FAILED', motivo: 'A voz local (Chatterbox) não está disponível nesta máquina.' }
    const { processarNarracaoComVozLocal } = await import('./narracao')
    const r = await processarNarracaoComVozLocal(job, {
      baixarReferencia: (caminho) => baixarAssetParaArquivoLocal(caminho, '.wav'),
      sintetizar: async (p) => (await new ChatterboxVoiceCloneProvider().sintetizar(p)).audioUrl,
    })
    return r.ok
      ? { sucesso: true, modo: 'VOICE_ONLY', status: 'READY', motivo: r.motivo, contentUrl: job.contentId ?? job.id }
      : { sucesso: false, modo: 'VOICE_ONLY', status: 'FAILED', motivo: r.motivo }
  }

  if (modo === 'DIGITAL_TWIN' || modo === 'VOICE_ONLY') {
    return processarEtapaDeVozOuAvatar(job, modo, contexto, capacidades)
  }

  // MOTION_GRAPHICS / PRODUCT_ONLY — roda de verdade, sem GPU.
  try {
    const resultado = await renderer.render({
      mediaAssetIds: [job.mediaAssetUrl],
      format: 'reel-simples',
      overlays: [
        { texto: job.overlayTexto, posicao: 'topo' },
        { texto: job.legenda, posicao: 'rodape' },
      ],
    })
    return { sucesso: true, modo, status: 'READY', motivo: `Gerado via ${modo} (fallback sem GPU).`, contentUrl: resultado.url }
  } catch (e) {
    return { sucesso: false, modo, status: 'FAILED', motivo: e instanceof Error ? e.message : 'Falha ao renderizar.' }
  }
}

/**
 * Baixa um asset do bucket PRIVADO (Supabase Storage) para um arquivo
 * local temporário. Necessário porque os providers reais (Chatterbox/
 * MuseTalk) rodam como subprocessos Python NESTA MESMA MÁQUINA (worker
 * local, regra do Rodada 8/9) e precisam de um caminho de arquivo — não
 * de uma URL remota.
 */
async function baixarAssetParaArquivoLocal(storagePath: string, sufixo: string): Promise<string> {
  const url = await criarUrlAssinada(BUCKET_DIGITAL_TWIN_PRIVADO, storagePath, 300)
  const destino = join(tmpdir(), `digital-twin-asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${sufixo}`)
  const resultado = await baixarComRetomada(url, destino)
  if (!resultado.concluido) throw new Error(`Falha ao baixar asset do storage privado: ${resultado.motivo}`)
  return destino
}

/**
 * Salva o resultado real de um job (voz/avatar) como um `DigitalTwinAsset`
 * de verdade (`GENERATED_PREVIEW`) no bucket privado — sem isso, a prévia
 * gerada nunca aparecia para a página "Configurações → Digital Twin"
 * consultar (ela busca assets por `type`/`purpose`, nunca por um caminho
 * de arquivo local do worker). Expira como qualquer outra prévia
 * (`calcularExpiracaoPreview`), igual ao upload manual em
 * `app/api/digital-twin/assets/route.ts`.
 */
async function salvarPreviaComoAssetPrivado(workspaceId: string, profileId: string, caminhoLocal: string, mimeType: string, purpose: string): Promise<string> {
  const buffer = await readFile(caminhoLocal)
  const storagePath = `previews/${profileId}/${purpose}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await uploadBufferPrivado(buffer, BUCKET_DIGITAL_TWIN_PRIVADO, storagePath, mimeType)
  const asset = await prisma.digitalTwinAsset.create({
    data: { workspaceId, profileId, type: 'GENERATED_PREVIEW', purpose, storagePath, mimeType, expiresAt: calcularExpiracaoPreview() },
  })
  return asset.id
}

/**
 * Chama de verdade os pipelines de voz/avatar já existentes
 * (`gerarPreviaDeVoz`/`gerarPreviaLipSync`/`gerarPreviaVozSomente`),
 * roteando pelo `jobType` (regra 31 da Retomada da Rodada 9) — antes,
 * QUALQUER job em modo `DIGITAL_TWIN`/`VOICE_ONLY` caía no mesmo
 * placeholder "não implementado". Nunca finge sucesso: quando o provider
 * real falha (ex.: Hugging Face bloqueado nesta sandbox), o motivo real do
 * provider é repassado como motivo de falha do job.
 */
export async function processarEtapaDeVozOuAvatar(
  job: JobDeProducao,
  modo: CreativePresenterMode,
  contexto: Awaited<ReturnType<typeof carregarContextoDigitalTwin>>,
  capacidades: Awaited<ReturnType<typeof detectarCapacidadesDeGeracao>>
): Promise<ResultadoProcessamento> {
  if (!contexto.voiceProfile) {
    return { sucesso: false, modo, status: 'FAILED', motivo: 'Nenhum VoiceProfile configurado para este workspace.' }
  }

  const assets = await listarAssetsDigitalTwin(job.workspaceId, job.profileId)

  if (job.jobType === 'VOICE_PREVIEW') {
    // Chatterbox é zero-shot (regra 10 da Continuação) — nunca inventa um
    // "voiceId" persistente; usa o áudio de referência JÁ autorizado
    // (VOICE_REFERENCE) diretamente como `audioPromptPath` a cada síntese.
    const voiceReference = assets.find((a) => a.type === 'VOICE_REFERENCE' && a.active)
    if (!voiceReference) {
      return { sucesso: false, modo, status: 'FAILED', motivo: 'Nenhum áudio de referência de voz (VOICE_REFERENCE) autorizado encontrado para este perfil.' }
    }
    let audioPromptPath: string
    try {
      audioPromptPath = await baixarAssetParaArquivoLocal(voiceReference.storagePath, '.wav')
    } catch (e) {
      return { sucesso: false, modo, status: 'FAILED', motivo: e instanceof Error ? e.message : 'Falha ao obter o áudio de referência de voz.' }
    }
    const resultado = await gerarPreviaDeVoz({
      provider: new ChatterboxVoiceCloneProvider(),
      audioPromptPath,
      idioma: contexto.voiceProfile.language ?? 'pt',
      texto: job.legenda || undefined,
      resolverParaCaminhoLocal: async (caminho) => caminho, // provider local (subprocesso na mesma máquina) já devolve caminho local
    })
    if (resultado.status !== 'READY' || !resultado.audioPath) {
      return { sucesso: false, modo, status: 'FAILED', motivo: resultado.motivo }
    }

    // Persiste a prévia como um DigitalTwinAsset real (GENERATED_PREVIEW) —
    // antes desta correção, nada convertia o áudio gerado num asset
    // consultável pela UI (statusAmigavelParaUsuaria()/página do Digital
    // Twin ficavam "órfãs" sem nenhum dado real para mostrar).
    let assetId: string
    try {
      assetId = await salvarPreviaComoAssetPrivado(job.workspaceId, job.profileId, resultado.audioPath, 'audio/wav', 'voice_preview')
    } catch (e) {
      return { sucesso: false, modo, status: 'FAILED', motivo: e instanceof Error ? e.message : 'Falha ao salvar a prévia de voz no storage privado.' }
    }
    return { sucesso: true, modo, status: 'READY', motivo: resultado.motivo, contentUrl: assetId }
  }

  if (job.jobType === 'AVATAR_PREVIEW') {
    if (!job.mediaAssetUrl) {
      return { sucesso: false, modo, status: 'FAILED', motivo: 'Áudio da voz ainda não foi gerado — gere e aprove a prévia de voz antes do avatar.' }
    }

    if (modo === 'DIGITAL_TWIN') {
      const referenceVideo = assets.find((a) => a.type === 'REFERENCE_VIDEO' && a.active)
      if (!referenceVideo) {
        return { sucesso: false, modo, status: 'FAILED', motivo: 'Nenhum vídeo de referência (REFERENCE_VIDEO) encontrado para este perfil.' }
      }
      let referenceVideoLocal: string
      try {
        referenceVideoLocal = await baixarAssetParaArquivoLocal(referenceVideo.storagePath, '.mp4')
      } catch (e) {
        return { sucesso: false, modo, status: 'FAILED', motivo: e instanceof Error ? e.message : 'Falha ao obter o vídeo de referência.' }
      }
      const resultado = await gerarPreviaLipSync({
        disponivel: capacidades.musetalkDisponivel,
        provider: new MuseTalkLipSyncProvider(),
        referenceVideoUrl: referenceVideoLocal,
        audioUrl: job.mediaAssetUrl,
        resolverParaCaminhoLocal: async (caminho) => caminho,
      })
      if (resultado.status !== 'READY_LIP_SYNC_PREVIEW') {
        return { sucesso: false, modo, status: 'FAILED', motivo: resultado.motivo }
      }
      return { sucesso: true, modo, status: 'READY', motivo: resultado.motivo, contentUrl: resultado.videoUrl ?? undefined }
    }

    // VOICE_ONLY — fallback real sem GPU (foto + voz clonada + motion graphics), nunca rotulado como lip-sync.
    const faceImage = assets.find((a) => a.type === 'FACE_IMAGE' && a.active)
    if (!faceImage) {
      return { sucesso: false, modo, status: 'FAILED', motivo: 'Nenhuma foto de rosto (FACE_IMAGE) encontrada para este perfil.' }
    }
    let faceImageUrl: string
    try {
      faceImageUrl = await criarUrlAssinada(BUCKET_DIGITAL_TWIN_PRIVADO, faceImage.storagePath, 300)
    } catch (e) {
      return { sucesso: false, modo, status: 'FAILED', motivo: e instanceof Error ? e.message : 'Falha ao gerar URL assinada da foto de rosto.' }
    }
    const resultado = await gerarPreviaVozSomente({ faceImageUrl, audioLocalPath: job.mediaAssetUrl, legenda: job.legenda })
    if (resultado.status !== 'READY_VOICE_ONLY_PREVIEW' || !resultado.caminhoLocal) {
      return { sucesso: false, modo, status: 'FAILED', motivo: resultado.motivo }
    }
    // P2.33.1: rosto + voz = dado biométrico → só no bucket PRIVADO, como prévia que expira (nunca URL pública).
    let assetId: string
    try {
      assetId = await salvarPreviaComoAssetPrivado(job.workspaceId, job.profileId, resultado.caminhoLocal, 'video/mp4', 'avatar_preview')
    } catch (e) {
      return { sucesso: false, modo, status: 'FAILED', motivo: e instanceof Error ? e.message : 'Falha ao salvar a prévia no storage privado.' }
    } finally {
      await unlink(resultado.caminhoLocal).catch(() => {})
    }
    return { sucesso: true, modo, status: 'READY', motivo: resultado.motivo, contentUrl: assetId }
  }

  if (job.jobType === 'PRODUCT_PREVIEW') {
    return processarProductPreview(job, modo, contexto, assets)
  }

  return {
    sucesso: false,
    modo,
    status: 'FAILED',
    motivo: `jobType "${job.jobType}" ainda não tem processamento real no worker (PUBLISH depende da aprovação do app TikTok).`,
  }
}

/**
 * PRODUCT_PREVIEW (Rodada 10) — conteúdo de afiliado completo, CPU_ONLY e
 * SEM avatar/lip-sync: voz aprovada narrando o roteiro do próprio job +
 * mídia do produto (quando autorizada) + hook/legenda/CTA do preset
 * determinístico TIKTOK_DIGITAL_TWIN_V1.
 *
 * Até esta rodada, este jobType caía no "fora do escopo" — mesmo com preset,
 * renderer e portões já existindo, nada os ligava a um produto real.
 *
 * Nenhuma chamada de IA paga: o roteiro falado vem de `Conteudo.narracao` e
 * hook/caption/CTA saem do preset, que é função pura sobre os dados do
 * produto. Custo R$ 0,00.
 */
async function processarProductPreview(
  job: JobDeProducao,
  modo: CreativePresenterMode,
  contexto: Awaited<ReturnType<typeof carregarContextoDigitalTwin>>,
  assets: Awaited<ReturnType<typeof listarAssetsDigitalTwin>>
): Promise<ResultadoProcessamento> {
  if (!job.contentId) {
    return { sucesso: false, modo, status: 'FAILED', motivo: 'Job sem conteúdo ligado (contentId) — o roteiro e o produto vêm dele.' }
  }

  const conteudo = await prisma.conteudo.findUnique({
    where: { id: job.contentId },
    include: { produto: true },
  })
  if (!conteudo) {
    return { sucesso: false, modo, status: 'FAILED', motivo: 'Conteúdo do job não encontrado.' }
  }
  // Isolamento por workspace — o mesmo cuidado de `lib/digital-twin-store.ts`.
  if (conteudo.workspaceId !== job.workspaceId) {
    return { sucesso: false, modo, status: 'FAILED', motivo: 'Conteúdo pertence a outro workspace.' }
  }

  const textoFalado = (job.legenda || conteudo.narracao || conteudo.roteiro || '').trim()
  if (!textoFalado) {
    return { sucesso: false, modo, status: 'FAILED', motivo: 'Conteúdo sem roteiro/narração — não há o que falar.' }
  }

  // --- Direitos de mídia ANTES de qualquer render (nunca depois) ----------
  const direitos = produtoPodeAparecerNoVideo({
    id: conteudo.produto.id,
    nome: conteudo.produto.nome,
    origemConteudo: conteudo.produto.origemConteudo,
    imagens: conteudo.produto.imagens,
  })

  // --- Preset determinístico: hook, caption, CTA, hashtags, disclosure ----
  const precoDaLegenda = avaliarPreco({
    preco: conteudo.produto.preco,
    verificadoEm: dataDaVerificacaoDoPreco(conteudo.produto),
    agora: new Date(),
  })
  const preset = gerarPresetTikTokDigitalTwinV1({
    produto: {
      nome: conteudo.produto.nome,
      categoria: conteudo.produto.categoria,
      // P1.9.1: `updatedAt` não é verificação de preço — qualquer edição do
      // cadastro o move. Só a verificação real vai para a legenda, e fora do
      // prazo o preço some em vez de aparecer com data velha.
      preco: precoDaLegenda.status === 'VERIFICADO' ? conteudo.produto.preco : null,
      precoConsultadoEm: precoDaLegenda.dataDaVerificacao,
      isAffiliate: true,
    },
    produtoVisivelNoAsset: direitos.visivel,
    // Sem avatar e sem lip-sync nesta rodada — declarado de verdade, porque
    // é disso que sai a AI disclosure.
    usaAvatarSintetico: false,
    usaVozClonada: true,
    usaLipSync: false,
  })
  if (!preset.aprovado || !preset.pacote) {
    return { sucesso: false, modo, status: 'FAILED', motivo: preset.motivo }
  }

  // --- Voz aprovada: sintetiza o roteiro com a referência já autorizada ---
  const voiceReference = assets.find((a) => a.type === 'VOICE_REFERENCE' && a.active)
  if (!voiceReference) {
    return { sucesso: false, modo, status: 'FAILED', motivo: 'Nenhum áudio de referência de voz (VOICE_REFERENCE) autorizado encontrado.' }
  }
  // `voiceApprovedAt` é campo do Prisma, não do tipo de domínio
  // `DigitalTwinProfile` — lido direto do banco, como o kill switch.
  const aprovacaoVoz = await prisma.digitalTwinProfile.findUnique({
    where: { id: job.profileId },
    select: { voiceApprovedAt: true },
  })
  if (!aprovacaoVoz?.voiceApprovedAt) {
    return { sucesso: false, modo, status: 'FAILED', motivo: 'Voz ainda não aprovada pela proprietária — aprove a prévia de voz antes de gerar conteúdo.' }
  }

  let audioPromptPath: string
  try {
    audioPromptPath = await baixarAssetParaArquivoLocal(voiceReference.storagePath, '.wav')
  } catch (e) {
    return { sucesso: false, modo, status: 'FAILED', motivo: e instanceof Error ? e.message : 'Falha ao obter o áudio de referência de voz.' }
  }

  const voz = await gerarPreviaDeVoz({
    provider: new ChatterboxVoiceCloneProvider(),
    audioPromptPath,
    idioma: contexto.voiceProfile?.language ?? 'pt',
    texto: textoFalado,
    resolverParaCaminhoLocal: async (caminho) => caminho,
  })
  if (voz.status !== 'READY' || !voz.audioPath) {
    return { sucesso: false, modo, status: 'FAILED', motivo: voz.motivo }
  }

  // --- Render: mídia do produto (ou fundo neutro) + narração + overlays ---
  let imagemUrl: string | null = null
  if (direitos.visivel) {
    imagemUrl = conteudo.produto.imagens[0]
  }

  let video: { caminhoLocal: string; durationSeconds: number; usouFundoNeutro: boolean }
  try {
    video = await new RendererFFmpeg().renderTikTokComNarracao({
      imagemUrl,
      audioLocalPath: voz.audioPath,
      hook: preset.pacote.hooks[0],
      legenda: preset.pacote.caption,
      cta: preset.pacote.cta,
    })
  } catch (e) {
    return { sucesso: false, modo, status: 'FAILED', motivo: e instanceof Error ? e.message : 'Falha ao renderizar o vídeo.' }
  }

  // --- Quality Gate final, antes de marcar READY -------------------------
  //
  // O preflight do TikTok não pode ser verificado aqui: depende de
  // `creator_info` de um canal conectado, e o app ainda não está aprovado.
  // O status real é `NOT_VERIFIED`. Para uma PRÉVIA PRIVADA, que por
  // definição nunca é publicada, isso é um aviso — não um motivo para
  // reprovar. Em vez de fingir `TECHNICALLY_VALID`, rodamos o gate duas
  // vezes e usamos o próprio gate para separar o que é bloqueio real do que
  // é pendência de publicação; nenhuma comparação de texto.
  const entradaGate = {
    identidadeOk: !!contexto.profile?.approvedAt,
    audioOk: voz.qualidade?.aprovado ?? false,
    lipSyncOk: null, // etapa não usada: esta rodada é sem avatar/lip-sync
    duracaoDentroDoLimite: video.durationSeconds >= 3 && video.durationSeconds <= 180,
    legendasPresentes: true, // hook, caption e CTA são queimados no vídeo
    produtoAutorizado: direitos.visivel || conteudo.produto.imagens.length === 0,
    aiDisclosureAplicado: true, // aplicado de verdade logo abaixo, na legenda
    commercialDisclosureAplicado: !!preset.pacote.disclosure,
  } as const

  const bloqueios = avaliarDigitalTwinQualityGate({ ...entradaGate, tiktokPreflightStatus: 'REQUIRES_USER_CONSENT' })
  if (!bloqueios.aprovado) {
    return { sucesso: false, modo, status: 'FAILED', motivo: `Quality Gate reprovou: ${bloqueios.problemas.join('; ')}` }
  }
  const comPreflight = avaliarDigitalTwinQualityGate({ ...entradaGate, tiktokPreflightStatus: 'NOT_VERIFIED' })
  const pendenciasParaPublicar = comPreflight.problemas

  // --- Persistência: vídeo no bucket PRIVADO, legenda no Conteudo --------
  let assetId: string
  try {
    assetId = await salvarPreviaComoAssetPrivado(job.workspaceId, job.profileId, video.caminhoLocal, 'video/mp4', 'product_preview')
  } catch (e) {
    return { sucesso: false, modo, status: 'FAILED', motivo: e instanceof Error ? e.message : 'Falha ao salvar o vídeo no storage privado.' }
  }

  // Legenda e hashtags ficam SEPARADAS do MP4, prontas para copiar na hora
  // de publicar à mão — nada é embutido no arquivo.
  //
  // Os dois disclosures entram no texto da legenda de verdade, e não como
  // um booleano otimista: o de IA (voz clonada) e o comercial (afiliado).
  // Um nunca substitui o outro.
  const legendaCompleta = [
    preset.pacote.caption,
    preset.pacote.disclosure,
    AI_DISCLOSURE_TEXTO,
    preset.pacote.hashtags.join(' '),
  ]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join('\n\n')

  // --- Cadeia de direitos do vídeo derivado (P1.9.2) ----------------------
  //
  // O MP4 não tem direito próprio: herda o das fontes, e só se TODAS
  // tiverem. A imagem do produto entra com o direito que o cadastro e a
  // custódia sustentam — "Gerado por IA" ou imagem de marketplace ficam
  // sem evidência, e o derivado inteiro fica bloqueado. O registro vai
  // gravado de qualquer jeito: é proveniência, e é o que explica depois
  // por que este vídeo não pode ir ao ar.
  const fontes = [
    imagemUrl
      ? fonteDaImagemDoProduto(conteudo.produto, imagemUrl, process.env)
      : fonteDoPatrono('FUNDO_NEUTRO', job.id, 'Fundo neutro composto pelo renderer local.'),
    fonteDoPatrono(
      'VOZ_SINTETIZADA',
      job.id,
      `Narração sintetizada localmente com a referência de voz aprovada pela dona em ${aprovacaoVoz.voiceApprovedAt.toISOString()}.`
    ),
    fonteDoPatrono('TEXTO_SOBREPOSTO', job.id, 'Hook, legenda e CTA do preset determinístico, queimados no vídeo.'),
  ]
  const derivacao = registrarDerivacao({
    // Prévia em bucket PRIVADO: identificador interno, não URL pública. O
    // registro guarda a cadeia; publicar exigiria outro arquivo, em custódia.
    assetUrl: `digital-twin-asset:${assetId}`,
    formato: 'VIDEO_9X16_FFMPEG_NARRADO',
    geracaoId: job.id,
    fontes,
    agora: new Date(),
    env: process.env,
  })
  const alertasAnteriores = Array.isArray(conteudo.alertasCompliance) ? conteudo.alertasCompliance : []

  await prisma.conteudo.update({
    where: { id: conteudo.id },
    data: {
      legendaTiktok: legendaCompleta,
      hashtags: preset.pacote.hashtags,
      chamadaAcao: preset.pacote.cta,
      textoTela: preset.pacote.hooks[0],
      duracao: Math.round(video.durationSeconds),
      alertasCompliance: [...alertasAnteriores, derivacao.evidencia] as object[],
    },
  })

  const observacaoMidia =
    (video.usouFundoNeutro ? ` ${direitos.motivo}` : '') +
    (derivacao.fontesAutorizadas ? '' : ` Cadeia de direitos: ${derivacao.motivo}`)
  const observacaoPublicacao = pendenciasParaPublicar.length
    ? ` Pendente para publicar: ${pendenciasParaPublicar.join('; ')}`
    : ''
  return {
    sucesso: true,
    modo,
    status: 'READY',
    motivo: `Conteúdo de afiliado gerado: ${video.durationSeconds.toFixed(1)}s, 9:16, voz aprovada.${observacaoMidia}${observacaoPublicacao}`,
    contentUrl: assetId,
  }
}
