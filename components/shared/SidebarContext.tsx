'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

interface SidebarContextType {
  isOpen: boolean
  toggle: () => void
  close: () => void
}

const SidebarContext = createContext<SidebarContextType>({
  isOpen: false,
  toggle: () => {},
  close: () => {},
})

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  // P2.15.3: no celular, o menu fecha sozinho depois de trocar de página.
  useEffect(() => setIsOpen(false), [pathname])
  return (
    <SidebarContext.Provider value={{
      isOpen,
      toggle: () => setIsOpen((v) => !v),
      close: () => setIsOpen(false),
    }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => useContext(SidebarContext)
