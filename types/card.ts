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

export interface DuplicateEntry {
  row?: number;
  fullName: string | null;
  company: string | null;
  matchedBy: string;
  existingId?: string;
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