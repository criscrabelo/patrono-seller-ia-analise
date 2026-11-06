/**
 * P2.17.13 — Revisão global de UX: verdade antes de tudo (nenhuma
 * estimativa sem dado, nada de "viral", vídeo só com arquivo, status do
 * banner verdadeiros), páginas próprias (Ferramentas, Conteúdo, Vendas &
 * Receita), primeira camada enxuta e técnico recolhido.
 * Dados abaixo são FIXTURE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { regraDaRota } from '../lib/modulos-rotas'
import { ESTILOS } from '../types'

const ler = (f: string) => fs.readFileSync(f, 'utf8').split('\r\n').join('\n')
/** O código sem comentários (os comentários explicam o que foi REMOVIDO). */
const codigo = (f: string) => ler(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('P0 — clareza e verdade', () => {
  test('Canais de receita (ex-Monetização): sem estimativa genérica nem "conteúdo viral"', () => {
    const src = codigo('app/(dashboard)/monetizacao/page.tsx')
    for (const proibido of ['5-30%', '~10% margem', '70-100%', '10k', 'Estimativa com', 'R$/dia', 'Conteúdo Viral', 'ESTIMATIVAS', 'PILARES']) assert.ok(!src.includes(proibido), proibido)
    assert.match(src, /\/api\/resumos\/canais/)
  })
  test('"Viral" não é estilo nem promessa', () => {
    assert.ok(!(ESTILOS as string[]).includes('Viral'))
    assert.ok((ESTILOS as string[]).includes('Orientado à retenção'))
    for (const f of ['app/(dashboard)/conteudos/gerar/page.tsx', 'app/(dashboard)/video-seller/page.tsx']) assert.doesNotMatch(ler(f), /'Viral'|Versão Viral/, f)
  })
  test('Video Seller não diz "Criar Vídeo" (não cria arquivo) e se declara legado', () => {
    const src = ler('app/(dashboard)/video-seller/page.tsx')
    assert.doesNotMatch(src, /Criar Vídeo/)
    assert.match(src, /Gerar roteiro e prompt/)
    assert.match(src, /não cria o arquivo de vídeo/)
  })
  test('banner: nada de "IA Gerando 24h"/"Mais Vendas Automático"; status real; completo só na Torre', () => {
    const src = ler('components/shared/BoraBanner.tsx')
    const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const proibido of ['IA Gerando', 'Conteúdo 24h', 'Mais Vendas', '>Automático<']) assert.ok(!codigo.includes(proibido), proibido)
    assert.match(src, /\/api\/resumos\/status/)
    assert.match(src, /const completo = pathname === HOME/)
  })
  test('Relatórios: sem "integração em versões futuras"; usa o modelo atual com períodos', () => {
    const src = codigo('app/(dashboard)/relatorios/page.tsx')
    assert.doesNotMatch(src, /versões futuras/)
    assert.match(src, /\/api\/resumos\/relatorio/)
    for (const p of ["'hoje'", "'7'", "'30'", "'custom'"]) assert.ok(src.includes(p), p)
  })
  test('Vídeos: qualquer origem real; nunca "criado pela IA"; só itens com arquivo', () => {
    const src = ler('app/(dashboard)/videos/page.tsx')
    assert.doesNotMatch(src, /pela IA/)
    assert.match(src, /\/api\/resumos\/videos/)
    const lib = ler('lib/resumos.ts')
    assert.match(lib, /videoUrl: \{ not: null \}/)
    assert.match(lib, /if \(!v\?\.arquivo\) return \[\]/)
  })
})

