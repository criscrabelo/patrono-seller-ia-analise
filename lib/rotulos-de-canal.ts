/**
 * P2.17.14 — Rótulos dos status de programa/canal, iguais em Meus Programas
 * e Canais de receita. "não cadastrado" só existe quando há registro que o
 * afirme; sem registro é "status não confirmado".
 */
import type { SituacaoDoCanal } from './resumos'

export const ROTULO_DO_CANAL: Record<SituacaoDoCanal, { rotulo: string; tom: 'ok' | 'atencao' | 'bloqueado' | 'neutro' }> = {
  CONECTADO: { rotulo: 'CONECTADO', tom: 'ok' },
  CADASTRO_CONFIRMADO: { rotulo: 'CADASTRO CONFIRMADO', tom: 'ok' },
  AGUARDANDO_CONEXAO: { rotulo: 'AGUARDANDO CONEXÃO', tom: 'atencao' },
  AGUARDANDO_APROVACAO: { rotulo: 'AGUARDANDO APROVAÇÃO', tom: 'atencao' },
  NAO_CONFIRMADO: { rotulo: 'STATUS NÃO CONFIRMADO', tom: 'neutro' },
  NAO_CADASTRADO: { rotulo: 'NÃO CADASTRADO', tom: 'neutro' },
}
