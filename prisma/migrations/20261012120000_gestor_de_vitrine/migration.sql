-- P2.17.15 — Gestor de Vitrine: motivo de entrada e decisões (com histórico no JSON existente).
ALTER TABLE "VitrineTikTokShop" ADD COLUMN "motivoEntrada" TEXT;
ALTER TABLE "VitrineTikTokShop" ADD COLUMN "decisao" TEXT;
ALTER TABLE "VitrineTikTokShop" ADD COLUMN "motivoDecisao" TEXT;
ALTER TABLE "VitrineTikTokShop" ADD COLUMN "decididoEm" TIMESTAMP(3);
ALTER TABLE "VitrineTikTokShop" ADD COLUMN "removidoEm" TIMESTAMP(3);