describe('Páginas próprias e rotas protegidas', () => {
  test('Ferramentas, Conteúdo e Vendas & Receita têm página com guarda por QUALQUER módulo da área', () => {
    for (const [f, area] of [['app/(dashboard)/ferramentas/page.tsx', '/ferramentas'], ['app/(dashboard)/conteudo/page.tsx', '/conteudo'], ['app/(dashboard)/vendas-receita/page.tsx', '/vendas-receita']]) {
      assert.match(ler(f), new RegExp(`useGuardModulo\\(modulosDaArea\\('${area}'\\)\\)`), f)
    }
    assert.notEqual(ler('app/(dashboard)/vendas-receita/page.tsx'), ler('app/(dashboard)/vendas-comissoes/page.tsx'))
  })
  test('cada resumo exige sessão e tem regra de módulo', () => {
    const regras: [string, string][] = [
      ['/api/resumos/vendas-receita', 'vendas-comissoes'], ['/api/resumos/canais', 'monetizacao'], ['/api/resumos/conteudo', 'conteudos'],
      ['/api/resumos/ferramentas', 'links'], ['/api/resumos/produtos', 'produtos'], ['/api/resumos/videos', 'videos'],
      ['/api/resumos/relatorio', 'relatorios'], ['/api/resumos/integracoes', 'integracoes'],
    ]
    for (const [rota, modulo] of regras) {
      assert.ok(regraDaRota(rota, 'GET')?.modulos.includes(modulo as never), rota)
      const pasta = rota.replace('/api/', 'app/api/')
      assert.match(ler(`${pasta}/route.ts`), /exigirSessao\(\)/, rota)
    }
    assert.match(ler('app/api/resumos/status/route.ts'), /exigirSessao\(\)/)
  })
})

