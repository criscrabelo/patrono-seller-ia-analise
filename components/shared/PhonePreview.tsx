import { Heart, MessageCircle, Bookmark, Share2 } from 'lucide-react'
import type { ReactNode } from 'react'

export function PhonePreview({
  videoUrl,
  label,
  badge,
  w = 150,
}: {
  videoUrl?: string | null
  label?: string
  badge?: ReactNode
  w?: number
}) {
  return (
    <div
      className="shrink-0 rounded-2xl p-1.5 bg-gradient-to-b from-secondary to-background border border-border shadow-md"
      style={{ width: w }}
    >
      <div className="relative rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '9 / 16' }}>
        {videoUrl ? (
          <video src={videoUrl} controls className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-center px-2">
            <p className="text-[10px] text-white/40">{label ?? 'Sem vídeo ainda'}</p>
          </div>
        )}
        {badge && <div className="absolute top-2 left-2">{badge}</div>}
        <div className="absolute right-2 bottom-3 flex flex-col gap-2.5 items-center text-white/85 pointer-events-none">
          <Heart className="w-4 h-4" />
          <MessageCircle className="w-4 h-4" />
          <Bookmark className="w-4 h-4" />
          <Share2 className="w-4 h-4" />
        </div>
      </div>
    </div>
  )
}
