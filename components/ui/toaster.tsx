'use client'

import { useToast } from '@/hooks/use-toast'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'flex items-start gap-3 rounded-xl border p-4 shadow-xl transition-all',
            toast.variant === 'destructive'
              ? 'border-danger/30 bg-danger/10 text-danger'
              : 'border-border bg-card text-foreground'
          )}
        >
          {toast.variant === 'destructive' ? (
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          ) : toast.variant === 'success' ? (
            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
          ) : (
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-400" />
          )}
          <div className="flex-1 min-w-0">
            {toast.title && <p className="text-sm font-medium">{toast.title}</p>}
            {toast.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{toast.description}</p>
            )}
          </div>
          <button
            onClick={() => dismiss(toast.id)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
