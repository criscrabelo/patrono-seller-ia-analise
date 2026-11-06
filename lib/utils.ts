import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { formatarBRL } from './formato-moeda'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string) {
  return format(new Date(date), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
}

export function formatDateShort(date: Date | string) {
  return format(new Date(date), 'dd/MM/yyyy', { locale: ptBR })
}

export function formatDatetime(date: Date | string) {
  return format(new Date(date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

/**
 * Mantido para as telas que já o importam — a formatação em si mora em
 * `lib/formato-moeda.ts`, que é a única implementação de BRL do projeto e não
 * depende de nada de UI (o worker também a usa).
 */
export function formatCurrency(value: number) {
  return formatarBRL(value)
}

export function truncate(str: string, length: number) {
  if (str.length <= length) return str
  return str.slice(0, length) + '...'
}

export function copyToClipboard(text: string) {
  return navigator.clipboard.writeText(text)
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim()
}
