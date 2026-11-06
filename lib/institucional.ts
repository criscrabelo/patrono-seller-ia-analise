/**
 * Dados institucionais públicos — a empresa por trás do Patrono Seller.
 *
 * Exibidos nas páginas públicas (/sobre, /privacidade, /termos), que
 * existem para que parceiros e plataformas (o TikTok Shop Partner Center,
 * por exemplo) identifiquem a razão social responsável pelo produto.
 *
 * ── O CNPJ ──────────────────────────────────────────────────────────────
 * Dado cadastral público da empresa, informado pela titular em 02/10/2026.
 * `PATRONO_EMPRESA_CNPJ` pode sobrepô-lo sem mudar código, e só vale se
 * passar nos dígitos verificadores. Qualquer valor inválido NÃO é exibido —
 * mostrar um CNPJ errado numa página de validação é pior do que não mostrar.
 *
 * Nada aqui é secret, e nada aqui lê secret.
 */

export const RAZAO_SOCIAL = 'PATRONO INOVA SIMPLES (I.S.)'
export const NOME_DO_PRODUTO = 'Patrono Seller'
export const CONTATO_EMAIL = 'contato@exemplo.com.br'
/** CNPJ da PATRONO INOVA SIMPLES (I.S.). */
export const CNPJ_DA_EMPRESA = '11.222.333/0001-81'

/** Só os dígitos. */
function digitos(valor: string): string {
  return (valor ?? '').replace(/\D/g, '')
}

/** Valida os dois dígitos verificadores do CNPJ. */
export function cnpjValido(valor: string | null | undefined): boolean {
  const d = digitos(valor ?? '')
  if (d.length !== 14) return false
  if (/^(\d)\1{13}$/.test(d)) return false

  const calcular = (base: string, pesos: number[]) => {
    const soma = base.split('').reduce((s, c, i) => s + Number(c) * pesos[i], 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const dv1 = calcular(d.slice(0, 12), p1)
  const dv2 = calcular(d.slice(0, 12) + dv1, p2)
  return d.endsWith(`${dv1}${dv2}`)
}

/** `12345678000195` → `12.345.678/0001-95`. `null` quando inválido. */
export function formatarCnpj(valor: string | null | undefined): string | null {
  if (!cnpjValido(valor)) return null
  const d = digitos(valor!)
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/**
 * Domínio oficial do site — dado INSTITUCIONAL, como a razão social e o
 * CNPJ: é o que a Política de Privacidade declara. A aplicação NÃO o usa
 * para montar URL nenhuma; links, e-mails e redirecionamentos vêm de
 * `PUBLIC_BASE_URL` (lib/link-de-publicacao.ts, lib/dominio.ts).
 */
export const DOMINIO_DO_SITE = 'exemplo.com.br'

/**
 * Data de vigência da Política de Privacidade da hospedagem Netlify (P2.8).
 * Vem de `PATRONO_VERSAO_DA_POLITICA` (dd/mm/aaaa), definida no go-live —
 * a política vale a partir da mudança de hospedagem, não antes. Ausente ou
 * fora do formato: a página diz que a versão vigora com a mudança.
 */
export function versaoDaPolitica(env: Record<string, string | undefined> = process.env): string | null {
  const v = (env.PATRONO_VERSAO_DA_POLITICA ?? '').trim()
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const [dia, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? v : null
}

export interface DadosInstitucionais {
  razaoSocial: string
  produto: string
  /** Formatado; `null` quando a configuração está ausente ou inválida. */
  cnpj: string | null
  contato: string
  dominio: string
  /** `null` até o go-live definir `PATRONO_VERSAO_DA_POLITICA`. */
  versaoDaPolitica: string | null
  /**
   * Parágrafo de transição da Vercel na seção 6.1 — aprovado por até 14
   * dias após o go-live. Ligado por `PATRONO_TRANSICAO_DE_HOSPEDAGEM=vercel`
   * no go-live; retirado removendo a variável no 14º dia.
   */
  transicaoDaVercel: boolean
}

export function dadosInstitucionais(
  env: Record<string, string | undefined> = process.env
): DadosInstitucionais {
  return {
    razaoSocial: RAZAO_SOCIAL,
    produto: NOME_DO_PRODUTO,
    // A configuração sobrepõe só quando é válida; inválida cai no cadastro.
    cnpj: formatarCnpj(env.PATRONO_EMPRESA_CNPJ) ?? formatarCnpj(CNPJ_DA_EMPRESA),
    contato: CONTATO_EMAIL,
    dominio: DOMINIO_DO_SITE,
    versaoDaPolitica: versaoDaPolitica(env),
    transicaoDaVercel: env.PATRONO_TRANSICAO_DE_HOSPEDAGEM === 'vercel',
  }
}

/**
 * Data da versão vigente dos Termos de Uso. A Política de Privacidade tem
 * data própria (`versaoDaPolitica`), definida no go-live da Netlify.
 */
export const VERSAO_DOS_TEXTOS = '02/10/2026'
