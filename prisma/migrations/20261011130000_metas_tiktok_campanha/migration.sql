-- P2.17.3.1 — Campanha que agrupa metas do TikTok Shop e a recompensa total da campanha. Só aditiva.
ALTER TABLE "MetaTikTokShop" ADD COLUMN "campanha" TEXT;
ALTER TABLE "MetaTikTokShop" ADD COLUMN "recompensaCampanha" DOUBLE PRECISION;
