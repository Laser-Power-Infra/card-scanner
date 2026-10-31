export const QUEUES = {
  PROFILE_COLLECTION: "CS-profile:collection",
} as const;

export const PROFILE_TAGS = [
  "research",
  "linkedin",
  "whatsapp",
  "instagram",
  "facebook",
  "twitter",
] as const;

export type ProfileTag = (typeof PROFILE_TAGS)[number];

/**
 * Tags the worker accepts. `address` is published by the new-contact pipeline
 * after research; it stays out of PROFILE_TAGS so the admin button grid does
 * not grow an address button.
 */
export const ENRICHMENT_QUEUE_TAGS = [...PROFILE_TAGS, "address"] as const;

export type QueueTag = (typeof ENRICHMENT_QUEUE_TAGS)[number];
