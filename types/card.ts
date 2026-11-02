export type LocationStatus = "VERIFIED" | "APPROXIMATE";
export type LocationPrecision = "STREET" | "AREA" | "CITY";

/** The CompanyLocation fields the directory table needs; a contact has up to 3. */
export interface CompanyLocationSummary {
  id: string;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  is_primary: boolean;
  status: LocationStatus;
  precision: LocationPrecision;
}

export type LocationSource = "OWN_SITE" | "REGISTRY" | "DIRECTORY" | "MIGRATED";

/**
 * A CompanyLocation as the profile shows it: the full address on top of the
 * list summary. The three `source_*` fields are provenance (which scraped page
 * an address came from) and are only ever loaded for a signed-in caller.
 */
export interface CompanyLocationDetail extends CompanyLocationSummary {
  address_line2: string | null;
  postal_code: string | null;
  source_url?: string | null;
  source_urls?: string[];
  source_type?: LocationSource;
}

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

  /** Public URL of the second (usually back) card photo, when one was scanned. */
  originalBackImageUrl?: string | null;

  /** Subsidiaries matched for the contact's company. */
  subsidiaryMatches?: string[];

  /** Worker-found locations, primary first. Absent on list rows that did not load them. */
  companyLocations?: CompanyLocationSummary[];

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
  /** ISO time the primary address was last verified; signed-in only. */
  addressVerifiedAt: string | null;
}

export interface ContactProfileResult {
  contact: CardData;
  /** False for an anonymous caller; the enrichment object then holds status only. */
  canSeeEnrichment: boolean;
  enrichment: ContactProfileEnrichment | null;
  /** Worker-found locations, primary first. Provenance fields only when `canSeeEnrichment`. */
  locations: CompanyLocationDetail[];
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

/** One pin on the Map tab: a single CompanyLocation with coordinates. */
export interface LocationPoint {
  /** CompanyLocation id: a contact with several locations has several points. */
  id: string;
  contactId: string;
  fullName: string | null;
  company: string | null;
  /** "City, State", else the street line; null when the row has neither. */
  label: string | null;
  address: string | null;
  lat: number;
  lng: number;
  isPrimary: boolean;
  status: LocationStatus;
  precision: LocationPrecision;
}

export interface LocationPointsResponse {
  points: LocationPoint[];
  /** Contacts matching the current search and filters. */
  contactsTotal: number;
  /** Of those, how many have at least one geocoded location. */
  contactsPlotted: number;
  /** True when the pin cap was hit, so some locations are not in `points`. */
  truncated: boolean;
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
