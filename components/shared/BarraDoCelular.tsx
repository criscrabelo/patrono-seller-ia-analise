'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePrecisaDeVoce } from '@/hooks/usePrecisaDeVoce'
import { useModulosLiberados } from '@/hooks/useModulosLiberados'
import { BARRA_DO_CELULAR, estadoDaNavegacao, visiveis } from '@/lib/navegacao'
import { SininhoBadge } from './SininhoBadge'
import { useSidebar } from './SidebarContext'
import { icone } from './Sidebar'

/**
 * P2.17.12 — no celular, o essencial fica embaixo do polegar: Torre, o
 * sininho (Precisa de você) e Vendas. Todo o resto em "Mais" (abre o menu).
 * A próxima ação real aparece no topo da Torre.
 */
export function BarraDoCelular() {
  const pathname = usePathname()
  const { total } = usePrecisaDeVoce()
  const { temAcesso } = useModulosLiberados()
  const { toggle } = useSidebar()
  // P2.17.13: a mesma regra de estado ativo da Sidebar (ex.: /monetizacao acende "Receita").
  const ativo = estadoDaNavegacao(pathname)
  return (
    <nav className="lg:hidden shrink-0 border-t border-border bg-primary grid grid-cols-5" aria-label="Navegação principal do celular">
      {visiveis(BARRA_DO_CELULAR, temAcesso, false).map((i) => {
        const Icon = icone(i.icone)
        return (
          <Link key={i.href} href={i.href} aria-current={ativo.area === i.href ? 'page' : undefined} className={cn('flex flex-col items-center gap-0.5 py-2 text-[10px]', ativo.area === i.href ? 'text-accent' : 'text-white/60')}>
            <span className="relative"><Icon className="w-5 h-5" />{i.badge && <SininhoBadge total={total} />}</span>
            {i.label}
          </Link>
        )
      })}
      <button onClick={toggle} className="flex flex-col items-center gap-0.5 py-2 text-[10px] text-white/60" aria-label="Abrir menu completo">
        <MoreHorizontal className="w-5 h-5" />
        Mais
      </button>
    </nav>
  )
}
