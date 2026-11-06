'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BellRing, Menu } from 'lucide-react'
import { useSidebar } from './SidebarContext'
import { usePrecisaDeVoce } from '@/hooks/usePrecisaDeVoce'
import { SininhoBadge } from './SininhoBadge'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Torre de Controle',
  '/produtos': 'Produtos',
  '/produtos/novo': 'Novo Produto',
  '/produtos/imagens': 'Importar imagens (contingência)',
  '/oportunidades': 'Oportunidades',
  '/tiktok-metas': 'Metas TikTok Shop',
  '/publicacoes-assistidas': 'Publicações assistidas',
  '/torre': 'Torre de Controle',
  '/conteudos': 'Banco de Conteúdos',
  '/conteudo': 'Conteúdo',
  '/vendas-receita': 'Vendas & Receita',
  '/ferramentas': 'Ferramentas',
  '/conteudos/gerar': 'Gerar conteúdo (manual)',
  '/aprovacao': 'Aprovações',
  '/calendario': 'Calendário Editorial',
  '/relatorios': 'Relatórios',
  '/links': 'Links Dinâmicos',
  '/monetizacao': 'Canais de receita',
  '/integracoes': 'Integrações',
  '/precisa-de-voce': 'Precisa de você',
  '/video-seller': 'Patrono Video Seller',
  '/admin/usuarios': 'Usuários',
  '/whatsapp': 'WhatsApp em Massa',
  '/videos': 'Vídeos',
  '/programas': 'Meus Programas',
  '/vendas-comissoes': 'Resultados de vendas',
  '/admin/permissoes': 'Permissões',
  '/admin/saude': 'Saúde do sistema',
  '/conta': 'Minha Conta',
  '/conta/digital-twin': 'Digital Twin',
  '/integracoes/shopee': 'Shopee',
}

export function Header() {
  const pathname = usePathname()
  const { toggle } = useSidebar()
  const { total } = usePrecisaDeVoce()

  const title =
    PAGE_TITLES[pathname] ??
    // P2.17.13: a rota mais específica ganha (/conteudos/x ≠ /conteudo).
    Object.entries(PAGE_TITLES).filter(([key]) => pathname.startsWith(key + '/')).sort((a, b) => b[0].length - a[0].length)[0]?.[1] ??
    'Patrono Seller IA'

  return (
    <header className="h-14 shrink-0 border-b border-border flex items-center gap-3 px-4 lg:px-6">
      <button
        onClick={toggle}
        className="lg:hidden text-white/60 hover:text-white p-1 rounded-md hover:bg-white/5 transition-colors"
        aria-label="Abrir menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      <h1 className="flex-1 text-base font-semibold text-white">{title}</h1>
      {/* P2.17.11: no celular o menu fica escondido — o MESMO sininho aparece aqui. */}
      <Link href="/precisa-de-voce" className="lg:hidden relative p-1.5 text-white/80 hover:text-white" aria-label={`Precisa de você${total ? `: ${total}` : ''}`}>
        <BellRing className="w-5 h-5" />
        <SininhoBadge total={total} />
      </Link>
    </header>
  )
}
