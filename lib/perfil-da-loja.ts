/**
 * P2.14.5.13 — Perfil da loja por workspace.
 *
 * O perfil gravado no banco (`PerfilDaLoja`) substitui o padrão de
 * lib/config.ts (`PERFIL_DA_LOJA`), que continua como RESERVA: se a linha não
 * existir ou estiver malformada, vale o padrão — o motor nunca fica sem
 * perfil e nunca inventa um.
 *
 * Só as PREFERÊNCIAS vêm do banco (público, categorias, faixa de preço,
 * marcas, estilo, conteúdo faceless, demonstração). Pesos e bônus da
 * afinidade continuam no código (`PERFIL_DA_LOJA.afinidadeDaTitular`), num
 * único motor: mudar peso exige mudar código e passar pelos testes.
 */

import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { PERFIL_DA_LOJA } from './config'
import type { PerfilDaLoja as PerfilDoMotor } from './motor-de-oportunidades'

type MarcaPreferida = PerfilDoMotor['afinidadeDaTitular']['marcasPreferidas'][number]

/** Linha de `PerfilDaLoja` no mínimo necessário (sem ids/datas). */
export interface LinhaDoPerfil {
  posicionamento: string
  publico: string
  categoriasPrioritarias: string[]
  categoriasDoCadastro: string[]
  subcategoriasPrioritarias: Prisma.JsonValue
  precoMinimo: number
  precoMaximo: number
  precoPremiumAte: number
  priorizarFacilDeDemonstrar: boolean
  priorizarConteudoFaceless: boolean
  marcasPreferidas: Prisma.JsonValue
  estilo: string[]
  marcadorDeUso: string
}

/** O perfil padrão de lib/config.ts no formato que o motor usa. */
export function perfilPadrao(): PerfilDoMotor {
  return PERFIL_DA_LOJA as unknown as PerfilDoMotor
}

/** Dados para gravar o perfil padrão no workspace (cópia fiel do config). */
export function linhaDoPerfilPadrao(): LinhaDoPerfil {
  const p = PERFIL_DA_LOJA
  return {
    posicionamento: p.posicionamento,
    publico: p.publico,
    categoriasPrioritarias: [...p.categoriasPrioritarias],
    categoriasDoCadastro: [...p.categoriasDoCadastro],
    subcategoriasPrioritarias: Object.fromEntries(
      Object.entries(p.subcategoriasPrioritarias).map(([k, v]) => [k, [...v]])
    ),
    precoMinimo: p.faixaDePreco.minimo,
    precoMaximo: p.faixaDePreco.maximo,
    precoPremiumAte: p.faixaDePreco.premiumAte,
    priorizarFacilDeDemonstrar: p.priorizarFacilDeDemonstrar,
    priorizarConteudoFaceless: p.priorizarSemPresencaDaTitular,
    marcasPreferidas: p.afinidadeDaTitular.marcasPreferidas.map((m) => ({
      nome: m.nome,
      termos: [...m.termos],
      ...(m.diferenciaMaiusculas ? { diferenciaMaiusculas: true } : {}),
      ...(m.excetoCategorias ? { excetoCategorias: [...m.excetoCategorias] } : {}),
    })),
    estilo: [...p.afinidadeDaTitular.estilo],
    marcadorDeUso: p.afinidadeDaTitular.marcadorDeUso,
  }
}

const listaDeTextos = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

function subcategoriasValidas(v: Prisma.JsonValue): Record<string, string[]> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const saida: Record<string, string[]> = {}
  for (const [k, termos] of Object.entries(v)) {
    if (!listaDeTextos(termos)) return null
    saida[k] = termos
  }
  return saida
}

function marcasValidas(v: Prisma.JsonValue): MarcaPreferida[] | null {
  if (!Array.isArray(v)) return null
  const saida: MarcaPreferida[] = []
  for (const m of v) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null
    const r = m as Record<string, unknown>
    if (typeof r.nome !== 'string' || !listaDeTextos(r.termos)) return null
    if (r.excetoCategorias !== undefined && !listaDeTextos(r.excetoCategorias)) return null
    saida.push({
      nome: r.nome,
      termos: r.termos,
      diferenciaMaiusculas: r.diferenciaMaiusculas === true,
      ...(r.excetoCategorias ? { excetoCategorias: r.excetoCategorias as string[] } : {}),
    })
  }
  return saida
}

/**
 * Converte a linha do banco no perfil do motor. Malformada (JSON fora do
 * formato, faixa de preço incoerente) → `null`, e quem chama usa o padrão.
 */
export function perfilDaLinha(linha: LinhaDoPerfil): PerfilDoMotor | null {
  const subcategorias = subcategoriasValidas(linha.subcategoriasPrioritarias)
  const marcas = marcasValidas(linha.marcasPreferidas)
  if (!subcategorias || !marcas) return null
  if (!(linha.precoMinimo >= 0 && linha.precoMinimo <= linha.precoMaximo && linha.precoMaximo <= linha.precoPremiumAte)) {
    return null
  }
  const pesos = PERFIL_DA_LOJA.afinidadeDaTitular
  return {
    categoriasDoCadastro: linha.categoriasDoCadastro,
    subcategoriasPrioritarias: subcategorias,
    faixaDePreco: { minimo: linha.precoMinimo, maximo: linha.precoMaximo, premiumAte: linha.precoPremiumAte },
    priorizarFacilDeDemonstrar: linha.priorizarFacilDeDemonstrar,
    priorizarSemPresencaDaTitular: linha.priorizarConteudoFaceless,
    afinidadeDaTitular: {
      marcasPreferidas: marcas,
      estilo: linha.estilo,
      marcadorDeUso: linha.marcadorDeUso,
      // Pesos: sempre do código.
      bonus: pesos.bonus,
      teto: pesos.teto,
      perfilMinimoParaBonus: pesos.perfilMinimoParaBonus,
    },
  }
}

export type OrigemDoPerfil = 'BANCO' | 'PADRAO' | 'PADRAO_LINHA_INVALIDA'

/**
 * Perfil efetivo do workspace. Com `criarSeAusente`, grava o padrão no
 * workspace na primeira vez (cópia fiel do config) — é a única escrita.
 */
export async function obterPerfilDaLoja(
  workspaceId: string,
  opcoes: { criarSeAusente?: boolean } = {}
): Promise<{ perfil: PerfilDoMotor; origem: OrigemDoPerfil }> {
  let linha = await prisma.perfilDaLoja.findUnique({ where: { workspaceId } })
  if (!linha && opcoes.criarSeAusente) {
    const dados = linhaDoPerfilPadrao() as Prisma.PerfilDaLojaUncheckedCreateInput
    try {
      linha = await prisma.perfilDaLoja.upsert({
        where: { workspaceId },
        create: { ...dados, workspaceId },
        update: {},
      })
    } catch (e) {
      // P2.17.4: duas primeiras coletas ao mesmo tempo — a perdedora relê o perfil criado.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
      linha = await prisma.perfilDaLoja.findUnique({ where: { workspaceId } })
    }
  }
  if (!linha) return { perfil: perfilPadrao(), origem: 'PADRAO' }
  const perfil = perfilDaLinha(linha)
  return perfil ? { perfil, origem: 'BANCO' } : { perfil: perfilPadrao(), origem: 'PADRAO_LINHA_INVALIDA' }
}
