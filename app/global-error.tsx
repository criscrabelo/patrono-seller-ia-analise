'use client'

// P2.15.3: última rede de segurança (erro no layout raiz). Sem CSS do app: estilos inline.
export default function ErroGeral({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b1020', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: 16 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <p style={{ fontSize: 18, fontWeight: 600 }}>O Patrono Seller encontrou um erro.</p>
          <p style={{ fontSize: 13, opacity: 0.75 }}>Nada foi publicado nem cobrado.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: '10px 18px', borderRadius: 8, border: 0, background: '#22c55e', color: '#04110a', fontWeight: 600, cursor: 'pointer' }}>Tentar de novo</button>
        </div>
      </body>
    </html>
  )
}
