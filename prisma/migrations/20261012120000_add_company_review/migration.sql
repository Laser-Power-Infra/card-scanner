-- CreateTable
CREATE TABLE "company_review" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "phrases" JSONB,
    "sharedPhrases" JSONB,
    "extractVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_review_company_key" ON "company_review"("company");

-- CreateIndex
CREATE INDEX "company_review_reason_idx" ON "company_review"("reason");
