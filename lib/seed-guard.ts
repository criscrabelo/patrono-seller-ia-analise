/**
 * Trava de segurança compartilhada por todo script que cria dados de teste
 * (seed principal e fixtures em scripts/). Todos criam usuárias com senha
 * conhecida ou produtos/conteúdos de exemplo — rodar isso contra produção
 * abriria uma porta de entrada ou poluiria o banco real com dado fictício.
 *
 * Para rodar mesmo assim (ex.: primeiro provisionamento do admin), use:
 *   PERMITIR_SEED_PRODUCAO=sim <comando>
 */
export function verificarAmbienteDeSeed(nomeScript: string) {
  if (process.env.PERMITIR_SEED_PRODUCAO === 'sim') return

  const url = process.env.DATABASE_URL ?? ''
  const local = /localhost|127\.0\.0\.1|host\.docker\.internal/.test(url)

  if (!local) {
    console.error(
      `\nBloqueado: DATABASE_URL não aponta para um banco local (script: ${nomeScript}).\n` +
        'Este script cria dado de teste (usuária com senha conhecida e/ou produto\n' +
        'de exemplo) e não deve tocar produção.\n' +
        'Se isso for mesmo intencional, rode com:\n' +
        '  PERMITIR_SEED_PRODUCAO=sim <comando>\n'
    )
    process.exit(1)
  }
}
