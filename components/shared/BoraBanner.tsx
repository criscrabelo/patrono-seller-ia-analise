'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { HOME } from '@/lib/navegacao'
import { Indicador, type Tom } from './Ux'

/**
 * P2.17.13 — Identidade BoraComprar sem desperdiçar tela: banner completo só
 * na Torre (Home); nas demais páginas, uma faixa fina. Os indicadores dizem
 * SÓ o que é verdade agora (modo assistido, publicação automática, vídeos
 * em geração, TikTok aguardando integração) — nada de
 * "IA Gerando 24h" ou "Mais Vendas Automático" sem dado.
 */
interface StatusDoTopo {
  publicacaoAutomatica: 'PAUSADA' | 'LIGADA'
  assistido: { concluidas: number; limite: number; ativo: boolean }
  fila: 'GERANDO' | 'VAZIA'
  gerando: number
  iaPaga: 'LIGADA' | 'DESLIGADA'
  tiktok: string
}

function useStatusDoTopo() {
  const [s, setS] = useState<StatusDoTopo | null>(null)
  useEffect(() => {
    let vivo = true
    fetch('/api/resumos/status').then(async (r) => r.ok && vivo && setS(await r.json())).catch(() => null)
    return () => { vivo = false }
  }, [])
  return s
}

/**
 * P2.17.14 — Status ESPECÍFICOS (nunca um "automação pausada" genérico):
 * o que está pausado é a PUBLICAÇÃO automática; o modo assistido (o Patrono
 * executa, você aprova) segue ativo nas 10 primeiras. IA paga é status
 * técnico: fica em Integrações/detalhes, não no topo.
 */
export function indicadoresDoTopo(s: StatusDoTopo): { nome: string; estado: string; tom: Tom }[] {
  return [
    s.assistido.ativo
      ? { nome: 'Modo assistido', estado: `ativo · ${s.assistido.concluidas}/${s.assistido.limite}`, tom: 'ok' }
      : { nome: 'Publicação automática', estado: s.publicacaoAutomatica === 'PAUSADA' ? 'pausada' : 'ligada', tom: s.publicacaoAutomatica === 'PAUSADA' ? 'atencao' : 'ok' },
    ...(s.assistido.ativo ? [{ nome: 'Publicação automática', estado: s.publicacaoAutomatica === 'PAUSADA' ? 'pausada' : 'ligada', tom: 'neutro' as Tom }] : []),
    { nome: 'Vídeos', estado: s.fila === 'GERANDO' ? `gerando ${s.gerando}` : 'nenhum em geração', tom: s.fila === 'GERANDO' ? 'ok' : 'neutro' },
    { nome: 'TikTok', estado: s.tiktok === 'BLOQUEADO' ? 'aguardando integração' : s.tiktok === 'SEMIAUTOMATICO' ? 'rascunho' : 'conectado', tom: s.tiktok === 'BLOQUEADO' ? 'atencao' : 'ok' },
  ]
}

