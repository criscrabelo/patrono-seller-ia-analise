/**
 * P2.11 — Orquestração dos passos ① e ③ do upload direto (ver
 * lib/digital-twin-upload-direto.ts). Separada das rotas para ser testada
 * contra o banco e o storage de TESTE sem simular a sessão do NextAuth: as
 * rotas resolvem cabeçalho e sessão; daqui para baixo, só o workspace da
 * sessão entra.
 */
import { randomBytes } from 'node:crypto'
import { prisma } from './prisma'
import { registrarAuditoria } from './audit-log'
import { criarUrlDeEnvioPrivado, deleteFilePrivado, infoDoObjetoPrivado } from './supabase'
import { BUCKET_DIGITAL_TWIN_PRIVADO } from './digital-twin-store'
import { consentimentosDoPerfil, podeUsarMaterial } from './digital-twin-consentimento'
import {
  CODIGO_UPLOAD_DIRETO_INDISPONIVEL,
  VALIDADE_DA_INTENCAO_MS,
  assinarIntencao,
  montarCaminhoDoAsset,
  uploadDiretoConfigurado,
  validarObjetoEnviado,
  validarPedidoDeEnvio,
  verificarIntencao,
} from './digital-twin-upload-direto'

type Env = Record<string, string | undefined>

export interface Sessao {
  workspaceId: string
  userId: string
}

export interface Resposta {
  status: number
  corpo: Record<string, unknown>
}

const INDISPONIVEL: Resposta = {
  status: 503,
  corpo: { error: 'Envio de arquivos indisponível no momento.', codigo: CODIGO_UPLOAD_DIRETO_INDISPONIVEL },
}

/** Passo ① — autoriza UM envio direto ao bucket privado. */
export async function autorizarEnvioDireto(
  sessao: Sessao,
  corpo: { type?: unknown; mimeType?: unknown; size?: unknown; purpose?: unknown } | null,
  env: Env = process.env,
  agora: Date = new Date()
): Promise<Resposta> {
  // Fail-closed: sem upload direto configurado, não há upload — nunca pela função.
  const config = uploadDiretoConfigurado(env)
  if (!config.ok) {
    console.error(`[digital-twin] upload direto indisponível: ${config.motivo}`)
    return INDISPONIVEL
  }

  const profile = await prisma.digitalTwinProfile.findUnique({ where: { workspaceId: sessao.workspaceId } })
  if (!profile) return { status: 400, corpo: { error: 'Crie o perfil do Digital Twin antes de enviar referências.' } }

  if (!corpo) return { status: 400, corpo: { error: 'JSON inválido.' } }
  const pedido = validarPedidoDeEnvio(corpo)
  if (!pedido.ok) return { status: 400, corpo: { error: pedido.motivo } }

  // P2.33.1: material biométrico só da PRÓPRIA titular do perfil e só com o consentimento vigente do tipo.
  const barreira = await barreiraDeConsentimento(sessao, pedido.tipo, typeof corpo.purpose === 'string' ? corpo.purpose : null, agora)
  if (barreira) return barreira

  const caminho = montarCaminhoDoAsset(sessao.workspaceId, profile.id, pedido.tipo, agora, randomBytes(6).toString('hex'))
  const { signedUrl } = await criarUrlDeEnvioPrivado(BUCKET_DIGITAL_TWIN_PRIVADO, caminho)

  const expiraEm = agora.getTime() + VALIDADE_DA_INTENCAO_MS
  const intencao = assinarIntencao(
    {
      workspaceId: sessao.workspaceId,
      profileId: profile.id,
      tipo: pedido.tipo,
      mime: pedido.mime,
      tamanho: pedido.tamanho,
      caminho,
      purpose: typeof corpo.purpose === 'string' ? corpo.purpose.slice(0, 200) : null,
      expiraEm,
    },
    env.NEXTAUTH_SECRET as string
  )

  await registrarAuditoria({
    workspaceId: sessao.workspaceId,
    userId: sessao.userId,
    action: 'digital_twin.asset_upload_autorizado',
    entityType: 'DigitalTwinProfile',
    entityId: profile.id,
    metadata: { type: pedido.tipo }, // nunca o caminho, nunca o conteúdo
  })

  return {
    status: 200,
    corpo: { uploadUrl: signedUrl, contentType: pedido.mime, intencao, expiraEm: new Date(expiraEm).toISOString() },
  }
}

/**
 * Passo ③ — confere, pelo storage, o que foi gravado (tamanho e formato,
 * nunca o conteúdo) contra a intenção assinada, e só então registra o
 * asset. Arquivo divergente ou intenção vencida: o objeto é apagado.
 */
