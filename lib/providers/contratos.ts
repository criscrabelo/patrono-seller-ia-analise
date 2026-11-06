/**
 * P2.14.7 (Fase 0A) — Contratos de providers (catálogo, canal, mídia).
 *
 * O núcleo NUNCA conhece um fornecedor pelo nome: pede uma CAPACIDADE
 * ("gerar vídeo vertical 9:16, uso comercial") e o roteador escolhe entre
 * os providers registrados. Trocar o motor de vídeo = registrar outro
 * descritor; nada no Supervisor muda (item do Prompt Mestre sobre troca do
 * motor de vídeo).
 *
 * Escolha FAIL-CLOSED: só entra provider com licença comercial na lista
 * permitida, consentimento exigido presente, saúde OK e custo dentro do
 * permitido. Sem candidato → null (o chamador usa fallback determinístico
 * ou pede decisão à titular). Providers não decidem política.
 */

export type TipoDeProvider = 'CATALOGO' | 'CANAL' | 'MIDIA'

export type CapacidadeDeMidia = 'VIDEO_VERTICAL' | 'IMAGEM' | 'VOZ' | 'LEGENDA' | 'ROTEIRO'
export type CapacidadeDeCanal = 'PUBLICAR_VIDEO' | 'PUBLICAR_IMAGEM' | 'LER_METRICAS' | 'AGENDAR'
export type CapacidadeDeCatalogo = 'LISTAR_PRODUTOS' | 'LER_COMISSAO' | 'GERAR_LINK_AFILIADO'
export type Capacidade = CapacidadeDeMidia | CapacidadeDeCanal | CapacidadeDeCatalogo

export type Licenca = 'COMERCIAL' | 'COMERCIAL_COM_ATRIBUICAO' | 'NAO_COMERCIAL' | 'DESCONHECIDA'
export type Saude = 'OK' | 'DEGRADADO' | 'FORA'

export interface DescritorDeProvider {
  id: string
  tipo: TipoDeProvider
  capacidades: Capacidade[]
  licenca: Licenca
  /** Custo estimado por operação, em centavos. 0 = gratuito/local. */
  custoEstimadoCentavos: number
  /** Ex.: 'USO_DE_IMAGEM_DA_TITULAR', 'CLONAGEM_DE_VOZ'. */
  consentimentosExigidos: string[]
  /** Somente API oficial; scraping é proibido por contrato. */
  oficial: true
  /** Precisa de credencial do cofre (nunca em texto puro). */
  exigeCredencial: boolean
}

export interface PedidoDeCapacidade {
  capacidade: Capacidade
  licencasPermitidas: Licenca[]
  consentimentosConcedidos: string[]
  custoMaximoCentavos: number
  saude: (providerId: string) => Saude
}

export class RegistroDeProviders {
  private readonly porId = new Map<string, DescritorDeProvider>()

  registrar(d: DescritorDeProvider): void {
    if (this.porId.has(d.id)) throw new Error(`Provider duplicado: ${d.id}`)
    if (d.oficial !== true) throw new Error(`Provider ${d.id} não é integração oficial.`)
    if (!Number.isInteger(d.custoEstimadoCentavos) || d.custoEstimadoCentavos < 0) throw new Error(`Custo inválido em ${d.id}.`)
    this.porId.set(d.id, Object.freeze({ ...d, capacidades: [...d.capacidades], consentimentosExigidos: [...d.consentimentosExigidos] }))
  }

  listar(): DescritorDeProvider[] {
    return [...this.porId.values()]
  }

  /** Mais barato elegível; empate por id (determinístico). */
  escolher(p: PedidoDeCapacidade): { provider: DescritorDeProvider | null; descartados: Array<{ id: string; motivo: string }> } {
    const descartados: Array<{ id: string; motivo: string }> = []
    const elegiveis = this.listar().filter((d) => {
      if (!d.capacidades.includes(p.capacidade)) return false
      if (!p.licencasPermitidas.includes(d.licenca)) return descartados.push({ id: d.id, motivo: `licença ${d.licenca}` }), false
      const falta = d.consentimentosExigidos.filter((c) => !p.consentimentosConcedidos.includes(c))
      if (falta.length) return descartados.push({ id: d.id, motivo: `falta consentimento: ${falta.join(', ')}` }), false
      if (d.custoEstimadoCentavos > p.custoMaximoCentavos) return descartados.push({ id: d.id, motivo: `custo ${d.custoEstimadoCentavos} > ${p.custoMaximoCentavos}` }), false
      const s = p.saude(d.id)
      if (s !== 'OK') return descartados.push({ id: d.id, motivo: `saúde ${s}` }), false
      return true
    })
    elegiveis.sort((a, b) => a.custoEstimadoCentavos - b.custoEstimadoCentavos || a.id.localeCompare(b.id))
    return { provider: elegiveis[0] ?? null, descartados }
  }
}
