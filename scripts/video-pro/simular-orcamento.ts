// P2.42 — Simulação de orçamento mensal (30/100/300 vídeos APROVADOS), com refações e descartes. Puro, sem rede.
//   node node_modules/tsx/dist/cli.mjs scripts/video-pro/simular-orcamento.ts
import { MODELOS } from '../../lib/video-pro/catalogo'
import { simularMes, estimarExecucao, brl, CAMBIO_PADRAO, type PerfilDeVideo } from '../../lib/video-pro/orcamento'

const M = MODELOS
// Premissas conservadoras: 35% das tentativas refeitas (falha, moderação, reprovação na fidelidade), até 3 por trecho;
// 25% dos vídeos inteiros descartados (titular rejeita) e refeitos. O resto do vídeo (~27 s) é filmagem real + voz
// local montadas no FFmpeg, R$ 0.
const base = { tentativasMax: 3, taxaDeRefacao: 0.35, taxaDeFalhaDoFornecedor: 0.15, taxaDeDescarte: 0.25 }
const PERFIS: PerfilDeVideo[] = [
  { nome: 'Econômico — 2 fotos reais animadas (MiniMax H3 Turbo/fal, 5 s cada)', trechos: [{ modelo: M['fal-minimax-h3-turbo'], segundos: 5 }, { modelo: M['fal-minimax-h3-turbo'], segundos: 5 }], ...base },
  { nome: 'RECOMENDADO — 1 take real editado (Omni Flash, 8 s) + 1 foto real animada (Kling 2.5/fal, 5 s)', trechos: [{ modelo: M['google-omni-flash-720p'], segundos: 8 }, { modelo: M['fal-kling25-turbo-pro'], segundos: 5 }], ...base },
  { nome: 'Take horizontal → vertical (Luma reframe, 2 × 10 s)', trechos: [{ modelo: M['luma-ray32-reframe-720p'], segundos: 10 }, { modelo: M['luma-ray32-reframe-720p'], segundos: 10 }], ...base },
  { nome: 'Premium — take real transformado (Runway Aleph 2, 15 s) + 2 fotos (Gen-4 Turbo, 5 s)', trechos: [{ modelo: M['runway-aleph2'], segundos: 15 }, { modelo: M['runway-gen4-turbo'], segundos: 5 }, { modelo: M['runway-gen4-turbo'], segundos: 5 }], ...base },
]

console.log(`Câmbio R$ ${CAMBIO_PADRAO.brlPorUsd} (PTAX 19/10/2026) + ${CAMBIO_PADRAO.margem * 100}% (IOF + spread); refação ${base.taxaDeRefacao * 100}% (${base.taxaDeFalhaDoFornecedor * 100}% falha do fornecedor — reembolsada na Luma/Gemini — e ${(base.taxaDeRefacao - base.taxaDeFalhaDoFornecedor) * 100}% reprovação na fidelidade), até ${base.tentativasMax} tentativas; descarte ${base.taxaDeDescarte * 100}%.\n`)
console.log('| Perfil | por vídeo (esperado) | limite por execução sugerido | 30/mês esperado (pior) | 100/mês esperado (pior) | 300/mês esperado (pior) |')
console.log('|---|---|---|---|---|---|')
for (const p of PERFIS) {
  const [a, b, c] = [30, 100, 300].map((n) => simularMes(n, p))
  const limite = Math.max(...p.trechos.map((t) => estimarExecucao({ modelo: t.modelo, segundos: t.segundos, tentativasMax: p.tentativasMax, taxaDeRefacao: p.taxaDeRefacao }).piorCasoCentavos))
  console.log(`| ${p.nome} | ${brl(a.porVideoEsperadoCentavos)} | ${brl(limite)} | ${brl(a.esperadoCentavos)} (${brl(a.piorCasoCentavos)}) | ${brl(b.esperadoCentavos)} (${brl(b.piorCasoCentavos)}) | ${brl(c.esperadoCentavos)} (${brl(c.piorCasoCentavos)}) |`)
}
console.log('| Atual — só filmagem real + voz local (FFmpeg) | R$ 0,00 | — | R$ 0,00 | R$ 0,00 | R$ 0,00 |')
