/**
 * P2.68 — PÁGINA DE LINKS OFICIAIS (Instagram e TikTok): um endereço só na bio, com um botão por campanha APROVADA.
 *
 * Regras dos programas respeitadas por construção:
 *  - o botão aponta DIRETO para o link oficial, IGUAL ao registrado no painel (ML 1.8: não encurtar nem alterar):
 *    sem redirecionador próprio, sem parâmetro acrescentado, só domínios oficiais de cada programa;
 *  - só entra campanha com aprovação da titular registrada (nada de link de campanha em teste);
 *  - divulgação publicitária no topo (#publi + aviso de comissão) e atributo rel="sponsored";
 *  - sem rastreador de terceiros: cliques e vendas vêm do painel oficial de cada programa.
 * Não altera bio nenhuma: gera o HTML estático; publicar (deploy) e trocar a bio são decisões da titular.
 */
import type { ProgramaDeAfiliados } from './ciclo-comercial'

export const DOMINIOS_OFICIAIS: Record<ProgramaDeAfiliados, RegExp[]> = {
  // só o encurtador oficial gerado no painel de afiliados (uma URL qualquer do site não é link de afiliada)
  MERCADO_LIVRE: [/^https:\/\/meli\.la\/[A-Za-z0-9]+$/],
  HOTMART: [/^https:\/\/go\.hotmart\.com\/[A-Za-z0-9]+(\?[^\s]*)?$/],
  SHOPEE: [/^https:\/\/s\.shopee\.com\.br\/[A-Za-z0-9]+$/],
  AMAZON: [/^https:\/\/amzn\.to\/[A-Za-z0-9]+$/],
  AWIN: [/^https:\/\/www\.awin1\.com\/cread\.php\?[^\s]+$/],
  // TikTok Shop: o produto é MARCADO no vídeo; link de afiliado em página externa não é o caminho do programa
  TIKTOK_SHOP: [],
}

export interface ItemDaPagina {
  campanhaId: string; programa: ProgramaDeAfiliados; titulo: string; detalhe: string; rotuloDoBotao: string
  /** link exatamente como está no registro oficial da campanha */
  link: string
  linkRegistrado: string
  aprovacaoDaTitular: { em: string; sha256DoVideo: string } | null
  /** sha256 do vídeo APTO na barreira desta campanha: a aprovação da titular tem de ser deste arquivo */
  sha256AptoNaBarreira: string | null
}

export function validarItem(i: ItemDaPagina): string[] {
  const erros: string[] = []
  if (!i.aprovacaoDaTitular) erros.push('campanha sem aprovação da titular registrada')
  else if (!i.sha256AptoNaBarreira || i.aprovacaoDaTitular.sha256DoVideo !== i.sha256AptoNaBarreira) erros.push('aprovação da titular não é do vídeo aprovado na barreira')
  if (i.link !== i.linkRegistrado) erros.push('link diferente do registrado no painel oficial (alteração proibida)')
  const dom = DOMINIOS_OFICIAIS[i.programa]
  if (!dom.length) erros.push(`${i.programa}: o caminho do programa é a marcação nativa, não página de links`)
  else if (!dom.some((re) => re.test(i.link))) erros.push('domínio/forma do link fora do padrão oficial do programa')
  if (/utm_|[?&](ref|src|redir|url)=/i.test(i.link) && i.programa !== 'HOTMART') erros.push('parâmetro acrescentado ao link')
  return erros
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function montarPaginaDeLinks(perfil: { nome: string; iniciais: string }, itens: ItemDaPagina[]): { html: string; aceitos: string[]; recusados: { campanhaId: string; erros: string[] }[] } {
  const recusados = itens.map((i) => ({ campanhaId: i.campanhaId, erros: validarItem(i) })).filter((x) => x.erros.length)
  const aceitos = itens.filter((i) => !recusados.some((r) => r.campanhaId === i.campanhaId))
  const cards = aceitos.map((i) => `<section class="item"><h2>${esc(i.titulo)}</h2><p>${esc(i.detalhe)}</p><a class="botao" href="${esc(i.link)}" rel="sponsored noopener" target="_blank">${esc(i.rotuloDoBotao)}</a></section>`).join('\n')
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(perfil.nome)} — links</title>
<style>:root{--f:#0b1220;--c:#131c2e;--t:#f5efe3;--s:#aab3c2;--o:#f5cd78;--v:#d63446}*{box-sizing:border-box}body{margin:0;background:var(--f);color:var(--t);font:16px/1.45 system-ui,sans-serif}main{max-width:480px;margin:0 auto;padding:28px 16px 48px}header{text-align:center}.logo{width:72px;height:72px;border-radius:50%;background:#f7c600;color:#111;display:grid;place-items:center;font-weight:900;margin:0 auto 10px}h1{font-size:20px;margin:0}.publi{display:inline-block;margin-top:10px;background:var(--v);color:#fff;font-weight:800;border-radius:999px;padding:4px 12px;font-size:13px}header p{color:var(--s);font-size:13px}.item{background:var(--c);border:1px solid #263248;border-radius:16px;padding:14px 16px;margin-top:12px}.item h2{font-size:16px;margin:0 0 4px}.item p{margin:0 0 10px;color:var(--s);font-size:13px}.botao{display:block;text-align:center;background:var(--o);color:#141821;font-weight:800;text-decoration:none;border-radius:999px;padding:12px}footer{margin-top:22px;color:var(--s);font-size:12px;text-align:center}</style></head>
<body><main><header><div class="logo">${esc(perfil.iniciais)}</div><h1>${esc(perfil.nome)}</h1><span class="publi">#publi</span>
<p>Links de afiliada: posso receber comissão pelas compras feitas por eles, sem custo extra para você. Preço, estoque e condições são os do anúncio oficial.</p></header>
${cards || '<p style="text-align:center;color:#aab3c2">Nenhuma campanha aprovada no momento.</p>'}
<footer>Conteúdos com narração por voz gerada por IA a partir da voz da titular, quando indicado no post.</footer></main></body></html>`
  return { html, aceitos: aceitos.map((i) => i.campanhaId), recusados }
}
