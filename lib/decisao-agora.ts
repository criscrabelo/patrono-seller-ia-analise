/**
 * P2.24 — MOTOR UNIFICADO "O QUE FAZER AGORA". FUNÇÃO PURA.
 *
 * Junta os sinais que já existem — produto (score/evidência), comissão, campanha/missão e prazo, produto em
 * mãos, decisão da amostra (P2.22), restrições da plataforma (P2.20), disponibilidade e o que o aprendizado
 * criativo vai aplicar (P2.21) — numa decisão ÚNICA e EXPLICADA.
 *
 * Ordem (degraus; dentro de cada degrau, a nota unificada desempata):
 *   0. prazo crítico real esperando a titular (o que mais perde dinheiro se esperar);
 *   1. publicação pronta (publicar / marcar produto / colar o link) — o mais perto do dinheiro;
 *   2. o produto que a titular acabou de escolher;
 *   3. produto em mãos que pede algo dela;
 *   4. o resto, pela nota.
 * Ação que a plataforma NÃO deixa fazer agora (quota oficial atingida) não é recomendada: vai para o fim da
 * fila (atrás de qualquer ação possível) e a explicação diz por quê. Nada aqui inventa dado: fator desconhecido não pontua.
 */
import { HORAS_DE_PRAZO_CRITICO, type EstadoDaJornada, type FatosDaJornada } from './motor-da-jornada'
import type { PermissaoDaAcao } from './permissao-da-acao'
import type { OrientacaoCriativa } from './aprendizado-criativo'

const HORA = 3_600_000
const ACOES_DE_PUBLICAR = ['PUBLICAR_VIDEO', 'MARCAR_PRODUTO', 'COLAR_LINK_PUBLICADO']
/** Publicação ocupando o estúdio (um vídeo por vez). Fonte única (a jornada importa daqui). */
export const EM_PRODUCAO = ['GERANDO', 'PRONTO', 'VIDEO_NA_FILA', 'GERANDO_VIDEO', 'AGUARDANDO_APROVACAO', 'APROVADO', 'PUBLICANDO', 'AJUSTE_PEDIDO']
const ACOES_QUE_CONSOMEM_QUOTA = ['PUBLICAR_VIDEO', 'APROVAR_VIDEO']

/** Pesos documentados da nota (0–100) usada dentro do degrau. */
export const PESOS_DA_NOTA = {
  pertoDoDinheiro: 30,
  evidencia: 25,
  comissao: 15,
  missaoOuCampanha: 15,
  emMaos: 10,
  amostra: 5,
} as const

export interface JornadaParaDecidir {
  estado: EstadoDaJornada
  fatos: FatosDaJornada
  /** A titular escolheu este produto (último "ESCOLHER OUTRO PRODUTO"), ms; 0 = não. */
  escolhidaEm: number
}

export interface FatorDaDecisao { fator: keyof typeof PESOS_DA_NOTA; valor: string; pontos: number; peso: number }

export interface ItemDaDecisao {
  candidatoId: string
  degrau: 0 | 1 | 2 | 3 | 4
  nota: number
  fatores: FatorDaDecisao[]
  bloqueadaPelaPlataforma: string | null
  motivo: string
}

export interface DecisaoAgora {
  ordem: ItemDaDecisao[]
  /** A ação do topo, explicada (ou "o Patrono está trabalhando"). */
  agora: { candidatoId: string | null; titulo: string; porque: string[]; fatores: FatorDaDecisao[]; alternativas: { candidatoId: string; titulo: string; porqueNao: string }[] } | null
}

const MOTIVO_DO_DEGRAU = [
  'prazo crítico: se esperar, perde dinheiro',
  'publicação pronta: é o passo mais perto do dinheiro',
  'é o produto que você acabou de escolher',
  'você já tem o produto em mãos',
  'melhor nota entre as demais',
] as const

function notaDaJornada(j: JornadaParaDecidir, agora: Date): { nota: number; fatores: FatorDaDecisao[] } {
  const f = j.fatos, e = j.estado, c = f.candidato
  const fatores: FatorDaDecisao[] = []
  const add = (fator: keyof typeof PESOS_DA_NOTA, valor: string, fracao: number) => fatores.push({ fator, valor, peso: PESOS_DA_NOTA[fator], pontos: Math.round(Math.max(0, Math.min(1, fracao)) * PESOS_DA_NOTA[fator] * 10) / 10 })
  add('pertoDoDinheiro', `${e.etapa} (passo ${Math.max(0, e.pertoDoDinheiro)} de 7)`, Math.max(0, e.pertoDoDinheiro) / 7)
  add('evidencia', `base de evidência ${c.baseDeEvidencia}`, c.baseDeEvidencia / 100)
  if (c.comissaoValor != null) add('comissao', `R$ ${c.comissaoValor.toFixed(2).replace('.', ',')} por venda`, Math.min(1, c.comissaoValor / 15))
  const missao = e.missao ?? f.missoes[0]?.nome ?? null
  if (missao) {
    const prazoH = e.prazo ? (new Date(e.prazo).getTime() - agora.getTime()) / HORA : null
    add('missaoOuCampanha', `${missao}${e.prazo ? ` (prazo ${new Date(e.prazo).toLocaleDateString('pt-BR')})` : ''}`, prazoH != null && prazoH <= HORAS_DE_PRAZO_CRITICO ? 1 : 0.6)
  }
  const emMaos = f.decisoes.emMaos || c.compradoPelaTitular || c.usadoPelaTitular
  if (emMaos) add('emMaos', 'produto em mãos', 1)
  const op = f.oportunidadeDeAmostra
  if (op && e.etapa === 'AMOSTRA') add('amostra', `${op.decisao}${op.nota != null ? ` (nota ${op.nota})` : ''}`, op.decisao === 'PEDIR' ? 1 : op.decisao === 'PEDIR_SE_PRIORIDADE' ? 0.5 : 0)
  return { nota: Math.round(fatores.reduce((s, x) => s + x.pontos, 0) * 10) / 10, fatores }
}

