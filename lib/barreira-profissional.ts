/**
 * P2.66 — BARREIRA DE QUALIDADE PROFISSIONAL: a última porta antes de um vídeo chegar à titular.
 *
 * Por que existe (causa raiz, P2.66-AUDITORIA-DOS-CONTROLES.md): o Quality Gate Comercial dava nota a partir de
 * metadados do roteiro e da montagem, começando em 100 e só descontando o que conseguia detectar. Tudo o que ele não
 * sabia medir (direção de arte, composição, naturalidade da voz, credibilidade…) ficava com nota cheia por ausência
 * de defeito detectado. Vídeos genéricos e repetitivos chegaram a 93–98.
 *
 * Regras desta barreira (não negociáveis):
 *  1. Sem NOTA GERAL. Cada item é APROVADO, REPROVADO ou NAO_VERIFICADO, sempre com a evidência ou o motivo.
 *  2. Nenhum item é aprovado por presunção. Sem evidência = NAO_VERIFICADO, e NAO_VERIFICADO impede a apresentação.
 *  3. Itens subjetivos (arte, composição, voz, interesse, credibilidade…) só passam com LAUDO de revisão do VÍDEO
 *     FINAL (mesmo sha256), feito por quem NÃO produziu o vídeo, com nota por item, justificativa e quadros citados.
 *     A titular não é revisora: ela aprova o que já passou aqui.
 *  4. Itens objetivos são medidos no arquivo final (variedade de cenas, legibilidade, pronúncia transcrita,
 *     loudness, decodificação, #publi, números conferidos com os fatos validados).
 *  5. Produto físico sem mídia do produto com direito comprovado = REPROVADO ("não comunica o produto"): é por isso
 *     que o formato "oferta sem imagem" ficou suspenso para produtos físicos (decisão da titular, 27/10/2026).
 */
import type { TextoNaTela } from './quality-gate-comercial'
import { conferirAfirmacoes, numerosPorExtenso, valorDeAlgarismos } from './afirmacoes-numericas'

export type StatusDoItem = 'APROVADO' | 'REPROVADO' | 'NAO_VERIFICADO'
export type Grupo = 'VISUAL' | 'AUDIOVISUAL' | 'COMERCIAL' | 'CONFORMIDADE'
export interface ItemDaBarreira { id: string; grupo: Grupo; titulo: string; status: StatusDoItem; evidencia: string | null; motivo: string }

/** Itens que nenhuma medição automática local consegue julgar com honestidade: exigem laudo independente. */
export const ITENS_DE_LAUDO = {
  impactoInicial: ['VISUAL', 'Impacto inicial'],
  direcaoDeArte: ['VISUAL', 'Direção de arte'],
  composicao: ['VISUAL', 'Composição visual'],
  qualidadeDasAnimacoes: ['VISUAL', 'Qualidade das animações/cenas'],
  identidadeDaMarca: ['VISUAL', 'Identidade da marca'],
  naturalidadeDaVoz: ['AUDIOVISUAL', 'Naturalidade da voz'],
  sincronizacao: ['AUDIOVISUAL', 'Sincronização imagem × fala'],
  qualidadeDaTrilha: ['AUDIOVISUAL', 'Qualidade da trilha'],
  despertaInteresse: ['COMERCIAL', 'Capacidade de despertar interesse'],
  clarezaDaOferta: ['COMERCIAL', 'Clareza da oferta'],
  coerenciaImagemNarracao: ['COMERCIAL', 'Coerência entre imagem e narração'],
  credibilidade: ['COMERCIAL', 'Credibilidade'],
  forcaDoCta: ['COMERCIAL', 'Força do CTA'],
  adequacaoPublicoPlataforma: ['COMERCIAL', 'Adequação ao público e à plataforma'],
} as const satisfies Record<string, readonly [Grupo, string]>
export type ItemDeLaudo = keyof typeof ITENS_DE_LAUDO

