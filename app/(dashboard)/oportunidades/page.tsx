'use client'

// P2.14.5.13 — Curadoria: os 3 melhores candidatos do motor de oportunidades.
// A titular escolhe 1; o produto é cadastrado (ou ligado, se já existe).
// Nada é gerado nem publicado aqui. Dado desconhecido aparece como
// "desconhecido" — nunca escondido, nunca preenchido.

import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle, Package, CheckCircle2, XCircle, Plus, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { useGuardModulo } from '@/hooks/useGuardModulo'
import { CATEGORIAS } from '@/types'
import type { CandidatoNaTela } from '@/lib/curadoria-http'
import { estadoDaCuradoria, textoDoResumo, type UltimaColetaNaTela } from '@/lib/curadoria-estado'
import { VisoesDeProdutos } from '@/components/oportunidades/VisoesDeProdutos'
import { Detalhes, DadosPendentes, SeloDecisao, type Decisao } from '@/components/shared/Ux'
import { ROTULO_NA_VITRINE } from '@/lib/vitrine-situacao'

const DESCONHECIDO = 'desconhecido'
const reais = (v: number | null) => (v === null ? DESCONHECIDO : `R$ ${v.toFixed(2).replace('.', ',')}`)
const numero = (v: number | null, sufixo = '') => (v === null ? DESCONHECIDO : `${v}${sufixo}`)

const ROTULO_DA_FONTE: Record<string, string> = {
  CATALOGO: 'Catálogo do Patrono',
  USER_PROVIDED: 'Informado pela titular',
}

const ROTULO_DA_CONFIANCA: Record<string, string> = {
  ALTA: 'alta',
  MEDIA: 'média',
  BAIXA: 'baixa',
  SEM_HISTORICO_REAL: 'sem histórico real',
}

/** P2.17.6: o motivo de faltar o dado, quando sabido; senão "desconhecido". */
function semDado(c: CandidatoNaTela): string {
  return c.dadosOficiais?.motivoCurto ?? DESCONHECIDO
}
const ROTULO_DA_FONTE_OFICIAL: Record<string, string> = { TIKTOK_SHOP_AFFILIATE_API: 'API de afiliados do TikTok Shop', SHOPEE_AFFILIATE_API: 'API de afiliados da Shopee' }
function atualizadoEm(c: CandidatoNaTela): string {
  const d = c.dadosOficiais
  const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  if (d?.atualizadoEm) return `${quando(d.atualizadoEm)} · ${ROTULO_DA_FONTE_OFICIAL[d.fonte] ?? d.fonte}`
  if (d) return `sem dado oficial (consultado ${quando(d.consultadoEm)})`
  return 'ainda não consultado'
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  const apagado = valor === DESCONHECIDO || /ainda não|sem dado|Sem |não reconhecida|falta/i.test(valor)
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-muted-foreground shrink-0">{rotulo}</span>
      <span className={`text-right ${apagado ? 'text-muted-foreground italic' : 'text-white'}`}>{valor}</span>
    </div>
  )
}

