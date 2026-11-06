'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import {
  RadioTower, CheckSquare, Package, Zap, Library, CheckCircle, Calendar, BarChart2, Video, LogOut,
  Plug, Link2, DollarSign, ImagePlus, Users, X, Facebook, Film, MessageCircle,
  SlidersHorizontal, HeartPulse, Handshake, Receipt, Sparkles, BellRing, Trophy, Wrench, Route,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePrecisaDeVoce } from '@/hooks/usePrecisaDeVoce'
import { SininhoBadge } from './SininhoBadge'
import { useModulosLiberados } from '@/hooks/useModulosLiberados'
import { useSidebar } from './SidebarContext'
import { BrandMark } from './BrandMark'
import { areasVisiveis, estadoDaNavegacao } from '@/lib/navegacao'

// P2.17.12: a árvore do menu mora em lib/navegacao.ts. Aqui só os ícones.
export const ICONES = {
  RadioTower, CheckSquare, Package, Zap, Library, CheckCircle, Calendar, BarChart2, Video, Plug, Link2,
  DollarSign, ImagePlus, Users, Film, MessageCircle, SlidersHorizontal, HeartPulse, Handshake, Receipt, Sparkles, BellRing, Trophy, Wrench, Route,
} as const
export const icone = (nome: string) => ICONES[nome as keyof typeof ICONES] ?? Package

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { total } = usePrecisaDeVoce()
  const { temAcesso } = useModulosLiberados()
  const { isOpen, close } = useSidebar()
  const areas = areasVisiveis(temAcesso)
  // P2.17.13: regra ÚNICA de estado ativo (pai + subitem), igual no desktop e no celular.
  const ativo = estadoDaNavegacao(pathname)

  return (
    <>
      {/* Overlay mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={close}
        />
      )}

    <aside className={cn(
      'fixed inset-y-0 left-0 z-40 w-64 shrink-0 flex flex-col bg-primary border-r border-border transition-transform duration-300',
      'lg:static lg:translate-x-0 lg:w-60',
      isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
    )}>
      {/* Logo */}
      <div className="flex items-center justify-between gap-2.5 px-4 py-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <BrandMark size={32} />
          <div>
            <p className="text-sm font-bold text-white leading-tight">Patrono Seller</p>
            <p className="text-[10px] text-accent font-semibold tracking-wider">IA</p>
          </div>
        </div>
        <button onClick={close} className="lg:hidden text-white/40 hover:text-white p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Nav — P2.17.13: 9 itens de primeiro nível, mesma tipografia; submenus só na área aberta */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto" aria-label="Menu principal">
        {areas.map((area) => {
          const Icon = icone(area.icone)
          const aberta = ativo.area === area.href
          return (
            <div key={area.href}>
              <Link href={area.destino} onClick={close} aria-current={aberta && !ativo.subitem ? 'page' : undefined} className={cn('sidebar-item', aberta && 'active')}>
                <span className="relative shrink-0">
                  <Icon className="w-4 h-4" />
                  {area.badge && <SininhoBadge total={total} />}
                </span>
                <span className="flex-1">{area.label}</span>
              </Link>
              {aberta && area.filhos.length > 0 && (
                <div className="ml-4 my-0.5 border-l border-border pl-2 space-y-0.5">
                  {area.filhos.map((f) => {
                    const FIcon = icone(f.icone)
                    const sub = ativo.subitem === f.href
                    return (
                      <Link key={f.href} href={f.href} onClick={close} aria-current={sub ? 'page' : undefined} className={cn('sidebar-subitem', sub && 'active')}>
                        <FIcon className="w-3.5 h-3.5 shrink-0" />
                        <span className="flex-1">{f.label}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3">
        <Link
          href="/conta"
          title="Minha conta"
          className={cn(
            'flex items-center gap-2.5 px-2 py-1.5 mb-1 rounded-md hover:bg-secondary/60 transition-colors',
            pathname.startsWith('/conta') && 'bg-secondary/60'
          )}
        >
          <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center">
            <span className="text-xs font-bold text-accent">
              {session?.user?.name?.[0] ?? 'A'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">
              {session?.user?.name ?? 'Usuário'}
            </p>
            <p className="text-[10px] text-white/40 truncate">{session?.user?.email}</p>
          </div>
        </Link>
        <a
          href="https://web.facebook.com/profile.php?id=61589588903488"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-white/50
                     hover:text-[#1877F2] hover:bg-[#1877F2]/10 transition-colors mb-0.5"
        >
          <Facebook className="w-3.5 h-3.5" />
          Siga-nos no Facebook
        </a>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-white/50
                     hover:text-danger hover:bg-danger/10 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sair
        </button>
      </div>
    </aside>
    </>
  )
}
