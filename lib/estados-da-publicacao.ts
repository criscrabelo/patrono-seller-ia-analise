/**
 * P2.23 — estados da publicação assistida que contam como "aprovada ou além" (fonte única:
 * monetização e operação comercial usavam cópias). Demonstração nunca chega a PUBLICADO.
 */
export const ESTADOS_APROVADOS_OU_ALEM = ['APROVADO', 'PUBLICANDO', 'PUBLICADO'] as const
export const aprovadaOuAlem = (estado: string) => (ESTADOS_APROVADOS_OU_ALEM as readonly string[]).includes(estado)
