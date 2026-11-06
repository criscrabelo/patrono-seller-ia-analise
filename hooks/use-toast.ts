'use client'

import { useState, useCallback } from 'react'

interface Toast {
  id: string
  title?: string
  description?: string
  variant?: 'default' | 'destructive' | 'success'
}

let toastListeners: Array<(toasts: Toast[]) => void> = []
let toastQueue: Toast[] = []

function notifyListeners() {
  toastListeners.forEach((fn) => fn([...toastQueue]))
}

export function toast(options: Omit<Toast, 'id'>) {
  const id = Math.random().toString(36).slice(2)
  const newToast: Toast = { id, ...options }
  toastQueue = [...toastQueue, newToast]
  notifyListeners()
  setTimeout(() => {
    toastQueue = toastQueue.filter((t) => t.id !== id)
    notifyListeners()
  }, 4000)
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const subscribe = useCallback(() => {
    const fn = (t: Toast[]) => setToasts(t)
    toastListeners.push(fn)
    return () => {
      toastListeners = toastListeners.filter((l) => l !== fn)
    }
  }, [])

  useState(() => {
    return subscribe()
  })

  const dismiss = useCallback((id: string) => {
    toastQueue = toastQueue.filter((t) => t.id !== id)
    notifyListeners()
  }, [])

  return { toasts, dismiss }
}
