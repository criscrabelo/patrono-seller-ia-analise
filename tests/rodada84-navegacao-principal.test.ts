/**
 * P2.17.12 → P2.17.13 — Menu só com operação (9 itens de primeiro nível),
 * estado ativo único (pai + subitem) em qualquer rota, nenhuma rota excluída,
 * Torre como Home.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  MENU_PRINCIPAL, FERRAMENTAS, ADMINISTRACAO, BARRA_DO_CELULAR, HOME, ROTAS_DE_CONTINGENCIA,
  areaAtiva, itemAtivo, areasVisiveis, rotaInicial, rotasDaNavegacao, visiveis, estadoDaNavegacao, modulosDaArea,
} from '../lib/navegacao'
import { MODULO_KEYS, type ModuloKey } from '../lib/modulos'
import { resumoDaAgenda } from '../lib/torre-de-controle'

/** Tudo o que estava na lateral ANTES da P2.17.12 (navItems + Video Seller + admin). */
const MENU_ANTIGO = [
  '/dashboard', '/torre', '/precisa-de-voce', '/produtos', '/produtos/imagens', '/oportunidades', '/tiktok-metas',
  '/publicacoes-assistidas', '/conteudos/gerar', '/conteudos', '/videos', '/aprovacao', '/calendario', '/relatorios',
  '/links', '/programas', '/vendas-comissoes', '/monetizacao', '/integracoes', '/whatsapp', '/video-seller',
  '/admin/usuarios', '/admin/permissoes', '/conta',
]

const paginaExiste = (rota: string) => fs.existsSync(path.join('app', '(dashboard)', ...rota.split('/').filter(Boolean), 'page.tsx'))

describe('P2.17.13 — árvore do menu', () => {
  // P2.18.5: "Operação" (jornada única) entra logo depois da Torre: é a experiência operacional principal.
  test('primeiro nível: exatamente os 10 itens de operação, nesta ordem', () => {
    assert.deepEqual(MENU_PRINCIPAL.map((a) => a.label), [
      'Torre de Controle', 'Operação', 'Precisa de você', 'Oportunidades', 'Produtos', 'Conteúdo', 'Vendas & Receita', 'Relatórios', 'Integrações', 'Ferramentas',
    ])
    assert.deepEqual(FERRAMENTAS.map((i) => i.label), ['Links Dinâmicos', 'WhatsApp em Massa', 'Video Seller'])
    assert.deepEqual(ADMINISTRACAO.map((i) => i.href), ['/admin/usuarios', '/admin/permissoes', '/admin/saude'])
  })

  test('fora da lateral (rotas preservadas): Aprovações, Publicações assistidas, Importar Imagens, Configurações', () => {
    const naLateral = MENU_PRINCIPAL.flatMap((a) => [a.href, ...a.filhos.map((f) => f.href)])
    for (const r of ['/aprovacao', '/publicacoes-assistidas', '/produtos/imagens', '/admin/usuarios', '/admin/permissoes', '/dashboard']) assert.ok(!naLateral.includes(r), r)
    assert.ok(!MENU_PRINCIPAL.some((a) => /Configura/.test(a.label)))
  })

  test('Conteúdo, Vendas & Receita e Ferramentas têm página própria (não repetem um submenu)', () => {
    for (const href of ['/conteudo', '/vendas-receita', '/ferramentas']) {
      const a = MENU_PRINCIPAL.find((x) => x.href === href)!
      assert.equal(a.agregadora, true, href)
      assert.ok(!a.filhos.some((f) => f.href === href), `${href} não pode ser também um subitem`)
      assert.ok(paginaExiste(href), href)
    }
    assert.deepEqual(MENU_PRINCIPAL.find((a) => a.href === '/vendas-receita')!.filhos.map((f) => f.label), ['Resultados', 'Canais de receita'])
  })

  test('Calendário aparece num lugar só (Conteúdo); a rota /calendario é única', () => {
    const todas = MENU_PRINCIPAL.flatMap((a) => [a, ...a.filhos])
    assert.equal(todas.filter((i) => i.href === '/calendario').length, 1)
    assert.equal(areaAtiva('/calendario')?.label, 'Conteúdo')
  })

  test('Video Seller: em Ferramentas pela função real (IA paga, sem catálogo, não salva conteúdo)', () => {
    const rota = fs.readFileSync('app/api/video-seller/route.ts', 'utf8')
    assert.match(rota, /gerarVideoSeller/)
    assert.doesNotMatch(rota, /prisma\./, 'se passar a salvar no Banco de Conteúdos, reavaliar o lugar (Conteúdo)')
    assert.ok(FERRAMENTAS.some((i) => i.href === '/video-seller'))
  })

  test('nenhuma funcionalidade perdida: toda rota antiga continua com página e acende uma área (ou é rodapé/admin)', () => {
    for (const r of MENU_ANTIGO) {
      assert.ok(paginaExiste(r), `sem página: ${r}`)
      assert.ok(areaAtiva(r) || ['/conta', '/admin/usuarios', '/admin/permissoes'].includes(r), `${r} não acende nenhuma área`)
    }
    for (const r of ROTAS_DE_CONTINGENCIA) assert.ok(paginaExiste(r), r)
    const modulos = new Set(MENU_PRINCIPAL.flatMap((a) => [a.modulo, ...a.filhos.map((f) => f.modulo)]))
    for (const m of MODULO_KEYS) assert.ok(modulos.has(m) || m === 'produtos-imagens' || m === 'aprovacao', `módulo ${m} sem lugar`)
  })

  test('nenhum link morto: toda rota da navegação (desktop, celular, admin) tem página', () => {
    for (const r of [...rotasDaNavegacao(), ...BARRA_DO_CELULAR.map((i) => i.href)]) assert.ok(paginaExiste(r), `sem página: ${r}`)
    assert.match(fs.readFileSync('app/(dashboard)/torre/page.tsx', 'utf8'), /href="\/calendario"[^>]*>Abrir calendário/)
  })
})

