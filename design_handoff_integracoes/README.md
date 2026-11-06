# Handoff: Integrações Reais — Patrono Seller IA

## Visão geral
A "Patrono Seller IA" é hoje um **protótipo front-end em HTML/React** (um único arquivo `patrono-app.jsx` + `styles.css`, sem servidor). Ele já tem toda a UI, fluxos e lógica de negócio simulada (dados em memória + `localStorage`). O que falta é conectar de verdade a:

- **Redes sociais**: Instagram, TikTok, Facebook, WhatsApp
- **Marketplaces / afiliados**: Shopee, Mercado Livre, Amazon, Hotmart
- **IA de vídeo**: Veo (Gemini), CapCut

Este pacote documenta **onde** cada integração se encaixa no protótipo e **o que precisa existir** (backend, OAuth, webhooks, banco de dados) para elas funcionarem de verdade.

## Sobre os arquivos de design
Os arquivos HTML/JSX incluídos são **referências de design e comportamento**, não código de produção para copiar direto. Eles mostram exatamente a UI, os textos, os estados e o fluxo esperado. A tarefa do time de desenvolvimento é:
1. Recriar essa UI no stack real do produto (React + backend própio, ou o que já for usado na empresa), reaproveitando o design/estrutura mostrados.
2. Substituir a camada de dados em memória (`window.DATA`, `localStorage`) por chamadas reais a um backend/banco de dados.
3. Implementar as integrações descritas abaixo, alimentando as mesmas telas.

## Fidelidade
**Alta fidelidade (hifi).** As telas, cores, textos e comportamento de UI já estão finalizados — devem ser recriados pixel a pixel. O que é **simulado** (não real) é: login/senha, todas as conexões de conta ("Conectar" só grava um handle digitado), envio de mensagens, geração de vídeo por IA, e todo o cálculo financeiro (roda em cima de números de exemplo). O objetivo deste handoff é tornar essas partes reais.

## Arquitetura necessária (hoje não existe)
O protótipo não tem servidor. Para integrações reais é preciso:

1. **Backend com banco de dados** (Postgres, por exemplo) — hoje tudo vive em `window.DATA` (um objeto JS global) e é persistido só no `localStorage` do navegador de cada pessoa. Isso precisa virar tabelas reais: `contas`, `integracoes_conectadas`, `produtos`, `criativos`, `creators`, `vendedores`, `pagamentos`, `logs_financeiros`, etc. (ver seção "Modelo de dados" abaixo).
2. **Servidor de autenticação/OAuth** — cada rede social/marketplace exige um fluxo OAuth2 (redirect → autorizar → callback com `code` → troca por `access_token`/`refresh_token`). Os tokens **nunca** devem ficar no front-end; guardar criptografados no backend, vinculados à conta/vendedor.
3. **Webhooks** — TikTok, Instagram e Shopee, por exemplo, notificam eventos (novo pedido, status de publicação) via webhook. Precisa de endpoints públicos HTTPS para recebê-los.
4. **Fila/worker assíncrono** — publicação agendada, geração de vídeo por IA e sincronização de vendas devem rodar em background (não bloqueando a UI).
5. **Multiusuário real** — hoje "quem sou eu" (afiliado/vendedor) é escolhido em um `<select>` e persistido em `localStorage`. Isso precisa de login real (e-mail/senha ou SSO) com sessão no servidor, e cada usuário só vendo os próprios dados.

## Integrações — o que cada uma precisa

### Redes sociais (publicação e link dinâmico)
| Plataforma | O que integrar | Onde aparece na UI |
|---|---|---|
| **TikTok** | Content Posting API (postar vídeo), TikTok Shop API (produtos/checkout) | Tela "Publicação", "Integrações" |
| **Instagram** | Graph API (Reels, Carrossel, Stories) via conta Business | Tela "Publicação", "Integrações" |
| **Facebook** | Pages API (posts, Reels) | Tela "Publicação", "Integrações" |
| **WhatsApp** | WhatsApp Business Platform API (mensagens em massa, catálogo) | Tela "Integrações", "WhatsApp em Massa" |

