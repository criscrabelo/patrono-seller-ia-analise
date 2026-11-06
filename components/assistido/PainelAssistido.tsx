'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { avisarMudancaNoPrecisaDeVoce } from '@/hooks/usePrecisaDeVoce'

/**
 * P2.17.10 — Modo assistido (10 primeiras publicações reais) + resultados.
 * O Patrono escolhe, gera e checa; a titular só APROVA, pede AJUSTE ou REJEITA.
 */

interface Etapa { etapa: string; texto: string; textoNaTela: string | null }
interface Versao { varianteId: string; estrutura: string; objetivo: string; gancho: string; roteiro: Etapa[]; cta: string; legenda: string; hashtags: string[]; disclosure: string; duracaoSegundos: number }
interface Apresentacao {
  produto: { nome: string; preco: number | null; comissaoTexto: string; link: string | null; tiktokShop: boolean; statusEconomico: string }
  motivoEscolha: string[]
  video: { arquivo: string | null; situacao: string; explicacao: string; midiaTipo?: string | null; midiaOrigem?: string | null; demonstracao?: boolean }
  versao: Versao
  textoNaTela: string[]
  canal: string
  horarioPlanejado: string
  horarioOrigem: string
  missoes: string[]
  produtoMarcado: string
  /** P2.18: o que gravar (kit da amostra ou lista genérica do formato). */
  cenasParaGravar?: string[] | null
}
interface QG { veredito: string; resumo: string; notas: Record<string, number>; motivos: string[] }
interface Item {
  id: string; ordem: number | null; estado: string; versao: number; nomeProduto: string; estrutura: string; apresentacao: Apresentacao; qualityGate: QG
  historico: { em: string; versao: number; acao: string; detalhe?: string }[]; aprovadoDePrimeira: boolean | null; objetivoDoTeste: string; vezesQueOProdutoApareceu: number
  horarioPlanejado: string | null; modoDePublicacao: string | null; bloqueio: string | null; erro: string | null; urlPublicada: string | null; publicadoEm: string | null
}
interface Painel {
  limite: number
  concluidas: number
  porEstado: Record<string, number>
  canal: { nivel: string; frase: string; bloqueios: { texto: string }[] }
  atual: { id: string } | null
  itens: Item[]
  relatorio: { final: boolean; recomendacao: string | null; motivos: string[]; aprovadasDePrimeira: number; ajustesPedidos: number; rejeicoes: number; falhas: number; intervaloMedioHoras: number | null }
}
interface Resultado {
  id: string; nomeProduto: string | null; estrutura: string; gancho: string; cta: string; publicadoEm: string; urlDoVideo: string | null
  views: number | null; retencaoMedia: number | null; tempoMedioSeg: number | null; cliquesProduto: number | null; adicoesCarrinho: number | null; vendas: number | null; comissao: number | null; receita: number | null
  derivadas: { ctr: number | null; conversaoCliqueVenda: number | null; vendasPor1000Views: number | null; receitaPor1000Views: number | null; receitaDoVideo: number | null }
  dna?: Dna
}
/** P2.21 — DNA criativo (UNKNOWN/null = o Patrono não sabe; nunca palpite). */
interface Dna {
  tipoDeGancho: string | null; confiancaDoGancho: string | null; tipoDeCta: string | null; formatoDoConteudo: string | null; tipoDeMidia: string | null; origemDaMidia: string | null
  temRosto: boolean | null; temDemonstracao: boolean | null; temNarracao: boolean | null; temTextoNaTela: boolean | null; origemDoDna: Record<string, string> | null
}
interface Recomendacao { acao: string; dimensao: string; grupo: string; nivel: string; orientaPlanejador: boolean; motivo: string }
interface Resultados {
  resultados: Resultado[]
  aprendizado: { dimensao: string; vencedor: string | null; recomendacao: string }[]
  aprendizadoCriativo?: { videosComparaveis: number; videosSemComissao: number; videosAbaixoDasViews: number; outliers: string[]; recomendacoes: Recomendacao[] }
  orientacao?: { motivos: string[] }
  produtos: { id: string; nome: string; status: string; motivos: string[] }[]
}

const NIVEL_TEXTO: Record<string, string> = { INSUFICIENTE: 'insuficiente', SINAL_INICIAL: 'sinal inicial', PADRAO_PROVAVEL: 'padrão provável', PADRAO_FORTE: 'padrão forte' }
const CAMPOS_DO_DNA = [['temRosto', 'Rosto'], ['temDemonstracao', 'Demonstração'], ['temNarracao', 'Narração'], ['temTextoNaTela', 'Texto na tela']] as const
const desconhecido = (s: string | null | undefined) => (!s || s === 'UNKNOWN' ? 'não sei' : s.toLowerCase().replace(/_/g, ' '))

