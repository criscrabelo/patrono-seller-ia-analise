'use client'

/**
 * P2.17.11 — O badge do sininho: número pequeno, bem visível; some com zero.
 * Só o número (sem outro elemento visual): fica sobre o ícone do sininho.
 */
export function SininhoBadge({ total }: { total: number }) {
  if (total <= 0) return null
  return (
    <span
      aria-label={`${total} pendência${total === 1 ? '' : 's'} em Precisa de você`}
      className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-danger text-white text-[10px] font-bold leading-none ring-2 ring-primary tabular-nums"
    >
      {total > 99 ? '99+' : total}
    </span>
  )
}
