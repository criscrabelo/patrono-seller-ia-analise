/**
 * P2.12 — Limite de tamanho do bucket privado `digital-twin-private`.
 *
 * Fixa `file_size_limit` = 50 MB (52428800 bytes = o maior limite por tipo
 * do upload direto, LIMITE_DO_BUCKET_BYTES em lib/digital-twin-upload-direto.ts).
 * Mantém o bucket privado e não mexe em `allowed_mime_types`.
 *
 * Sem `--aplicar`: só mostra a configuração atual e o que mudaria.
 *
 *   node --env-file="$LOCALAPPDATA/PatronoSeller/teste/.env.digital-twin-test" scripts/limite-bucket-digital-twin.mjs
 *   node --env-file="$LOCALAPPDATA/PatronoSeller/teste/.env.digital-twin-test" scripts/limite-bucket-digital-twin.mjs --aplicar
 *
 * PRODUÇÃO (só no go-live, por decisão explícita): exige
 * PATRONO_REF_DO_BANCO_DE_PRODUCAO no ambiente E `--confirmo-producao`.
 * Sem a referência, o script não sabe o que é produção e recusa aplicar.
 */
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'digital-twin-private'
const LIMITE_BYTES = 52428800

const args = new Set(process.argv.slice(2))
const aplicar = args.has('--aplicar')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const refProd = (process.env.PATRONO_REF_DO_BANCO_DE_PRODUCAO ?? '').trim()

// Sem process.exit(): no Windows, sair com conexões do fetch abertas derruba o Node.
class Recusa extends Error {}
function sair(msg) {
  throw new Recusa(msg)
}

async function principal() {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) || !chave) sair('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente.')
  const ehProducao = refProd.length >= 8 && url.includes(refProd)
  const projeto = new URL(url).hostname.split('.')[0]
  console.log(`Projeto: ${projeto} (${ehProducao ? 'PRODUÇÃO' : refProd.length >= 8 ? 'não-produção' : 'desconhecido: PATRONO_REF_DO_BANCO_DE_PRODUCAO ausente'})`)

  const admin = createClient(url, chave)
  const { data: antes, error } = await admin.storage.getBucket(BUCKET)
  if (error || !antes) sair(`Bucket ${BUCKET} não encontrado: ${error?.message ?? 'sem dados'}`)
  console.log('Atual:  ', JSON.stringify({ public: antes.public, file_size_limit: antes.file_size_limit, allowed_mime_types: antes.allowed_mime_types }))
  console.log('Alvo:   ', JSON.stringify({ public: false, file_size_limit: LIMITE_BYTES, allowed_mime_types: antes.allowed_mime_types }))

  if (antes.public) sair('O bucket está PÚBLICO. Pare e investigue antes de qualquer outra coisa.')
  if (!aplicar) {
    console.log(antes.file_size_limit === LIMITE_BYTES ? 'Já aplicado. Nada a fazer.' : 'Ensaio: nada alterado. Use --aplicar.')
    return
  }
  if (refProd.length < 8) sair('Recusado: sem PATRONO_REF_DO_BANCO_DE_PRODUCAO não dá para saber se este projeto é a produção.')
  if (ehProducao && !args.has('--confirmo-producao')) sair('Recusado: este projeto é a PRODUÇÃO. Só no go-live, com --confirmo-producao.')
  if (antes.file_size_limit === LIMITE_BYTES) {
    console.log('Já aplicado. Nada a fazer.')
    return
  }

  const { error: erro } = await admin.storage.updateBucket(BUCKET, {
    public: false,
    fileSizeLimit: LIMITE_BYTES,
    allowedMimeTypes: antes.allowed_mime_types ?? undefined,
  })
  if (erro) sair(`Falha ao aplicar: ${erro.message}`)
  const { data: depois } = await admin.storage.getBucket(BUCKET)
  console.log('Depois: ', JSON.stringify({ public: depois?.public, file_size_limit: depois?.file_size_limit, allowed_mime_types: depois?.allowed_mime_types }))
  if (depois?.public !== false || depois?.file_size_limit !== LIMITE_BYTES) sair('Conferência falhou: o bucket não ficou como esperado.')
  console.log('Aplicado.')
}

try {
  await principal()
} catch (e) {
  console.error(e instanceof Recusa ? e.message : e)
  process.exitCode = 1
}
