'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react'

export function CarouselPreview({
  slides,
  badge,
  w = 150,
}: {
  slides: string[]
  badge?: ReactNode
  w?: number
}) {
  const [i, setI] = useState(0)
  const total = slides.length

  return (
    <div
      className="shrink-0 rounded-2xl p-1.5 bg-gradient-to-b from-secondary to-background border border-border shadow-md"
      style={{ width: w }}
    >
      <div className="relative rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '4 / 5' }}>
        {total > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={slides[i]} alt={`slide ${i + 1}`} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <p className="text-[10px] text-white/40">Sem imagens</p>
          </div>
        )}
        {badge && <div className="absolute top-2 left-2">{badge}</div>}
        {total > 1 && (
          <>
            <div className="absolute top-2 right-2 bg-black/55 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white flex items-center gap-1">
              <Layers className="w-2.5 h-2.5" />{i + 1}/{total}
            </div>
            <button
              onClick={() => setI((i - 1 + total) % total)}
              className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setI((i + 1) % total)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <div className="absolute bottom-2 left-0 right-0 flex gap-1 justify-center">
              {slides.map((_, k) => (
                <span
                  key={k}
                  className={`h-1 rounded-full transition-all ${k === i ? 'w-3.5 bg-white' : 'w-1.5 bg-white/50'}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
