/** P2.17.22 — Gera o anexo em Markdown dos kits de conteúdo a partir do código (fonte única). Não toca banco. */
import { KITS_DE_AMOSTRAS, checarKit, legendaCompleta } from '../../lib/kits-de-amostras'
const out: string[] = []
for (const k of KITS_DE_AMOSTRAS) {
  const c = checarKit(k)
  out.push(`### ${k.produto}`, '', `- **Papéis:** ${k.papeis.join(' + ')}${k.campanha ? ` · **Campanha:** ${k.campanha}` : ''}`, `- **Objetivo:** ${k.objetivo}`, `- **Formato recomendado:** ${k.formatoRecomendado}`, `- **Duração:** ${k.duracaoRecomendada}`, `- **Exige uso real:** ${k.exigeUsoReal ? 'sim (só o roteiro marcado)' : 'não'} · **Exige demonstração:** ${k.exigeDemonstracao ? 'sim' : 'não'} · **Pode ser sem rosto:** ${k.podeSerFaceless ? 'sim' : 'não'}`, `- **Checagem automática:** depoimento ${c.depoimentos.length ? 'ENCONTRADO' : 'nenhum'} · claims ${c.claims.length ? c.claims.join(', ') : 'nenhum'} · Quality Gate ${c.qualityGate.map((q) => `${q.id}=${q.veredito}`).join(', ')}`, '')
  out.push('**Roteiros**', '')
  for (const r of k.roteiros) {
    out.push(`${k.roteiros.indexOf(r) + 1}. **${r.titulo}** (${r.estrutura}, ${r.duracaoSegundos} s, objetivo ${r.objetivo}${r.liberadoQuando === 'APOS_USO_REAL' ? ', **só depois do uso real — a fala é da titular**' : ''})`)
    out.push(`   - Gancho: “${r.hook}”`)
    for (const e of r.roteiro) out.push(`   - ${e.etapa}: ${e.texto}${e.textoNaTela ? ` _[tela: ${e.textoNaTela}]_` : ''}`)
    out.push(`   - CTA: ${r.cta}`)
  }
  out.push('', `**3 hooks:** ${k.hooks.map((h) => `“${h}”`).join(' · ')}`, '', `**2 CTAs:** ${k.ctas.join(' · ')}`, '', '**2 legendas (como vão ao ar):**', '')
  for (const l of k.legendas) out.push('```', legendaCompleta(k, l), '```')
  out.push('', `**Plano A/B:** ${k.planoAB.a} × ${k.planoAB.b} — mede ${k.planoAB.mede}. ${k.planoAB.regra}`, '', `**Mídia necessária:** ${k.midiaNecessaria.join('; ')}`, '', '**Cenas que a titular grava:**', ...k.cenasParaGravar.map((x) => `- ${x}`), '', `**Alternativa sem rosto:** ${k.alternativaFaceless ?? '—'}`, '', '**Riscos de claim:**', ...k.riscosDeClaim.map((x) => `- ${x}`))
  if (k.usosOperacionais) out.push('', '**Como equipamento de produção (POV dos demais produtos):**', ...k.usosOperacionais.map((x) => `- ${x}`))
  out.push('', '---', '')
}
console.log(out.join('\n'))
