import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/permissions";
import type { ContactProfileResult } from "@/types/card";

/**
 * Public by decision, like GET /api/contacts: the directory and the card-level
 * contact fields are world-readable, and only the researched `enrichment` row
 * is withheld.
 *
 * The shaping happens in the QUERY, not after it: an anonymous caller's
 * `include` narrows enrichment to `status`, so the researched columns are never
 * loaded from Postgres at all. Do not "fix" this by selecting the whole row and
 * deleting fields on the way out.
 */
export const dynamic = "force-dynamic";

type FullEnrichmentRow = {
  status: string;
  avatar_url: string | null;
  linkedin_url: string | null;
  linkedin_photo_url: string | null;
  facebook_url: string | null;
  twitter_url: string | null;
  instagram_url: string | null;
  official_site: string | null;
  location: string | null;
  summary: string | null;
  career_background: string | null;
  company_core_business: string | null;
  company_details: string | null;
  sources: string | null;
  other_profiles: string | null;
};

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getCurrentSession();
  const canSeeEnrichment = !!session?.user;

  try {
    const { id } = await params;

    const contact = await prisma.contact.findUnique({
      where: { id },
      include: {
        enrichment: canSeeEnrichment ? true : { select: { status: true } },
      },
    });

    if (!contact) {
      return NextResponse.json(
        { success: false, error: "Contact not found." },
        { status: 404, headers: NO_STORE }
      );
    }

    const row = contact.enrichment;
    const full = canSeeEnrichment ? (row as FullEnrichmentRow | null) : null;

    const result: ContactProfileResult = {
      contact: {
        id: contact.id,
        fullName: contact.fullName,
        jobTitle: contact.jobTitle,
        company: contact.company,
        mobileNumbers: contact.mobileNumbers,
        telephoneNumbers: contact.telephoneNumbers,
        emails: contact.emails,
        website: contact.website,
        address: contact.address,
        companyLocation: contact.companyLocation,
        linkedin: contact.linkedin,
        otherSocials: [],
        rawNotes: contact.rawNotes,
        originalImageUrl: contact.originalImageUrl,
        originalBackImageUrl: contact.originalBackImageUrl,
        subsidiaryMatches: contact.subsidiaryMatches,
        enrichment: row ? { status: row.status } : null,
      },
      canSeeEnrichment,
      enrichment: row
        ? {
            status: row.status,
            avatarUrl: full?.avatar_url ?? null,
            linkedinUrl: full?.linkedin_url ?? null,
            linkedinPhotoUrl: full?.linkedin_photo_url ?? null,
            facebookUrl: full?.facebook_url ?? null,
            twitterUrl: full?.twitter_url ?? null,
            instagramUrl: full?.instagram_url ?? null,
            officialSite: full?.official_site ?? null,
            location: full?.location ?? null,
            summary: full?.summary ?? null,
            careerBackground: full?.career_background ?? null,
            companyCoreBusiness: full?.company_core_business ?? null,
            companyDetails: full?.company_details ?? null,
            sources: full?.sources ?? null,
            otherProfiles: full?.other_profiles ?? null,
          }
        : null,
    };

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error("[Contacts] Failed to load profile:", error);

    return NextResponse.json(
      { success: false, error: "Failed to load profile." },
      { status: 500, headers: NO_STORE }
    );
  }
}
