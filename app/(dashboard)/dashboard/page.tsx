import { redirect } from 'next/navigation'
import { HOME } from '@/lib/navegacao'

// P2.17.12: o Dashboard foi absorvido pela Torre de Controle (seção "Visão
// geral"). A rota continua viva — favoritos e links antigos caem na Torre.
export default function DashboardPage() {
  redirect(HOME)
}
