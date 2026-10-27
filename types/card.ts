export interface CardData {
  id?: string;
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

  otherSocials: {
    label: string;
    url: string;
  }[];

  rawNotes: string | null;

  /** Public URL of the uploaded card image, absent for older contacts. */
  originalImageUrl?: string | null;

  /** Subsidiaries matched for the contact's company. */
  subsidiaryMatches?: string[];

  enrichment?: {
    status: string | null;
  } | null;
}

export interface EnrichedProfile {
  avatarUrl: string | null;
  linkedinProfile: string | null;
  companyDetails: string | null;
  careerBackground: string | null;
  location: string | null;
  officialSite: string | null;
  socialProfiles: {
    label: string;
    url: string;
  }[];
  summary: string | null;
}

/** The researched columns the profile drawer can display. */
export interface ContactProfileEnrichment {
  status: string | null;
  avatarUrl: string | null;
  linkedinUrl: string | null;
  linkedinPhotoUrl: string | null;
  facebookUrl: string | null;
  twitterUrl: string | null;
  instagramUrl: string | null;
  officialSite: string | null;
  location: string | null;
  summary: string | null;
  careerBackground: string | null;
  companyCoreBusiness: string | null;
  companyDetails: string | null;
  sources: string | null;
  otherProfiles: string | null;
}

export interface ContactProfileResult {
  contact: CardData;
  /** False for an anonymous caller; the enrichment object then holds status only. */
  canSeeEnrichment: boolean;
  enrichment: ContactProfileEnrichment | null;
}

export interface DuplicateEntry {
  row?: number;
  fullName: string | null;
  company: string | null;
  matchedBy: string;
  existingId?: string;
}

export type FacetField = "company" | "subsidiary" | "profile" | "state" | "country";

export interface FacetValue {
  value: string;
  count: number;
}

export interface ContactsPageResponse {
  items: CardData[];
  total: number;
  page: number;
  pageSize: number;
  facets: Record<FacetField, FacetValue[]>;
}

export interface ScanResponse {
  success: boolean;
  data?: CardData | CardData[];
  error?: string;
  duplicates?: DuplicateEntry[];
  alreadyExists?: boolean;
  matchedBy?: string;
  message?: string;
}
