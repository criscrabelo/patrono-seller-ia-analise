import Link from 'next/link'

// P2.15.3: 404 em português (antes, o padrão do Next em inglês).
export default function NaoEncontrada() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="card-stat max-w-md w-full text-center space-y-3">
        <p className="text-3xl font-bold text-white">404</p>
        <p className="text-sm text-white">Esta página não existe.</p>
        <p className="text-xs text-muted-foreground">O endereço pode ter mudado ou o link estar incompleto.</p>
        <Link href="/torre" className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-primary-dark hover:bg-accent-light">
          Ir para a Central
        </Link>
      </div>
    </main>
  )
}