function LogoBoraComprar({ size = 56 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 200"
      width={size}
      height={size}
      style={{ flexShrink: 0 }}
    >
      {/* Fundo círculo amarelo */}
      <circle cx="100" cy="100" r="100" fill="#F5C000" />

      {/* ── CARRINHO ── */}
      {/* Cabo / alça do carrinho (linha grossa à esquerda) */}
      <line x1="22" y1="52" x2="46" y2="52" stroke="#111" strokeWidth="8" strokeLinecap="round" />

      {/* Cesto do carrinho — trapézio */}
      <path
        d="M46 52 L54 106 L148 106 L156 64 L50 64 Z"
        fill="none"
        stroke="#111"
        strokeWidth="7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Rodas */}
      <circle cx="74"  cy="119" r="9" fill="#F07820" stroke="#111" strokeWidth="5" />
      <circle cx="130" cy="119" r="9" fill="#F07820" stroke="#111" strokeWidth="5" />

      {/* ── SACOLA laranja dentro do carrinho ── */}
      {/* Corpo da sacola */}
      <rect x="58" y="44" width="70" height="64" rx="7" fill="#F07820" stroke="#111" strokeWidth="6" />
      {/* Alças da sacola (arco duplo) */}
      <path
        d="M74 44 Q74 26 93 26 Q112 26 112 44"
        fill="none"
        stroke="#111"
        strokeWidth="6"
        strokeLinecap="round"
      />

      {/* ── MÃO branca clicando ── */}
      {/* Palma */}
      <path
        d="M106 58
           L106 92
           Q106 104 118 104
           L138 104
           Q150 104 151 92
           L153 70
           Q153 61 145 61
           Q143 53 136 55
           Q134 47 127 50
           Q124 42 117 46
           L117 58 Z"
        fill="#FFFAEF"
        stroke="#111"
        strokeWidth="5.5"
        strokeLinejoin="round"
      />
      {/* Dedo indicador (retângulo arredondado) */}
      <rect x="112" y="38" width="11" height="36" rx="5.5" fill="#FFFAEF" stroke="#111" strokeWidth="5.5" />

      {/* Raios de clique ao redor da ponta do dedo */}
      <line x1="117" y1="30" x2="117" y2="24" stroke="#111" strokeWidth="4" strokeLinecap="round" />
      <line x1="128" y1="33" x2="132" y2="28" stroke="#111" strokeWidth="4" strokeLinecap="round" />
      <line x1="106" y1="33" x2="102" y2="28" stroke="#111" strokeWidth="4" strokeLinecap="round" />

      {/* ── TEXTO ── */}
      <text
        x="100"
        y="160"
        fontFamily="'Arial Black', 'Arial Bold', Arial, sans-serif"
        fontSize="22"
        fontWeight="900"
        textAnchor="middle"
        fill="#111111"
        letterSpacing="-0.8"
      >
        BoraComprar
      </text>
    </svg>
  )
}

export function BoraBanner() {
  const pathname = usePathname()
  const status = useStatusDoTopo()
  const completo = pathname === HOME
  if (!completo) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border px-3 py-1.5 select-none" aria-label="BoraComprar">
        <LogoBoraComprar size={22} />
        <span className="text-xs font-extrabold" style={{ color: '#F5C000' }}>BoraComprar</span>
        <div className="ml-auto hidden sm:flex flex-wrap gap-1.5">{status && indicadoresDoTopo(status).map((i) => <Indicador key={i.nome} {...i} />)}</div>
      </div>
    )
  }
  return (
    <div className="relative overflow-hidden rounded-xl mb-4 select-none">
      {/* Fundo gradiente navy */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(135deg, #1A1A3E 0%, #2a2a5e 45%, #1A1A3E 70%, #0d0d28 100%)',
        }}
      />

      {/* Círculos decorativos */}
      <div
        className="absolute -top-8 -right-8 w-40 h-40 rounded-full opacity-15"
        style={{ background: '#F5C000' }}
      />
      <div
        className="absolute -bottom-12 right-24 w-56 h-56 rounded-full opacity-10"
        style={{ background: '#F5C000' }}
      />

      {/* Faixa amarela superior */}
      <div
        className="absolute top-0 left-0 right-0 h-1.5"
        style={{ background: 'linear-gradient(90deg, #F5C000, #ffd93d, #F5C000)' }}
      />

      {/* Conteúdo */}
      <div className="relative z-10 flex items-center justify-between px-5 py-3 gap-4">
        {/* Logomarca + tagline */}
        <div className="flex items-center gap-4">
          <div style={{ filter: 'drop-shadow(0 4px 14px rgba(245,192,0,0.45))' }}>
            <LogoBoraComprar size={60} />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span
                className="text-xl font-extrabold tracking-tight"
                style={{ color: '#F5C000' }}
              >
                BoraComprar
              </span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                style={{ background: '#F5C000', color: '#1A1A3E' }}
              >
                IA
              </span>
            </div>
            <p className="text-xs text-white/60 mt-0.5">
              Sua operação de vendas, trabalhando por você
            </p>
          </div>
        </div>

        {/* Status REAL (P2.17.13) */}
        <div className="hidden sm:flex flex-wrap justify-end gap-1.5 max-w-md">
          {status && indicadoresDoTopo(status).map((i) => <Indicador key={i.nome} {...i} />)}
        </div>
      </div>

      {/* Faixa amarela inferior */}
      <div
        className="absolute bottom-0 left-0 right-0 h-0.5 opacity-40"
        style={{ background: 'linear-gradient(90deg, transparent, #F5C000, transparent)' }}
      />
    </div>
  )
}
