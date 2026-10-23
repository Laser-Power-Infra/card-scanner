-- Add address enrichment columns.
ALTER TABLE "enrichment"
  ADD COLUMN "address_line1" text,
  ADD COLUMN "address_line2" text,
  ADD COLUMN "city" text,
  ADD COLUMN "state" text,
  ADD COLUMN "postal_code" text,
  ADD COLUMN "country" text,
  ADD COLUMN "address_verified_at" timestamp without time zone,
  ADD COLUMN "address_attempts" integer NOT NULL DEFAULT 0;

-- Extend LocationCache without replacing existing columns.
ALTER TABLE "LocationCache"
  ADD COLUMN "placeId" text,
  ADD COLUMN "formattedAddress" text,
  ADD COLUMN "country" text,
  ADD COLUMN "state" text,
  ADD COLUMN "expiresAt" timestamp without time zone,
  ADD COLUMN "normalizedQuery" text;

-- Backfill using the worker's normalization rule: lowercase, collapse whitespace, trim.
UPDATE "LocationCache"
SET "normalizedQuery" = lower(btrim(regexp_replace("query", '\s+', ' ', 'g')))
WHERE "normalizedQuery" IS NULL;

-- Keep the newest row per normalized key if any collisions exist.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(btrim(regexp_replace("query", '\s+', ' ', 'g')))
      ORDER BY "updatedAt" DESC, id
    ) AS rn
  FROM "LocationCache"
)
DELETE FROM "LocationCache"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE "LocationCache"
  ALTER COLUMN "normalizedQuery" SET NOT NULL;

CREATE UNIQUE INDEX "LocationCache_normalizedQuery_key"
  ON "LocationCache" ("normalizedQuery");

CREATE INDEX "LocationCache_expiresAt_idx"
  ON "LocationCache" ("expiresAt");