export interface LaudoDeRevisao {
  /** quem revisou: nome/identificador. Não pode ser o processo que produziu o vídeo. */
  revisor: string
  /** declaração explícita de que o revisor não produziu nem roteirizou este vídeo */
  independenteDaProducao: boolean
  /** sha256 do vídeo FINAL revisado (laudo de outro arquivo não vale) */
  sha256: string
  em: string
  itens: Partial<Record<ItemDeLaudo, { nota: 1 | 2 | 3 | 4 | 5; justificativa: string; quadros: number[] }>>
  /** P2.67: obrigatório. A confiança NÃO vem do laudo: vem do CADASTRO de revisores (ver RevisorConfiavel). */
  tipo?: 'IA' | 'HUMANO'
  /** versão da instrução/rubrica usada (o revisor por IA só vale na versão em que foi calibrado) */
  versaoDoPrompt?: string
  /** defeitos que o próprio revisor apontou (instante + descrição): qualquer um reprova */
  defeitos?: { instante: number; descricao: string }[]
  /** informativo; a barreira ignora a calibração declarada no laudo e usa só o cadastro */
  calibracao?: unknown
}

/**
 * P2.67 (revisão independente do código, achado 1): o laudo não pode se declarar confiável. Só vale revisor deste
 * CADASTRO: humano cadastrado por decisão da titular; IA só com calibração aprovada, na mesma versão de instrução e
 * dentro da validade. O cadastro é escrito pelo exame de calibração (IA) ou pela titular (humano), nunca pelo produtor.
 * Limite honesto: protege contra autoaprovação automática/acidental, não contra alguém com acesso ao computador
 * editar o cadastro de propósito.
 */
export interface RevisorConfiavel {
  revisor: string; tipo: 'IA' | 'HUMANO'
  cadastradoPelaTitularEm?: string | null
  calibracao?: { aprovada: boolean; em: string; validaAte: string; versaoDoPrompt: string; motivo: string } | null
}

export interface EvidenciasDoVideo {
  sha256: string
  /** duração do vídeo final (s): instantes citados no laudo precisam estar dentro dela */
  duracaoS?: number
  /** cadastro confiável de revisores (lido de fora do laudo) e o instante da avaliação (validade da calibração) */
  revisoresConfiaveis?: RevisorConfiavel[]
  agora?: string
  produtoFisico: boolean
  /** a mídia do produto aparece? com direito comprovado (ativo com origem/licença)? */
  midiaDoProduto: { aparece: boolean; direitosComprovados: boolean; evidencia?: string }
  /** worker/medir_variedade_visual.py no arquivo final */
  variedade?: { variedade: number; cenasDistintas: number; fundoFixo: number; quadros: number } | null
  /** textos com tamanho MEDIDO; sem tamanho = não verificado */
  textos?: TextoNaTela[] | null
  /** transcrição local de CADA fala do vídeo (pronuncia.mjs) */
  pronuncia?: { falas: { texto: string; aprovada: boolean; errosReais?: { esperado: string | null; ouvido: string | null }[] }[]; totalDeFalas: number } | null
  audio?: { lufs: number; picoDb: number; vozSobreTrilhaDb: number | null } | null
  tecnico?: { errosDeDecodificacao: number; largura: number; altura: number } | null
  publi?: { naTelaDesdeOInicio: boolean; naLegenda: boolean } | null
  /** P2.69+: TRECHOS do vídeo (textos na tela e falas, inteiros) × fatos validados da ficha — o contexto diz do que é cada número */
  afirmacoes?: { trechosDoVideo: string[]; fatosValidados: string[]; /** palavras do nome do produto também valem como contexto */ nomeDoProduto?: string } | null
  direitos?: { imagem: 'COMPROVADOS' | 'PROPRIOS_GERADOS' | 'SEM_COMPROVACAO'; audio: 'PROPRIA' | 'LICENCIADA' | 'SEM_LICENCA'; voz: 'TITULAR_COM_CONSENTIMENTO' | 'NEUTRA_LOCAL' | 'SEM_CONSENTIMENTO' } | null
  programa?: { linkOficialSemAlteracao: boolean | null; midiaCadastradaNoPrograma: boolean | null } | null
  canal?: { rotuloDeIaPrevisto: boolean | null; regrasConferidasEm: string | null } | null
  laudo?: LaudoDeRevisao | null
}