export async function confirmarEnvioDireto(
  sessao: Sessao,
  corpo: { intencao?: unknown } | null,
  env: Env = process.env,
  agora: number = Date.now()
): Promise<Resposta> {
  const config = uploadDiretoConfigurado(env)
  if (!config.ok) return INDISPONIVEL

  const verificada = verificarIntencao(corpo?.intencao, env.NEXTAUTH_SECRET as string, agora)
  if (!verificada.ok) {
    // `vencida` só sai DEPOIS de a assinatura conferir: o caminho é do
    // servidor. Se o objeto chegou fora do prazo, é apagado. Adulterada:
    // nada é tocado.
    if (verificada.motivo === 'vencida') {
      const autentica = lerCorpoDaIntencao(corpo?.intencao)
      if (autentica && autentica.workspaceId === sessao.workspaceId) {
        await deleteFilePrivado(BUCKET_DIGITAL_TWIN_PRIVADO, autentica.caminho).catch(() => {})
      }
      return { status: 410, corpo: { error: 'O prazo para concluir o envio terminou. Envie o arquivo de novo.' } }
    }
    return { status: 400, corpo: { error: 'Pedido de envio inválido.' } }
  }

  const intencao = verificada.intencao
  // Isolamento: intenção de outro workspace → recusa, sem tocar no objeto.
  if (intencao.workspaceId !== sessao.workspaceId) return { status: 403, corpo: { error: 'Pedido de envio inválido.' } }
  const profile = await prisma.digitalTwinProfile.findFirst({ where: { id: intencao.profileId, workspaceId: sessao.workspaceId } })
  if (!profile) return { status: 403, corpo: { error: 'Perfil do Digital Twin não encontrado.' } }

  // Idempotência: confirmar duas vezes devolve o mesmo asset.
  const existente = await prisma.digitalTwinAsset.findFirst({ where: { workspaceId: sessao.workspaceId, storagePath: intencao.caminho } })
  if (existente) return { status: 200, corpo: { id: existente.id, type: existente.type, createdAt: existente.createdAt } }

  // P2.33.1: o consentimento é conferido de novo — revogado entre o pedido e a confirmação, o arquivo sai.
  const barreira = await barreiraDeConsentimento(sessao, intencao.tipo, intencao.purpose, new Date(agora))
  if (barreira) {
    await deleteFilePrivado(BUCKET_DIGITAL_TWIN_PRIVADO, intencao.caminho).catch(() => {})
    return barreira
  }

  const info = await infoDoObjetoPrivado(BUCKET_DIGITAL_TWIN_PRIVADO, intencao.caminho)
  if (!info) return { status: 409, corpo: { error: 'O arquivo ainda não chegou ao armazenamento.' } }

  const conferencia = validarObjetoEnviado(info, intencao)
  if (!conferencia.ok) {
    await deleteFilePrivado(BUCKET_DIGITAL_TWIN_PRIVADO, intencao.caminho).catch(() => {})
    await registrarAuditoria({
      workspaceId: sessao.workspaceId,
      userId: sessao.userId,
      action: 'digital_twin.asset_upload_recusado',
      entityType: 'DigitalTwinProfile',
      entityId: profile.id,
      metadata: { type: intencao.tipo, motivo: conferencia.motivo },
    })
    return { status: 400, corpo: { error: conferencia.motivo } }
  }

  const asset = await prisma.digitalTwinAsset.create({
    data: {
      workspaceId: sessao.workspaceId,
      profileId: profile.id,
      type: intencao.tipo,
      storagePath: intencao.caminho,
      mimeType: intencao.mime,
      purpose: intencao.purpose,
      // Referências de identidade/voz nunca expiram por rotina (prévias não vêm por aqui).
      expiresAt: null,
    },
  })

  await registrarAuditoria({
    workspaceId: sessao.workspaceId,
    userId: sessao.userId,
    action: 'digital_twin.asset_uploaded',
    entityType: 'DigitalTwinAsset',
    entityId: asset.id,
    metadata: { type: intencao.tipo, via: 'upload-direto' }, // nunca o conteúdo, nunca o storagePath
  })

  return { status: 200, corpo: { id: asset.id, type: asset.type, createdAt: asset.createdAt } }
}

/** `null` = pode; senão, a resposta de recusa (403). Mesma decisão para pedir e para confirmar o envio. */
async function barreiraDeConsentimento(sessao: Sessao, tipo: string, purpose: string | null, agora: Date): Promise<Resposta | null> {
  const c = await consentimentosDoPerfil(sessao.workspaceId)
  if (!c.ownerUserId || c.ownerUserId !== sessao.userId) {
    return { status: 403, corpo: { error: 'Só a titular do perfil envia o próprio rosto ou voz.' } }
  }
  const pode = podeUsarMaterial(tipo, purpose, { userId: sessao.userId, imagem: c.imagem, voz: c.voz, agora })
  return pode.ok ? null : { status: 403, corpo: { error: pode.motivo ?? 'Consentimento não vigente.', codigo: 'CONSENTIMENTO_EXIGIDO' } }
}

function lerCorpoDaIntencao(token: unknown): { workspaceId: string; caminho: string } | null {
  if (typeof token !== 'string') return null
  try {
    const j = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
    return typeof j.workspaceId === 'string' && typeof j.caminho === 'string' ? j : null
  } catch {
    return null
  }
}
