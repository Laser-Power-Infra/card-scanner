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
