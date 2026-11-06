/**
 * P1.9.2 — O vídeo enviado pela dona serve como Reel?
 *
 * Lê o MP4 diretamente (ISO BMFF), sem FFmpeg e sem dependência nova: o
 * worker de produção não tem FFmpeg, e validar não pode depender dele.
 *
 * O que se verifica no ARQUIVO:
 *   - contêiner MP4/MOV (caixa `ftyp`);
 *   - duração entre 10 e 30 segundos (`mvhd`);
 *   - proporção 9:16, já considerando a rotação que o celular grava
 *     (matriz da `tkhd`: muito vídeo de celular é 1920×1080 "deitado" com
 *     rotação de 90°, e é exibido 1080×1920);
 *   - resolução mínima de 540×960;
 *   - vídeo H.264 (`avc1`/`avc3`) ou HEVC (`hvc1`/`hev1`);
 *   - áudio, se houver, em AAC (`mp4a`);
 *   - tamanho até 100 MB.
 *
 * O que NÃO dá para verificar no arquivo, e por isso vira DECLARAÇÃO
 * obrigatória de quem envia, gravada com a evidência:
 *   - que foi gravado pela própria dona;
 *   - que não há música de terceiros;
 *   - que não aparecem terceiros nem crianças.
 *
 * Os limites são regra NOSSA para o primeiro teste, mais estreitos que os
 * da plataforma de propósito. Puro: recebe bytes, devolve veredito.
 */

export const REGRAS_DO_REEL = {
  duracaoMinimaS: 10,
  duracaoMaximaS: 30,
  /** 9/16 = 0,5625. Tolerância para 1080×1918, 720×1282 e afins. */
  proporcaoAlvo: 9 / 16,
  toleranciaDeProporcao: 0.02,
  larguraMinima: 540,
  alturaMinima: 960,
  tamanhoMaximoBytes: 100 * 1024 * 1024,
  codecsDeVideo: ['avc1', 'avc3', 'hvc1', 'hev1'],
  codecsDeAudio: ['mp4a'],
} as const

/** O que só quem enviou pode afirmar. Todas obrigatórias. */
export const DECLARACOES_OBRIGATORIAS = [
  'gravadoPelaPropriaDona',
  'semMusicaDeTerceiros',
  'semTerceirosNemCriancas',
] as const
export type DeclaracaoDoReel = (typeof DECLARACOES_OBRIGATORIAS)[number]

export interface MetadadosDoMp4 {
  marca: string | null
  duracaoS: number | null
  /** Dimensões de EXIBIÇÃO, já com a rotação aplicada. */
  largura: number | null
  altura: number | null
  rotacaoGraus: number
  codecDeVideo: string | null
  codecDeAudio: string | null
  temAudio: boolean
}

export interface ValidacaoDoReel {
  valido: boolean
  problemas: string[]
  metadados: MetadadosDoMp4 | null
  tamanhoBytes: number
}

// ── Leitura das caixas ──────────────────────────────────────────────────

interface Caixa {
  tipo: string
  inicio: number
  /** Início do conteúdo, depois do cabeçalho. */
  dados: number
  fim: number
}

const CONTEINERES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])

function lerCaixas(buf: Buffer, inicio: number, fim: number): Caixa[] {
  const caixas: Caixa[] = []
  let p = inicio
  while (p + 8 <= fim) {
    let tamanho = buf.readUInt32BE(p)
    const tipo = buf.toString('latin1', p + 4, p + 8)
    let cabecalho = 8
    if (tamanho === 1) {
      if (p + 16 > fim) break
      const grande = buf.readBigUInt64BE(p + 8)
      if (grande > BigInt(Number.MAX_SAFE_INTEGER)) break
      tamanho = Number(grande)
      cabecalho = 16
    } else if (tamanho === 0) {
      tamanho = fim - p
    }
    if (tamanho < cabecalho || p + tamanho > fim) break
    caixas.push({ tipo, inicio: p, dados: p + cabecalho, fim: p + tamanho })
    p += tamanho
  }
  return caixas
}

function filha(buf: Buffer, pai: Caixa, tipo: string): Caixa | null {
  return lerCaixas(buf, pai.dados, pai.fim).find((c) => c.tipo === tipo) ?? null
}

function caminho(buf: Buffer, pai: Caixa, tipos: string[]): Caixa | null {
  let atual: Caixa | null = pai
  for (const t of tipos) {
    if (!atual) return null
    atual = filha(buf, atual, t)
  }
  return atual
}

/** `mvhd` → duração em segundos. */
function lerMvhd(buf: Buffer, c: Caixa): number | null {
  const versao = buf.readUInt8(c.dados)
  if (versao === 1) {
    const escala = buf.readUInt32BE(c.dados + 20)
    const duracao = Number(buf.readBigUInt64BE(c.dados + 24))
    return escala > 0 ? duracao / escala : null
  }
  const escala = buf.readUInt32BE(c.dados + 12)
  const duracao = buf.readUInt32BE(c.dados + 16)
  return escala > 0 ? duracao / escala : null
}

