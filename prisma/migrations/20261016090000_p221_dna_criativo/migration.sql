-- P2.21 — DNA criativo no resultado do vídeo. Aditiva (só colunas novas, todas opcionais).
-- AlterTable
ALTER TABLE "VideoTikTokResultado" ADD COLUMN     "confiancaDoGancho" TEXT,
ADD COLUMN     "formatoDoConteudo" TEXT,
ADD COLUMN     "metodoDoGancho" TEXT,
ADD COLUMN     "origemDaMidia" TEXT,
ADD COLUMN     "origemDoDna" JSONB,
ADD COLUMN     "temDemonstracao" BOOLEAN,
ADD COLUMN     "temNarracao" BOOLEAN,
ADD COLUMN     "temRosto" BOOLEAN,
ADD COLUMN     "temTextoNaTela" BOOLEAN,
ADD COLUMN     "tipoDeCta" TEXT,
ADD COLUMN     "tipoDeGancho" TEXT,
ADD COLUMN     "tipoDeMidia" TEXT,
ADD COLUMN     "versaoDoDna" TEXT;

