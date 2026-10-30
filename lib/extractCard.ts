import "dotenv/config";
import OpenAI from "openai";
import type { CardData } from "@/types/card";

const MODEL = process.env.LLM_MODEL || "gpt-6-luna";


const SYSTEM_PROMPT = `
You are a business card data extraction engine.

Extract all business card information and return ONLY valid JSON.

IMPORTANT RULES:

1. Extract ALL mobile numbers.
2. Extract ALL telephone numbers.
3. Never merge mobile and telephone numbers.
4. If 4 phone numbers exist, return all 4.
5. If number contains Mobile, Cell, M, Mob -> mobileNumbers.
6. If number contains Tel, Telephone, Office, Direct, Fax -> telephoneNumbers.
7. Extract ALL email addresses.
8. Extract company name separately.
9. Extract company location separately if present.
10. Normalize website URLs by adding https:// if missing.
11. Extract LinkedIn URLs if present.
12. Extract all social media URLs.
13. Never invent values.
14. Use null for missing string fields.
15. Use [] for missing array fields.
16. Return JSON only.

When more than one image is supplied, they are the front and back of the SAME
business card. Merge them into one record:

- Take each field from the first image that has it.
- Combine emails, mobileNumbers, telephoneNumbers and otherSocials from all
  images, removing duplicates.
- Prefer the more complete value when the two sides disagree; never emit the
  same phone number or email twice.
- Treat the images as one card, not two contacts.

Return exactly this structure:

{
  "fullName": null,
  "jobTitle": null,
  "company": null,
  "mobileNumbers": [],
  "telephoneNumbers": [],
  "emails": [],
  "website": null,
  "address": null,
  "companyLocation": null,
  "linkedin": null,
  "otherSocials": [],
  "rawNotes": null
}
`;

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced) {
    return fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }

  return text.trim();
}

export interface CardImage {
  base64: string;
  mediaType: string;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueSocials(socials: CardData["otherSocials"]): CardData["otherSocials"] {
  const seen = new Set<string>();

  return socials.filter((social) => {
    const key = social.url.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function extractCardFromImages(
  images: CardImage[]
): Promise<CardData> {
  if (images.length === 0) {
    throw new Error("No card images were supplied.");
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is missing. Add it to .env.local and restart the server."
    );
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await openai.chat.completions.create({
    model: MODEL,

    max_completion_tokens: 800,

    response_format: {
      type: "json_object",
    },

    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          ...images.map((image) => ({
            type: "image_url" as const,
            image_url: {
              url: `data:${image.mediaType};base64,${image.base64}`,
              detail: "high" as const,
            },
          })),
          {
            type: "text" as const,
            text:
              images.length > 1
                ? "These are the front and back of the same business card. Extract and merge all details into one valid JSON object."
                : "Extract all business card details and return valid JSON only.",
          },
        ],
      },
    ],
  });

  const text = response.choices[0]?.message?.content;

  if (!text) {
    throw new Error("No text response received from the model.");
  }

  const jsonString = extractJson(text);

  let parsed: Partial<CardData>;

  try {
    parsed = JSON.parse(jsonString);

    console.log("===== EXTRACTED DATA =====");
    console.log(JSON.stringify(parsed, null, 2));
    console.log("==========================");
  } catch {
    throw new Error(
      "Could not parse structured data from the card image."
    );
  }

  return {
    fullName: parsed.fullName ?? null,

    jobTitle: parsed.jobTitle ?? null,

    company: parsed.company ?? null,

    mobileNumbers: Array.isArray(parsed.mobileNumbers)
      ? uniqueStrings(parsed.mobileNumbers.map(String))
      : [],

    telephoneNumbers: Array.isArray(parsed.telephoneNumbers)
      ? uniqueStrings(parsed.telephoneNumbers.map(String))
      : [],

    emails: Array.isArray(parsed.emails)
      ? uniqueStrings(parsed.emails.map(String))
      : [],

    website: parsed.website ?? null,

    address: parsed.address ?? null,

    companyLocation: parsed.companyLocation ?? null,

    linkedin: parsed.linkedin ?? null,

    otherSocials: Array.isArray(parsed.otherSocials)
      ? uniqueSocials(parsed.otherSocials)
      : [],

    rawNotes: parsed.rawNotes ?? null,
  };
}

export async function extractCardFromImage(
  base64Image: string,
  mediaType: string
): Promise<CardData> {
  return extractCardFromImages([{ base64: base64Image, mediaType }]);
}