describe('P1 — primeira camada enxuta, técnico recolhido', () => {
  test('Torre: HOJE (o que fazer agora) → dinheiro → status → agora (produto/etapa/depois) → máx. 3 pendências; técnico em detalhes', () => {
    const src = ler('app/(dashboard)/torre/page.tsx')
    // P2.26: a "próxima ação" é o bloco HOJE no topo (decisão única da Operação); o cartão paralelo saiu.
    assert.doesNotMatch(src, /aria-label="Próxima ação"/)
    const ordem = ['<BlocoHoje />', 'aria-label="Dinheiro"', 'aria-label="Status"', 'aria-label="O que o Patrono está fazendo agora"', 'aria-label="Precisa de você"', 'aria-label="Jornada"', 'aria-label="Detalhes da operação"']
    const pos = ordem.map((o) => src.indexOf(o))
    assert.ok(pos.every((p, i) => p > 0 && (i === 0 || p > pos[i - 1])), `ordem: ${pos.join(',')}`)
    assert.match(src, /precisaDeVoce\.slice\(0, 3\)/)
    assert.match(src, /dinheiro\.slice\(0, 3\)/)
    assert.match(src, /DETALHE_DA_ETAPA\[j\.etapa\]/, 'cada etapa da jornada abre o detalhe')
    assert.match(ler('lib/torre-de-controle.ts'), /agoraEnxuto/)
  })
  test('Precisa de você: cartão com "Ver conteúdo completo"; mídia progressiva (arquivo → origem → campos)', () => {
    const src = ler('components/assistido/PainelAssistido.tsx')
    assert.match(src, /Ver conteúdo completo/)
    assert.match(src, /1\. Enviar fotos? ou vídeos? do produto[\s\S]*2\. De onde veio\?[\s\S]*3\. Confirmar/)
    assert.match(src, /\['PROPRIO', 'É meu'\], \['LICENCIADO', 'Tenho licença'\], \['FORNECEDOR', 'Do vendedor \(autorizada\)'\], \['DESCONHECIDA', 'Outra origem'\]/)
    const primeira = src.slice(src.indexOf('export function CartaoDeAprovacao'), src.indexOf('Ver conteúdo completo'))
    assert.doesNotMatch(primeira, /Hashtags:|Roteiro \(/, 'roteiro e hashtags ficam no conteúdo completo')
    assert.doesNotMatch(ler('app/(dashboard)/precisa-de-voce/page.tsx'), /Por que este produto: \{p\.assistida\.motivoEscolha\}/, 'sem repetir o motivo fora do cartão')
  })
  test('Oportunidades: decisão + até 3 motivos na primeira camada; score/evidência/pesos em "Ver análise completa"', () => {
    const src = ler('app/(dashboard)/oportunidades/page.tsx')
    const card = src.slice(src.indexOf('function CardDoCandidato'), src.indexOf('function mensagemDeErro'))
    const primeira = card.slice(0, card.indexOf('Ver análise completa'))
    assert.match(primeira, /<SeloDecisao/)
    assert.match(primeira, /motivosPositivos\.slice\(0, 3\)/)
    assert.match(primeira, /<DadosPendentes/)
    for (const tecnico of ['Score', 'Base de evidência', 'Confiança', 'Afinidade', 'Aderência', 'Por que está nesta posição', 'Dados desconhecidos']) assert.ok(!primeira.includes(tecnico), tecnico)
    assert.match(card, /Escolher produto/)
    assert.match(ler('components/oportunidades/VisoesDeProdutos.tsx'), /ranking compacto/)
  })
  test('dados ausentes: UMA indicação "Dados oficiais pendentes", não a frase campo a campo', () => {
    const ux = ler('components/shared/Ux.tsx')
    assert.match(ux, /Dados oficiais pendentes \(\{campos\.length\}\)/)
    assert.match(ux, /SEM_DADO_OFICIAL = 'Aguardando dados oficiais'/)
    const src = ler('app/(dashboard)/oportunidades/page.tsx')
    const card = src.slice(src.indexOf('function CardDoCandidato'), src.indexOf('function mensagemDeErro'))
    const primeira = card.slice(0, card.indexOf('Ver análise completa'))
    assert.ok(primeira.length > 200, 'primeira camada encontrada')
    assert.doesNotMatch(primeira, /semDado\(c\)/)
  })
  test('Metas: aviso de API vira indicador discreto + "Saiba mais"; print e registro são contingência', () => {
    const sync = ler('components/metas/SincronizacaoMetas.tsx')
    assert.match(sync, /Sincronização automática indisponível — aguardando fonte oficial/)
    const antesDoSaibaMais = sync.slice(0, sync.indexOf('Saiba mais'))
    assert.doesNotMatch(antesDoSaibaMais, /não oferece API oficial de missões/)
    const metas = ler('app/(dashboard)/tiktok-metas/page.tsx')
    assert.match(metas, /Contingência:/)
    assert.match(metas, /Recomendação do Patrono para hoje: \{m\.hojeRecomendado\}/) // P2.17.14
    assert.match(metas, /<SeloDecisao decisao=\{p\.consultoria\.veredito as Decisao\} \/>/)
    for (const k of ['Recompensa em jogo', 'Ações faltando', 'Prazo mais próximo', 'Missões em risco', 'Produto prioritário']) assert.ok(metas.includes(k), k)
  })
  test('manual vira contingência: programas, resultados, importar imagens, gerar conteúdo, informar produto', () => {
    assert.match(ler('app/(dashboard)/programas/page.tsx'), /Cadastrar manualmente \(contingência\)/)
    assert.match(ler('app/(dashboard)/programas/page.tsx'), /Programas que o Patrono acompanha/)
    assert.match(ler('app/(dashboard)/vendas-comissoes/page.tsx'), /Registrar manualmente \(contingência\)/)
    assert.match(ler('app/(dashboard)/produtos/imagens/page.tsx'), /Modo manual de contingência/)
    assert.match(ler('app/(dashboard)/conteudos/gerar/page.tsx'), /Modo manual \/ avançado/)
    assert.match(ler('app/(dashboard)/oportunidades/page.tsx'), /variant="ghost"[\s\S]{0,160}title="Contingência/)
  })
  test('Produtos: status econômico, vendas/comissão reais, mídia autorizada e conteúdos no cartão', () => {
    const src = ler('app/(dashboard)/produtos/page.tsx')
    for (const s of ['TESTANDO', 'PROMISSOR', 'ESCALAR', 'PAUSAR', 'ENCERRADO']) assert.ok(src.includes(s), s)
    assert.match(src, /\/api\/resumos\/produtos/)
    assert.match(src, /mídia\(s\) autorizada\(s\)/)
  })
  test('Integrações: os 5 status executivos + impacto + próxima ação; configuração técnica abaixo', () => {
    const src = ler('components/integracoes/ResumoDasIntegracoes.tsx')
    for (const s of ['CONECTADO', 'PRECISA DE VOCÊ', 'AGUARDANDO PLATAFORMA', 'BLOQUEADO EXTERNAMENTE', 'NÃO CONFIGURADO']) assert.ok(src.includes(s), s)
    const pagina = ler('app/(dashboard)/integracoes/page.tsx')
    assert.ok(pagina.indexOf('<ResumoDasIntegracoes') > 0 && pagina.indexOf('<ResumoDasIntegracoes') < pagina.indexOf('Configurar conexões'))
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('P2.17.13 — banco de TESTE: resumos não inventam nada', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let R: typeof import('../lib/resumos')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  let ws = ''
  before(async () => {
    ;[{ prisma }, R, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/resumos'), import('./_limpar-workspace-de-teste')])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}ux P2.17.13`, ownerId: `r86-${Date.now()}` }, select: { id: true } })).id
  })
  after(async () => {
    await limpar(prisma, ws, PREFIXO)
    await prisma?.$disconnect()
  })

  test('workspace vazio: dinheiro = null (aguardando dados oficiais), nunca zero', async () => {
    const v = await R.resumoVendasReceita(ws)
    assert.deepEqual([v.hoje.comissao, v.sete.comissao, v.trinta.comissao, v.trinta.vendas, v.trinta.receitaPor1000Views, v.trinta.conversao], [null, null, null, null, null, null])
    assert.deepEqual([v.melhorProduto, v.melhorVideo, v.melhorCanal], [null, null, null])
    const r = await R.relatorioDoPeriodo(ws, new Date(Date.now() - 30 * 864e5), new Date())
    assert.deepEqual([r.receita, r.comissao, r.vendas, r.visualizacoes, r.ctr, r.conversao, r.origemDasMetricas], [null, null, null, null, null, null, null])
    assert.deepEqual(r.vencedores, [])
  })
  test('canais: os 4 principais aparecem; sem registro de programa = STATUS NÃO CONFIRMADO (P2.17.14), receita/comissão null', async () => {
    const c = await R.canaisDeReceita(ws)
    assert.deepEqual(c.map((x) => x.id).sort(), ['amazon-associados', 'mercado-livre', 'shopee', 'tiktok-shop'])
    assert.ok(c.every((x) => x.situacao === 'NAO_CONFIRMADO' && x.receita === null && x.comissao === null))
  })
  test('ferramentas: WhatsApp indisponível fora da hospedagem permitida; Video Seller indisponível sem IA paga', async () => {
    const f = await R.situacaoDasFerramentas(ws, { NETLIFY: 'true', PAID_AI_ENABLED: 'false' })
    assert.deepEqual(f.map((x) => [x.href, x.situacao]), [['/links', 'ATIVA'], ['/whatsapp', 'INDISPONIVEL'], ['/video-seller', 'INDISPONIVEL']])
    assert.match(f[1].motivo, /LGPD/)
  })
  test('banner: status real e ESPECÍFICO (P2.17.14: publicação automática pausada; modo assistido ativo; nenhum vídeo em geração)', async () => {
    const s = await R.statusDoTopo(ws, {})
    assert.deepEqual([s.publicacaoAutomatica, s.assistido.ativo, s.assistido.concluidas, s.fila, s.gerando, s.iaPaga], ['PAUSADA', true, 0, 'VAZIA', 0, 'DESLIGADA'])
  })
  test('conteúdo, vídeos, produtos e integrações: contagens reais (zeros de contagem, sem valor inventado)', async () => {
    const c = await R.resumoConteudo(ws)
    assert.ok(Object.values(c).every((e) => e.total === 0))
    assert.deepEqual(await R.videosDoFluxo(ws), [])
    assert.deepEqual(await R.resumoDosProdutos(ws), {})
    const i = (await R.integracoesExecutivo(ws, { NETLIFY: 'true' })).linhas
    assert.equal(i.find((x) => x.id === 'tiktok-shop')?.situacao, 'BLOQUEADO_EXTERNAMENTE')
    assert.equal(i.find((x) => x.id === 'whatsapp')?.situacao, 'BLOQUEADO_EXTERNAMENTE')
    // Sem app: é ação da titular — o mesmo que a central pede ("Conferir (ou criar) o app no TikTok for Developers").
    assert.equal(i.find((x) => x.id === 'tiktok')?.situacao, 'PRECISA_DE_VOCE')
  })
})
