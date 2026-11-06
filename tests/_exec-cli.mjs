/**
 * Executa as CLIs do projeto (prisma, tsx) de forma portátil.
 *
 * POR QUE ISTO EXISTE: os testes chamavam `execFileSync('npx', [...])`, o que
 * só funciona em Linux/macOS. No Windows há dois bloqueios em sequência:
 *
 *   1. `npx` é na verdade `npx.cmd` — `execFileSync` sem shell não resolve a
 *      extensão e falha com ENOENT;
 *   2. resolvendo para `npx.cmd`, o Node passa a recusar executar `.cmd` sem
 *      `shell: true` desde a correção do CVE-2024-27980 — falha com EINVAL.
 *
 * E `shell: true` não serve como saída: um dos chamadores passa um script
 * JavaScript inteiro como argumento, que o shell destruiria.
 *
 * A solução é não usar `npx`: invocamos o entry point JS da CLI com o próprio
 * Node (`process.execPath`). Funciona igual nos três sistemas, sem shell e sem
 * depender de PATH.
 *
 * Verificado na máquina Windows real: era o que impedia toda a suíte `.mjs`
 * de rodar lá.
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Caminho absoluto de um arquivo dentro do repositório, a partir de `tests/`. */
function doRepo(relativo) {
  return fileURLToPath(new URL(relativo, import.meta.url))
}

export const PRISMA_CLI = doRepo('../node_modules/prisma/build/index.js')
export const TSX_CLI = doRepo('../node_modules/tsx/dist/cli.mjs')

/** Roda uma CLI do projeto com o Node atual. Mesma assinatura de `execFileSync`. */
export function execCli(cli, args, opcoes) {
  return execFileSync(process.execPath, [cli, ...args], opcoes)
}
