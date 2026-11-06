import { Sidebar } from '@/components/shared/Sidebar'
import { Header } from '@/components/shared/Header'
import { SidebarProvider } from '@/components/shared/SidebarContext'
import { BarraDoCelular } from '@/components/shared/BarraDoCelular'
import { BoraBanner } from '@/components/shared/BoraBanner'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <Header />
          <main className="flex-1 overflow-y-auto p-4 lg:p-6">
            <BoraBanner />
            {children}
          </main>
          <BarraDoCelular />
        </div>
      </div>
    </SidebarProvider>
  )
}
