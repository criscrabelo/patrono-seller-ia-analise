/**
 * P2.117 — NARRAÇÃO PROFISSIONAL LICENCIADA (Azure Speech), recurso reutilizável para qualquer produto.
 *
 * Arquitetura P2.87, ajustada à documentação oficial conferida em 31/10/2026:
 *   - voz principal: `pt-BR-Thalita:DragonHDLatestNeural` (Neural HD). Reserva: `pt-BR-ThalitaNeural`
 *     (padrão) e `pt-BR-ThalitaMultilingualNeural`;
 *   - a HD só existe em algumas regiões (eastus, eastus2, westeurope, swedencentral, westus2,
 *     francecentral, centralindia, canadacentral, southeastasia). **brazilsouth NÃO tem HD**;
 *   - a HD (DragonHD) aceita `<break>`, `<phoneme>`, `<sub>`, `<say-as>`, `<lang>`, `<p>`, `<s>` e o
 *     parâmetro `temperature`; NÃO aceita `<prosody>`, `<emphasis>`, `express-as` nem `mstts:silence`;
 *   - preço por uso (API pública de preços, eastus): HD US$ 22 / 1 M caracteres; padrão US$ 15 / 1 M.
 *
 * Regras:
 *   - DESLIGADO por padrão: só sintetiza com `NARRACAO_AZURE_ATIVA=true` E chave + região presentes;
 *   - a chave nunca é registrada, impressa ou devolvida; vem do ambiente (arquivo fora do OneDrive / Netlify);
 *   - só vozes da lista autorizada (`VOZES_AUTORIZADAS`): nunca a voz da titular, nunca voz pessoal/clonada;
 *   - orçamento mensal travado em caracteres: ultrapassou, recusa ANTES de chamar a Azure;
 *   - cache por sha256(voz + SSML): o mesmo texto nunca é pago duas vezes;
 *   - só o TEXTO sai da máquina — nenhum áudio é enviado ao serviço.
 */
import { createHash } from 'node:crypto'

export type IdDaVoz = 'pt-BR-Thalita:DragonHDLatestNeural' | 'pt-BR-ThalitaNeural' | 'pt-BR-ThalitaMultilingualNeural'
export type IntencaoDaFrase = 'APRESENTACAO' | 'DEMONSTRACAO' | 'PROPOSTA' | 'CTA'

export interface VozAutorizada {
  provedor: 'AZURE'
  id: IdDaVoz
  hd: boolean
  licenca: string
  /** Escolha da voz pela titular (não aprova a versão HD por si só: a HD depende de avaliação auditiva). */
  aprovadaPelaTitularEm: string | null
  amostraSha256: string | null
}

const LICENCA = 'Voz pronta Azure Speech (Microsoft Product Terms); áudio gerado pode ser usado comercialmente pelo cliente.'
export const VOZES_AUTORIZADAS: Record<IdDaVoz, VozAutorizada> = {
  'pt-BR-Thalita:DragonHDLatestNeural': { provedor: 'AZURE', id: 'pt-BR-Thalita:DragonHDLatestNeural', hd: true, licenca: LICENCA, aprovadaPelaTitularEm: '2026-10-31', amostraSha256: null },
  'pt-BR-ThalitaNeural': { provedor: 'AZURE', id: 'pt-BR-ThalitaNeural', hd: false, licenca: LICENCA, aprovadaPelaTitularEm: '2026-10-31', amostraSha256: null },
  'pt-BR-ThalitaMultilingualNeural': { provedor: 'AZURE', id: 'pt-BR-ThalitaMultilingualNeural', hd: false, licenca: LICENCA, aprovadaPelaTitularEm: null, amostraSha256: null },
}

export const REGIOES_COM_HD = new Set(['eastus', 'eastus2', 'westus2', 'westeurope', 'swedencentral', 'francecentral', 'centralindia', 'canadacentral', 'southeastasia'])
export const PRECO_USD_POR_MILHAO = { HD: 22, PADRAO: 15 } as const
export const ORCAMENTO_MENSAL_PADRAO = 100_000 // caracteres; a cota gratuita F0 de vozes neurais é 500 mil/mês

export interface FrasesDoRoteiro { texto: string; intencao: IntencaoDaFrase }