/** `tkhd` → largura, altura (16.16) e rotação pela matriz. */
function lerTkhd(buf: Buffer, c: Caixa): { largura: number; altura: number; rotacao: number } {
  const versao = buf.readUInt8(c.dados)
  // Depois de versão/flags (4): datas e duração mudam de tamanho na v1.
  const base = c.dados + 4 + (versao === 1 ? 32 : 20)
  // reservado(8) layer(2) alternate(2) volume(2) reservado(2) = 16
  const matriz = base + 16
  const a = buf.readInt32BE(matriz) / 65536
  const b = buf.readInt32BE(matriz + 4) / 65536
  const largura = buf.readUInt32BE(matriz + 36) / 65536
  const altura = buf.readUInt32BE(matriz + 40) / 65536
  const rotacao = ((Math.round((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360
  return { largura, altura, rotacao }
}

function lerHandler(buf: Buffer, trak: Caixa): string | null {
  const hdlr = caminho(buf, trak, ['mdia', 'hdlr'])
  if (!hdlr) return null
  return buf.toString('latin1', hdlr.dados + 8, hdlr.dados + 12)
}

function lerCodec(buf: Buffer, trak: Caixa): string | null {
  const stsd = caminho(buf, trak, ['mdia', 'minf', 'stbl', 'stsd'])
  if (!stsd) return null
  // versão/flags(4) + contagem(4), depois a primeira entrada: tamanho(4) + tipo(4).
  const entrada = stsd.dados + 8
  if (entrada + 8 > stsd.fim) return null
  return buf.toString('latin1', entrada + 4, entrada + 8)
}

/** Lê o que importa do MP4. `null` quando o arquivo não é um MP4 legível. */
export function lerMetadadosDoMp4(buf: Buffer): MetadadosDoMp4 | null {
  try {
    const topo = lerCaixas(buf, 0, buf.length)
    const ftyp = topo.find((c) => c.tipo === 'ftyp')
    const moov = topo.find((c) => c.tipo === 'moov')
    if (!ftyp || !moov) return null

    const marca = buf.toString('latin1', ftyp.dados, ftyp.dados + 4)
    const mvhd = filha(buf, moov, 'mvhd')
    const duracaoS = mvhd ? lerMvhd(buf, mvhd) : null

    let largura: number | null = null
    let altura: number | null = null
    let rotacaoGraus = 0
    let codecDeVideo: string | null = null
    let codecDeAudio: string | null = null

    for (const trak of lerCaixas(buf, moov.dados, moov.fim).filter((c) => c.tipo === 'trak')) {
      const handler = lerHandler(buf, trak)
      if (handler === 'vide' && codecDeVideo === null) {
        codecDeVideo = lerCodec(buf, trak)
        const tkhd = filha(buf, trak, 'tkhd')
        if (tkhd) {
          const t = lerTkhd(buf, tkhd)
          rotacaoGraus = t.rotacao
          const deitado = t.rotacao === 90 || t.rotacao === 270
          largura = Math.round(deitado ? t.altura : t.largura)
          altura = Math.round(deitado ? t.largura : t.altura)
        }
      } else if (handler === 'soun' && codecDeAudio === null) {
        codecDeAudio = lerCodec(buf, trak)
      }
    }

    return {
      marca,
      duracaoS,
      largura,
      altura,
      rotacaoGraus,
      codecDeVideo,
      codecDeAudio,
      temAudio: codecDeAudio !== null,
    }
  } catch {
    return null
  }
}

// ── O veredito ──────────────────────────────────────────────────────────

/** FUNÇÃO PURA. Todos os problemas de uma vez, não só o primeiro. */
export function validarReel(buf: Buffer): ValidacaoDoReel {
  const r = REGRAS_DO_REEL
  const problemas: string[] = []
  const tamanhoBytes = buf.length

  if (tamanhoBytes > r.tamanhoMaximoBytes) {
    problemas.push(`Arquivo com ${(tamanhoBytes / 1048576).toFixed(0)} MB — o limite é 100 MB.`)
  }

  const m = lerMetadadosDoMp4(buf)
  if (!m) {
    problemas.push('Não é um MP4 legível (faltam as caixas ftyp/moov).')
    return { valido: false, problemas, metadados: null, tamanhoBytes }
  }

  if (m.duracaoS === null) problemas.push('Duração não encontrada no arquivo.')
  else if (m.duracaoS < r.duracaoMinimaS || m.duracaoS > r.duracaoMaximaS) {
    problemas.push(`Duração de ${m.duracaoS.toFixed(1)} s — precisa ficar entre ${r.duracaoMinimaS} e ${r.duracaoMaximaS} s.`)
  }

  if (m.largura === null || m.altura === null || m.altura === 0) {
    problemas.push('Faixa de vídeo sem dimensões.')
  } else {
    const proporcao = m.largura / m.altura
    if (Math.abs(proporcao - r.proporcaoAlvo) > r.toleranciaDeProporcao) {
      problemas.push(
        `Proporção ${m.largura}×${m.altura} não é vertical 9:16${m.largura > m.altura ? ' — o vídeo está deitado' : ''}.`
      )
    }
    if (m.largura < r.larguraMinima || m.altura < r.alturaMinima) {
      problemas.push(`Resolução ${m.largura}×${m.altura} abaixo do mínimo de ${r.larguraMinima}×${r.alturaMinima}.`)
    }
  }

  if (!m.codecDeVideo) problemas.push('Nenhuma faixa de vídeo encontrada.')
  else if (!(r.codecsDeVideo as readonly string[]).includes(m.codecDeVideo)) {
    problemas.push(`Codec de vídeo "${m.codecDeVideo}" não aceito — use H.264 ou HEVC.`)
  }
  if (m.codecDeAudio && !(r.codecsDeAudio as readonly string[]).includes(m.codecDeAudio)) {
    problemas.push(`Codec de áudio "${m.codecDeAudio}" não aceito — use AAC, ou envie sem áudio.`)
  }

  return { valido: problemas.length === 0, problemas, metadados: m, tamanhoBytes }
}

/** As declarações faltantes. Vazio = todas feitas. */
export function declaracoesFaltando(d: Partial<Record<DeclaracaoDoReel, boolean>> | null | undefined): DeclaracaoDoReel[] {
  return DECLARACOES_OBRIGATORIAS.filter((k) => d?.[k] !== true)
}
