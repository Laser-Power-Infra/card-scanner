-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('active', 'inactive');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "status" "ContactStatus" NOT NULL DEFAULT 'active';

-- CreateIndex
CREATE INDEX "Contact_status_createdAt_idx" ON "Contact"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Contact_dedupeKey_idx" ON "Contact"("dedupeKey");
