-- CreateEnum
CREATE TYPE "CompanyLocationSource" AS ENUM ('OWN_SITE', 'REGISTRY', 'DIRECTORY', 'MIGRATED');

-- CreateEnum
CREATE TYPE "CompanyLocationPrecision" AS ENUM ('STREET', 'AREA', 'CITY');

-- CreateEnum
CREATE TYPE "CompanyLocationStatus" AS ENUM ('VERIFIED', 'APPROXIMATE');

-- CreateTable
CREATE TABLE "CompanyLocation" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "source_url" TEXT,
    "source_type" "CompanyLocationSource" NOT NULL DEFAULT 'DIRECTORY',
    "precision" "CompanyLocationPrecision" NOT NULL DEFAULT 'AREA',
    "status" "CompanyLocationStatus" NOT NULL DEFAULT 'APPROXIMATE',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "evidence_saved" BOOLEAN NOT NULL DEFAULT true,
    "found_count" INTEGER NOT NULL DEFAULT 1,
    "found_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyLocation_contact_id_idx" ON "CompanyLocation"("contact_id");

-- CreateIndex
CREATE INDEX "CompanyLocation_contact_id_is_primary_idx" ON "CompanyLocation"("contact_id", "is_primary");

-- AddForeignKey
ALTER TABLE "CompanyLocation" ADD CONSTRAINT "CompanyLocation_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every enrichment row that already has address data becomes one
-- location. There is no captured source page or quote for these, so they are
-- marked evidence_saved = false; they can never outrank a sourced location.
INSERT INTO "CompanyLocation" (
    "id",
    "contact_id",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "country",
    "source_type",
    "precision",
    "status",
    "is_primary",
    "evidence_saved",
    "found_at"
)
SELECT
    gen_random_uuid()::text,
    e.contact_id,
    nullif(btrim(e.address_line1), ''),
    nullif(btrim(e.address_line2), ''),
    nullif(btrim(e.city), ''),
    nullif(btrim(e.state), ''),
    nullif(btrim(e.postal_code), ''),
    nullif(btrim(e.country), ''),
    'MIGRATED',
    (CASE
        WHEN nullif(btrim(e.address_line1), '') IS NOT NULL THEN 'STREET'
        WHEN nullif(btrim(e.address_line2), '') IS NOT NULL THEN 'AREA'
        ELSE 'CITY'
    END)::"CompanyLocationPrecision",
    (CASE
        WHEN e.address_verified_at IS NOT NULL THEN 'VERIFIED'
        ELSE 'APPROXIMATE'
    END)::"CompanyLocationStatus",
    true,
    false,
    COALESCE(e.address_verified_at, e.updated_at, now())
FROM enrichment e
WHERE nullif(btrim(concat_ws(
    ' ', e.address_line1, e.address_line2, e.city, e.state,
    e.postal_code, e.country
)), '') IS NOT NULL;
