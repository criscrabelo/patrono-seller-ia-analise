/**
 * P2.33.1 — CONSENTIMENTO ESPECÍFICO para material biométrico (rosto e voz), decidido num lugar só.
 *
 * Regra: nenhum material de rosto ou voz é enviado, guardado, servido ou usado sem o consentimento
 * vigente DA PRÓPRIA PESSOA (subjectUserId = quem envia/usa), para a finalidade daquele tipo:
 *   - rosto (FACE_IMAGE)             → consentimento de IMAGEM;
 *   - voz (VOICE_REFERENCE)          → consentimento de VOZ;
 *   - vídeo de referência            → IMAGEM e VOZ (tem rosto e, em geral, a fala);
 *   - prévias geradas                → conforme o que carregam (voz → VOZ; rosto + voz → os dois).
 * "Vigente" = GRANTED, sem revogação e dentro da validade. Funções puras: o servidor (envio, confirmação,
 * listagem, worker, narração) chama a mesma decisão — a tela esconder botões nunca é a proteção.
 */

export type Consentimento = 'IMAGEM' | 'VOZ'

export interface RegistroDeConsentimento {
  status: string
  subjectUserId: string
  revokedAt: Date | null
  expiresAt: Date | null
}

/** Finalidades aceitas (texto exato registrado no consentimento — nada genérico, nada vindo livre do navegador). */
export const FINALIDADES: Record<Consentimento, readonly string[]> = {
  IMAGEM: ['Geração de vídeos de divulgação com minha imagem'],
  VOZ: ['Clonagem da minha voz para vídeos de divulgação', 'Narração dos meus vídeos de divulgação com a minha voz'],
}

/** Validade padrão de um consentimento novo (renovável; vencido = não vale). */
export const VALIDADE_DO_CONSENTIMENTO_MS = 365 * 24 * 60 * 60 * 1000

/** Quais consentimentos cada tipo de material exige. Tipo desconhecido exige os dois (fail-closed). */
export function consentimentosExigidos(tipo: string, purpose?: string | null): Consentimento[] {
  if (tipo === 'FACE_IMAGE') return ['IMAGEM']
  if (tipo === 'VOICE_REFERENCE') return ['VOZ']
  if (tipo === 'REFERENCE_VIDEO') return ['IMAGEM', 'VOZ']
  if (tipo === 'CONSENT_EVIDENCE') return []
  if (tipo === 'GENERATED_PREVIEW') {
    if (purpose === 'voice_preview' || purpose === 'product_preview' || purpose === 'narration') return ['VOZ']
    return ['IMAGEM', 'VOZ']
  }
  return ['IMAGEM', 'VOZ']
}

/** O consentimento vale AGORA para esta pessoa? */
export function consentimentoVigente(c: RegistroDeConsentimento | null | undefined, userId: string, agora: Date = new Date()): { ok: boolean; motivo: string | null } {
  if (!c) return { ok: false, motivo: 'Sem consentimento registrado.' }
  if (c.subjectUserId !== userId) return { ok: false, motivo: 'O consentimento é de outra pessoa: só a própria titular usa o próprio rosto ou voz.' }
  if (c.status !== 'GRANTED' || c.revokedAt) return { ok: false, motivo: 'O consentimento foi revogado ou não está concedido.' }
  if (c.expiresAt && c.expiresAt.getTime() <= agora.getTime()) return { ok: false, motivo: 'O consentimento venceu: renove para continuar.' }
  return { ok: true, motivo: null }
}

const NOME: Record<Consentimento, string> = { IMAGEM: 'imagem', VOZ: 'voz' }

/** Decisão única: este material (tipo/finalidade) pode ser enviado/servido/usado por esta pessoa agora? */
export function podeUsarMaterial(
  tipo: string,
  purpose: string | null | undefined,
  ctx: { userId: string; imagem: RegistroDeConsentimento | null; voz: RegistroDeConsentimento | null; agora?: Date },
): { ok: boolean; motivo: string | null } {
  for (const c of consentimentosExigidos(tipo, purpose)) {
    const v = consentimentoVigente(c === 'IMAGEM' ? ctx.imagem : ctx.voz, ctx.userId, ctx.agora)
    if (!v.ok) return { ok: false, motivo: `Consentimento de ${NOME[c]}: ${v.motivo}` }
  }
  return { ok: true, motivo: null }
}

/** A finalidade informada é uma das aceitas para este consentimento? (texto exato) */
export function finalidadeAceita(tipo: Consentimento, purpose: unknown): purpose is string {
  return typeof purpose === 'string' && FINALIDADES[tipo].includes(purpose.trim())
}

/** Consentimentos do perfil do workspace, no formato da decisão (lê só o necessário). */
export async function consentimentosDoPerfil(workspaceId: string): Promise<{ ownerUserId: string | null; profileId: string | null; imagem: RegistroDeConsentimento | null; voz: RegistroDeConsentimento | null }> {
  const { prisma } = await import('./prisma')
  const profile = await prisma.digitalTwinProfile.findUnique({ where: { workspaceId }, select: { id: true, ownerUserId: true, identityConsentId: true, voiceProfileId: true } })
  if (!profile) return { ownerUserId: null, profileId: null, imagem: null, voz: null }
  const sel = { status: true, subjectUserId: true, revokedAt: true, expiresAt: true } as const
  const imagem = profile.identityConsentId ? await prisma.identityConsent.findFirst({ where: { id: profile.identityConsentId, workspaceId }, select: sel }) : null
  const vp = profile.voiceProfileId ? await prisma.voiceProfile.findFirst({ where: { id: profile.voiceProfileId, workspaceId }, select: { consentId: true } }) : null
  const voz = vp?.consentId ? await prisma.voiceConsent.findFirst({ where: { id: vp.consentId, workspaceId }, select: sel }) : null
  return { ownerUserId: profile.ownerUserId, profileId: profile.id, imagem, voz }
}