Cada uma segue o padrão: usuário clica "Adicionar conta" → redirect OAuth → callback grava `{provider, account_id, handle, access_token, refresh_token, expires_at}` no backend → UI passa a listar a conta como conectada (troca a simulação de `DATA.integracoes[].contas` por uma consulta real).

### Marketplaces / afiliados
| Plataforma | O que integrar | Onde aparece na UI |
|---|---|---|
| **Shopee** | Open API (produtos, comissões, pedidos) | "Produtos Afiliados", "Lucro e Escala" |
| **Mercado Livre** | API de Afiliados | idem |
| **Amazon** | Amazon Associates API / PA-API | idem |
| **Hotmart** | API de Vendas + Webhook de compra aprovada | idem, "Financeiro" |

Aqui o dado mais importante a sincronizar é **venda por cupom/link** — a tela "Links Dinâmicos" e o campo `cupom` de cada creator (`DATA.creators[].cupom`) já modelam isso; o real trabalho é: quando a plataforma reporta uma venda com aquele cupom, gravar em `vendas` e recalcular comissão do afiliado e margem do vendedor automaticamente (hoje isso é feito manualmente clicando em "Marcar pago").

### IA de vídeo
| Ferramenta | O que integrar | Onde aparece na UI |
|---|---|---|
| **Veo (Gemini)** | API de geração de vídeo a partir de roteiro | "Transformador IA", "Patrono Video Seller" |
| **CapCut** | API/SDK de edição e templates | "Patrono Video Seller" |

## Modelo de dados atual (protótipo → migrar para banco real)
Hoje tudo vive em `window.DATA` (ver `patrono-app.jsx`). As estruturas principais a migrar para tabelas:

- `DATA.integracoes[]` → tabela `integracoes` (`plataforma`, `categoria`) + `contas_conectadas` (`integracao_id`, `conta_id`, `handle`, `token`, `status`)
- `DATA.produtos[]` → tabela `produtos` (inclui `donoId` → `vendedor_id`, `comissao`, `vendas`)
- `DATA.creators[]` → tabela `afiliados` (`cache`, `entregas`, `termo`, `cupom`, `pagamentos` → tabela própria `pagamentos_afiliado`)
- `DATA.vendedores[]` → tabela `vendedores` (`mensalidade`, `plano`, `custos`, `periodicidade`)
- `DATA.linksDinamicos[]` → tabela `links` (`slug`, `cupom`, `cliques`, `vendas`) — cliques/vendas devem vir de tracking real (redirect server-side) e/ou webhook do marketplace
- `DATA.logsFinanceiros[]` → tabela `logs_financeiros`
- `DATA.solicitacoes[]` → tabela `solicitacoes_acesso`

## Autenticação/sessão
Hoje: um botão "Entrar" sem validar nada, e um `<select>` de papel (Admin/Operador/Convidado/Afiliado/Vendedor). Isso precisa virar:
- Login real (e-mail + senha com hash, ou OAuth do próprio Google/etc.)
- Sessão no servidor (JWT ou cookie de sessão)
- Cada afiliado/vendedor só acessa os próprios dados (hoje o "Portal do Afiliado" deixa escolher qualquer creator num dropdown — isso é só para demo)

## Arquivos deste pacote
- `patrono-app.jsx` — toda a lógica e telas do protótipo (React, sem build step, carregado via Babel no navegador)
- `styles.css` — design system completo (cores, tipografia, componentes)
- `Patrono Seller IA.dc.html` — arquivo que carrega os dois acima

## Como usar este pacote no Claude Code
1. Abra os três arquivos para entender a UI e a lógica de cada tela (busque por `DATA.integracoes`, `DATA.produtos`, `DATA.creators`, `DATA.vendedores` para achar rapidamente os pontos de dados simulados).
2. Recrie o projeto no stack real da empresa (ex.: Next.js + Postgres + Prisma), portando as telas.
3. Implemente o backend e OAuth de cada integração da tabela acima, uma por vez — comece pela que tiver maior impacto imediato (ex.: Shopee ou TikTok, se já concentram o volume de vendas).
4. Troque cada leitura de `window.DATA.x` por uma chamada de API real ao backend.