export const LIMITES_DA_BARREIRA = {
  // calibrado em 27/10 (worker/medir_variedade_visual.py): Emocionário v4 APROVADO = 0,122 / 11 cenas;
  // reprovados: Cordão v2 0,047 / 1 cena, Kappa v2 0,045 / 1 cena, Cordão v3 0,100 / 5 cenas.
  variedadeMin: 0.08, cenasDistintasMin: 8, fundoFixoMax: 0.1,
  legendaMinPx: 60, textoMinPx: 34, areaSeguraTopo: 220, areaSeguraBase: 1500,
  lufsAlvo: -14, lufsTolerancia: 1.5, picoMax: -1.0, vozSobreTrilhaMin: 10, vozSobreTrilhaMax: 18,
  notaMinimaDoLaudo: 4, justificativaMinCaracteres: 40,
} as const

export interface ResultadoDaBarreira {
  decisao: 'APTO_PARA_TITULAR' | 'REPROVADO' | 'NAO_APRESENTAVEL_NAO_VERIFICADO'
  itens: ItemDaBarreira[]
  reprovados: ItemDaBarreira[]
  naoVerificados: ItemDaBarreira[]
  resumo: string
}

/** "1.600" → 1600, "4,9" → 4.9, "4.9" → 4.9, "5 mil" → 5000, "+5 mil" → 5000: números como VALORES, comparáveis. */
export function numerosNormalizados(texto: string): string[] {
  return [...texto.matchAll(/(\d+(?:[.,]\d+)*)(\s*(mil\b|milh[aãõ]o\b|milh[oõ]es\b))?/gi)].map((m) => String(valorDeAlgarismos(m[1], m[3])))
}
// P2.69: números DITOS por extenso; P2.69+: cada número vinculado ao seu atributo (lib/afirmacoes-numericas.ts)
export { numerosPorExtenso }

