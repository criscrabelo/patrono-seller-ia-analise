import { NextResponse } from 'next/server'

/**
 * P2.15.3 — DESATIVADA (410). Nenhuma tela chama esta rota: os envios vão do
 * navegador direto ao Storage (lib/upload-midia.ts). Ela gravava em bucket
 * público sem lista de tipos permitidos — superfície sem uso, então fechada.
 * O código anterior está no histórico do git (commit a037147).
 */
export async function POST() {
  return NextResponse.json({ error: 'Esta rota foi desativada. Os envios de arquivo são feitos direto pela tela.' }, { status: 410 })
}
