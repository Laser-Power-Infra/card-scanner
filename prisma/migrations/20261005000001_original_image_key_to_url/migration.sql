-- The column now stores the bucket's public URL for the card image, not the S3
-- object key. Renamed in place: both are nullable and one-to-one with the row,
-- so a rename preserves existing values without a backfill. Rows written before
-- this migration still hold key-shaped values and must be backfilled with the
-- real base URL (<AWS_ENDPOINT_URL_S3>/<AWS_S3_BUCKET>/<key>) or reset.
ALTER TABLE "Contact" RENAME COLUMN "originalImageKey" TO "originalImageUrl";
