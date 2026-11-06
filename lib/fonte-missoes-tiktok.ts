/**
 * P2.17.5 — De onde o TikTok Mission Sync pode ler as missões/metas.
 *
 * Ordem obrigatória da titular:
 *   1. API oficial do TikTok Shop (se houver endpoint de missões);
 *   2. automação da interface web oficial com sessão da titular — SÓ se
 *      técnica e contratualmente permitida;
 *   3. nunca: scraping clandestino, endpoint privado, engenharia reversa,
 *      bypass de CAPTCHA/MFA, credencial exposta.
 * Se nada disso estiver disponível, o texto do print (revisado) é o FALLBACK.
 *
 * Este arquivo só DECLARA o estado de cada fonte, com a data da verificação.
 * Nada aqui chama o TikTok.
 */

export type FonteDeMissoes = 'API_OFICIAL' | 'AUTOMACAO_WEB' | 'TEXTO_REVISADO'

export type EstadoDaFonte =
  | { fonte: FonteDeMissoes; disponivel: true }
  | { fonte: FonteDeMissoes; disponivel: false; status: 'SEM_FONTE' | 'NAO_PERMITIDA' | 'EXIGE_TITULAR'; motivo: string }

/** Registro da verificação (diretriz: nunca afirmar regra/endpoint sem data e fonte). */
export const VERIFICACAO_DAS_FONTES = {
  data: '2026-10-11',
  apiOficial:
    'A documentação pública do TikTok Shop Partner Center (Affiliate Creator API) cobre perfil da criadora, vitrine, busca de colaborações abertas, amostras e pedidos de afiliado. Não há endpoint publicado de missões, metas ou recompensas de criadora.',
  automacaoWeb:
    'Os Termos de Serviço do TikTok proíbem extrair dados da plataforma com sistema automatizado ("bots") sem aprovação por escrito. Automatizar o Creator Center/Seller Center com a sessão da titular seria esse tipo de extração.',
}

/**
 * Estado da API oficial. Hoje: indisponível (sem endpoint publicado). Quando o
 * TikTok publicar um endpoint de missões, o leitor entra aqui — com o formato
 * confirmado pela documentação ou pela primeira resposta real, nunca por palpite.
 */
export function estadoDaApiOficial(): EstadoDaFonte {
  return {
    fonte: 'API_OFICIAL',
    disponivel: false,
    status: 'SEM_FONTE',
    motivo: `O TikTok ainda não oferece API oficial de missões para criadoras (verificado em ${VERIFICACAO_DAS_FONTES.data}). Nada foi lido nem alterado.`,
  }
}

/** Automação web: avaliada e recusada (Termos do TikTok). Não implementada. */
export function estadoDaAutomacaoWeb(): EstadoDaFonte {
  return {
    fonte: 'AUTOMACAO_WEB',
    disponivel: false,
    status: 'NAO_PERMITIDA',
    motivo: 'Automação do painel do TikTok com a sua sessão não é permitida pelos Termos do TikTok sem aprovação por escrito; por isso não foi implementada.',
  }
}

/** A fonte automática que o "Sincronizar metas agora" tenta, em ordem. */
export function melhorFonteAutomatica(): EstadoDaFonte {
  const oficial = estadoDaApiOficial()
  if (oficial.disponivel) return oficial
  const web = estadoDaAutomacaoWeb()
  if (web.disponivel) return web
  return oficial
}
