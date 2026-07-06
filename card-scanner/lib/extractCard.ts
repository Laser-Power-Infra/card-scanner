import OpenAI from "openai";
import type { CardData } from "@/types/card";

if (!process.env.OPENAI_API_KEY){
  throw new Error("OPENAI_API_KEY is missing. Add it to .env.local and restart the server.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a business card data extraction engine. You will be shown a photo of a business card (it may be rotated, at an angle, or have both front and back visible).

Read every piece of printed text carefully and return ONLY a single JSON object (no markdown fences, no commentary) matching exactly this shape:

{
  "fullName": string or null,
  "jobTitle": string or null,
  "company": string or null,

  "mobileNumbers": string[],

  "telephoneNumbers": string[],

  "emails": string[],

  "website": string or null,

  "address": string or null,

  "companyLocation": string or null,

  "linkedin": string or null,

  "otherSocials": [
    {
      "label": string,
      "url": string
    }
  ],

  "rawNotes": string or null
}

Rules:
- Normalize phone numbers to a readable format but keep the country code if printed.
- "website" should be a full URL (add https:// if missing a scheme).
- "linkedin" should be a full profile URL if a handle or QR-adjacent text implies one; otherwise null.
- "otherSocials" covers any other platform (Twitter/X, Instagram, GitHub, etc). Empty array if none.
- "rawNotes" can hold anything printed that doesn't fit elsewhere (tagline, certifications, extra numbers). Null if nothing extra.
- If a field is not present on the card, use null (or an empty array for list fields). Never invent data.
- Return valid JSON only.`;

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
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
    // gpt-4o-mini is ~16x cheaper than gpt-4o and is plenty accurate for
    // reading printed text off a business card. Bump to "gpt-4o" only if
    // you find it's struggling with handwriting or very stylized fonts.
    model: "gpt-4o-mini",
    max_tokens: 600, // the JSON response is short; no need to allow more
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${mediaType};base64,${base64Image}`,
              // "low" detail uses far fewer (and cheaper) image tokens than
              // "high"/"auto". Business card text is dense but the card
              // itself is a simple, small image, so low detail reads it
              // fine in practice. Switch to "high" if you notice it
              // missing small print on high-resolution photos.
              detail: "low",
            },
          },
          {
            type: "text",
            text: "Extract all contact details from this business card and return the JSON object described in your instructions.",
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
  } catch {
    throw new Error("Could not parse structured data from the card image.");
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

  companyLocation:
    parsed.companyLocation ?? null,

  linkedin: parsed.linkedin ?? null,

  otherSocials: Array.isArray(parsed.otherSocials)
    ? parsed.otherSocials
    : [],

  rawNotes: parsed.rawNotes ?? null,
};
}
