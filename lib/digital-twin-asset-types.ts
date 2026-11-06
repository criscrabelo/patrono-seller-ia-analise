/**
 * Tipos de asset do Digital Twin — extraído para ser testável sem
 * precisar de uma requisição HTTP real (usado por
 * `app/api/digital-twin/assets/route.ts`).
 */

export const DIGITAL_TWIN_ASSET_TYPES = ['FACE_IMAGE', 'REFERENCE_VIDEO', 'VOICE_REFERENCE', 'CONSENT_EVIDENCE', 'GENERATED_PREVIEW'] as const
export type DigitalTwinAssetType = (typeof DIGITAL_TWIN_ASSET_TYPES)[number]

export function ehTipoDeAssetValido(tipo: string): tipo is DigitalTwinAssetType {
  return (DIGITAL_TWIN_ASSET_TYPES as readonly string[]).includes(tipo)
}

/** Aceita tanto gravação pelo navegador (webm) quanto upload de arquivo de áudio comum. */
export function ehMimeTypeDeVozAceito(mimeType: string): boolean {
  return mimeType.startsWith('audio/')
}
