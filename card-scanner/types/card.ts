export interface CardData {
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
}

export interface ScanResponse {
  success: boolean;
  data?: CardData;
  error?: string;
}