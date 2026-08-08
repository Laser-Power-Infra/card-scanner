-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "enrichment" (
    "contact_id" TEXT NOT NULL,
    "status" "EnrichmentStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "expected" INTEGER NOT NULL DEFAULT 0,
    "linkedin_url" TEXT,
    "linkedin_photo_url" TEXT,
    "avatar_url" TEXT,
    "facebook_url" TEXT,
    "twitter_url" TEXT,
    "instagram_url" TEXT,
    "other_profiles" TEXT,
    "company_details" TEXT,
    "company_core_business" TEXT,
    "official_site" TEXT,
    "sources" TEXT,
    "location" TEXT,
    "career_background" TEXT,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "enriched_at" TIMESTAMP(3),

    CONSTRAINT "enrichment_pkey" PRIMARY KEY ("contact_id")
);

-- AddForeignKey
ALTER TABLE "enrichment" ADD CONSTRAINT "enrichment_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
