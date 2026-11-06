/**
 * P2.2 — Envio em massa no WhatsApp (Z-API), em segundo plano.
 *
 * Era a rota esperando 3 s entre números dentro da requisição: 11 números
 * já passavam dos 30 s. Agora o progresso é gravado NÚMERO A NÚMERO:
 *
 *   - antes de cada envio, `emEnvio = numero`;
 *   - depois, o resultado entra em `resultados[numero]`;
 *   - uma retomada que encontra `emEnvio` sem resultado marca aquele
 *     número como INCERTO e não reenvia — a mensagem pode ter chegado;
 *   - envio que voltou sem resposta (`incerto` do lib/whatsapp) também
 *     não é repetido.
 *
 * Número já tratado nunca recebe de novo dentro do mesmo trabalho.
 */
import { createHash } from 'node:crypto'
import { prisma } from '../prisma'
import { enviarTexto, enviarImagem, type ResultadoEnvio } from '../whatsapp'
import type { Desfecho, Execucao, ExecutorDeTrabalho } from '../trabalho-longo'
import { CODIGO_WHATSAPP_BLOQUEADO, envioDeWhatsappPermitido } from '../transferencia-internacional'

export interface PedidoDeEnvio {
  numeros: string[]
  mensagem: string
  imagemUrl?: string
  delayMs: number
}

/** Mínimo 1,5 s entre mensagens para não ser banido. */
export function intervaloEntreEnvios(delayMs: number | undefined): number {
  return Math.max(delayMs ?? 3000, 1500)
}

/**
 * Mesma lista + mesma mensagem + mesma imagem, no mesmo dia (UTC) = mesmo
 * envio. Clicar duas vezes não manda duas vezes; repetir a campanha amanhã
 * é outro envio. Quem precisa repetir no mesmo dia passa `chaveDoEnvio`.
 */
export function chaveDoEnvio(p: PedidoDeEnvio, agora: Date, chaveExplicita?: string | null): string {
  const base = chaveExplicita?.trim()
    ? `explicita|${chaveExplicita.trim()}`
    : `${[...p.numeros].sort().join(',')}|${p.mensagem}|${p.imagemUrl ?? ''}|${agora.toISOString().slice(0, 10)}`
  return `whatsapp:${createHash('sha256').update(base).digest('hex').slice(0, 32)}`
}

type Registro = Pick<ResultadoEnvio, 'ok' | 'erro' | 'incerto'>

export interface DependenciasDoEnvio {
  enviarTexto: typeof enviarTexto
  enviarImagem: typeof enviarImagem
}

const DEPENDENCIAS_REAIS: DependenciasDoEnvio = { enviarTexto, enviarImagem }

/** Margem para um envio + gravação antes de o orçamento acabar. */
const MARGEM_POR_ENVIO_MS = 15_000

function resumo(pedido: PedidoDeEnvio, resultados: Record<string, Registro>) {
  const lista = pedido.numeros
    .filter((n) => resultados[n])
    .map((numero) => ({ numero, ...resultados[numero] }))
  return {
    enviados: lista.filter((r) => r.ok).length,
    erros: lista.filter((r) => !r.ok && !r.incerto).length,
    incertos: lista.filter((r) => r.incerto).length,
    pendentes: pedido.numeros.length - lista.length,
    resultados: lista,
  }
}

export function executorDoEnvio(
  dep: DependenciasDoEnvio = DEPENDENCIAS_REAIS,
  env: Record<string, string | undefined> = process.env
): ExecutorDeTrabalho {
  return async (e: Execucao): Promise<Desfecho> => {
    // P2.11: trabalho que já estava na fila e chegou a uma hospedagem sem
    // mecanismo de transferência termina aqui, sem ler nem enviar números.
    const hospedagem = envioDeWhatsappPermitido(env)
    if (!hospedagem.permitido) {
      return {
        fim: 'falhou',
        erro: CODIGO_WHATSAPP_BLOQUEADO,
        resposta: { status: 403, corpo: { error: hospedagem.motivo, codigo: CODIGO_WHATSAPP_BLOQUEADO } },
      }
    }
    const ctx = e.trabalho.contexto
    const pedido = ctx.pedido as PedidoDeEnvio
    const resultados: Record<string, Registro> = { ...((ctx.resultados as Record<string, Registro>) ?? {}) }

    const integracao = await prisma.integracao.findUnique({
      where: { workspaceId_plataforma: { workspaceId: e.trabalho.workspaceId, plataforma: 'whatsapp' } },
    })
    if (!integracao || integracao.status !== 'conectado' || !integracao.accountId || !integracao.accessToken) {
      return {
        fim: 'falhou',
        erro: 'WhatsApp não configurado',
        resposta: { status: 400, corpo: { error: 'WhatsApp não configurado. Configure em Integrações.' } },
      }
    }
    const extra = (integracao.extraData ?? {}) as Record<string, string>
    const cfg = { instanceId: integracao.accountId, token: integracao.accessToken, clientToken: extra.clientToken }

    // A execução anterior morreu com uma mensagem no caminho.
    const emEnvio = typeof ctx.emEnvio === 'string' ? ctx.emEnvio : null
    if (emEnvio && !resultados[emEnvio]) {
      resultados[emEnvio] = {
        ok: false,
        incerto: true,
        erro: 'Envio interrompido sem confirmação. Não foi reenviado para não duplicar a mensagem.',
      }
      await e.salvar({ resultados, emEnvio: null })
    }

    const faltam = pedido.numeros.filter((n) => !resultados[n])
    for (let i = 0; i < faltam.length; i++) {
      if (e.restanteMs() < pedido.delayMs + MARGEM_POR_ENVIO_MS) {
        return {
          fim: 'continuar',
          resposta: { status: 202, corpo: { ok: false, processando: true, mensagem: 'Envio em andamento.', ...resumo(pedido, resultados) } },
        }
      }
      const numero = faltam[i]
      await e.salvar({ emEnvio: numero })
      // O workspace do trabalho é o que o gate usa para apurar o orçamento.
      const r = pedido.imagemUrl
        ? await dep.enviarImagem(cfg, { numero, imageUrl: pedido.imagemUrl, legenda: pedido.mensagem }, e.trabalho.workspaceId)
        : await dep.enviarTexto(cfg, { numero, mensagem: pedido.mensagem }, e.trabalho.workspaceId)
      resultados[numero] = { ok: r.ok, ...(r.erro ? { erro: r.erro } : {}), ...(r.incerto ? { incerto: true } : {}) }
      await e.salvar({ resultados, emEnvio: null })
      if (i < faltam.length - 1) await e.dormir(pedido.delayMs)
    }

    const final = resumo(pedido, resultados)
    if (final.incertos > 0) {
      // Os demais números foram tratados. Os incertos ficam para uma pessoa.
      return {
        fim: 'incerto',
        erro: `${final.incertos} envio(s) sem confirmação`,
        resposta: { status: 200, corpo: { ok: true, ...final } },
      }
    }
    return { fim: 'concluido', resposta: { status: 200, corpo: { ok: true, ...final } } }
  }
}
