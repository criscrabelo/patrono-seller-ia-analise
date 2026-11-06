/**
 * Três níveis de kill switch (Rodada 8, regra 53; terceiro adicionado na
 * Rodada 9, regra 34) — SEMPRE independentes:
 *
 *  - `Workspace.automationPaused` (lib/autopilot.ts, Rodada 5): pausa
 *    PUBLICAÇÕES do Autopilot em geral (qualquer canal/modo).
 *  - `DigitalTwinProfile.enabled` (lib/digital-twin.ts, Rodada 6/7): pausa
 *    especificamente o uso de IDENTIDADE/VOZ da proprietária.
 *  - `DigitalTwinProfile.workerPaused` (Rodada 9): pausa especificamente o
 *    PROCESSAMENTO LOCAL (o worker para de reivindicar jobs) — nem publicar
 *    conteúdo comum, nem gerar prévias de voz/avatar dependem dele.
 *
 * Desligar um nunca desliga os outros — a usuária pode pausar só o Digital
 * Twin (o Autopilot continua publicando com Motion Graphics/produto), só o
 * Autopilot (o Digital Twin continua disponível para prévia manual), ou só
 * o worker (nenhum job novo é processado localmente, mas o resto do
 * Patrono continua funcionando normalmente).
 */

export interface AvaliacaoKillSwitches {
  autopilotPausado: boolean
  digitalTwinPausado: boolean
  workerPausado: boolean
  podePublicarAutopilot: boolean
  podeUsarIdentidadeOuVoz: boolean
  podeProcessarLocalmente: boolean
}

export function avaliarKillSwitches(params: { automationPaused: boolean; digitalTwinEnabled: boolean; workerPaused: boolean }): AvaliacaoKillSwitches {
  return {
    autopilotPausado: params.automationPaused,
    digitalTwinPausado: !params.digitalTwinEnabled,
    workerPausado: params.workerPaused,
    podePublicarAutopilot: !params.automationPaused,
    podeUsarIdentidadeOuVoz: params.digitalTwinEnabled,
    podeProcessarLocalmente: !params.workerPaused,
  }
}
