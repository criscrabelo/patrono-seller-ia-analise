# Mapa dos módulos

Guia para quem vai ler, auditar ou continuar o projeto. Tudo aqui foi conferido na árvore do repositório; nomes de arquivo são reais.

## 1. Fluxo comercial → onde está cada etapa
| Etapa | Código principal | Observação |
|---|---|---|
| Produto | `app/(dashboard)/produtos`, `lib/curadoria*.ts`, `lib/motor-de-oportunidades.ts`, `lib/oportunidade*.ts` | catálogo e candidatos |
| Afiliação e link | `lib/affiliate-*.ts`, `lib/link-*.ts`, `app/api/l/[slug]` (redirecionamento público), `app/api/links` | link rastreável com SSRF guard (`lib/destino-publico.ts`) |
| Direito de uso | `lib/cadeia-de-direitos.ts`, `lib/autorizacao-midia-vendedor.ts`, `lib/midia-privada.ts`, `lib/midia-do-produto.ts` | nenhum ativo entra sem direito comprovado |
| Roteiro e legenda | `lib/copy-por-canal.ts`, `lib/captions.ts`, `lib/dna-criativo.ts`, `lib/claude.ts` | IA paga só com `PAID_AI_ENABLED` |
| Narração | `lib/narracao.ts`, `lib/voz/provedor-azure.ts`, `worker/chatterbox_synthesize.py`, `worker/narracao_*.py` | Azure Thalita pronta e desligada; Chatterbox local |
| Vídeo | `lib/video-pro/*`, `lib/renderer-ffmpeg.ts`, `lib/concat-video.ts`, `worker/motor_visual.py`, `worker/gerar_tomadas.py` | montagem local gratuita; IA paga só sob orçamento (`lib/video-pro/orcamento.ts`) |
| Apresentadora virtual | `lib/creative-presenter-mode.ts`, `lib/digital-twin-*.ts`, `worker/` | rig 2,5D local; avatar realista só com consentimento e material novo |
| Revisão e controles | `lib/quality-gate-video-tiktok.ts`, `lib/quality-gate-comercial.ts`, `lib/quality-gate-conformidade.ts`, `lib/barreira-profissional.ts` | `liberacaoParaPublicacao` reúne todos |
| Aprovação | `app/(dashboard)/operacao`, `components/assistido/*`, `lib/publicacao-assistida*.ts`, `lib/aprovacoes.ts` | trava por versão + sha256; arquivo aprovado imutável (`lib/arquivo-aprovado*.ts`) |
| Publicação | `lib/publicacao-*.ts`, `lib/instagram*.ts`, `lib/tiktok-*.ts`, `lib/whatsapp*.ts` | assistida por padrão; automática atrás de flags |
| Resultados | `lib/vendas-comissoes.ts`, `lib/financeiro.ts`, `lib/metricas-*.ts`, `lib/atribuicao-clique.ts`, `lib/ml-*.ts` | fonte única de vendas/comissões |
| Custos | `lib/cost-governor.ts`, `lib/cost-safety-*.ts`, `components/gastos` | teto e reserva por chamada |

## 2. Telas (`app/(dashboard)`)
`operacao` (jornada única) · `aprovacao` · `produtos` (+`imagens`, `novo`, `[id]/editar`) · `conteudos` (+`gerar`, `[id]`) · `videos` · `video-seller` · `publicacoes-assistidas` · `links` · `programas` · `vendas-comissoes` · `vendas-receita` · `monetizacao` · `relatorios` · `calendario` · `oportunidades` · `torre` · `precisa-de-voce` · `tiktok-metas` · `integracoes` (+`shopee`) · `whatsapp` · `ferramentas` · `conta` (+`digital-twin`) · `admin` (`usuarios`, `permissoes`, `eventos`, `saude`, `regras-da-plataforma`). Autenticação em `app/(auth)`; páginas institucionais públicas em `app/(institucional)`.

## 3. API (`app/api`)
Grupos por quantidade de rotas: `tiktok` (27) · `integracoes` (13) · `cron` (11, protegidas por `CRON_SECRET`) · `resumos` (9) · `digital-twin` (8) · `oportunidades` (7) · `conteudos` (7) · `admin` (5) · `operacao`, `auth` (4) · `vendas`, `produtos`, `midias`, `comissoes` (3). Rotas sem sessão são só: `auth`, `l/[slug]`, `cron` (segredo), `webhooks/tiktok` (assinatura). Regra: **negar por padrão** no `middleware.ts`; papéis checados no servidor (`lib/sessao.ts`, rotas `admin/*`).

## 4. Banco (`prisma/`)
`schema.prisma` (61 modelos) e `migrations/` (34). Núcleo: `Workspace`/`User` (isolamento por workspace), `Produto`, `Conteudo`, `Publicacao`, `PublicacaoAssistida`, `LinkDinamico`/`EventoLink`, `Sale`/`Commission`, `AffiliateProgram`, `AutorizacaoDeMidiaDoVendedor`, `MidiaDoProduto`, `IdentityConsent`/`VoiceConsent` (consentimento biométrico), `CostLedger`, `AuditLog`, `DomainEvent`, `AutomationJob`, `MLModel`. Use `prisma migrate deploy` (não `db push`).

## 5. Segurança transversal
`lib/auth.ts`, `lib/sessao.ts`, `lib/politica-de-senha.ts`, `lib/limite-de-tentativas.ts`, `lib/cofre.ts` (AES-256-GCM, rotação por `kid`), `lib/audit-log.ts`, `lib/destino-publico.ts` (SSRF), `lib/guarda-de-ambiente.ts` (impede o banco de produção em ambiente de teste), `lib/segredo-de-rotina.ts` (crons).

## 6. Fora da aplicação
- `worker/` — worker Python/TS local (voz, tomadas, fidelidade, motor visual). Roda na máquina da operadora; pesos e dados biométricos **não** ficam no repositório.
- `netlify/` e `netlify.toml` — funções agendadas e de trabalho longo (referência de hospedagem).
- `scripts/` — `dev/postgres-local.mjs` (banco de teste), `video-pro/`, `teste/`, `desempenho/`, `manutencao/` e seeds de teste.
- `.github/workflows/` — `ci.yml` (build + testes, sem deploy) e `patrono-crons.yml` (agendamento; inerte fora da branch padrão).

## 7. Testes (`tests/`)
Cerca de 180 arquivos. `*.test.ts` rodam com `tsx --test` contra PostgreSQL de teste; `*.test.mjs` exigem servidor em `:3100`. Nome `rodadaNN-…` = rodada de desenvolvimento em que a regra foi fixada. Limite conhecido: os blocos "contra o Supabase de TESTE" (`rodada56`, `rodada57`) precisam de um projeto Supabase real e ficam *skipped* sem ele.

## 8. Convenções
Português nos domínios e nas mensagens; toda regra de negócio crítica tem um teste que a fixa (nome `rodadaNN-…`). Valores monetários: ver `lib/financeiro.ts` antes de alterar (há plano de migração para centavos inteiros ainda não concluído).