describe('P2.17.13 — estado ativo único (pai + subitem) em qualquer rota', () => {
  const casos: [string, string, string | null][] = [
    ['/torre', '/torre', null],
    ['/dashboard', '/torre', null],
    ['/precisa-de-voce', '/precisa-de-voce', null],
    ['/aprovacao', '/precisa-de-voce', null],
    ['/publicacoes-assistidas', '/precisa-de-voce', null],
    ['/oportunidades', '/oportunidades', null],
    ['/tiktok-metas', '/oportunidades', '/tiktok-metas'],
    ['/programas', '/oportunidades', '/programas'],
    ['/produtos', '/produtos', null],
    ['/produtos/novo', '/produtos', null],
    ['/produtos/imagens', '/produtos', null],
    ['/produtos/abc/editar', '/produtos', null],
    ['/conteudo', '/conteudo', null],
    ['/conteudos', '/conteudo', '/conteudos'],
    ['/conteudos/abc', '/conteudo', '/conteudos'],
    ['/conteudos/gerar', '/conteudo', '/conteudos/gerar'],
    ['/videos', '/conteudo', '/videos'],
    ['/calendario', '/conteudo', '/calendario'],
    ['/vendas-receita', '/vendas-receita', null],
    ['/vendas-comissoes', '/vendas-receita', '/vendas-comissoes'],
    ['/monetizacao', '/vendas-receita', '/monetizacao'],
    ['/relatorios', '/relatorios', null],
    ['/integracoes', '/integracoes', null],
    ['/integracoes/shopee', '/integracoes', null],
    ['/ferramentas', '/ferramentas', null],
    ['/links', '/ferramentas', '/links'],
    ['/whatsapp', '/ferramentas', '/whatsapp'],
    ['/video-seller', '/ferramentas', '/video-seller'],
  ]
  for (const [rota, area, sub] of casos) {
    test(`${rota} → ${area}${sub ? ` › ${sub}` : ''}`, () => assert.deepEqual(estadoDaNavegacao(rota), { area, subitem: sub }))
  }
  test('fora do menu (conta, admin): nenhuma área acesa', () => {
    for (const r of ['/conta', '/admin/usuarios', '/admin/permissoes']) assert.deepEqual(estadoDaNavegacao(r), { area: null, subitem: null })
  })
  test('Sidebar e barra do celular usam a MESMA regra', () => {
    assert.match(fs.readFileSync('components/shared/Sidebar.tsx', 'utf8'), /estadoDaNavegacao\(pathname\)/)
    assert.match(fs.readFileSync('components/shared/BarraDoCelular.tsx', 'utf8'), /estadoDaNavegacao\(pathname\)/)
    assert.equal(itemAtivo('/conteudos/gerar', ['/conteudos/gerar', '/conteudos']), '/conteudos/gerar')
  })
})

