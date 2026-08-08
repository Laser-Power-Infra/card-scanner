import OpenAI from "openai";
import type { CardData } from "@/types/card";

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY is missing. Add it to .env.local and restart the server."
  );
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

export async function extractCardFromImage(
  base64Image: string,
  mediaType: string
): Promise<CardData> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",

    max_tokens: 800,

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
          {
            type: "image_url",
            image_url: {
              url: `data:${mediaType};base64,${base64Image}`,
              detail: "high",
            },
          },
          {
            type: "text",
            text: "Extract all business card details and return valid JSON only.",
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
      ? parsed.mobileNumbers
      : [],

    telephoneNumbers: Array.isArray(parsed.telephoneNumbers)
      ? parsed.telephoneNumbers
      : [],

    emails: Array.isArray(parsed.emails)
      ? parsed.emails
      : [],

    website: parsed.website ?? null,

    address: parsed.address ?? null,

    companyLocation: parsed.companyLocation ?? null,

    linkedin: parsed.linkedin ?? null,

    otherSocials: Array.isArray(parsed.otherSocials)
      ? parsed.otherSocials
      : [],

    rawNotes: parsed.rawNotes ?? null,
  };
}