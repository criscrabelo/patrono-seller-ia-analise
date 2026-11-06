/**
 * Privacidade do ML de performance (Rodada 9, complemento ML, regras 38-39).
 *
 * - Dados biométricos do Digital Twin (áudio bruto, rosto bruto, qualquer
 *   referência de identidade) NUNCA entram no dataset de performance —
 *   barreira estrutural, verificada antes de qualquer persistência de
 *   feature/previsão.
 * - Isolamento por workspace: todo dado de ML é escopado por
 *   `workspaceId` (ver prisma/schema.prisma) — nenhuma consulta deste
 *   módulo lê/escreve sem esse filtro. Um modelo global agregando vários
 *   workspaces exigiria política própria de anonimização — não
 *   implementado nesta rodada (regra 39).
 */

const CAMPOS_BIOMETRICOS_PROIBIDOS = [
  'referenceaudio',
  'faceimage',
  'voiceprofileid',
  'identityreferenceid',
  'rosto',
  'voz',
  'audio',
  'face',
  'biometr',
  'videourl',
]

/** Barreira estrutural — nunca deixa um campo de dado biométrico bruto entrar num objeto de features/previsão. */
export function verificarSemDadosBiometricos(objeto: Record<string, unknown>): void {
  for (const chave of Object.keys(objeto)) {
    const normalizada = chave.toLowerCase()
    if (CAMPOS_BIOMETRICOS_PROIBIDOS.some((proibido) => normalizada.includes(proibido))) {
      throw new Error(`Dado de ML de performance nunca pode incluir campo biométrico bruto: "${chave}".`)
    }
  }
}