describe('P2.17.13 — tipografia/hierarquia', () => {
  test('primeiro nível: uma única classe (sidebar-item) para todos; subitens: sidebar-subitem com estado ativo', () => {
    const sb = fs.readFileSync('components/shared/Sidebar.tsx', 'utf8')
    assert.match(sb, /className=\{cn\('sidebar-item', aberta && 'active'\)\}/)
    assert.match(sb, /className=\{cn\('sidebar-subitem', sub && 'active'\)\}/)
    const nav = sb.slice(sb.indexOf('<nav'), sb.indexOf('</nav>'))
    assert.doesNotMatch(nav, /SecaoSecundaria|<details/, 'nada de grupos menores/recolhidos no primeiro nível')
    assert.doesNotMatch(nav, /text-(xs|sm|\[)/, 'no menu, o tamanho de fonte vem só das classes comuns')
    const css = fs.readFileSync('app/globals.css', 'utf8')
    assert.match(css, /\.sidebar-subitem \{[\s\S]*?text-xs/)
    assert.match(css, /\.sidebar-subitem\.active \{/)
  })
})

describe('P2.17.12/13 — Home e redirecionamentos', () => {
  test('/ e /dashboard levam à Torre', () => {
    assert.equal(HOME, '/torre')
    for (const f of ['app/page.tsx', 'app/(dashboard)/dashboard/page.tsx']) assert.match(fs.readFileSync(f, 'utf8'), /redirect\(HOME\)/, f)
    assert.match(fs.readFileSync('app/(auth)/login/page.tsx', 'utf8'), /let caminho = '\/torre'/)
    for (const f of ['app/error.tsx', 'app/(dashboard)/error.tsx', 'app/not-found.tsx']) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /href="\/dashboard"/, f)
  })

  test('o Dashboard segue absorvido pela Torre (mesmo conteúdo, sob demanda)', () => {
    assert.match(fs.readFileSync('app/(dashboard)/torre/page.tsx', 'utf8'), /<VisaoGeral \/>/)
    const vg = fs.readFileSync('components/dashboard/VisaoGeral.tsx', 'utf8')
    for (const peca of ['/api/metricas', 'PrimeiraComissaoCard', 'LucroEscala', 'CentralOperacional', 'Conteúdos Recentes']) assert.ok(vg.includes(peca), peca)
  })

  test('módulo bloqueado manda para a Home certa, sem laço', () => {
    assert.equal(rotaInicial(() => true), '/torre')
    // Sem a Torre, a Home é a Operação (mesmo módulo da central de aprovações).
    assert.equal(rotaInicial((m: ModuloKey) => m !== 'dashboard'), '/operacao')
    const so = (lista: ModuloKey[]) => (m: ModuloKey) => lista.includes(m)
    assert.equal(rotaInicial(so(['monetizacao'])), '/vendas-receita', 'agregadora: leva à página-resumo')
    assert.equal(rotaInicial(so(['programas'])), '/programas')
    assert.equal(rotaInicial(so([])), '/conta')
    assert.match(fs.readFileSync('hooks/useGuardModulo.ts', 'utf8'), /rotaInicial\(/)
  })
})

describe('P2.17.13 — permissões', () => {
  test('agregadora aparece com QUALQUER submenu liberado; página-resumo aceita qualquer módulo da área', () => {
    const areas = areasVisiveis((m) => m === 'videos')
    assert.deepEqual(areas.map((a) => [a.label, a.destino]), [['Conteúdo', '/conteudo']])
    assert.deepEqual(areas[0].filhos.map((f) => f.href), ['/videos'])
    assert.deepEqual(modulosDaArea('/ferramentas').sort(), ['links', 'video-seller', 'whatsapp'])
    assert.match(fs.readFileSync('hooks/useGuardModulo.ts', 'utf8'), /modulo: ModuloKey \| ModuloKey\[\]/)
  })
  test('Usuários, Permissões e Saúde do sistema (P2.28): só admin, em Minha conta', () => {
    assert.equal(visiveis(ADMINISTRACAO, () => true, false).length, 0)
    assert.equal(visiveis(ADMINISTRACAO, () => true, true).length, 3)
    assert.match(fs.readFileSync('app/(dashboard)/conta/page.tsx', 'utf8'), /session\?\.user\?\.role === 'admin' &&[\s\S]*ADMINISTRACAO\.map/)
  })
})

describe('P2.17.13 — sininho e celular', () => {
  test('contador no menu (desktop) e no topo (celular), um número só', () => {
    assert.equal(MENU_PRINCIPAL.find((a) => a.href === '/precisa-de-voce')?.badge, true)
    assert.match(fs.readFileSync('components/shared/Header.tsx', 'utf8'), /lg:hidden[\s\S]*BellRing[\s\S]*SininhoBadge/)
    assert.ok(!BARRA_DO_CELULAR.some((i) => i.badge))
  })
  test('celular: Torre, Operação, Precisa de você, Receita e "Mais"; o estado ativo vale para as subpáginas', () => {
    assert.deepEqual(BARRA_DO_CELULAR.map((i) => i.href), ['/torre', '/operacao', '/precisa-de-voce', '/vendas-receita'])
    assert.equal(estadoDaNavegacao('/monetizacao').area, '/vendas-receita')
    assert.match(fs.readFileSync('app/(dashboard)/layout.tsx', 'utf8'), /<BarraDoCelular \/>/)
    assert.match(fs.readFileSync('components/shared/BarraDoCelular.tsx', 'utf8'), /lg:hidden[\s\S]*Mais/)
    assert.match(fs.readFileSync('components/shared/Sidebar.tsx', 'utf8'), /onClick=\{close\}/, 'no celular o menu fecha ao navegar')
  })
})

describe('P2.17.12 — agenda da Torre (resumo do Calendário)', () => {
  test('plano de hoje, próximas e próximo horário — só o que tem data', () => {
    const agora = new Date('2026-10-11T15:00:00Z')
    const inicioHoje = new Date('2026-10-11T03:00:00Z')
    const r = resumoDaAgenda(
      [
        { id: 'a', status: 'agendado', dataAgendamento: new Date('2026-10-11T20:00:00Z'), dataPublicacao: null, produto: { nome: 'FIXTURE A' }, redeSocial: 'instagram' },
        { id: 'b', status: 'publicado', dataAgendamento: new Date('2026-10-11T21:00:00Z'), dataPublicacao: null, produto: { nome: 'FIXTURE B' }, redeSocial: 'tiktok' },
        { id: 'c', status: 'aprovado', dataAgendamento: null, dataPublicacao: null, produto: { nome: 'FIXTURE C' }, redeSocial: null },
        { id: 'd', status: 'agendado', dataAgendamento: new Date('2026-10-13T12:00:00Z'), dataPublicacao: null, produto: null, redeSocial: null },
      ],
      [{ id: 'x', estado: 'AGUARDANDO_APROVACAO', horarioPlanejado: new Date('2026-10-11T17:00:00Z'), nomeProduto: 'FIXTURE X' }],
      agora,
      inicioHoje
    )
    assert.deepEqual(r.hoje.map((i) => i.titulo), ['FIXTURE X · TikTok (assistida)', 'FIXTURE A · instagram'])
    assert.equal(r.proximas.length, 3)
    assert.equal(r.proximoHorario, '2026-10-11T17:00:00.000Z')
  })
})
