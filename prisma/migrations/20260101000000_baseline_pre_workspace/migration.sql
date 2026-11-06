-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'usuario',
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuloPermissao" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "liberado" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuloPermissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkDinamico" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plataforma" TEXT NOT NULL,
    "urlDestino" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'afiliado',
    "comissao" DOUBLE PRECISION,
    "precoAtual" DOUBLE PRECISION,
    "cliques" INTEGER NOT NULL DEFAULT 0,
    "conversoes" INTEGER NOT NULL DEFAULT 0,
    "receitaTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimaAtualizacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkDinamico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoLink" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "plataforma" TEXT,
    "referer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integracao" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plataforma" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'desconectado',
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "accountId" TEXT,
    "accountName" TEXT,
    "extraData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "preco" DOUBLE PRECISION,
    "linkProduto" TEXT,
    "descricao" TEXT,
    "publicoAlvo" TEXT[],
    "origemConteudo" TEXT NOT NULL,
    "tipoVenda" TEXT NOT NULL,
    "observacoes" TEXT,
    "beneficios" TEXT[],
    "pontosNegativos" TEXT[],
    "imagens" TEXT[],
    "videos" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conteudo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "roteiro" TEXT,
    "legendaTiktok" TEXT,
    "legendaInstagram" TEXT,
    "legendaYoutube" TEXT,
    "legendaWhatsapp" TEXT,
    "legendaFacebook" TEXT,
    "legendaMarketplace" TEXT,
    "hashtags" TEXT[],
    "textoTela" TEXT,
    "narracao" TEXT,
    "trilhaSugerida" TEXT,
    "promptVideoIA" TEXT,
    "promptCurto" TEXT,
    "promptNarracao" TEXT,
    "chamadaAcao" TEXT,
    "estilo" TEXT,
    "duracao" INTEGER,
    "redeSocial" TEXT,
    "objetivo" TEXT,
    "notaProduto" DOUBLE PRECISION,
    "pontosPositivos" TEXT[],
    "pontosNegativos" TEXT[],
    "veredito" TEXT,
    "status" TEXT NOT NULL DEFAULT 'roteiro_gerado',
    "dataPublicacao" TIMESTAMP(3),
    "dataAgendamento" TIMESTAMP(3),
    "visualizacoes" INTEGER NOT NULL DEFAULT 0,
    "cliquesLink" INTEGER NOT NULL DEFAULT 0,
    "comentarios" INTEGER NOT NULL DEFAULT 0,
    "compartilhamentos" INTEGER NOT NULL DEFAULT 0,
    "taxaConclusao" DOUBLE PRECISION,
    "alertasCompliance" JSONB[],
    "videoUrl" TEXT,
    "videoRequestId" TEXT,
    "videoErro" TEXT,
    "publicacaoExternaId" TEXT,
    "erroPublicacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conteudo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ModuloPermissao_role_modulo_key" ON "ModuloPermissao"("role", "modulo");

-- CreateIndex
CREATE UNIQUE INDEX "LinkDinamico_slug_key" ON "LinkDinamico"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Integracao_userId_plataforma_key" ON "Integracao"("userId", "plataforma");

-- AddForeignKey
ALTER TABLE "LinkDinamico" ADD CONSTRAINT "LinkDinamico_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkDinamico" ADD CONSTRAINT "LinkDinamico_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoLink" ADD CONSTRAINT "EventoLink_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "LinkDinamico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integracao" ADD CONSTRAINT "Integracao_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conteudo" ADD CONSTRAINT "Conteudo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conteudo" ADD CONSTRAINT "Conteudo_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

