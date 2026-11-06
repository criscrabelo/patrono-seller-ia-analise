/**
 * P2.35 — FUNÇÃO PURA (roda no navegador). O link temporário do vídeo privado é de outro domínio (o storage):
 * o navegador ignora o atributo `download` e só ABRIRIA o vídeo. Com `&download=<nome>.mp4` o storage responde
 * `Content-Disposition: attachment` e o celular/computador SALVA o arquivo. Link que não é assinado (mídia pública
 * antiga) volta igual.
 */
export function linkParaBaixar(url: string, nomeDoProduto: string): string {
  if (!/\/storage\/v1\/object\/sign\//.test(url) || /[?&]download=/.test(url)) return url
  const nome = nomeDoProduto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'video'
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(`${nome}.mp4`)}`
}
