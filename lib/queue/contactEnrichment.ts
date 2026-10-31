import { randomUUID } from "crypto";
import type { CardData } from "@/types/card";
import { publishProfileCollectionTask } from "./profileCollection";

/** The fields the worker needs from a cleaned contact. */
export interface EnrichmentContact {
  id: string;
  fullName: string | null;
  jobTitle: string | null;
  company: string | null;
  mobileNumbers: string[];
  telephoneNumbers: string[];
  emails: string[];
  website: string | null;
  address: string | null;
  companyLocation: string | null;
  linkedin: string | null;
  originalImageUrl?: string | null;
  originalBackImageUrl?: string | null;
}

function toCardData(contact: EnrichmentContact): CardData {
  return {
    id: contact.id,
    fullName: contact.fullName,
    jobTitle: contact.jobTitle,
    company: contact.company,
    mobileNumbers: contact.mobileNumbers ?? [],
    telephoneNumbers: contact.telephoneNumbers ?? [],
    emails: contact.emails ?? [],
    website: contact.website,
    address: contact.address,
    companyLocation: contact.companyLocation,
    linkedin: contact.linkedin,
    otherSocials: [],
    rawNotes: null,
    originalImageUrl: contact.originalImageUrl ?? null,
    originalBackImageUrl: contact.originalBackImageUrl ?? null,
  };
}

/** Queue the full research pass for one contact. */
export async function publishResearchTask(contact: EnrichmentContact): Promise<boolean> {
  try {
    const queued = await publishProfileCollectionTask({
      tag: "research",
      taskId: randomUUID(),
      contactId: contact.id,
      contact: toCardData(contact),
      timestamp: Date.now(),
    });
    console.log(
      `[ContactEnrichment] Research task ${queued ? "queued" : "NOT queued"} for contactId=${contact.id}`,
    );
    return queued;
  } catch (err) {
    console.error(`[ContactEnrichment] Failed to push research task for ${contact.id}:`, err);
    return false;
  }
}

/** Queue the address pass for one contact. */
export async function publishAddressTask(contact: EnrichmentContact): Promise<boolean> {
  try {
    const queued = await publishProfileCollectionTask({
      tag: "address",
      taskId: randomUUID(),
      contactId: contact.id,
      contact: toCardData(contact),
      timestamp: Date.now(),
    });
    console.log(
      `[ContactEnrichment] Address task ${queued ? "queued" : "NOT queued"} for contactId=${contact.id}`,
    );
    return queued;
  } catch (err) {
    console.error(`[ContactEnrichment] Failed to push address task for ${contact.id}:`, err);
    return false;
  }
}

/**
 * New-contact handoff: research first, then address. The queue consumer is
 * single-prefetch, so the address pass starts after research has written
 * official_site.
 */
export async function publishContactEnrichment(
  contact: EnrichmentContact,
): Promise<{ research: boolean; address: boolean }> {
  const research = await publishResearchTask(contact);
  const address = await publishAddressTask(contact);
  console.log(
    `[ContactEnrichment] contactId=${contact.id} research=${research} address=${address}`,
  );
  return { research, address };
}
