-- CreateIndex
CREATE INDEX "Contact_emails_idx" ON "Contact" USING GIN ("emails");
CREATE INDEX "Contact_mobileNumbers_idx" ON "Contact" USING GIN ("mobileNumbers");
CREATE INDEX "Contact_telephoneNumbers_idx" ON "Contact" USING GIN ("telephoneNumbers");
CREATE INDEX "Contact_createdAt_idx" ON "Contact"("createdAt" DESC);
CREATE INDEX "Contact_fullName_company_idx" ON "Contact"("fullName", "company");
CREATE INDEX "enrichment_status_idx" ON "enrichment"("status");
