'use client'

import { useEffect, useRef } from 'react'

/**
 * Permite colar (Ctrl+V / Cmd+V) imagens e vídeos direto na página — útil pra
 * quem copia uma imagem do navegador, do WhatsApp ou de um print de tela.
 *
 * Só intercepta quando o que foi colado é ARQUIVO. Texto (ex.: colar uma URL
 * dentro de um input) continua funcionando normalmente.
 */
export function useColarArquivos(onArquivos: (files: File[]) => void, ativo = true) {
  // Guarda o callback num ref para não recriar o listener a cada render.
  const callbackRef = useRef(onArquivos)
  useEffect(() => {
    callbackRef.current = onArquivos
  }, [onArquivos])

  // Idem para "ativo": evita recriar o listener e permite ignorar o paste
  // enquanto a tela ainda carrega (senão o dado colado seria sobrescrito).
  const ativoRef = useRef(ativo)
  useEffect(() => {
    ativoRef.current = ativo
  }, [ativo])

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      if (!ativoRef.current) return
      const items = e.clipboardData?.items
      if (!items) return

      const arquivos: File[] = []
      for (const item of Array.from(items)) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (!file) continue
        if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
          arquivos.push(file)
        }
      }

      if (arquivos.length > 0) {
        e.preventDefault()
        callbackRef.current(arquivos)
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [])
}
