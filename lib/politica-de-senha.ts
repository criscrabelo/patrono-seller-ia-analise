/**
 * Política de senha única (A8/A15). Vale para toda senha NOVA (cadastro,
 * redefinição, troca em /conta e troca pelo admin). O login não usa esta
 * regra: quem já tem senha curta continua entrando e é levada a trocar.
 */
export const SENHA_MINIMA = 10
/** O bcrypt só usa os primeiros 72 bytes: acima disso a senha seria truncada em silêncio. */
export const SENHA_MAXIMA_BYTES = 72

const COMUNS = new Set([
  '1234567890', '0123456789', '12345678910', 'qwertyuiop', 'password12', 'senha12345', 'senha123456',
  'abcdefghij', 'admin12345', 'mudar12345', 'brasil2026', 'patrono123', 'patrono1234',
  'senha1234567', 'qwertyuiop1', 'password123', 'mudar123456',
])

export const MENSAGEM_DE_SENHA = `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres e não pode ser uma sequência óbvia.`

/** Devolve a mensagem de erro, ou null se a senha é aceitável. */
export function validarSenhaNova(senha: unknown): string | null {
  if (typeof senha !== 'string' || senha.length < SENHA_MINIMA) return MENSAGEM_DE_SENHA
  const s = senha.toLowerCase()
  if (COMUNS.has(s)) return MENSAGEM_DE_SENHA
  if (Buffer.byteLength(senha, 'utf8') > SENHA_MAXIMA_BYTES) return `A senha pode ter no máximo ${SENHA_MAXIMA_BYTES} bytes (cerca de 70 caracteres).`
  if (new Set(s).size < 5) return MENSAGEM_DE_SENHA // poucos caracteres distintos (ex.: 1111111112)
  if (/^(0123456789|1234567890|qwertyuiop|asdfghjkl|abcdefghij)/.test(s) && new Set(s).size < 11) return MENSAGEM_DE_SENHA // sequência de teclado/numérica
  return null
}