function Lista({ titulo, itens, cor }: { titulo: string; itens: string[]; cor: string }) {
  return (
    <div>
      <p className={`text-xs font-medium ${cor}`}>{titulo}</p>
      {itens.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">nenhum</p>
      ) : (
        <ul className="mt-1 space-y-0.5 list-disc pl-4">
          {itens.map((t, i) => (
            <li key={i} className="text-xs text-white/80">{t}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** P2.17.13: os campos comerciais que faltam viram UMA linha "Dados oficiais pendentes". */
function camposPendentes(c: CandidatoNaTela): string[] {
  return [
    c.preco === null ? 'preço' : null,
    c.comissaoPercentual === null && c.comissaoValor === null ? 'comissão' : null,
    c.vendas === null ? 'vendas' : null,
    c.avaliacao === null ? 'avaliação' : null,
    c.estoque === null ? 'estoque' : null,
  ].filter((x): x is string => !!x)
}

const MARKETPLACE: Record<string, string> = { 'tiktok-shop': 'TikTok Shop', shopee: 'Shopee', 'mercado-livre': 'Mercado Livre', 'amazon-associados': 'Amazon' }

/**
 * P2.17.13 — Cartão do Top 3 em duas camadas. Primeira: posição, imagem,
 * nome, marketplace, preço/comissão/vendas REAIS (quando houver), a decisão
 * do Patrono (PRIORIZAR | TESTAR | AGUARDAR | EVITAR), até 3 motivos, risco
 * e a ação. Score, evidência, confiança, afinidade, aderência, dados
 * desconhecidos, pesos e "por que nesta posição" ficam em "Ver análise completa".
 */
function CardDoCandidato({
  c,
  ocupado,
  onEscolher,
  onDescartar,
  onTenhoEmMaos,
}: {
  c: CandidatoNaTela
  ocupado: boolean
  onEscolher: () => void
  onDescartar: () => void
  onTenhoEmMaos: () => void
}) {
  const decisao = c.consultoria?.veredito as Decisao | undefined
  const numeros = [
    c.preco !== null ? `${reais(c.preco)}${c.dadosOficiais?.descontoPercentual ? ` (−${c.dadosOficiais.descontoPercentual}%)` : ''}` : null,
    c.comissaoValor !== null ? `${reais(c.comissaoValor)}/venda` : c.comissaoPercentual !== null ? `${c.comissaoPercentual}% de comissão` : null,
    c.vendas !== null ? `${c.vendas.toLocaleString('pt-BR')} vendidos` : null,
  ].filter(Boolean)
  return (
    <div className="card-stat flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-accent">{c.posicao}º</span>
        {decisao && <SeloDecisao decisao={decisao} />}
      </div>

      <div className="flex gap-3">
        <div className="w-16 h-16 shrink-0 rounded-lg bg-secondary flex items-center justify-center overflow-hidden">
          {c.imagem ? <img src={c.imagem} alt={c.nome} className="w-full h-full object-cover" /> : <Package className="w-6 h-6 text-muted-foreground" aria-label={c.imagemInformadaSemDireito ? 'Imagem sem direito de uso verificado' : 'Sem imagem'} />}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white text-sm line-clamp-2">{c.nome}</p>
          <p className="text-[11px] text-muted-foreground">{MARKETPLACE[c.providerId ?? ''] ?? ROTULO_DA_FONTE[c.fonte] ?? c.providerId ?? c.fonte}</p>
          {c.campanha && c.campanha.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1" aria-label={`Etiquetas da campanha ${c.campanha.nome}`}>
              {c.campanha.tags.map((t) => (
                <span key={t} className="rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{ROTULO_DA_TAG[t] ?? t}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* P2.17.15: situação na vitrine (só informa; quem inclui é o fluxo automático, quando autorizado). */}
      {c.vitrine && <p className="text-[11px] text-muted-foreground">Vitrine: <span className={c.vitrine === 'NA_VITRINE' || c.vitrine === 'ELEGIVEL' ? 'text-accent' : 'text-white/80'}>{ROTULO_NA_VITRINE[c.vitrine]}</span></p>}
      {numeros.length > 0 && <p className="text-sm text-white">{numeros.join(' · ')}</p>}
      <DadosPendentes campos={camposPendentes(c)} fonte={c.providerId === 'tiktok-shop' ? 'O TikTok' : c.providerId === 'shopee' ? 'A Shopee' : undefined} />

      {c.motivosPositivos.length > 0 && (
        <ul className="space-y-0.5 list-disc pl-4">
          {c.motivosPositivos.slice(0, 3).map((t, i) => <li key={i} className="text-xs text-white/85">{t}</li>)}
        </ul>
      )}
      {c.nivelDeRisco && <p className="text-[11px] text-muted-foreground">Risco: <span className={c.nivelDeRisco === 'ALTO' ? 'text-danger' : c.nivelDeRisco === 'MEDIO' ? 'text-warning' : 'text-white'}>{c.nivelDeRisco.toLowerCase()}</span></p>}
      {c.dadosOficiais?.alertas.map((a) => <p key={a} className="text-[11px] text-warning">{a}</p>)}

      <Detalhes titulo="Ver análise completa">
        {c.consultoria && (
          <div aria-label="Minha opinião" className="space-y-1">
            <p className="text-white">{c.consultoria.resumo}</p>
            {(
              [
                ['Vale a pena?', c.consultoria.valeAPena], ['Programa', c.consultoria.programa], ['Canal', c.consultoria.canal], ['Formato', c.consultoria.formato],
                ['Comissão', c.consultoria.comissao], ['Evidência de venda', c.consultoria.evidencia], ['Sazonalidade', c.consultoria.sazonalidade],
                ['Risco', c.consultoria.risco], ['Próximo passo', c.consultoria.proximoPasso],
              ] as const
            ).map(([rotulo, texto]) => <p key={rotulo}><span className="text-white">{rotulo}:</span> {texto}</p>)}
          </div>
        )}
        <div className="space-y-1 pt-1">
          <Linha rotulo="Score" valor={`${c.score}/100`} />
          <Linha rotulo="Base de evidência" valor={`${c.baseDeEvidencia}/100`} />
          <Linha rotulo="Confiança" valor={ROTULO_DA_CONFIANCA[c.confianca] ?? c.confianca} />
          <Linha rotulo="Aderência BoraComprar" valor={c.aderenciaDoPerfil === null ? DESCONHECIDO : `${c.aderenciaDoPerfil}/80`} />
          <Linha rotulo="Afinidade da titular" valor={`${c.afinidade}/20`} />
          <Linha rotulo="Avaliação" valor={c.avaliacao === null ? semDado(c) : `${c.avaliacao} (${numero(c.numeroDeAvaliacoes, ' avaliações')})`} />
          <Linha rotulo="Estoque" valor={c.estoque === null ? semDado(c) : numero(c.estoque)} />
          <Linha rotulo="Atualizado em" valor={atualizadoEm(c)} />
          {c.dadosOficiais?.motivo && c.dadosOficiais.situacao !== 'OK' && <p className="text-[10px]">{c.dadosOficiais.motivo}</p>}
        </div>
        <Lista titulo="Motivos positivos" itens={c.motivosPositivos} cor="text-success" />
        <Lista titulo="Riscos" itens={c.riscos} cor="text-warning" />
        <Lista titulo="Dados desconhecidos" itens={c.desconhecidos} cor="text-muted-foreground" />
        <Lista titulo="Por que está nesta posição" itens={c.porqueDestaPosicao} cor="text-white" />
        {c.linkProduto && (
          <a href={c.linkProduto} target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent inline-flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> abrir link do produto
          </a>
        )}
      </Detalhes>

      <div className="flex gap-2 pt-2 border-t border-border mt-auto">
        <Button size="sm" className="flex-1" disabled={ocupado} onClick={onEscolher}>
          <CheckCircle2 className="w-3.5 h-3.5" /> Escolher produto
        </Button>
        <Button size="sm" variant="outline" disabled={ocupado} onClick={onDescartar} title="Descartar">
          <XCircle className="w-3.5 h-3.5" />
        </Button>
      </div>
      {/* P2.18 — Plano B: produto que a titular já tem em casa vira vídeo sem esperar amostra. */}
      <Button size="sm" variant="outline" disabled={ocupado} onClick={onTenhoEmMaos}>
        <Package className="w-3.5 h-3.5" /> Tenho este produto em mãos
      </Button>
    </div>
  )
}

/**
 * P2.17.1: erro sempre em frase compreensível. A mensagem da API (já em
 * português, por campo) tem prioridade; sem ela, explica pelo status.
 */
function mensagemDeErro(status: number, erro: unknown): string {
  if (status === 401) return 'Sua sessão expirou. Entre de novo e repita.'
  if (status === 403) return 'Seu acesso não inclui Oportunidades. Peça a liberação ao administrador.'
  if (typeof erro === 'string' && erro.trim() && status < 500) return erro
  if (status >= 500) return 'Erro do nosso lado ao processar o produto. Tente de novo em instantes; se repetir, me avise.'
  return `Não deu certo (código ${status}). Tente de novo.`
}

/** "R$ 1.234,56" → 1234.56; vazio → null; ilegível → NaN (a tela avisa). */
function lerPreco(texto: string): number | null {
  const t = texto.trim()
  if (!t) return null
  let limpo = t.replace(/[^\d,.-]/g, '')
  if (limpo.includes(',') && limpo.includes('.')) limpo = limpo.replace(/\./g, '').replace(',', '.')
  else limpo = limpo.replace(',', '.')
  return limpo ? Number(limpo) : NaN
}

/** P2.17.3: veredito do consultor, em português. */
const ROTULO_DO_VEREDITO: Record<string, string> = {
  PRIORIZAR: 'eu priorizaria',
  TESTAR: 'eu testaria',
  AGUARDAR: 'eu aguardaria',
  EVITAR: 'eu evitaria',
}

/** P2.17.2: etiquetas da campanha de Natal, em português para a tela. */
const ROTULO_DA_TAG: Record<string, string> = {
  NATAL: '🎄 Natal',
  PRESENTE: 'Presente',
  DECORACAO_NATALINA: 'Decoração natalina',
  PRESENTE_INFANTIL: 'Presente infantil',
  PRESENTE_MULHER: 'Presente p/ mulher',
  PRESENTE_CASA: 'Presente p/ casa',
  LEMBRANCINHA: 'Lembrancinha',
  PREMIUM: 'Premium',
}

const FORM_VAZIO = { nome: '', link: '', categoria: '', preco: '', imagem: '', comprei: false, usei: false }

export default function OportunidadesPage() {
  useGuardModulo('oportunidades')
  const [candidatos, setCandidatos] = useState<CandidatoNaTela[]>([])
  const [ultima, setUltima] = useState<UltimaColetaNaTela | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [form, setForm] = useState(FORM_VAZIO)
  const [erroDoForm, setErroDoForm] = useState<string | null>(null)
  const [versaoDosDados, setVersaoDosDados] = useState(0)
  const [enriquecendo, setEnriquecendo] = useState(false)

  async function chamar(url: string, init?: RequestInit) {
    const res = await fetch(url, init)
    let dados: Record<string, unknown> = {}
    try {
      dados = await res.json()
    } catch {
      // resposta sem JSON: trata como erro abaixo
    }
    if (!res.ok) throw new Error(mensagemDeErro(res.status, dados.error))
    return dados
  }

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const d = await chamar('/api/oportunidades')
      setCandidatos((d.candidatos as CandidatoNaTela[]) ?? [])
      setUltima((d.ultimaColeta as UltimaColetaNaTela | null) ?? null)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  // P2.17.6: enriquecimento automático — dado oficial com mais de 12 h (ou
  // nunca consultado) é atualizado em segundo plano ao abrir a tela.
  async function enriquecer(manual: boolean) {
    setEnriquecendo(true)
    try {
      const d = await chamar('/api/oportunidades/enriquecer', { method: 'POST' })
      const alertas = ((d.linhas as { alertas: string[] }[]) ?? []).flatMap((l) => l.alertas)
      if (manual || alertas.length) {
        toast({
          title: 'Dados dos produtos atualizados',
          description: alertas.length ? alertas.slice(0, 3).join(' ') : `${d.comDadoOficial} com dado oficial; ${d.semFonte} sem fonte oficial ativa; ${d.naoIdentificados} sem produto identificado.`,
        })
      }
      await carregar()
      setVersaoDosDados((v) => v + 1)
    } catch (e) {
      if (manual) toast({ title: 'Não consegui atualizar os dados', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setEnriquecendo(false)
    }
  }
  useEffect(() => {
    if (carregando || enriquecendo || !candidatos.length) return
    const velho = Date.now() - 12 * 60 * 60 * 1000
    if (candidatos.some((c) => !c.dadosOficiais || new Date(c.dadosOficiais.consultadoEm).getTime() < velho)) enriquecer(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando])

  async function atualizar() {
    setOcupado(true)
    setErro(null)
    try {
      const d = await chamar('/api/oportunidades/coletar', { method: 'POST' })
      setCandidatos((d.candidatos as CandidatoNaTela[]) ?? [])
      setVersaoDosDados((v) => v + 1)
      const nova = (d.ultimaColeta as UltimaColetaNaTela | null) ?? null
      setUltima(nova)
      // Os números reais da coleta — inclusive quando são zero.
      toast({ title: 'Coleta concluída', description: nova ? textoDoResumo(nova) : undefined, variant: 'success' })
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  async function escolher(c: CandidatoNaTela) {
    if (!confirm(`Escolher "${c.nome}"? O produto será cadastrado (nada é gerado nem publicado).`)) return
    setOcupado(true)
    try {
      const d = await chamar(`/api/oportunidades/${c.id}/escolher`, { method: 'POST' })
      toast({
        title: d.produtoCriado ? 'Produto cadastrado' : 'Produto escolhido (já estava no catálogo)',
        variant: 'success',
      })
      await carregar()
    } catch (e) {
      toast({ title: 'Não foi possível escolher', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setOcupado(false)
    }
  }

  async function tenhoEmMaos(c: CandidatoNaTela) {
    if (!confirm(`Você tem "${c.nome}" em casa?

O Patrono prepara o vídeo deste produto (roteiro, checagem de qualidade) e pede só a sua mídia: fotos/vídeos que VOCÊ gravar dele. Nada é publicado sem a sua aprovação.`)) return
    setOcupado(true)
    try {
      const d = await chamar('/api/tiktok/assistido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidatoEmMaos: c.id }) })
      toast({
        title: 'Vídeo em preparação',
        description: d.estado === 'AGUARDANDO_MIDIA' ? 'Agora é só enviar a sua mídia em "Precisa de você" (as cenas a gravar estão lá).' : 'Acompanhe em Publicações assistidas.',
        variant: 'success',
      })
    } catch (e) {
      toast({ title: 'Não foi possível preparar o vídeo', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setOcupado(false)
    }
  }

  async function descartar(c: CandidatoNaTela) {
    if (!confirm(`Descartar "${c.nome}"? Ele fica fora das coletas por 30 dias.`)) return
    setOcupado(true)
    try {
      await chamar(`/api/oportunidades/${c.id}/descartar`, { method: 'POST' })
      await carregar()
    } catch (e) {
      toast({ title: 'Não foi possível descartar', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setOcupado(false)
    }
  }

  async function informar(e: React.FormEvent) {
    e.preventDefault()
    setErroDoForm(null)
    if (!form.nome.trim() || !form.link.trim()) {
      setErroDoForm('Preencha o nome e o link do produto.')
      toast({ title: 'Nome e link são obrigatórios', variant: 'destructive' })
      return
    }
    const preco = lerPreco(form.preco)
    if (preco !== null && !(preco > 0)) {
      setErroDoForm('Preço inválido: use só números, por exemplo 49,90 — ou deixe em branco.')
      toast({ title: 'Preço inválido', variant: 'destructive' })
      return
    }
    setOcupado(true)
    try {
      const d = await chamar('/api/oportunidades/informar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: form.nome,
          link: form.link,
          categoria: form.categoria || null,
          preco,
          imagem: form.imagem || null,
          comprei: form.comprei,
          usei: form.usei,
        }),
      })
      setCandidatos((d.candidatos as CandidatoNaTela[]) ?? [])
      setUltima((d.ultimaColeta as UltimaColetaNaTela | null) ?? null)
      setForm(FORM_VAZIO)
      setMostrarForm(false)
      toast(typeof d.aviso === 'string' && d.aviso ? { title: 'Produto informado', description: d.aviso } : { title: 'Produto informado e incluído no ranking', variant: 'success' })
    } catch (e) {
      const msg = e instanceof TypeError ? 'Sem conexão com o servidor. Confira a internet e tente de novo.' : (e as Error).message
      setErroDoForm(msg)
      toast({ title: 'O produto não foi incluído', description: msg, variant: 'destructive' })
    } finally {
      setOcupado(false)
    }
  }

  const situacao = estadoDaCuradoria({ ultima, candidatosEmAberto: candidatos.length })

  const input =
    'w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <div className="space-y-4 w-full max-w-6xl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-white">Oportunidades</h2>
          <p className="text-sm text-muted-foreground">
            O Patrono já filtrou: os 3 melhores agora. Escolha 1 — nada é gerado nem publicado aqui.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => setMostrarForm((v) => !v)} disabled={ocupado} title="Contingência: produto que o Patrono ainda não encontrou">
            <Plus className="w-4 h-4" /> Informar produto
          </Button>
          <Button variant="outline" size="sm" onClick={() => enriquecer(true)} disabled={ocupado || enriquecendo}>
            <RefreshCw className={`w-4 h-4 ${enriquecendo ? 'animate-spin' : ''}`} /> Atualizar dados dos produtos
          </Button>
          <Button size="sm" onClick={atualizar} disabled={ocupado}>
            <RefreshCw className={`w-4 h-4 ${ocupado ? 'animate-spin' : ''}`} /> Atualizar candidatos
          </Button>
        </div>
      </div>

      {mostrarForm && (
        <form onSubmit={informar} className="card-stat grid grid-cols-1 sm:grid-cols-2 gap-3">
          <p className="sm:col-span-2 text-xs text-muted-foreground">
            Para um produto que ainda não está no catálogo. Só nome e link são obrigatórios; o que ficar em branco
            continua desconhecido.
          </p>
          {erroDoForm && (
            <p role="alert" className="sm:col-span-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-white break-words">
              {erroDoForm}
            </p>
          )}
          <input className={input} placeholder="Nome *" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          <input className={input} placeholder="Link * (https://…)" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
          <select className={input} value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
            <option value="">Categoria (opcional — sem ela, "Outros")</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input className={input} placeholder="Preço (opcional)" inputMode="decimal" value={form.preco} onChange={(e) => setForm({ ...form, preco: e.target.value })} />
          <input className={`${input} sm:col-span-2`} placeholder="Link da imagem (opcional)" value={form.imagem} onChange={(e) => setForm({ ...form, imagem: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-white">
            <input type="checkbox" checked={form.comprei} onChange={(e) => setForm({ ...form, comprei: e.target.checked })} /> Comprei
          </label>
          <label className="flex items-center gap-2 text-sm text-white">
            <input type="checkbox" checked={form.usei} onChange={(e) => setForm({ ...form, usei: e.target.checked })} /> Usei
          </label>
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" size="sm" disabled={ocupado}>Informar</Button>
          </div>
        </form>
      )}

      {erro && (
        <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
          <p className="text-sm text-danger">{erro}</p>
        </div>
      )}

      {carregando ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card-stat animate-pulse h-96" />
          ))}
        </div>
      ) : candidatos.length === 0 ? (
        <div className="card-stat flex flex-col items-center justify-center py-16 text-center" data-estado={situacao.estado}>
          <Package className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm text-white font-medium">{situacao.titulo}</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">{situacao.detalhe}</p>
          {situacao.estado === 'CATALOGO_VAZIO' && (
            <p className="text-xs text-muted-foreground mt-3">
              Se quiser, você também pode usar “Informar produto” — é opcional.
            </p>
          )}
          {situacao.resumo && ultima && (
            <p className="text-[11px] text-muted-foreground mt-4">
              Última coleta: {situacao.resumo} · {new Date(ultima.em).toLocaleString('pt-BR')}
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {situacao.resumo && ultima && (
            <p className="lg:col-span-3 text-[11px] text-muted-foreground">
              Última coleta: {situacao.resumo} · {new Date(ultima.em).toLocaleString('pt-BR')}
            </p>
          )}
          {candidatos.map((c) => (
            <CardDoCandidato key={c.id} c={c} ocupado={ocupado} onEscolher={() => escolher(c)} onDescartar={() => descartar(c)} onTenhoEmMaos={() => tenhoEmMaos(c)} />
          ))}
        </div>
      )}

      {!carregando && <VisoesDeProdutos versao={versaoDosDados} top3={candidatos.map((c) => c.id)} />}
    </div>
  )
}
