/**
 * P2.17.14 — QA visual final: contador de integrações de UMA fonte,
 * desconhecido ≠ zero, "não confirmado" ≠ "não cadastrado", recomendação do
 * Patrono ≠ regra do TikTok, publicação automática ≠ automação geral,
 * WhatsApp indisponível não parece operacional. Dados abaixo são FIXTURE.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { INTEGRACOES_DA_TELA, INTEGRACOES_OFICIAIS, PLATAFORMAS_COM_CHAVE } from '../lib/integracoes-da-tela'
import { ROTULO_DO_CANAL } from '../lib/rotulos-de-canal'
import { estadoDaNavegacao, BARRA_DO_CELULAR } from '../lib/navegacao'

const ler = (f: string) => fs.readFileSync(f, 'utf8').split('\r\n').join('\n')
const codigo = (f: string) => ler(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('1. contador de integrações = cartões da tela (uma fonte)', () => {
  test('Y = oficiais (TikTok, TikTok Shop) + plataformas com chave; ids únicos', () => {
    assert.deepEqual(INTEGRACOES_DA_TELA.map((i) => i.id), [...INTEGRACOES_OFICIAIS.map((i) => i.id), ...PLATAFORMAS_COM_CHAVE.map((p) => p.id)])
    assert.equal(new Set(INTEGRACOES_DA_TELA.map((i) => i.id)).size, INTEGRACOES_DA_TELA.length)
    assert.equal(INTEGRACOES_DA_TELA.length, 8)
  })
  test('a página não tem número fixo: contador vem do resumo; cada integração tem cartão com id cfg-<id>', () => {
    const pagina = codigo('app/(dashboard)/integracoes/page.tsx')
    assert.doesNotMatch(pagina, /PLATAFORMAS\.length|de 6|de 7|de 8/)
    assert.match(pagina, /id="cfg-tiktok"/)
    assert.match(pagina, /id="cfg-tiktok-shop"/)
    assert.match(pagina, /id=\{`cfg-\$\{plat\.id\}`\}/)
    const resumo = ler('components/integracoes/ResumoDasIntegracoes.tsx')
    assert.match(resumo, /\{r\.conectadas\} de \{r\.total\}/)
    assert.match(ler('lib/resumos.ts'), /INTEGRACOES_DA_TELA\.map\(/)
  })
  test('detalhes técnicos recolhidos por padrão, "Configurar" abre', () => {
    const pagina = ler('app/(dashboard)/integracoes/page.tsx')
    assert.match(pagina, /<details open=\{configurando\}/)
    assert.match(pagina, /<ResumoDasIntegracoes onConfigurar=\{configurar\} \/>/)
  })
})

describe('2. desconhecido ≠ zero ≠ sem registro', () => {
  test('terminologia única no componente comum', () => {
    const ux = ler('components/shared/Ux.tsx')
    for (const t of ["SEM_DADO_OFICIAL = 'Aguardando dados oficiais'", "NENHUM_REGISTRO = 'Nenhum resultado registrado'", "NAO_CONFIRMADO = 'status não confirmado'"]) assert.ok(ux.includes(t), t)
    assert.match(ux, /semValor = SEM_DADO_OFICIAL/)
  })
  test('Resultados: ledger vazio não vira "R$ 0,00 faturado"', () => {
    const src = ler('app/(dashboard)/vendas-comissoes/page.tsx')
    assert.match(src, /Nenhuma venda registrada ainda\. Sem integração oficial conectada, isto não significa faturamento zero\./)
    assert.match(src, /comissoes\.length === 0 \? <span[^>]*>Nenhum resultado registrado/)
  })
  test('Vendas & Receita, Canais, Relatórios e Links distinguem registro de dado oficial', () => {
    assert.match(ler('app/(dashboard)/vendas-receita/page.tsx'), /semValor="Nenhuma venda registrada"/)
    assert.match(ler('app/(dashboard)/monetizacao/page.tsx'), /'Nenhuma venda registrada'/)
    const rel = ler('app/(dashboard)/relatorios/page.tsx')
    assert.match(rel, /rotulo="Vendas" valor=\{r\.vendas\} semValor=\{NENHUM_REGISTRO\}/)
    assert.match(rel, /rotulo="Visualizações" valor=\{r\.visualizacoes/)
    assert.doesNotMatch(rel, /rotulo="Visualizações"[^/]*semValor/, 'views sem API = desconhecido (padrão)')
    const links = ler('app/(dashboard)/links/page.tsx')
    assert.match(links, /Conversões registradas/)
    assert.match(links, /Receita registrada/)
  })
})

describe('3. status não confirmado ≠ não cadastrado', () => {
  test('rótulos: os seis status corretos; "não cadastrado" é um, "não confirmado" é outro', () => {
    assert.deepEqual(Object.keys(ROTULO_DO_CANAL), ['CONECTADO', 'CADASTRO_CONFIRMADO', 'AGUARDANDO_CONEXAO', 'AGUARDANDO_APROVACAO', 'NAO_CONFIRMADO', 'NAO_CADASTRADO'])
    assert.equal(ROTULO_DO_CANAL.NAO_CONFIRMADO.rotulo, 'STATUS NÃO CONFIRMADO')
    for (const f of ['app/(dashboard)/monetizacao/page.tsx', 'app/(dashboard)/programas/page.tsx']) {
      assert.match(ler(f), /ROTULO_DO_CANAL/, f)
      assert.doesNotMatch(codigo(f), /'não cadastrado'/, f)
    }
  })
  test('Meus Programas = participação; Canais de receita = dinheiro', () => {
    const prog = ler('app/(dashboard)/programas/page.tsx')
    assert.match(prog, /cadastro, aprovação, integração e documentação/)
    assert.doesNotMatch(prog, /c\.receita|c\.comissao/)
    assert.match(ler('app/(dashboard)/monetizacao/page.tsx'), /onde o dinheiro está sendo gerado/)
  })
})

describe('4–6. recomendação ≠ regra; publicação automática ≠ automação; WhatsApp indisponível', () => {
  test('Metas: "Necessário para a meta" (missão) e "Recomendação do Patrono" (nosso cálculo)', () => {
    const src = codigo('app/(dashboard)/tiktok-metas/page.tsx')
    assert.match(src, /Necessário para a meta: faltam \{m\.faltam\}/)
    assert.match(src, /Recomendação do Patrono para hoje: \{m\.hojeRecomendado\}/)
    assert.doesNotMatch(src, /Hoje: publicar/)
  })
  test('banner: nada de "Automação pausada" genérico nem IA paga no topo', () => {
    const src = codigo('components/shared/BoraBanner.tsx')
    assert.doesNotMatch(src, /nome: 'Automação'/)
    assert.doesNotMatch(src, /nome: 'IA paga'/)
    assert.match(src, /nome: 'Publicação automática'/)
    assert.match(src, /nome: 'Modo assistido'/)
    assert.match(ler('lib/resumos.ts'), /publicacaoAutomatica: ws\?\.automationPaused \? 'PAUSADA' : 'LIGADA'/)
  })
  test('WhatsApp: "WhatsApp indisponível" primeiro; formulário recolhido e desabilitado', () => {
    const src = ler('app/(dashboard)/whatsapp/page.tsx')
    assert.ok(src.indexOf('WhatsApp indisponível') < src.indexOf('<Implementacao'))
    assert.match(src, /<fieldset disabled/)
    assert.match(src, /Ver implementação \(desabilitada\)/)
  })
  test('Precisa de você: primeira camada sem Quality Gate/status/evidência; demonstração recolhida', () => {
    const src = ler('components/assistido/PainelAssistido.tsx')
    const primeira = src.slice(src.indexOf('export function CartaoDeAprovacao'), src.indexOf('Ver conteúdo completo'))
    assert.doesNotMatch(primeira, /Quality Gate\{|Status: \{item\.status|Por quê:/)
    const central = ler('app/(dashboard)/precisa-de-voce/page.tsx')
    assert.match(central, /<details className="card-stat space-y-3">\s*<summary[^>]*>DEMONSTRAÇÃO — NÃO CONTA — NÃO PUBLICA/)
  })
  test('ações manuais discretas; "Gerar manualmente" nunca como fluxo normal', () => {
    assert.match(ler('components/dashboard/VisaoGeral.tsx'), /Ações manuais/)
    assert.match(ler('app/(dashboard)/conteudos/page.tsx'), /variant="ghost" size="sm">\s*<Link href="\/conteudos\/gerar">[\s\S]{0,60}Gerar manualmente/)
    assert.doesNotMatch(codigo('app/(dashboard)/produtos/page.tsx'), />Gerar<\/Link>/)
  })
  test('Oportunidades: ranking marca o Top 3 e diz que é comparação', () => {
    const src = ler('components/oportunidades/VisoesDeProdutos.tsx')
    assert.match(src, /top3\.includes\(i\.id\)/)
    assert.match(src, /A decisão principal é o Top 3 acima/)
  })
  test('Torre: "nenhuma tarefa em andamento" (não "PARADO"); missão sem registro ≠ dado oficial', () => {
    assert.match(ler('lib/torre-de-controle.ts'), /agoraFazendo\.status === 'PARADO' \? 'Nenhuma tarefa em andamento'/)
    assert.match(ler('app/(dashboard)/torre/page.tsx'), /rotulo="Missão em jogo"[^/]*semValor="Nenhuma missão registrada"/)
  })
  test('nome longo não incha o cartão (até 2 linhas + texto completo no title)', () => {
    assert.match(ler('components/shared/Ux.tsx'), /title=\{texto\}[^>]*line-clamp-2/)
  })
})

describe('7–10. navegação (desktop e celular)', () => {
  test('barra do celular acende pela mesma regra em todas as subpáginas de Receita', () => {
    for (const r of ['/vendas-receita', '/vendas-comissoes', '/monetizacao']) assert.equal(estadoDaNavegacao(r).area, '/vendas-receita', r)
    assert.ok(BARRA_DO_CELULAR.every((i) => estadoDaNavegacao(i.href).area === i.href))
  })
})

const TEM_BANCO = !!process.env.DATABASE_URL && (process.env.DATABASE_URL ?? '').includes('ref-teste-exemplo')

describe('banco de TESTE: contador e status dos programas', { skip: !TEM_BANCO ? 'exige banco de TESTE' : false }, () => {
  let prisma: typeof import('../lib/prisma').prisma
  let R: typeof import('../lib/resumos')
  let limpar: typeof import('./_limpar-workspace-de-teste').limparWorkspaceDeTeste
  const PREFIXO = 'Conta de Teste — '
  let ws = ''
  let user = ''
  before(async () => {
    ;[{ prisma }, R, { limparWorkspaceDeTeste: limpar }] = await Promise.all([import('../lib/prisma'), import('../lib/resumos'), import('./_limpar-workspace-de-teste')])
    ws = (await prisma.workspace.create({ data: { name: `${PREFIXO}qa P2.17.14`, ownerId: `r87-${Date.now()}` }, select: { id: true } })).id
    user = (await prisma.user.create({ data: { email: `r87-${Date.now()}@teste.local`, name: 'U', password: 'x', workspaceId: ws }, select: { id: true } })).id
  })
  after(async () => {
    await prisma.affiliateProgram.deleteMany({ where: { workspaceId: ws } })
    await prisma.integracao.deleteMany({ where: { workspaceId: ws } })
    await limpar(prisma, ws, PREFIXO)
    await prisma?.$disconnect()
  })

  test('contador: total = integrações da tela; conectadas = as de fato conectadas', async () => {
    const vazio = await R.integracoesExecutivo(ws, { NETLIFY: 'true' })
    assert.equal(vazio.total, INTEGRACOES_DA_TELA.length)
    assert.deepEqual(vazio.linhas.map((l) => l.id), INTEGRACOES_DA_TELA.map((i) => i.id))
    assert.equal(vazio.conectadas, 0)
    assert.equal(Object.values(vazio.porSituacao).reduce((a, b) => a + b, 0), vazio.total)
    await prisma.integracao.create({ data: { workspaceId: ws, userId: user, plataforma: 'shopee', status: 'conectado' } })
    const um = await R.integracoesExecutivo(ws, { NETLIFY: 'true' })
    assert.deepEqual([um.conectadas, um.total], [1, INTEGRACOES_DA_TELA.length])
  })

  test('programas: sem registro = NÃO CONFIRMADO; NOT_REGISTERED = NÃO CADASTRADO; WAITING_APPROVAL = AGUARDANDO APROVAÇÃO', async () => {
    const sem = await R.canaisDeReceita(ws)
    assert.equal(sem.find((c) => c.id === 'tiktok-shop')?.situacao, 'NAO_CONFIRMADO', 'não inferir que não é afiliada só porque não está conectado')
    await prisma.affiliateProgram.create({ data: { workspaceId: ws, platform: 'amazon-associados', status: 'NOT_REGISTERED' } })
    await prisma.affiliateProgram.create({ data: { workspaceId: ws, platform: 'mercado-livre', status: 'WAITING_APPROVAL' } })
    const com = await R.canaisDeReceita(ws)
    assert.equal(com.find((c) => c.id === 'amazon-associados')?.situacao, 'NAO_CADASTRADO')
    assert.equal(com.find((c) => c.id === 'mercado-livre')?.situacao, 'AGUARDANDO_APROVACAO')
    assert.equal(com.find((c) => c.id === 'shopee')?.situacao, 'CONECTADO')
    assert.ok(com.every((c) => c.receita === null && c.comissao === null), 'sem lançamento: null (não zero)')
  })
})
