import Link from 'next/link'
import { dadosInstitucionais } from '@/lib/institucional'

/**
 * Layout das páginas institucionais PÚBLICAS (/sobre, /privacidade, /termos).
 *
 * Sem sessão, sem dado de workspace, sem chamada a API: só texto. É
 * renderizado no servidor, então a razão social está no HTML que um crawler
 * recebe — não depende de JavaScript.
 */
export default function LayoutInstitucional({ children }: { children: React.ReactNode }) {
  const empresa = dadosInstitucionais()
  return (
    <div className="min-h-screen bg-primary-dark text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-4 py-5 flex items-center justify-between gap-4">
          <Link href="/sobre" className="font-bold text-lg">
            <span className="text-accent">{empresa.produto}</span>
          </Link>
          <nav className="flex gap-4 text-sm text-white/70">
            <Link href="/sobre" className="hover:text-white">Sobre</Link>
            <Link href="/privacidade" className="hover:text-white">Privacidade</Link>
            <Link href="/termos" className="hover:text-white">Termos</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>

      <footer className="border-t border-white/10">
        <div className="mx-auto max-w-3xl px-4 py-6 text-sm text-white/60 space-y-1">
          <p>
            {empresa.produto} é um produto da <strong className="text-white/80">{empresa.razaoSocial}</strong>.
          </p>
          {empresa.cnpj && <p>CNPJ {empresa.cnpj}</p>}
          <p>
            Contato: <a className="underline hover:text-white" href={`mailto:${empresa.contato}`}>{empresa.contato}</a>
          </p>
        </div>
      </footer>
    </div>
  )
}
