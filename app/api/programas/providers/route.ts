import { NextResponse } from 'next/server'
import { exigirSessao } from '@/lib/sessao'
import { listarProviders } from '@/lib/affiliate-providers'
import { capacidadeOuDesconhecida } from '@/lib/affiliate-provider-capabilities'

// Catálogo de providers conhecidos (AffiliateProviderRegistry) + a
// capacidade real de cada um (AffiliateProviderCapability) — dado público,
// igual para todo mundo, sem nada específico da usuária. A UI/automação
// deve CONSULTAR isto, nunca hardcodar comportamento por plataforma.
// Ainda exige sessão só para manter o padrão "negar por padrão" do projeto.
export async function GET() {
  const session = await exigirSessao()
  if (session instanceof NextResponse) return session

  const providers = listarProviders().map((provider) => ({
    ...provider,
    capability: capacidadeOuDesconhecida(provider.id),
  }))

  return NextResponse.json(providers)
}
