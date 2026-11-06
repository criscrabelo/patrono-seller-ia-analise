# PATRONO SELLER IA — Guia de Instalação

## PRÉ-REQUISITOS

1. Node.js 18+ → https://nodejs.org (baixar versão LTS)
2. Conta Supabase gratuita → https://supabase.com
3. Chave da API da Anthropic → https://console.anthropic.com

---

## PASSO 1 — INSTALAR NODE.JS

Baixe em: https://nodejs.org/pt-br/download
Escolha "LTS" para Windows.
Após instalar, abra o PowerShell e teste:

```
node --version   (deve aparecer v18.x ou superior)
npm --version
```

---

## PASSO 2 — CRIAR PROJETO NO SUPABASE

1. Acesse https://supabase.com e crie uma conta
2. Clique em "New Project"
3. Escolha nome: patrono-seller-ia
4. Anote a senha do banco (você vai precisar)
5. Após criar, vá em: Settings → Database
   - Copie a "Connection string" (URI)
6. Vá em: Settings → API
   - Copie: Project URL, anon/public key, service_role key
7. Vá em: Storage → Create bucket:
   - Nome: "imagens" (public)
   - Nome: "videos" (public)

---

## PASSO 3 — CONFIGURAR VARIÁVEIS DE AMBIENTE

Abra o arquivo `.env.local` nesta pasta e preencha:

```
DATABASE_URL="postgresql://postgres:SUASENHA@db.SEUID.supabase.co:5432/postgres"
NEXTAUTH_SECRET="qualquer-string-aleatoria-longa"
NEXTAUTH_URL="http://localhost:3000"
ANTHROPIC_API_KEY="sk-ant-..."
NEXT_PUBLIC_SUPABASE_URL="https://SEUID.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
SUPABASE_SERVICE_ROLE_KEY="eyJ..."
```

Para gerar o NEXTAUTH_SECRET, execute:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## PASSO 4 — INSTALAR DEPENDÊNCIAS

No PowerShell, navegue até esta pasta e execute:

```powershell
cd "<pasta-onde-você-clonou>\patrono-seller-ia"
npm install
```

Aguarde a instalação (pode demorar 2-5 minutos).

---

## PASSO 5 — CONFIGURAR BANCO DE DADOS

Defina antes, só no seu terminal (nunca em arquivo versionado), as credenciais do primeiro administrador.
A senha precisa ter 12 caracteres ou mais:

```powershell
$env:SEED_ADMIN_EMAIL = "seu-email@exemplo.com"
$env:SEED_ADMIN_PASSWORD = "<senha-forte-gerada-por-voce>"
npm run db:generate
npm run db:push
npm run db:seed
```

Se der erro de conexão, verifique o DATABASE_URL no .env.local.

---

## PASSO 6 — RODAR O SISTEMA

```powershell
npm run dev
```

Acesse: http://localhost:3000

Login: use o e-mail e a senha que você definiu em `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` no Passo 5.
Não existe usuário nem senha padrão. Troque a senha no primeiro acesso se ela passou por e-mail, chat ou arquivo.

---

## PASSO 7 — DEPLOY NA VERCEL (PRODUÇÃO)

1. Instale a CLI da Vercel: `npm install -g vercel`
2. Execute: `vercel`
3. Adicione todas as variáveis de ambiente no painel da Vercel
4. Deploy automático a cada push no GitHub

---

## PROBLEMAS COMUNS

**Erro "Cannot find module @prisma/client"**
→ Execute: `npm run db:generate`

**Erro de conexão com banco**
→ Verifique se o DATABASE_URL está correto e o Supabase está ativo

**Upload de imagem não funciona**
→ Verifique se os buckets "imagens" e "videos" foram criados no Supabase Storage

**Claude API retorna erro**
→ Verifique se a ANTHROPIC_API_KEY está correta e tem créditos

---

## ESTRUTURA DO SISTEMA

- /dashboard    → Visão geral e estatísticas
- /produtos     → Cadastro e gestão de produtos
- /conteudos/gerar → Geração de conteúdo com IA
- /conteudos    → Banco de todos os conteúdos
- /aprovacao    → Fila de aprovação antes de publicar
- /calendario   → Calendário editorial
- /relatorios   → Métricas e relatórios
- /video-seller → Módulo Patrono Video Seller

---

Desenvolvido para o Grupo Patrono — Patrono Seller IA v1.0
