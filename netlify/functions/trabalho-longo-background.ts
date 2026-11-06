/**
 * P2.2 — Background Function: executa os trabalhos longos (até 15 min).
 *
 * O sufixo `-background` no nome do arquivo é o que a Netlify usa para
 * responder 202 na hora e deixar a execução seguir. Comprovado no plano
 * Free na P2.1 (50,3 s, concluída).
 *
 * Segurança: a URL é pública, mas só executa um `jobId` assinado com o
 * NEXTAUTH_SECRET deste ambiente — e, mesmo assinado, só o que estiver
 * PENDING e reservado no banco. Disparo repetido é inofensivo: o claim é
 * atômico e só um vence.
 */
import { disparoAutentico, executarTrabalhoLongo, ORCAMENTO_EM_SEGUNDO_PLANO_MS } from '../../lib/trabalho-longo'
import { EXECUTORES_REAIS } from '../../lib/trabalhos-longos'

export default async (req: Request): Promise<void> => {
  const corpo = (await req.json().catch(() => ({}))) as { jobId?: unknown; assinatura?: unknown }
  if (!disparoAutentico(corpo.jobId, corpo.assinatura)) {
    console.warn('[trabalho-longo-background] disparo sem assinatura válida — ignorado.')
    return
  }
  const r = await executarTrabalhoLongo(corpo.jobId as string, {
    executores: EXECUTORES_REAIS,
    orcamentoMs: ORCAMENTO_EM_SEGUNDO_PLANO_MS,
    modo: 'segundo-plano',
  })
  console.log(`[trabalho-longo-background] ${corpo.jobId}: ${r ? r.estado : 'não disponível (outro worker ou já tratado)'}`)
}
