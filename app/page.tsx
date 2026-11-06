import { redirect } from 'next/navigation'
import { HOME } from '@/lib/navegacao'

// P2.17.12: a Home é a Torre de Controle.
export default function Home() {
  redirect(HOME)
}
