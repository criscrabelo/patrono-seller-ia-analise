/**
 * P2.14.5.13.3 — estado da tela /oportunidades. Módulo PURO e sem imports:
 * é usado pelo componente do navegador, então não pode puxar Prisma, Next
 * ou qualquer código de servidor.
 */

/** Última coleta como a tela recebe (datas em ISO). */
export interface UltimaColetaNaTela {
  em: string
  avaliados: number
  apresentados: number
  bloqueados: number | null
}

export function ultimaColetaParaTela(r: { em: Date; avaliados: number; apresentados: number; bloqueados: number | null } | null): UltimaColetaNaTela | null {
  return r ? { em: r.em.toISOString(), avaliados: r.avaliados, apresentados: r.apresentados, bloqueados: r.bloqueados } : null
}

export type EstadoDaCuradoria =
  | 'NUNCA_COLETADO'
  | 'CATALOGO_VAZIO'
  | 'SEM_ELEGIVEIS'
  | 'CANDIDATOS_RESOLVIDOS'
  | 'COM_CANDIDATOS'

/** "X avaliados · Y apresentados · Z bloqueados" — os números reais da coleta. */
export function textoDoResumo(r: Pick<UltimaColetaNaTela, 'avaliados' | 'apresentados' | 'bloqueados'>): string {
  const bloqueados = r.bloqueados === null ? '—' : String(r.bloqueados)
  return `${r.avaliados} avaliados · ${r.apresentados} apresentados · ${bloqueados} bloqueados`
}

/**
 * FUNÇÃO PURA. O que a tela diz, separando "nunca coletou" de "coletou e
 * não havia produto" de "havia produto, mas nenhum elegível". A titular não
 * é obrigada a cadastrar nada: "Informar produto" é só uma alternativa.
 */
export function estadoDaCuradoria(p: { ultima: UltimaColetaNaTela | null; candidatosEmAberto: number }): {
  estado: EstadoDaCuradoria
  titulo: string
  detalhe: string
  resumo: string | null
} {
  const resumo = p.ultima ? textoDoResumo(p.ultima) : null
  if (p.candidatosEmAberto > 0) {
    return { estado: 'COM_CANDIDATOS', titulo: 'Candidatos encontrados.', detalhe: 'Escolha 1 para cadastrar — nada é gerado nem publicado aqui.', resumo }
  }
  if (!p.ultima) {
    return {
      estado: 'NUNCA_COLETADO',
      titulo: 'O Patrono ainda não avaliou o catálogo.',
      detalhe: 'Clique em “Atualizar candidatos” para o Patrono ranquear os produtos disponíveis.',
      resumo,
    }
  }
  if (p.ultima.avaliados === 0) {
    return {
      estado: 'CATALOGO_VAZIO',
      titulo: 'Ainda não há produtos disponíveis para o Patrono avaliar.',
      detalhe: 'Quando houver produtos no catálogo ou em uma fonte conectada, o Patrono selecionará automaticamente os melhores candidatos.',
      resumo,
    }
  }
  if (p.ultima.apresentados === 0) {
    return {
      estado: 'SEM_ELEGIVEIS',
      titulo: `O Patrono avaliou ${p.ultima.avaliados} produto(s), mas nenhum está elegível agora.`,
      detalhe: 'Produtos indisponíveis, bloqueados por compliance, já escolhidos ou descartados há menos de 30 dias não entram na seleção.',
      resumo,
    }
  }
  return {
    estado: 'CANDIDATOS_RESOLVIDOS',
    titulo: 'Os candidatos da última coleta já foram resolvidos.',
    detalhe: 'Clique em “Atualizar candidatos” para uma nova seleção.',
    resumo,
  }
}
