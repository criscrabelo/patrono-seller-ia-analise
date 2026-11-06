import { cn } from '@/lib/utils'
import { STATUS_LABELS, STATUS_COLORS, type StatusConteudo } from '@/types'

interface StatusBadgeProps {
  status: StatusConteudo
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'badge-status text-white',
        STATUS_COLORS[status],
        className
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}