/**
 * Decide a ordem e explica o topo. `restricoes` = permissão de publicar promocional agora (P2.20);
 * `orientacao` = o que o aprendizado criativo vai aplicar no próximo vídeo (P2.21), quando houver.
 */
export function decidirAgora(p: { jornadas: JornadaParaDecidir[]; agora: Date; restricoes?: PermissaoDaAcao | null; orientacao?: OrientacaoCriativa | null }): DecisaoAgora {
  const ativas = p.jornadas.filter((j) => !j.estado.terminal)
  const ultimaEscolha = [...ativas].filter((j) => j.escolhidaEm > 0).sort((a, b) => b.escolhidaEm - a.escolhidaEm)[0]
  // Um vídeo por vez: se a escolhida espera o estúdio, quem a destrava é a produção atual.
  const naFila = !!ultimaEscolha?.fatos.outraProducao && ultimaEscolha.estado.etapa === 'CONTEUDO'
  const escolhida = naFila ? ativas.find((j) => j.fatos.assistida && EM_PRODUCAO.includes(j.fatos.assistida.estado))?.estado.candidatoId : ultimaEscolha?.estado.candidatoId
  const quotaBloqueada = p.restricoes?.resultado === 'BLOQUEADA' ? p.restricoes.motivo : null

  const itens: (ItemDaDecisao & { _j: JornadaParaDecidir; _criticoEm: number; _pedeTitular: number })[] = ativas.map((j) => {
    const e = j.estado, f = j.fatos
    const pedeTitular = e.espera === 'AGUARDANDO_CRISTIANE'
    const critico = pedeTitular && !!e.prazo && new Date(e.prazo).getTime() - p.agora.getTime() <= HORAS_DE_PRAZO_CRITICO * HORA
    const bloqueada = quotaBloqueada && ACOES_QUE_CONSOMEM_QUOTA.includes(e.acao?.tipo ?? '') && f.candidato.providerId === 'tiktok-shop' ? quotaBloqueada : null
    const emMaos = f.decisoes.emMaos || f.candidato.compradoPelaTitular || f.candidato.usadoPelaTitular
    const degrau: ItemDaDecisao['degrau'] = critico ? 0 : ACOES_DE_PUBLICAR.includes(e.acao?.tipo ?? '') ? 1 : e.candidatoId === escolhida ? 2 : pedeTitular && emMaos ? 3 : 4
    const { nota, fatores } = notaDaJornada(j, p.agora)
    return { candidatoId: e.candidatoId, degrau, nota, fatores, bloqueadaPelaPlataforma: bloqueada, motivo: MOTIVO_DO_DEGRAU[degrau], _j: j, _criticoEm: critico ? new Date(e.prazo!).getTime() : Number.POSITIVE_INFINITY, _pedeTitular: pedeTitular ? 1 : 0 }
  })
  itens.sort((a, b) =>
    // A plataforma não deixa fazer agora (quota oficial): nunca é "o que fazer agora" se houver outra ação possível.
    Number(!!a.bloqueadaPelaPlataforma) - Number(!!b.bloqueadaPelaPlataforma) ||
    a.degrau - b.degrau ||
    a._criticoEm - b._criticoEm ||
    b._pedeTitular - a._pedeTitular ||
    Number(!!b._j.estado.missao) - Number(!!a._j.estado.missao) ||
    b._j.estado.pertoDoDinheiro - a._j.estado.pertoDoDinheiro ||
    b.nota - a.nota ||
    (b._j.fatos.candidato.score ?? 0) - (a._j.fatos.candidato.score ?? 0)
  )
  const ordem: ItemDaDecisao[] = itens.map(({ _j, _criticoEm, _pedeTitular, ...x }) => x)
  const topo = itens[0]
  if (!topo) return { ordem, agora: null }
  const e = topo._j.estado
  const porque = [topo.motivo]
  const melhores = [...topo.fatores].filter((x) => x.pontos > 0).sort((a, b) => b.pontos - a.pontos).slice(0, 3).map((x) => x.valor)
  if (melhores.length) porque.push(`sinais: ${melhores.join(' · ')}`)
  if (topo.bloqueadaPelaPlataforma) porque.push(`atenção: ${topo.bloqueadaPelaPlataforma}`)
  if (p.orientacao?.motivos.length && ['CONTEUDO', 'MIDIA', 'APROVAR_PRODUTO'].includes(e.etapa)) porque.push(`no vídeo, o Patrono vai aplicar o que aprendeu: ${p.orientacao.motivos[0]}`)
  const alternativas = itens.slice(1, 4).map((x) => ({
    candidatoId: x.candidatoId,
    titulo: x._j.estado.titulo,
    porqueNao: x.bloqueadaPelaPlataforma ? x.bloqueadaPelaPlataforma : x.degrau > topo.degrau ? `prioridade menor (${x.motivo})` : x._j.estado.espera !== 'AGUARDANDO_CRISTIANE' ? 'não depende de você agora' : `nota ${x.nota} contra ${topo.nota}`,
  }))
  return {
    ordem,
    agora: { candidatoId: e.candidatoId, titulo: e.espera === 'AGUARDANDO_CRISTIANE' ? e.titulo : `Patrono trabalhando: ${e.titulo}`, porque, fatores: topo.fatores, alternativas },
  }
}
