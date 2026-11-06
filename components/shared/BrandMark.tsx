export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <div
      className="shrink-0 rounded-xl bg-gradient-to-br from-accent to-accent-dark flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" fill="none" style={{ width: size * 0.55, height: size * 0.55 }}>
        <path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="#0d0d28" />
      </svg>
    </div>
  )
}