const ESTADOS = [
  ['GERANDO', 'gerando'], ['PRONTO', 'pronto'], ['AGUARDANDO_MIDIA', 'aguardando mídia autorizada'], ['VIDEO_NA_FILA', 'vídeo na fila'], ['GERANDO_VIDEO', 'vídeo em geração'],
  ['VIDEO_FALHOU', 'geração do vídeo falhou'], ['AGUARDANDO_APROVACAO', 'aguardando sua aprovação'], ['APROVADO', 'aprovado'],
  ['PUBLICANDO', 'publicando'], ['PUBLICADO', 'publicado'], ['FALHOU', 'falhou'],
] as const
const reais = (v: number | null) => (v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`)
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

async function chamar(url: string, metodo: string, corpo?: unknown) {
  const r = await fetch(url, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(r.status === 401 ? 'Sua sessão expirou. Entre de novo.' : d.error ?? 'Não deu certo.')
  return d
}

export interface ItemParaAprovar {
  id: string
  versao: number
  apresentacao: Apresentacao
  qualityGate: QG
  objetivoDoTeste: string
  vezesQueOProdutoApareceu: number
  status?: { principal: string; videoGerado: boolean }
  contador?: string
  imagem?: string | null
  /** P2.17.12: APROVAR (com o MP4) · MIDIA (fornecer mídia autorizada) · DEMONSTRACAO (teste, não conta). */
  modo?: 'APROVAR' | 'MIDIA' | 'DEMONSTRACAO'
  /** P2.49/P2.51: os TRÊS controles + campanha (afiliação, direitos). Retida = a aprovação fica registrada, mas não libera. */
  liberacao?: { liberado: boolean; motivos: string[] } | null
}

const ORIGEM_DA_MIDIA: Record<string, string> = {
  PROPRIO: 'sua (própria)', LICENCIADO: 'licenciada', GERADO_PELO_PATRONO: 'gerada pelo Patrono', FORNECEDOR: 'do fornecedor', PLATAFORMA: 'da plataforma',
}

/**
 * P2.17.12 / P2.17.13 — Envio de mídia PROGRESSIVO: primeiro o arquivo;
 * depois "de onde veio" (é meu / tenho licença / outra origem); só então os
 * campos que aquela origem exige. O servidor grava quem declarou e quando e
 * classifica pela régua do preflight. Autorizada: o vídeo é gerado sozinho.
 */
function FormularioDeMidia({ ocupado, enviar }: { ocupado: boolean; enviar: (corpo: Record<string, unknown>) => Promise<void> }) {
  // P2.18: de 1 a 10 arquivos de uma vez — o vídeo usa todos, na ordem escolhida.
  const [arquivos, setArquivos] = useState<File[]>([])
  const arquivo = arquivos[0] ?? null
  const [origem, setOrigem] = useState<'PROPRIO' | 'LICENCIADO' | 'FORNECEDOR' | 'DESCONHECIDA' | null>(null)
  // P2.18.10: mídia do vendedor — indícios de direito de terceiro (a autorização geral da loja não cobre).
  const [indicios, setIndicios] = useState<string[]>([])
  const [titularidade, setTitularidade] = useState('')
  const [direito, setDireito] = useState('')
  const [descricao, setDescricao] = useState('')
  const [termo, setTermo] = useState('')
  const [decl, setDecl] = useState({ gravadoPelaPropriaDona: false, semMusicaDeTerceiros: false, semTerceirosNemCriancas: false })
  const [subindo, setSubindo] = useState(false)
  const ehVideo = arquivos.some((f) => f.type.startsWith('video/'))
  const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white'
  // "É meu": titular e direito já vêm preenchidos (você pode ajustar).
  const tit = origem === 'PROPRIO' ? titularidade.trim() || 'Titular da conta (eu)' : origem === 'FORNECEDOR' ? titularidade.trim() || 'Vendedor (loja do produto)' : titularidade.trim()
  const dir = origem === 'PROPRIO' ? direito.trim() || 'Uso nas minhas redes e nos vídeos do Patrono' : origem === 'FORNECEDOR' ? direito.trim() || 'Autorização do vendedor registrada no Patrono' : direito.trim()
  const completo =
    !!arquivo && !!origem && descricao.trim().length >= 3 && tit.length >= 3 && (origem === 'DESCONHECIDA' || dir.length >= 3) &&
    (origem !== 'LICENCIADO' || termo.trim().length >= 3) && (!(ehVideo && origem === 'PROPRIO') || Object.values(decl).every(Boolean))
  async function confirmar() {
    if (!arquivo || !origem) return
    setSubindo(true)
    try {
      const { enviarMidia } = await import('@/lib/upload-midia')
      const itens = []
      for (const [i, f] of arquivos.entries()) {
        const video = f.type.startsWith('video/')
        const url = await enviarMidia(f, 'midias-de-produto')
        itens.push({
          url, tipo: video ? 'VIDEO' : 'IMAGEM', origem, titularidade: tit, direitoDeUso: dir || 'não informado',
          descricao: arquivos.length > 1 ? `${descricao} (${i + 1}/${arquivos.length})` : descricao,
          termoDeLicenca: origem === 'LICENCIADO' ? termo : null, declaracoes: video && origem === 'PROPRIO' ? decl : null,
          indicios: origem === 'FORNECEDOR' ? indicios : null,
        })
      }
      await enviar({ itens })
    } catch (e) {
      toast({ title: 'Não consegui enviar o arquivo', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSubindo(false)
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-xs" aria-label="Enviar mídia autorizada">
      <p className="text-white font-medium">1. Enviar fotos ou vídeos do produto (de 1 a 10; o ideal são 3 ou mais)</p>
      <input type="file" multiple accept="image/*,video/*" className="text-white" onChange={(e) => setArquivos(Array.from(e.target.files ?? []).slice(0, 10))} />
      {arquivos.length > 1 && <p className="text-muted-foreground">{arquivos.length} arquivos: cada um vira um trecho do vídeo, nesta ordem.</p>}
      {arquivo && (
        <div className="space-y-2">
          <p className="text-white font-medium">2. De onde veio?</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Origem do arquivo">
            {([['PROPRIO', 'É meu'], ['LICENCIADO', 'Tenho licença'], ['FORNECEDOR', 'Do vendedor (autorizada)'], ['DESCONHECIDA', 'Outra origem']] as const).map(([v, rotulo]) => (
              <button key={v} type="button" role="radio" aria-checked={origem === v} onClick={() => setOrigem(v)} className={`rounded-full border px-3 py-1 ${origem === v ? 'border-accent text-accent' : 'border-border text-white/80'}`}>{rotulo}</button>
            ))}
          </div>
        </div>
      )}
      {arquivo && origem && (
        <div className="space-y-2">
          <p className="text-white font-medium">3. Confirmar</p>
          <input className={input} placeholder="O que é (ex.: foto da árvore montada na minha sala)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          {origem === 'PROPRIO' && (
            <>
              {ehVideo && (
                <div className="space-y-1 text-muted-foreground">
                  {([['gravadoPelaPropriaDona', 'Gravei eu mesma'], ['semMusicaDeTerceiros', 'Sem música de terceiros'], ['semTerceirosNemCriancas', 'Sem outras pessoas nem crianças']] as const).map(([k, rotulo]) => (
                    <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={decl[k]} onChange={(e) => setDecl({ ...decl, [k]: e.target.checked })} />{rotulo}</label>
                  ))}
                </div>
              )}
              <details className="text-muted-foreground">
                <summary className="cursor-pointer">Titular e direito de uso: {tit} · {dir}</summary>
                <input className={`${input} mt-1`} placeholder="Titular do arquivo" value={titularidade} onChange={(e) => setTitularidade(e.target.value)} />
                <input className={`${input} mt-1`} placeholder="Direito de uso" value={direito} onChange={(e) => setDireito(e.target.value)} />
              </details>
            </>
          )}
          {origem === 'LICENCIADO' && (
            <>
              <input className={input} placeholder="Titular do arquivo (quem licenciou)" value={titularidade} onChange={(e) => setTitularidade(e.target.value)} />
              <input className={input} placeholder="Direito de uso (o que a licença permite)" value={direito} onChange={(e) => setDireito(e.target.value)} />
              <input className={input} placeholder="Referência do termo de licença" value={termo} onChange={(e) => setTermo(e.target.value)} />
            </>
          )}
          {origem === 'FORNECEDOR' && (
            <div className="space-y-1 text-muted-foreground">
              <p>Só vale com a autorização do vendedor registrada ("MÍDIA DO VENDEDOR"). Sem ela, o arquivo fica bloqueado.</p>
              <p className="text-white/80">O arquivo tem algum destes? (a autorização geral da loja não cobre)</p>
              {([['CREATOR_TERCEIRO', 'Outro creator'], ['INFLUENCIADOR', 'Influenciador'], ['MUSICA_LICENCIADA', 'Música de terceiros'], ['MARCA_DE_TERCEIRO', 'Marca de terceiro'], ['NAO_PARECE_DA_LOJA', 'Não parece ser da loja']] as const).map(([k, rotulo]) => (
                <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={indicios.includes(k)} onChange={(e) => setIndicios(e.target.checked ? [...indicios, k] : indicios.filter((x) => x !== k))} />{rotulo}</label>
              ))}
            </div>
          )}
          {origem === 'DESCONHECIDA' && (
            <>
              <input className={input} placeholder="De quem é o arquivo" value={titularidade} onChange={(e) => setTitularidade(e.target.value)} />
              <p className="text-warning">Sem ser seu nem licenciado, o arquivo fica registrado como NÃO CONFIRMADO e não vira vídeo. Foto do vendedor ou do anúncio é bloqueada.</p>
            </>
          )}
          <Button size="sm" disabled={ocupado || subindo || !completo} onClick={confirmar}>{subindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}ENVIAR MÍDIA AUTORIZADA</Button>
        </div>
      )}
    </div>
  )
}

/**
 * P2.33.1 — NARRAÇÃO (opcional) antes de aprovar. A versão ORIGINAL nunca muda; a narrada é o mesmo vídeo
 * com a voz da titular, guardada no armazenamento PRIVADO. Ela ouve a prévia e escolhe a versão na aprovação.
 */
interface EstadoDaNarracaoNaTela {
  modo: 'GRAVACAO_REAL' | 'VOZ_LOCAL'; estado: string; utilizavel: boolean; motivo: string | null; texto: string | null; expiraEm: string
  qg: { veredito: string; problemas: string[] } | null; audioUrl: string | null; videoUrl: string | null
}
const DECLARACAO_DA_GRAVACAO = 'Esta gravação é da minha própria voz, feita por mim, e autorizo o seu uso como narração deste vídeo.'

function textoSugerido(v: Versao, nome: string) {
  const meio = v.roteiro.map((r) => r.texto.trim()).filter((t) => t && !/^(mostre|abra|compare|diga|feche|grave|filme|use)\b/i.test(t))
  return [v.gancho, nome, ...meio, v.cta].map((x) => x.trim().replace(/[.!?…]*$/, '')).filter(Boolean).join('. ') + '.'
}

function PainelDeNarracao({ id, versaoDoVideo, nome, versaoEscolhida, escolher, bloqueado }: { id: string; versaoDoVideo: Versao; nome: string; versaoEscolhida: 'ORIGINAL' | 'NARRADA'; escolher: (v: 'ORIGINAL' | 'NARRADA') => void; bloqueado: boolean }) {
  const [n, setN] = useState<EstadoDaNarracaoNaTela | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [declaro, setDeclaro] = useState(false)
  const [texto, setTexto] = useState(() => textoSugerido(versaoDoVideo, nome))
  const base = `/api/tiktok/assistido/${id}/narracao`
  const carregar = useCallback(async () => {
    const r = await fetch(base).catch(() => null)
    if (!r?.ok) return
    const d = (await r.json()) as { narracao: EstadoDaNarracaoNaTela | null }
    setN(d.narracao)
    if (!d.narracao?.utilizavel) escolher('ORIGINAL')
  }, [base, escolher])
  useEffect(() => { void carregar() }, [carregar])
  // Na fila do worker local: confere de novo a cada 15 s até a prévia ficar pronta.
  useEffect(() => {
    if (n?.estado !== 'NA_FILA') return
    const t = setInterval(() => { void carregar() }, 15_000)
    return () => clearInterval(t)
  }, [n?.estado, carregar])
  const erro = async (r: Response | null) => toast({ title: ((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Não consegui preparar a narração.', variant: 'destructive' })
  async function enviarGravacao(file: File) {
    setOcupado(true)
    try {
      const r = await fetch(`${base}/envio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mime: file.type, tamanho: file.size, declaro }) }).catch(() => null)
      if (!r?.ok) return erro(r)
      const d = (await r.json()) as { uploadUrl: string; contentType: string }
      const envio = await fetch(d.uploadUrl, { method: 'PUT', headers: { 'Content-Type': d.contentType, 'x-upsert': 'false' }, body: file }).catch(() => null)
      if (!envio?.ok) return toast({ title: 'Não consegui enviar a gravação.', variant: 'destructive' })
      const c = await fetch(`${base}/confirmar`, { method: 'POST' }).catch(() => null)
      if (!c?.ok) { await erro(c); return }
      toast({ title: 'Prévia narrada pronta: ouça antes de aprovar.' })
    } finally {
      setOcupado(false)
      await carregar()
    }
  }
  async function pedirVozLocal() {
    setOcupado(true)
    try {
      const r = await fetch(`${base}/voz-local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto }) }).catch(() => null)
      if (!r?.ok) return erro(r)
      toast({ title: 'Na fila: o seu computador gera a narração com a sua voz (o processador precisa estar ligado).' })
    } finally {
      setOcupado(false)
      await carregar()
    }
  }
  async function descartar() {
    setOcupado(true)
    try {
      const r = await fetch(base, { method: 'DELETE' }).catch(() => null)
      if (!r?.ok) return erro(r)
      escolher('ORIGINAL')
    } finally {
      setOcupado(false)
      await carregar()
    }
  }
  const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white'
  return (
    <details className="rounded-lg border border-border p-3 text-xs space-y-2" aria-label="Narração do vídeo" open={!!n && n.estado !== 'DESCARTADA'}>
      <summary className="cursor-pointer text-white font-medium">Narração com a sua voz (opcional)</summary>
      <p className="text-muted-foreground">O vídeo original continua igual. A versão narrada é o mesmo vídeo com a sua voz, guardada só para você; você ouve e escolhe na aprovação.</p>
      {n && n.estado !== 'DESCARTADA' && (
        <div className="space-y-1">
          <p className={n.utilizavel ? 'text-accent' : 'text-warning'}>
            {n.modo === 'VOZ_LOCAL' ? 'Voz gerada no seu computador' : 'Sua gravação'} · {n.estado === 'PREVIA_PRONTA' ? 'prévia pronta' : n.estado === 'NA_FILA' ? 'na fila do seu computador' : n.estado === 'AGUARDANDO_GRAVACAO' ? 'aguardando o envio' : n.estado === 'FALHOU' ? 'falhou' : n.estado}
            {n.qg ? ` · checagem do áudio: ${n.qg.veredito}` : ''}
          </p>
          {n.qg && n.qg.problemas.length > 0 && <ul className="list-disc pl-4 text-warning">{n.qg.problemas.map((p) => <li key={p}>{p}</li>)}</ul>}
          {n.motivo && !n.utilizavel && <p className="text-muted-foreground">{n.motivo}</p>}
          {n.videoUrl && <p className="text-muted-foreground">Versão narrada (compare com a original acima)</p>}
          {n.videoUrl && <video src={n.videoUrl} controls playsInline preload="metadata" className="w-full max-w-[200px] aspect-[9/16] rounded-lg bg-black" aria-label="Prévia narrada" />}
          {n.videoUrl && <a href={n.videoUrl} target="_blank" rel="noopener noreferrer" className="text-accent">Baixar o vídeo narrado (link vale 5 minutos)</a>}
          {n.modo === 'VOZ_LOCAL' && n.estado === 'PREVIA_PRONTA' && <p className="text-muted-foreground">Voz sintetizada: a legenda recebe o aviso de conteúdo gerado por IA, e no app ative o rótulo de IA ao publicar.</p>}
          <Button size="sm" variant="outline" disabled={ocupado || bloqueado} onClick={descartar}>DESCARTAR NARRAÇÃO</Button>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-white">1) Gravar com a sua voz (sem IA)</p>
        <label className="flex items-start gap-2 text-muted-foreground"><input type="checkbox" checked={declaro} onChange={(e) => setDeclaro(e.target.checked)} /><span>{DECLARACAO_DA_GRAVACAO}</span></label>
        <input type="file" accept="audio/*" capture="user" disabled={!declaro || ocupado || bloqueado} onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarGravacao(f); e.target.value = '' }} className="text-muted-foreground" aria-label="Arquivo da gravação" />
      </div>
      <div className="space-y-1">
        <p className="text-white">2) Ou gerar com a sua voz digital (no seu computador, se autorizada)</p>
        <textarea className={`${input} min-h-[70px]`} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Texto da narração" />
        <Button size="sm" variant="outline" disabled={ocupado || bloqueado || n?.estado === 'NA_FILA'} onClick={pedirVozLocal}>{ocupado ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}GERAR COM A MINHA VOZ</Button>
      </div>
      <fieldset className="space-y-1" aria-label="Versão para aprovar">
        <p className="text-white">Versão para aprovar</p>
        <label className="flex items-center gap-2"><input type="radio" checked={versaoEscolhida === 'ORIGINAL'} onChange={() => escolher('ORIGINAL')} />Original (sem narração)</label>
        <label className={`flex items-center gap-2 ${n?.utilizavel ? '' : 'opacity-50'}`}><input type="radio" disabled={!n?.utilizavel} checked={versaoEscolhida === 'NARRADA'} onChange={() => escolher('NARRADA')} />Narrada (você publica pelo app)</label>
      </fieldset>
    </details>
  )
}

/**
 * P2.17.11 / P2.17.13: o MESMO cartão serve à tela assistida e à central.
 * Primeira camada: o que decidir (vídeo, produto, motivo, status, botões).
 * O resto (comercial, roteiro, legenda, hashtags, notas da checagem) fica em
 * "Ver conteúdo completo".
 */
export function CartaoDeAprovacao({ item, ocupado, agir }: { item: ItemParaAprovar; ocupado: boolean; agir: (acao: string, corpo?: unknown) => Promise<void> }) {
  const ap = item.apresentacao
  const temVideo = !!ap.video.arquivo
  const modo = item.modo ?? (temVideo ? 'APROVAR' : 'MIDIA')
  const [gancho, setGancho] = useState(ap.versao.gancho)
  const [legenda, setLegenda] = useState(ap.versao.legenda)
  const [motivo, setMotivo] = useState('')
  const [versaoEscolhida, setVersaoEscolhida] = useState<'ORIGINAL' | 'NARRADA'>('ORIGINAL')
  useEffect(() => {
    setGancho(ap.versao.gancho)
    setLegenda(ap.versao.legenda)
  }, [ap.versao.gancho, ap.versao.legenda])
  // Gancho está QUEIMADO no vídeo: muda só por "Pedir ajuste" (o Patrono gera de novo).
  const alteracoesDeAprovar = legenda !== ap.versao.legenda ? { legenda } : {}
  const alteracoesDeAjuste = { ...(gancho !== ap.versao.gancho ? { gancho } : {}), ...alteracoesDeAprovar }
  const input = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-white'
  const arquivo = (item.qualityGate as QG & { arquivo?: { duracaoS: number | null; largura: number | null; altura: number | null; direitoPublicavel: boolean } }).arquivo
  const retida = !!item.liberacao && !item.liberacao.liberado
  const titulo = modo === 'DEMONSTRACAO' ? 'DEMONSTRAÇÃO (teste) · não conta e não publica' : modo === 'MIDIA' ? 'Aguardando mídia autorizada' : temVideo ? 'Aguardando sua aprovação' : 'Vídeo ainda não gerado'
  return (
    <div className="card-stat space-y-3" aria-label={modo === 'MIDIA' ? 'Fornecer mídia autorizada' : 'Aprovar publicação'}>
      {/* P2.17.14: primeira camada = ação, produto, botão. Quality Gate, status, evidência e motivo completo ficam em "Ver conteúdo completo". */}
      <p className="text-sm font-semibold text-white">{item.contador ? `${item.contador} · ` : ''}{titulo}</p>
      <div className="flex flex-col sm:flex-row gap-3 text-xs">
        {temVideo && (
          <div className="space-y-1 shrink-0">
            {/* O vídeo FINAL, o mesmo arquivo que será enviado. */}
            <p className="text-muted-foreground">Versão original (sem narração)</p>
            <video src={ap.video.arquivo ?? undefined} controls playsInline preload="metadata" controlsList={retida ? 'nodownload' : undefined} className="w-full max-w-[200px] aspect-[9/16] rounded-lg bg-black" aria-label={`Vídeo final de ${ap.produto.nome}`} />
            {!retida && <a href={ap.video.arquivo ?? '#'} target="_blank" rel="noopener noreferrer" className="text-accent">Abrir em tela cheia</a>}
          </div>
        )}
        <div className="space-y-1 min-w-0">
          <p className="text-white font-medium line-clamp-2" title={ap.produto.nome}>{ap.produto.nome}</p>
          {(ap.produto as { link?: string | null }).link && <a href={(ap.produto as { link?: string }).link} target="_blank" rel="noopener noreferrer" className="text-accent">Ver o produto na loja</a>}
        </div>
      </div>
      {item.liberacao && (
        <div className={retida ? 'rounded-lg border border-danger/60 p-3 text-xs space-y-1' : 'rounded-lg border border-accent/60 p-3 text-xs'} aria-label="Controles obrigatórios">
          {retida ? <>
            <p className="text-danger font-medium">Campanha retida: não será liberada para publicar enquanto houver pendência.</p>
            <ul className="list-disc pl-4 text-muted-foreground">{item.liberacao.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
          </> : <p className="text-accent">Três controles e campanha aprovados (técnico, comercial, conformidade, afiliação e direitos). A decisão é sua.</p>}
        </div>
      )}

      {modo === 'MIDIA' && ap.cenasParaGravar && ap.cenasParaGravar.length > 0 && (
        <div className="rounded-lg border border-border p-3 text-xs space-y-1" aria-label="O que gravar">
          <p className="text-white font-medium">O que gravar</p>
          <ul className="list-disc pl-4 text-white/85">{ap.cenasParaGravar.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      {modo === 'MIDIA' && <FormularioDeMidia ocupado={ocupado} enviar={(corpo) => agir('midia', corpo)} />}
      {modo === 'APROVAR' && temVideo && <PainelDeNarracao id={item.id} versaoDoVideo={ap.versao} nome={ap.produto.nome} versaoEscolhida={versaoEscolhida} escolher={setVersaoEscolhida} bloqueado={ocupado} />}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-white">Ver conteúdo completo</summary>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className={item.qualityGate.veredito === 'APROVADO' ? 'text-accent' : 'text-danger'}>Quality Gate{temVideo ? ' do vídeo final' : ' do roteiro'}: {item.qualityGate.veredito}</p>
            {item.status && <p className="text-accent">Status: {item.status.principal}</p>}
            {!temVideo && <p className="text-muted-foreground">{ap.video.explicacao}</p>}
            {temVideo && <p className="text-muted-foreground">Mídia: {ap.video.midiaTipo === 'VIDEO' ? 'vídeo' : 'foto'} {ORIGEM_DA_MIDIA[ap.video.midiaOrigem ?? ''] ?? ''}{ap.video.demonstracao ? ' · FIXTURE de demonstração' : ''}{arquivo ? ` · ${arquivo.duracaoS?.toFixed(0)} s · direito ${arquivo.direitoPublicavel ? 'ok' : 'bloqueado'}` : ''}</p>}
            <p className="text-muted-foreground">Preço: {reais(ap.produto.preco)} · Comissão: {ap.produto.comissaoTexto} · Status: {ap.produto.statusEconomico}</p>
            <p className="text-muted-foreground">Canal: TikTok · Horário planejado: {quando(ap.horarioPlanejado)} <span className="italic">({ap.horarioOrigem})</span></p>
            <p className="text-muted-foreground">{item.objetivoDoTeste} Já apareceu {item.vezesQueOProdutoApareceu}×.</p>
            <p className="text-muted-foreground">Por que este produto:</p>
            <ul className="list-disc pl-4 text-muted-foreground">{ap.motivoEscolha.map((m) => <li key={m}>{m}</li>)}</ul>
            {ap.missoes.length > 0 && <ul className="list-disc pl-4 text-accent">{ap.missoes.map((m) => <li key={m}>{m}</li>)}</ul>}
            <p className="text-muted-foreground">{ap.produtoMarcado}</p>
            <p className="text-muted-foreground">Checagem: {item.qualityGate.resumo}</p>
            <p className="text-muted-foreground">{Object.entries(item.qualityGate.notas ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
          </div>
          <div className="space-y-2">
            <label className="block text-muted-foreground">Gancho{temVideo ? ' (escrito no vídeo: para mudar, peça ajuste)' : ''}<input className={`${input} mt-1`} value={gancho} onChange={(e) => setGancho(e.target.value)} /></label>
            <div>
              <p className="text-muted-foreground">Roteiro ({ap.versao.duracaoSegundos} s · {ap.versao.estrutura})</p>
              <ul className="list-disc pl-4 text-white/80">{ap.versao.roteiro.map((r, i) => <li key={i}>{r.etapa}: {r.texto}{r.textoNaTela ? <span className="text-accent"> · tela: “{r.textoNaTela}”</span> : null}</li>)}</ul>
            </div>
            <p className="text-muted-foreground">CTA: <span className="text-white">{ap.versao.cta}</span></p>
            <label className="block text-muted-foreground">Legenda (inclui o aviso de afiliada)<textarea className={`${input} mt-1 min-h-[110px]`} value={legenda} onChange={(e) => setLegenda(e.target.value)} /></label>
            <p className="text-muted-foreground">Hashtags: <span className="text-white">{ap.versao.hashtags.join(' ')}</span></p>
          </div>
        </div>
      </details>

      <input className={input} placeholder={modo === 'DEMONSTRACAO' ? 'Motivo para descartar a demonstração' : 'Motivo (obrigatório para pedir ajuste ou rejeitar)'} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        {/* Sem o MP4 não existe APROVAR E PUBLICAR (P2.17.12). Demonstração nunca. */}
        {modo === 'APROVAR' && temVideo && !retida && <Button disabled={ocupado} onClick={() => agir('aprovar', { alteracoes: alteracoesDeAprovar, versao: item.versao, sha256: (ap.video as { sha256?: string | null }).sha256 ?? null, versaoEscolhida })}>APROVAR E PUBLICAR</Button>}
        {modo === 'APROVAR' && temVideo && retida && <Button disabled={ocupado} onClick={() => agir('aprovar', { alteracoes: alteracoesDeAprovar, versao: item.versao, sha256: (ap.video as { sha256?: string | null }).sha256 ?? null, versaoEscolhida })}>APROVAR (continua retida até resolver as pendências)</Button>}
        {modo === 'APROVAR' && temVideo && versaoEscolhida === 'NARRADA' && <span className="self-center text-xs text-accent">Versão narrada escolhida: depois de aprovar, você publica pelo app.</span>}
        {modo === 'APROVAR' && temVideo && <Button variant="outline" disabled={ocupado || motivo.trim().length < 3} onClick={() => agir('ajuste', { motivo, alteracoes: alteracoesDeAjuste })}>PEDIR AJUSTE</Button>}
        <Button variant="outline" disabled={ocupado || motivo.trim().length < 3} onClick={() => agir('rejeitar', { motivo })}>
          {modo === 'DEMONSTRACAO' ? 'DESCARTAR DEMONSTRAÇÃO' : modo === 'MIDIA' ? 'REJEITAR (não tenho mídia deste produto)' : 'REJEITAR'}
        </Button>
      </div>
    </div>
  )
}

function LinhaDeResultado({ r, salvar, salvarDna }: { r: Resultado; salvar: (id: string, m: Record<string, number | null>) => Promise<void>; salvarDna: (id: string, d: Record<string, boolean | null>) => Promise<void> }) {
  const campos = [
    ['views', 'Views', r.views], ['retencaoMedia', 'Retenção (0–1)', r.retencaoMedia], ['tempoMedioSeg', 'Tempo médio (s)', r.tempoMedioSeg], ['cliquesProduto', 'Cliques', r.cliquesProduto],
    ['adicoesCarrinho', 'Carrinhos', r.adicoesCarrinho], ['vendas', 'Vendas', r.vendas], ['comissao', 'Comissão R$', r.comissao], ['receita', 'Receita R$', r.receita],
  ] as const
  const [valores, setValores] = useState<Record<string, string>>(Object.fromEntries(campos.map(([k, , v]) => [k, v === null ? '' : String(v)])))
  const enviar = () => {
    const m: Record<string, number | null> = {}
    for (const [k] of campos) m[k] = valores[k].trim() === '' ? null : Number(valores[k].replace(',', '.'))
    return salvar(r.id, m)
  }
  return (
    <div className="rounded-lg border border-border p-2.5 space-y-2 text-xs">
      <p className="text-white">{r.nomeProduto ?? 'Produto'} · {r.estrutura} · “{r.gancho}” · {quando(r.publicadoEm)} {r.urlDoVideo && <a className="text-accent" href={r.urlDoVideo} target="_blank" rel="noopener noreferrer">abrir</a>}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {campos.map(([k, rotulo]) => (
          <label key={k} className="text-muted-foreground">{rotulo}
            <input className="w-full rounded border border-border bg-background px-2 py-1 text-white" inputMode="decimal" placeholder="não medido" value={valores[k]} onChange={(e) => setValores({ ...valores, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">CTR {pct(r.derivadas.ctr)} · conversão {pct(r.derivadas.conversaoCliqueVenda)} · vendas/1.000 views {r.derivadas.vendasPor1000Views ?? '—'} · receita/1.000 views {reais(r.derivadas.receitaPor1000Views)}</p>
        <Button size="sm" variant="outline" onClick={enviar}>Salvar números</Button>
      </div>
      {r.dna && (
        <div className="space-y-1.5" aria-label="DNA criativo">
          <p className="text-muted-foreground break-words">
            DNA: hook <b className="text-white">{desconhecido(r.dna.tipoDeGancho)}</b>{r.dna.confiancaDoGancho && r.dna.tipoDeGancho !== 'UNKNOWN' ? ` (confiança ${r.dna.confiancaDoGancho.toLowerCase()})` : ''} · CTA {desconhecido(r.dna.tipoDeCta)} · formato {desconhecido(r.dna.formatoDoConteudo)} · mídia {desconhecido(r.dna.tipoDeMidia)}/{desconhecido(r.dna.origemDaMidia)}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CAMPOS_DO_DNA.map(([k, rotulo]) => (
              <label key={k} className="text-muted-foreground">{rotulo}{r.dna!.origemDoDna?.[k] === 'INFORMADO_PELA_TITULAR' ? ' (você)' : r.dna!.origemDoDna?.[k] === 'DERIVADO_DO_RENDER' ? ' (do vídeo)' : ''}
                <select className="input w-full min-h-[44px]" value={r.dna![k] === null ? '' : r.dna![k] ? 'sim' : 'nao'} onChange={(e) => salvarDna(r.id, { [k]: e.target.value === '' ? null : e.target.value === 'sim' })}>
                  <option value="">Não sei</option><option value="sim">Sim</option><option value="nao">Não</option>
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function PainelAssistido() {
  const [painel, setPainel] = useState<Painel | null>(null)
  const [resultados, setResultados] = useState<Resultados | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [url, setUrl] = useState('')

  const carregar = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([chamar('/api/tiktok/assistido', 'GET'), chamar('/api/tiktok/resultados', 'GET')])
      setPainel(p)
      setResultados(r)
      setErro(null)
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [])
  useEffect(() => {
    carregar()
  }, [carregar])

  async function executar(fn: () => Promise<unknown>, ok: string) {
    setOcupado(true)
    try {
      await fn()
      toast({ title: ok })
      avisarMudancaNoPrecisaDeVoce()
      await carregar()
    } catch (e) {
      toast({ title: 'Não deu certo', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setOcupado(false)
    }
  }

  if (erro) return <p className="card-stat text-sm text-muted-foreground">{erro}</p>
  if (!painel) return <p className="card-stat flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>
  const atual = painel.atual ? painel.itens.find((i) => i.id === painel.atual!.id) ?? null : null

  return (
    <div className="space-y-4">
      <div className="card-stat space-y-2">
        <p className="text-base font-semibold text-white">Modo assistido: {painel.concluidas}/{painel.limite} publicações concluídas</p>
        <div className="flex flex-wrap gap-1.5">
          {ESTADOS.map(([k, rotulo]) => (
            <span key={k} className={`rounded-full border px-2 py-0.5 text-[11px] ${painel.porEstado[k] ? 'border-accent text-accent' : 'border-border text-muted-foreground'}`}>{rotulo} {painel.porEstado[k] ?? 0}</span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">TikTok: <b className="text-white">{painel.canal.nivel}</b> — {painel.canal.frase}</p>
      </div>

      {!atual && (
        <div className="card-stat flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-white">Nenhuma publicação em andamento.</p>
          <Button disabled={ocupado} onClick={() => executar(() => chamar('/api/tiktok/assistido', 'POST'), 'Próxima publicação preparada')}>Preparar a próxima</Button>
        </div>
      )}

      {atual?.estado === 'AGUARDANDO_APROVACAO' && (
        <CartaoDeAprovacao
          item={{ ...atual, status: (atual as unknown as { status?: { principal: string; videoGerado: boolean } }).status }}
          ocupado={ocupado}
          agir={(acao, corpo) => executar(() => chamar(`/api/tiktok/assistido/${atual.id}/${acao}`, 'POST', corpo), acao === 'aprovar' ? 'Aprovado' : acao === 'ajuste' ? 'Nova versão apresentada' : 'Rejeitado — o Patrono preparou outra opção')}
        />
      )}

      {atual && ['APROVADO', 'PUBLICANDO', 'FALHOU'].includes(atual.estado) && (
        <div className="card-stat space-y-2 text-sm">
          <p className="text-white font-medium">{atual.nomeProduto} · {atual.estado === 'PUBLICANDO' ? 'publicando' : atual.estado === 'FALHOU' ? 'falhou' : 'aprovado'}</p>
          {atual.bloqueio && <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-white">{atual.bloqueio}</p>}
          {atual.erro && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-white">{atual.erro}</p>}
          <div className="flex flex-wrap gap-2">
            {atual.estado !== 'PUBLICANDO' && <Button size="sm" variant="outline" disabled={ocupado} onClick={() => { const incerto = (atual.erro ?? '').startsWith('ENVIO INCERTO'); if (incerto && !window.confirm('O último envio ficou sem confirmação. Você conferiu o seu perfil no TikTok e o vídeo NÃO está lá?')) return; executar(() => chamar(`/api/tiktok/assistido/${atual.id}/tentar-de-novo`, 'POST', incerto ? { conferiuOPerfil: true } : {}), 'Tentativa feita') }}>{(atual.erro ?? '').startsWith('ENVIO INCERTO') ? 'Conferi o perfil: tentar de novo' : 'Tentar publicar de novo'}</Button>}
            {atual.estado === 'PUBLICANDO' && <Button size="sm" variant="outline" disabled={ocupado} onClick={() => executar(() => chamar('/api/tiktok/publicacoes/acompanhar', 'POST'), 'TikTok consultado')}>Consultar o TikTok agora</Button>}
          </div>
          {atual.estado !== 'FALHOU' && (
            <div className="flex flex-wrap gap-2">
              <input className="flex-1 min-w-[220px] rounded-lg border border-border bg-background px-3 py-2 text-xs text-white" placeholder="Publiquei pelo app (limitação oficial): cole o link do vídeo" value={url} onChange={(e) => setUrl(e.target.value)} />
              <Button size="sm" disabled={ocupado || !url.trim()} onClick={() => executar(() => chamar(`/api/tiktok/assistido/${atual.id}/publicado`, 'POST', { url }), 'Publicação registrada')}>Registrar publicação</Button>
            </div>
          )}
        </div>
      )}

      {painel.relatorio.final && (
        <div className="card-stat space-y-1 text-sm">
          <p className="text-white font-semibold">Pronto para automação plena? {painel.relatorio.recomendacao}</p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">{painel.relatorio.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="text-xs text-warning">É só uma recomendação: nada foi ativado. A decisão é sua.</p>
        </div>
      )}

      <details className="card-stat text-sm" open>
        <summary className="cursor-pointer text-white font-medium">Resultados dos vídeos e aprendizado</summary>
        <div className="mt-3 space-y-3">
          {resultados?.resultados.length ? resultados.resultados.map((r) => (
            <LinhaDeResultado key={r.id} r={r} salvar={(id, m) => executar(() => chamar(`/api/tiktok/resultados/${id}`, 'PATCH', m), 'Números salvos')} salvarDna={(id, d) => executar(() => chamar(`/api/tiktok/resultados/${id}/dna`, 'PATCH', d), 'DNA salvo')} />
          )) : <p className="text-xs text-muted-foreground">Nenhum vídeo publicado ainda.</p>}
          {resultados && (
            <div className="space-y-1 text-xs">
              <p className="text-white font-medium">O que o Patrono aprendeu</p>
              {resultados.aprendizadoCriativo && (
                <div aria-label="Aprendizado criativo" className="space-y-1">
                  {resultados.aprendizadoCriativo.recomendacoes.length === 0 ? (
                    <p className="text-muted-foreground">Ainda sem padrão: {resultados.aprendizadoCriativo.videosComparaveis} vídeo(s) comparável(is) (com 500+ views e comissão conhecida). O Patrono não muda o próximo vídeo com dado insuficiente.</p>
                  ) : resultados.aprendizadoCriativo.recomendacoes.slice(0, 8).map((r) => (
                    <p key={`${r.dimensao}:${r.grupo}`} className="text-muted-foreground break-words">
                      <b className={r.orientaPlanejador ? 'text-accent' : 'text-white'}>{r.acao.replace(/_/g, ' ')}</b> · {NIVEL_TEXTO[r.nivel] ?? r.nivel}{r.orientaPlanejador ? ' · orienta o próximo vídeo' : ' · ainda não orienta'} — {r.motivo}
                    </p>
                  ))}
                  {resultados.aprendizadoCriativo.outliers.length > 0 && <p className="text-muted-foreground">{resultados.aprendizadoCriativo.outliers.length} vídeo(s) fora da curva: o Patrono usa mediana, então eles não decidem sozinhos.</p>}
                </div>
              )}
              <p className="text-white/85 mt-1">Comparação simples por grupo</p>
              {resultados.aprendizado.map((a) => <p key={a.dimensao} className="text-muted-foreground"><b className="text-white">{a.dimensao}</b>: {a.recomendacao}</p>)}
              <p className="text-white font-medium mt-2">Status dos produtos</p>
              {resultados.produtos.filter((p) => p.status !== 'TESTANDO').length === 0 && <p className="text-muted-foreground">Todos em TESTANDO: ainda sem evidência suficiente para decidir.</p>}
              {resultados.produtos.filter((p) => p.status !== 'TESTANDO').map((p) => <p key={p.id} className="text-muted-foreground"><b className="text-white">{p.status}</b> · {p.nome} — {p.motivos[0]}</p>)}
            </div>
          )}
        </div>
      </details>

      <details className="card-stat text-sm">
        <summary className="cursor-pointer text-white font-medium">Histórico das publicações</summary>
        <ul className="mt-2 space-y-1 text-xs">
          {painel.itens.map((i) => (
            <li key={i.id} className="text-muted-foreground">
              {i.ordem ? `#${i.ordem} ` : ''}<b className="text-white">{(i as unknown as { status?: { principal: string } }).status?.principal ?? i.estado}</b> · {i.nomeProduto} · {i.estrutura} · v{i.versao}
              {i.aprovadoDePrimeira ? ' · aprovado de primeira' : ''}
              {i.urlPublicada && <> · <a className="text-accent" href={i.urlPublicada} target="_blank" rel="noopener noreferrer">vídeo</a></>}
              {i.historico.filter((h) => h.acao === 'AJUSTE_PEDIDO' || h.acao === 'REJEITADO').map((h, k) => <span key={k}> · {h.acao === 'REJEITADO' ? 'rejeitado' : 'ajuste'}: “{h.detalhe}”</span>)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