export interface OpcoesDoSsml {
  voz: IdDaVoz
  /** Pausa depois de cada frase, por intenção (ms). HD aceita `<break>`, não `<prosody>`. */
  pausas?: Partial<Record<IntencaoDaFrase, number>>
  /** Pronúncia: palavra → IPA (`<phoneme>`), para corrigir palavras como "conversas". */
  fonemas?: Record<string, string>
  /** 0 a 1; menor = mais estável entre gerações (só HD). */
  temperatura?: number
}

const PAUSAS_PADRAO: Record<IntencaoDaFrase, number> = { APRESENTACAO: 450, DEMONSTRACAO: 400, PROPOSTA: 500, CTA: 0 }

const escaparXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** FUNÇÃO PURA. Roteiro marcado por intenção → SSML compatível com a voz (sem elementos que a HD rejeita). */
export function montarSsml(frases: FrasesDoRoteiro[], o: OpcoesDoSsml): string {
  if (!VOZES_AUTORIZADAS[o.voz]) throw new Error(`Voz fora da lista autorizada: ${o.voz}`)
  if (!frases.length) throw new Error('Roteiro vazio.')
  const hd = VOZES_AUTORIZADAS[o.voz].hd
  const pausas = { ...PAUSAS_PADRAO, ...(o.pausas ?? {}) }
  const fonemas = o.fonemas ?? {}
  // Uma passada só, sobre o texto CRU: chaves mais longas primeiro, trechos e palavras escapados separadamente
  // (sem aninhar <phoneme> nem casar dentro de tag ou entidade já inserida).
  const chaves = Object.keys(fonemas).filter(Boolean).sort((a, b) => b.length - a.length)
  const escRe = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const reFonema = chaves.length ? new RegExp(`(?<![\\p{L}])(${chaves.map(escRe).join('|')})(?![\\p{L}])`, 'giu') : null
  const ipaDe = (m: string) => fonemas[chaves.find((k) => k.toLocaleLowerCase('pt-BR') === m.toLocaleLowerCase('pt-BR')) ?? m]
  const corpo = frases.map((f, i) => {
    const cru = f.texto.replace(/\s+/g, ' ').trim()
    let t = ''
    let ultimo = 0
    if (reFonema) for (const m of cru.matchAll(reFonema)) {
      t += escaparXml(cru.slice(ultimo, m.index)) + `<phoneme alphabet="ipa" ph="${escaparXml(ipaDe(m[0]))}">${escaparXml(m[0])}</phoneme>`
      ultimo = m.index! + m[0].length
    }
    t += escaparXml(cru.slice(ultimo))
    const pausa = i < frases.length - 1 ? pausas[f.intencao] : 0
    return `<s>${t}</s>${pausa > 0 ? `<break time="${Math.round(pausa)}ms"/>` : ''}`
  }).join('')
  const temp = hd && o.temperatura != null && Number.isFinite(o.temperatura) ? ` parameters="temperature=${Math.min(1, Math.max(0, o.temperatura)).toFixed(2)}"` : ''
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="pt-BR"><voice name="${o.voz}"${temp}>${corpo}</voice></speak>`
}

/** FUNÇÃO PURA. Caracteres cobrados: a Azure cobra tudo o que está dentro de <voice>, inclusive as tags (só <speak> e <voice> ficam fora). */
export function caracteresCobrados(ssml: string): number {
  return ssml.replace(/^[\s\S]*?<voice[^>]*>/, '').replace(/<\/voice>[\s\S]*$/, '').length
}

/** FUNÇÃO PURA. Custo estimado em US$ fora da cota gratuita. */
export function custoEstimadoUsd(caracteres: number, hd: boolean): number {
  return (caracteres / 1_000_000) * (hd ? PRECO_USD_POR_MILHAO.HD : PRECO_USD_POR_MILHAO.PADRAO)
}

export const chaveDeCache = (voz: IdDaVoz, ssml: string) => createHash('sha256').update(`${voz}\n${ssml}`, 'utf8').digest('hex')

// ── Configuração e portas ───────────────────────────────────────────────

export interface ConfigDaAzure { ativa: boolean; chave: string | null; regiao: string | null; orcamentoMensal: number }

export function configDoAmbiente(env: Record<string, string | undefined> = process.env): ConfigDaAzure {
  const orc = Number(env.NARRACAO_AZURE_ORCAMENTO_MENSAL)
  return {
    ativa: env.NARRACAO_AZURE_ATIVA === 'true',
    chave: env.AZURE_SPEECH_KEY?.trim() || null,
    regiao: env.AZURE_SPEECH_REGION?.trim().toLowerCase() || null,
    orcamentoMensal: Number.isFinite(orc) && orc > 0 ? orc : ORCAMENTO_MENSAL_PADRAO,
  }
}

export interface PortasDaAzure {
  fetch: typeof fetch
  /** Caracteres já gastos no mês corrente (fonte: registro local de uso). */
  usoDoMes(): Promise<number>
  registrarUso(caracteres: number, voz: IdDaVoz): Promise<void>
  lerCache(chave: string): Promise<Buffer | null>
  gravarCache(chave: string, wav: Buffer): Promise<void>
}

export type ResultadoDaSintese =
  | { ok: true; wav: Buffer; caracteres: number; doCache: boolean; chave: string; custoUsd: number }
  | { ok: false; motivo: string; status?: number }

/** Explica um status HTTP da Azure em português, sem ecoar a chave nem o corpo bruto. */
export function motivoDoStatus(status: number, hd: boolean): string {
  if (status === 401) return 'A chave da Azure foi recusada (401): confira a chave e a região do recurso.'
  if (status === 403) return 'Acesso negado pela Azure (403): o recurso pode estar desativado ou sem permissão.'
  if (status === 400) return hd ? 'A Azure recusou o pedido (400): a voz HD pode não estar disponível nesta região ou neste plano, ou o SSML tem elemento não suportado.' : 'A Azure recusou o SSML (400).'
  if (status === 429) return 'Limite de uso atingido (429): cota gratuita ou de requisições esgotada. Nada foi cobrado além do plano.'
  return `A Azure respondeu ${status}.`
}

/** Sintetiza (ou devolve do cache). Recusa sem chamar a rede se desligado, sem chave, região sem HD ou acima do orçamento. */
export async function sintetizar(ssml: string, voz: IdDaVoz, cfg: ConfigDaAzure, portas: PortasDaAzure): Promise<ResultadoDaSintese> {
  const info = VOZES_AUTORIZADAS[voz]
  if (!info) return { ok: false, motivo: `Voz fora da lista autorizada: ${voz}` }
  if (!ssml.includes(`name="${voz}"`)) return { ok: false, motivo: 'O SSML não usa a voz pedida.' }
  const chave = chaveDeCache(voz, ssml)
  const caracteres = caracteresCobrados(ssml)
  const doCache = await portas.lerCache(chave)
  if (doCache) return { ok: true, wav: doCache, caracteres, doCache: true, chave, custoUsd: 0 }
  if (!cfg.ativa) return { ok: false, motivo: 'Narração Azure desligada (NARRACAO_AZURE_ATIVA não é "true").' }
  if (!cfg.chave || !cfg.regiao) return { ok: false, motivo: 'Recurso Azure Speech não configurado (falta chave ou região).' }
  if (info.hd && !REGIOES_COM_HD.has(cfg.regiao)) return { ok: false, motivo: `A região ${cfg.regiao} não oferece vozes HD. Use eastus, eastus2 ou westeurope.` }
  const usado = await portas.usoDoMes()
  if (usado + caracteres > cfg.orcamentoMensal) return { ok: false, motivo: `Orçamento mensal de ${cfg.orcamentoMensal} caracteres seria ultrapassado (usado: ${usado}, pedido: ${caracteres}).` }
  const resp = await portas.fetch(`https://${cfg.regiao}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': cfg.chave,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'riff-48khz-16bit-mono-pcm',
      'User-Agent': 'patrono-seller-narracao',
    },
    body: ssml,
  })
  if (!resp.ok) return { ok: false, motivo: motivoDoStatus(resp.status, info.hd), status: resp.status }
  const wav = Buffer.from(await resp.arrayBuffer())
  if (wav.length < 44 || wav.subarray(0, 4).toString('ascii') !== 'RIFF') return { ok: false, motivo: 'A Azure não devolveu um WAV válido.' }
  await portas.registrarUso(caracteres, voz)
  await portas.gravarCache(chave, wav)
  return { ok: true, wav, caracteres, doCache: false, chave, custoUsd: custoEstimadoUsd(caracteres, info.hd) }
}
