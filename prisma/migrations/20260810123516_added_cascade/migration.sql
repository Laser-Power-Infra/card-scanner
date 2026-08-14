-- DropForeignKey
ALTER TABLE "enrichment" DROP CONSTRAINT "enrichment_contact_id_fkey";

-- AddForeignKey
ALTER TABLE "enrichment" ADD CONSTRAINT "enrichment_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
