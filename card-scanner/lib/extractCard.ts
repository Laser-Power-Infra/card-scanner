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

You will be shown a photo of a business card.
The card may be:
- rotated
- tilted
- partially visible
- front and back together
- contain multiple phone numbers, emails and websites

Read EVERY printed text carefully.

Return ONLY a valid JSON object.

JSON format:

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

- Extract ALL mobile numbers.
- Extract ALL telephone/landline numbers.
- Never merge mobile and telephone numbers.
- If the card contains 4 phone numbers, return all 4.
- If the card contains 4 email addresses, return all 4.
- Extract company name.
- Extract company address separately as companyLocation.
- Extract website URL.
- Extract LinkedIn URL.
- Extract all social links.
- Normalize URLs by adding https:// when missing.
- Never invent data.
- Use empty arrays when no values exist.
- Return valid JSON only.
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

    max_tokens: 1000,

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

              // Better accuracy for tiny card text
              detail: "high",
            },
          },

          {
            type: "text",
            text:
              "Extract all contact details from this business card. " +
              "Return ONLY the JSON object specified in the instructions.",
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