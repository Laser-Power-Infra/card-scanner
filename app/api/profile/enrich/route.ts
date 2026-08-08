import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { CardData, EnrichedProfile } from "@/types/card";

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY is missing. Add it to .env.local and restart the server."
  );
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const PROMPT = `You are a web researcher and profile enrichment engine.

Using the provided contact information from a business card, attempt to find the person's public profile details.

Return a JSON object with these fields:
{
  "avatarUrl": null,
  "linkedinProfile": null,
  "companyDetails": null,
  "careerBackground": null,
  "location": null,
  "officialSite": null,
  "socialProfiles": [],
  "summary": null
}

Rules:
- Do not invent information. If the data cannot be confirmed, return null or empty lists.
- Prefer official public profile sources like LinkedIn and company websites.
- Use the card's name, company, email domain, and LinkedIn URL if provided.
- If the LinkedIn URL is provided, extract career and company details from it.
- Provide additional social links if clearly associated with the person.
- Return valid JSON only.
`;

type RawSocialProfile = {
  label?: string | null;
  url?: string | null;
};

type RawEnrichedProfile = {
  avatarUrl?: string | null;
  linkedinProfile?: string | null;
  companyDetails?: string | null | Record<string, unknown>;
  careerBackground?: string | null | Record<string, unknown>;
  location?: string | null;
  officialSite?: string | null;
  socialProfiles?: Array<RawSocialProfile | null> | null;
  summary?: string | null | Record<string, unknown>;
};

function safeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return null;
}

function normalizeSocialProfiles(value: unknown): EnrichedProfile["socialProfiles"] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is RawSocialProfile => typeof item === "object" && item !== null)
    .map((item) => ({
      label: safeString(item.label) ?? "Profile",
      url: safeString(item.url) ?? "",
    }))
    .filter((profile) => profile.url);
}

function normalizeProfile(raw: unknown): EnrichedProfile {
  const parsed = raw as RawEnrichedProfile;

  return {
    avatarUrl: safeString(parsed.avatarUrl),
    linkedinProfile: safeString(parsed.linkedinProfile),
    companyDetails: safeString(parsed.companyDetails),
    careerBackground: safeString(parsed.careerBackground),
    location: safeString(parsed.location),
    officialSite: safeString(parsed.officialSite),
    socialProfiles: normalizeSocialProfiles(parsed.socialProfiles),
    summary: safeString(parsed.summary),
  };
}

export async function POST(req: NextRequest) {
  try {
    const contact = (await req.json()) as CardData;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 800,
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content: PROMPT,
        },
        {
          role: "user",
          content: `Contact details: ${JSON.stringify(contact)}`,
        },
      ],
    });

    const json = response.choices[0]?.message?.content;

    if (!json) {
      return NextResponse.json(
        {
          success: false,
          error: "No response from OpenAI.",
        },
        { status: 502 }
      );
    }

    let profile: EnrichedProfile;

    if (typeof json === "string") {
      profile = normalizeProfile(JSON.parse(json));
    } else {
      profile = normalizeProfile(json);
    }

    return NextResponse.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    console.error("Profile enrichment error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to enrich profile.",
      },
      { status: 500 }
    );
  }
}