export function avaliarBarreiraProfissional(e: EvidenciasDoVideo): ResultadoDaBarreira {
  const L = LIMITES_DA_BARREIRA
  const itens: ItemDaBarreira[] = []
  const add = (id: string, grupo: Grupo, titulo: string, status: StatusDoItem, evidencia: string | null, motivo: string) => itens.push({ id, grupo, titulo, status, evidencia, motivo })
  const nv = (id: string, grupo: Grupo, titulo: string, motivo: string) => add(id, grupo, titulo, 'NAO_VERIFICADO', null, motivo)

  // ── VISUAL (objetivos) ──
  if (e.produtoFisico && !(e.midiaDoProduto.aparece && e.midiaDoProduto.direitosComprovados)) {
    add('clarezaDoProduto', 'VISUAL', 'Clareza do produto', 'REPROVADO', e.midiaDoProduto.evidencia ?? null,
      e.midiaDoProduto.aparece ? 'O produto aparece, mas sem direito de uso comprovado.' : 'Produto físico que nunca aparece no vídeo: não comunica o produto (formato suspenso pela titular em 27/10/2026).')
  } else if (!e.midiaDoProduto.aparece) {
    nv('clarezaDoProduto', 'VISUAL', 'Clareza do produto', 'Produto não físico sem mídia própria: clareza depende do laudo.')
  } else if (!e.midiaDoProduto.direitosComprovados) {
    add('clarezaDoProduto', 'VISUAL', 'Clareza do produto', 'REPROVADO', e.midiaDoProduto.evidencia ?? null, 'A mídia do produto aparece sem direito de uso comprovado.')
  } else add('clarezaDoProduto', 'VISUAL', 'Clareza do produto', 'APROVADO', e.midiaDoProduto.evidencia ?? 'mídia do produto com direito comprovado', 'O produto real aparece, com direito comprovado.')

  if (!e.variedade) nv('variedadeDeCenas', 'VISUAL', 'Variedade de cenas', 'Variedade não medida no arquivo final.')
  else {
    const v = e.variedade, ev = `variedade ${v.variedade} · ${v.cenasDistintas}/${v.quadros} cenas distintas · fundo fixo ${v.fundoFixo}`
    const ok = v.variedade >= L.variedadeMin && v.cenasDistintas >= L.cenasDistintasMin && v.fundoFixo <= L.fundoFixoMax
    add('variedadeDeCenas', 'VISUAL', 'Variedade de cenas', ok ? 'APROVADO' : 'REPROVADO', ev, ok ? 'Cenas variadas.' : `Visualmente repetitivo (mín.: variedade ${L.variedadeMin}, ${L.cenasDistintasMin} cenas distintas, fundo fixo ≤ ${L.fundoFixoMax}).`)
  }

  if (!e.textos?.length || e.textos.some((t) => t.tamanhoPx === undefined)) nv('legibilidadeNoCelular', 'VISUAL', 'Legibilidade no celular', 'Tamanho dos textos não medido no vídeo final.')
  else {
    const ruins = e.textos.filter((t) => (t.tamanhoPx ?? 0) < (t.tipo === 'LEGENDA' ? L.legendaMinPx : L.textoMinPx) || t.topo < L.areaSeguraTopo || t.base > L.areaSeguraBase)
    add('legibilidadeNoCelular', 'VISUAL', 'Legibilidade no celular', ruins.length ? 'REPROVADO' : 'APROVADO', `${e.textos.length} textos medidos; menor ${Math.min(...e.textos.map((t) => t.tamanhoPx ?? 0))} px`,
      ruins.length ? `Textos pequenos ou fora da área segura: ${ruins.slice(0, 3).map((t) => `"${t.texto.slice(0, 20)}"`).join(', ')}.` : 'Todos os textos no tamanho mínimo e na área segura.')
  }

  // ── AUDIOVISUAL (objetivos) ──
  const p = e.pronuncia
  if (!p || p.falas.length < p.totalDeFalas || !p.totalDeFalas) nv('pronuncia', 'AUDIOVISUAL', 'Pronúncia', p ? `Só ${p.falas.length} de ${p.totalDeFalas} falas transcritas.` : 'Narração não transcrita: pronúncia não verificada.')
  else {
    const erradas = p.falas.filter((f) => !f.aprovada)
    add('pronuncia', 'AUDIOVISUAL', 'Pronúncia', erradas.length ? 'REPROVADO' : 'APROVADO', `${p.falas.length}/${p.totalDeFalas} falas transcritas localmente`,
      erradas.length ? `Erros de fala: ${erradas.flatMap((f) => (f.errosReais ?? []).map((x) => `"${x.esperado ?? '∅'}" → "${x.ouvido ?? '∅'}"`)).slice(0, 4).join(', ') || erradas.map((f) => f.texto.slice(0, 30)).join('; ')}.` : 'Todas as falas conferem com o texto.')
  }
  if (!e.audio) nv('volume', 'AUDIOVISUAL', 'Volume', 'Loudness não medido.')
  else if (e.audio.vozSobreTrilhaDb === null) nv('volume', 'AUDIOVISUAL', 'Volume', 'Relação voz × trilha não medida.')
  else {
    const a = e.audio, prob: string[] = []
    if (Math.abs(a.lufs - L.lufsAlvo) > L.lufsTolerancia) prob.push(`loudness ${a.lufs} LUFS`)
    if (a.picoDb > L.picoMax) prob.push(`pico ${a.picoDb} dBFS`)
    if (a.vozSobreTrilhaDb !== null && (a.vozSobreTrilhaDb < L.vozSobreTrilhaMin || a.vozSobreTrilhaDb > L.vozSobreTrilhaMax)) prob.push(`voz × trilha ${a.vozSobreTrilhaDb} dB`)
    add('volume', 'AUDIOVISUAL', 'Volume', prob.length ? 'REPROVADO' : 'APROVADO', `${a.lufs} LUFS, pico ${a.picoDb} dBFS, voz ${a.vozSobreTrilhaDb ?? '?'} dB acima da trilha`, prob.length ? prob.join('; ') : 'Dentro do padrão de plataforma.')
  }
  if (!e.tecnico) nv('ausenciaDeFalhas', 'AUDIOVISUAL', 'Ausência de falhas', 'Arquivo não verificado.')
  else add('ausenciaDeFalhas', 'AUDIOVISUAL', 'Ausência de falhas', e.tecnico.errosDeDecodificacao === 0 && e.tecnico.largura === 1080 && e.tecnico.altura === 1920 ? 'APROVADO' : 'REPROVADO',
    `${e.tecnico.largura}×${e.tecnico.altura}, ${e.tecnico.errosDeDecodificacao} erro(s) de decodificação`, 'Decodificação completa do arquivo final.')

  // ── CONFORMIDADE (objetivos) ──
  const d = e.direitos
  if (!d) nv('direitosDeImagemEAudio', 'CONFORMIDADE', 'Direitos de imagem e áudio', 'Cadeia de direitos não informada.')
  else {
    const ruim = d.imagem === 'SEM_COMPROVACAO' || d.audio === 'SEM_LICENCA' || d.voz === 'SEM_CONSENTIMENTO'
    add('direitosDeImagemEAudio', 'CONFORMIDADE', 'Direitos de imagem e áudio', ruim ? 'REPROVADO' : 'APROVADO', `imagem ${d.imagem}, áudio ${d.audio}, voz ${d.voz}`, ruim ? 'Item sem direito comprovado.' : 'Todos os ativos com origem/licença registrada.')
  }
  const af = e.afirmacoes
  if (!af) nv('afirmacoesVerificaveis', 'CONFORMIDADE', 'Afirmações verificáveis', 'Números do vídeo não conferidos com a ficha.')
  else {
    // P2.69+: VÍNCULO SEMÂNTICO — cada número (algarismo ou por extenso) com o atributo do seu contexto (nota, vendas,
    // avaliações, preço, LEDs…) precisa de um fato da ficha com o MESMO atributo e valor; a fonte entre parênteses não conta
    const c = conferirAfirmacoes(af.trechosDoVideo, af.fatosValidados, af.nomeDoProduto ?? '')
    add('afirmacoesVerificaveis', 'CONFORMIDADE', 'Afirmações verificáveis', c.semVinculo.length ? 'REPROVADO' : 'APROVADO', `${c.total} número(s) do vídeo vinculado(s) a ${af.fatosValidados.length} fato(s) com fonte`,
      c.semVinculo.length ? `Número sem frase correspondente na ficha (o vídeo tem de dizer o que a ficha diz): ${c.semVinculo.slice(0, 6).join('; ')}.` : 'Cada número mostrado/dito corresponde ao fato certo da ficha.')
  }
  if (!e.publi) nv('identificacaoPublicitaria', 'CONFORMIDADE', 'Identificação publicitária', 'Não verificada.')
  else add('identificacaoPublicitaria', 'CONFORMIDADE', 'Identificação publicitária', e.publi.naTelaDesdeOInicio && e.publi.naLegenda ? 'APROVADO' : 'REPROVADO', `#publi na tela desde o início: ${e.publi.naTelaDesdeOInicio}; na legenda: ${e.publi.naLegenda}`, 'CDC art. 36 / Guia CONAR / termos do programa.')
  const pg = e.programa
  if (!pg || pg.linkOficialSemAlteracao === null || pg.midiaCadastradaNoPrograma === null) nv('regrasDoPrograma', 'CONFORMIDADE', 'Regras do programa de afiliados', 'Falta confirmar link oficial sem alteração e/ou mídia cadastrada no programa.')
  else add('regrasDoPrograma', 'CONFORMIDADE', 'Regras do programa de afiliados', pg.linkOficialSemAlteracao && pg.midiaCadastradaNoPrograma ? 'APROVADO' : 'REPROVADO', `link oficial sem alteração: ${pg.linkOficialSemAlteracao}; mídia cadastrada: ${pg.midiaCadastradaNoPrograma}`, 'Termos do programa (ex.: ML 1.3 e 1.8).')
  const c = e.canal
  if (!c || c.rotuloDeIaPrevisto === null || !c.regrasConferidasEm) nv('regrasDoCanal', 'CONFORMIDADE', 'Regras do canal de publicação', 'Regras do canal não conferidas para esta peça.')
  else add('regrasDoCanal', 'CONFORMIDADE', 'Regras do canal de publicação', c.rotuloDeIaPrevisto ? 'APROVADO' : 'REPROVADO', `rótulo de IA previsto: ${c.rotuloDeIaPrevisto}; regras conferidas em ${c.regrasConferidasEm}`, 'Conteúdo com IA rotulado conforme o canal.')

  // ── LAUDO independente (itens subjetivos) ──
  const laudo = e.laudo
  const cad = laudo ? (e.revisoresConfiaveis ?? []).find((x) => x.revisor === laudo.revisor && x.tipo === laudo.tipo) : undefined
  const agora = e.agora ?? new Date().toISOString()
  const laudoInvalido = !laudo ? 'Sem laudo de revisão independente do vídeo final.'
    : !laudo.independenteDaProducao || /patrono|produtor|claude-produtor/i.test(laudo.revisor) ? 'Laudo feito por quem produziu o vídeo: não vale.'
    : laudo.tipo !== 'IA' && laudo.tipo !== 'HUMANO' ? 'Laudo sem o tipo do revisor (IA ou HUMANO).'
    : laudo.sha256 !== e.sha256 ? 'Laudo de outro arquivo (sha256 diferente do vídeo final).'
    // a confiança vem do CADASTRO, nunca do próprio laudo (achado 1 da revisão independente)
    : !cad ? `Revisor "${laudo.revisor}" fora do cadastro de revisores confiáveis.`
    : laudo.tipo === 'HUMANO' && !cad.cadastradoPelaTitularEm ? 'Revisor humano não cadastrado pela titular.'
    // re-revisão: versão da instrução OBRIGATÓRIA nas duas pontas; validade comparada como data (texto inválido não vale)
    : laudo.tipo === 'IA' && !(cad.calibracao?.aprovada && !!cad.calibracao.versaoDoPrompt && cad.calibracao.versaoDoPrompt === laudo.versaoDoPrompt
        && Number.isFinite(Date.parse(cad.calibracao.validaAte)) && Date.parse(cad.calibracao.validaAte) >= Date.parse(agora))
      ? `Revisor por IA sem calibração aprovada e válida para esta versão da instrução${cad.calibracao?.motivo ? ` (${cad.calibracao.motivo})` : ''}.` : null
  const dur = e.duracaoS ?? Infinity
  for (const [id, [grupo, titulo]] of Object.entries(ITENS_DE_LAUDO) as [ItemDeLaudo, readonly [Grupo, string]][]) {
    if (laudoInvalido) { nv(id, grupo, titulo, laudoInvalido); continue }
    const r = laudo!.itens[id]
    if (!r) { nv(id, grupo, titulo, 'Item ausente no laudo.'); continue }
    const notaValida = Number.isInteger(r.nota) && r.nota >= 1 && r.nota <= 5
    const quadrosValidos = Array.isArray(r.quadros) && r.quadros.length > 0 && r.quadros.every((q) => typeof q === 'number' && q >= 0 && q <= dur + 0.5)
    if (!notaValida || !quadrosValidos || typeof r.justificativa !== 'string' || r.justificativa.trim().length < L.justificativaMinCaracteres) { nv(id, grupo, titulo, 'Laudo com nota fora de 1–5, sem justificativa suficiente ou sem instantes válidos do vídeo: nota não aceita.'); continue }
    add(id, grupo, titulo, r.nota >= L.notaMinimaDoLaudo ? 'APROVADO' : 'REPROVADO', `laudo de ${laudo!.revisor} (${laudo!.em}): ${r.nota}/5, quadros ${r.quadros.join(', ')} s`, r.justificativa)
  }
  if (!laudoInvalido && laudo!.defeitos?.length) add('defeitosApontados', 'AUDIOVISUAL', 'Defeitos apontados pelo revisor', 'REPROVADO', `laudo de ${laudo!.revisor}`, laudo!.defeitos.slice(0, 4).map((x) => `${x.instante}s: ${x.descricao}`).join('; '))

  const reprovados = itens.filter((i) => i.status === 'REPROVADO'), naoVerificados = itens.filter((i) => i.status === 'NAO_VERIFICADO')
  const decisao = reprovados.length ? 'REPROVADO' : naoVerificados.length ? 'NAO_APRESENTAVEL_NAO_VERIFICADO' : 'APTO_PARA_TITULAR'
  const resumo = decisao === 'APTO_PARA_TITULAR' ? `Todos os ${itens.length} itens aprovados com evidência.`
    : `${reprovados.length} reprovado(s), ${naoVerificados.length} não verificado(s) de ${itens.length}. Não apresentar à titular.${reprovados.length ? ` Reprovados: ${reprovados.map((i) => i.titulo).join(', ')}.` : ''}`
  return { decisao, itens, reprovados, naoVerificados, resumo }
}
