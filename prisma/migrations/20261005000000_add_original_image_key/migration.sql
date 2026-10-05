-- Nullable, so every existing contact keeps working and no backfill is needed.
-- The value is an S3 object key (contacts/{year}/{month}/{uuid}.{ext}), never a URL.
ALTER TABLE "Contact" ADD COLUMN "originalImageKey" TEXT;
