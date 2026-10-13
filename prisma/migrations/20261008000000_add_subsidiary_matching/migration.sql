CREATE TYPE "KeywordRole" AS ENUM ('OWN_BUSINESS', 'TECHNICAL', 'DEMAND_SIDE', 'PROCUREMENT');
CREATE TYPE "NegativeStrength" AS ENUM ('VETO', 'PENALTY');
CREATE TYPE "CompanyScoreStatus" AS ENUM ('OK', 'NO_DATA');

ALTER TABLE "Contact"
  ADD COLUMN "subsidiaryMatches" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "subsidiaryMatchedAt" TIMESTAMP(3);

CREATE TABLE "subsidiary_keyword" (
  "id" TEXT NOT NULL,
  "subsidiary" TEXT NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "phrase" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "role" "KeywordRole" NOT NULL,
  "negativeStrength" "NegativeStrength",
  "aliasGroup" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subsidiary_keyword_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "company_keyword_score" (
  "id" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "keyword" TEXT NOT NULL DEFAULT '',
  "scores" JSONB,
  "status" "CompanyScoreStatus" NOT NULL DEFAULT 'OK',
  "extractVersion" TEXT NOT NULL,
  "scoreVersions" JSONB,
  "sources" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_keyword_score_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subsidiary_keyword_subsidiary_phrase_key"
  ON "subsidiary_keyword"("subsidiary", "phrase");
CREATE INDEX "subsidiary_keyword_subsidiary_idx"
  ON "subsidiary_keyword"("subsidiary");
CREATE UNIQUE INDEX "company_keyword_score_company_keyword_key"
  ON "company_keyword_score"("company", "keyword");
CREATE INDEX "company_keyword_score_keyword_idx"
  ON "company_keyword_score"("keyword");
CREATE INDEX "company_keyword_score_company_idx"
  ON "company_keyword_score"("company");
CREATE INDEX "Contact_subsidiaryMatches_gin_idx"
  ON "Contact" USING GIN ("subsidiaryMatches");
