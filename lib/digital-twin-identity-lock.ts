/**
 * DigitalTwinIdentityLock (Rodada 8, regra 20) — depois que a proprietária
 * aprova o perfil (`DigitalTwinProfile.approvedAt`), o Autopilot só pode
 * usar referências (assets FACE_IMAGE/REFERENCE_VIDEO/VOICE_REFERENCE)
 * DAQUELE perfil específico — nunca mistura outra pessoa, outro rosto ou
 * um modelo genérico.
 */

export interface DigitalTwinIdentityLockCheck {
  profileId: string
  profileApproved: boolean
  assetProfileId: string
}

export interface IdentityLockResultado {
  permitido: boolean
  motivo: string
}

export function verificarIdentityLock(check: DigitalTwinIdentityLockCheck): IdentityLockResultado {
  if (!check.profileApproved) {
    return { permitido: false, motivo: 'Perfil ainda não aprovado — o Autopilot não pode reutilizar referências antes da aprovação única do perfil.' }
  }
  if (check.assetProfileId !== check.profileId) {
    return { permitido: false, motivo: 'Asset pertence a um perfil diferente — nunca misturar identidade de outro Digital Twin ou modelo genérico.' }
  }
  return { permitido: true, motivo: 'Asset pertence ao perfil aprovado.' }
}
