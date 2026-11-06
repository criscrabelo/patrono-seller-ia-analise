'use client'

import { useGuardModulo } from '@/hooks/useGuardModulo'
import { PainelAssistido } from '@/components/assistido/PainelAssistido'
import { PlanoDasDez } from '@/components/assistido/PlanoDasDez'

/** P2.17.10 — As 10 primeiras publicações reais: o Patrono faz, a titular aprova. */
export default function PublicacoesAssistidasPage() {
  useGuardModulo('oportunidades')
  return (
    <div className="space-y-4 w-full max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Publicações assistidas</h2>
        <p className="text-sm text-muted-foreground">
          O Patrono escolhe, gera e checa a qualidade. Você só aprova, pede ajuste ou rejeita. Nada é publicado sem a sua aprovação nas 10 primeiras.
        </p>
      </div>
      <PainelAssistido />
      <PlanoDasDez />
    </div>
  )
}
