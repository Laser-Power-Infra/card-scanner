-- Track every source page that has confirmed this location. Two distinct
-- hosts are the "two-source upgrade" signal in the worker.
ALTER TABLE "CompanyLocation"
  ADD COLUMN "source_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "CompanyLocation"
SET "source_urls" = ARRAY["source_url"]
WHERE "source_url" IS NOT NULL AND btrim("source_url") <> '';
