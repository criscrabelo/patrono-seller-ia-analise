# Patrono Seller IA

Plataforma própria para **operar campanhas de afiliada**: escolher produto, verificar o direito de usar cada material, gerar roteiro, narração e vídeo, passar por controles de qualidade e conformidade, **aprovação humana**, publicação e acompanhamento de resultados. Regra de ouro: **o sistema executa, a titular aprova**. Nada é publicado sem aprovação.

> Direitos reservados (ver `LICENSE`). A visibilidade deste repositório não concede licença de uso.

## Estado real (leia antes de avaliar)
| Camada | Situação |
|---|---|
| Código das funcionalidades abaixo | **Implementado** |
| Suítes automatizadas (`tests/`) | **Testadas** localmente com PostgreSQL 17 e canais simulados |
| Integrações reais (TikTok, Instagram, Mercado Livre, Azure, Meta) | **Não homologadas neste repositório**: dependem de credenciais e aprovações das plataformas |
| Publicação automática em canal | **Desligada por padrão** (flags `PUBLICACAO_REAL_*`); o caminho usado é o **assistido** (a titular publica no app com o pacote pronto) |
| Serviços de IA pagos (texto, vídeo, voz profissional) | **Desligados por padrão** (`PAID_AI_ENABLED`), com orçamento e travas de custo |

O repositório não contém dados reais, credenciais, gravações nem materiais de terceiros.

## O que a plataforma faz
1. **Produtos e afiliação** — cadastro, programas de afiliados, links rastreáveis, catálogos (TikTok Shop, Mercado Livre, Shopee, Amazon, Hotmart, conforme adaptadores).
2. **Direitos de uso** — cadeia de direitos por ativo (`lib/cadeia-de-direitos.ts`), autorização de mídia do vendedor, consentimento para imagem/voz, armazenamento privado de mídia.
3. **Conteúdo** — roteiros e variantes, legendas com aviso de afiliada/IA, DNA criativo.
4. **Vídeo** — montagem local (FFmpeg), motor de vídeo profissional híbrido (`lib/video-pro/`), narração (Chatterbox local; Azure Thalita pronta e desligada), apresentadora virtual por rig 2,5D, worker Python em `worker/`.
5. **Controles antes da titular** — Quality Gate técnico, comercial e de conformidade + Barreira de Qualidade Profissional (`lib/quality-gate-*.ts`, `lib/barreira-profissional.ts`). O arquivo aprovado é fixado por **sha256 imutável**; o que foi avaliado é o que sai.
6. **Aprovação e publicação** — jornada única em `/operacao`, pacote de publicação, trava por versão + sha256 (a tela que a titular viu é a que vale), registro manual do link com auditoria.
7. **Resultados** — cliques, vendas e comissões por fonte única, atribuição, custos e rentabilidade, controle de gastos de APIs.
8. **Segurança** — papéis no servidor, política de senha, limite de tentativas, trilha de auditoria, cofre AES-256-GCM para tokens, SSRF guard em downloads, isolamento por workspace.

## Pilha
Next.js 15 (App Router) · React 18 · TypeScript · Prisma 5 + PostgreSQL 17 · NextAuth v4 (credenciais) · FFmpeg (`ffmpeg-static`) · Python (worker local) · hospedagem independente (a referência usa Netlify; nada impede outra).

## Como executar localmente (sem Supabase, sem custo)
1. `npm install`
2. Copie `.env.example` para `.env.local` e preencha (valores fictícios bastam para testes).
3. Banco de teste local: `scripts/dev/postgres-local.mjs` (PostgreSQL 17 descartável). Passo a passo e variáveis: **`docs/TESTES-LOCAIS.md`**.
4. `npx prisma migrate deploy` (use as migrations; há constraints só em SQL) e `npm run build`.
5. Testes: `node ./node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 tests/*.test.ts` e, com o servidor em `:3100`, `node --test tests/*.test.mjs`.

Dica de memória: em máquinas com pouca RAM use `--test-concurrency=1` e `NODE_OPTIONS=--max-old-space-size=1024`.

## Mapa
- **`docs/MAPA-DOS-MODULOS.md`** — onde está cada coisa (telas, rotas, módulos, banco, worker, testes).
- `INSTALAR.md` — instalação passo a passo.
- `.env.example` — contrato de variáveis de ambiente.
- `.github/workflows/ci.yml` — CI (build + testes, **sem deploy**).

## Regras que não podem ser quebradas
- Nada é publicado sem a aprovação da titular.
- Nenhum material de terceiro é usado sem licença ou autorização compatível.
- Nenhum dado biométrico (voz, rosto) entra no repositório; consentimento específico e revogável.
- Serviço pago só com orçamento e flag explícitos.
- Mudanças de banco são migrations versionadas.
