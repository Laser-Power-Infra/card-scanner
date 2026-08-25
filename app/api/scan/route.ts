import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { extractCardFromImage } from "@/lib/extractCard";
import type { CardData, ScanResponse } from "@/types/card";
import { prisma } from "@/lib/prisma";
import { publishProfileCollectionTask } from "@/lib/queue/profileCollection";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const MAX_BYTES = 8 * 1024 * 1024; // 8MB

function isSpreadsheet(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".csv") ||
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    file.type === "text/csv" ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

// Header aliases -> Contact field. Matching is case/space/punctuation
// insensitive; scalars take the first matching column, arrays collect all.
const FIELD_ALIASES: Record<string, string[]> = {
  fullName: ["name", "full name", "fullname", "contact", "contact name", "person"],
  jobTitle: ["job title", "title", "designation", "position", "role"],
  company: ["company", "company name", "organisation", "organization", "employer", "business", "firm"],
  emails: ["email", "email id", "email address", "emailid", "e-mail", "mail"],
  mobileNumbers: ["mobile", "mobile no", "mobile number", "mobile no.", "cell", "mobile phone"],
  telephoneNumbers: ["telephone", "phone", "office phone", "tel", "landline", "direct"],
  website: ["website", "web", "url", "site", "web site"],
  address: ["address", "street", "postal address"],
  companyLocation: ["location", "city", "state", "company location", "place"],
  linkedin: ["linkedin", "linkedin url", "linkedin profile"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function mapHeader(field: string): string[] {
  return (FIELD_ALIASES[field] ?? []).map(normalizeHeader);
}

function headerToField(headers: string[]): Map<number, string> {
  const fieldByCol = new Map<number, string>();
  const used = new Set<string>();

  for (let i = 0; i < headers.length; i++) {
    const normalized = normalizeHeader(headers[i]);
    if (!normalized) continue;

    let matched: string | null = null;
    for (const field of Object.keys(FIELD_ALIASES)) {
      if (used.has(field)) continue;
      if (mapHeader(field).includes(normalized)) {
        matched = field;
        break;
      }
    }
    // Also allow a header to equal any alias exactly.
    if (!matched) {
      for (const field of Object.keys(FIELD_ALIASES)) {
        if (used.has(field)) continue;
        if (mapHeader(field).some((a) => a === normalized)) {
          matched = field;
          break;
        }
      }
    }

    if (matched) {
      fieldByCol.set(i, matched);
      used.add(matched);
    }
  }

  return fieldByCol;
}

function cellValue(row: any[], i: number): string {
  const v = row[i];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

async function pushResearchTask(contact: {
  id: string;
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
  rawNotes: string | null;
}) {
  try {
    const payload: CardData = {
      id: contact.id,
      fullName: contact.fullName,
      jobTitle: contact.jobTitle,
      company: contact.company,
      mobileNumbers: contact.mobileNumbers ?? [],
      telephoneNumbers: contact.telephoneNumbers ?? [],
      emails: contact.emails ?? [],
      website: contact.website,
      address: contact.address,
      companyLocation: contact.companyLocation,
      linkedin: contact.linkedin,
      otherSocials: [],
      rawNotes: null, // rawNotes is not used for research tasks
    };

    const queued = await publishProfileCollectionTask({
      tag: "research",
      taskId: randomUUID(),
      contactId: contact.id,
      contact: payload,
      timestamp: Date.now(),
    });
    console.log(
      `[Scan] Research task ${queued ? "queued" : "NOT queued"} for contactId=${contact.id}`
    );
  } catch (err) {
    console.error(`[Scan] Failed to push research task for ${contact.id}:`, err);
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    apiKeyPresent: !!process.env.OPENAI_API_KEY,
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const maybeImage = formData.get("image");
    const maybeFile = formData.get("file");
    const file = (maybeImage || maybeFile) as File | null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: "No file was received.",
        },
        { status: 400 }
      );
    }

    // Spreadsheet import path (CSV/XLSX/XLS)
    if (!file.type.startsWith("image/") && isSpreadsheet(file)) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const created: any[] = [];
      const duplicates: any[] = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: null,
        });

        const headers: string[] = (rows.shift() || []).map(
          (h: any, i: number) => {
            if (
              h === null ||
              h === undefined ||
              String(h).trim() === ""
            ) {
              return `column_${i + 1}`;
            }
            return String(h);
          }
        );

        // Map which columns map to which Contact field.
        const fieldByCol = headerToField(headers);

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex];
          const scalar: Record<string, string | null> = {
            fullName: null,
            jobTitle: null,
            company: null,
            website: null,
            address: null,
            companyLocation: null,
            linkedin: null,
          };
          const arrays: Record<string, Set<string>> = {
            emails: new Set(),
            mobileNumbers: new Set(),
            telephoneNumbers: new Set(),
          };

          for (const [colIndex, field] of fieldByCol.entries()) {
            const value = cellValue(row, colIndex);
            if (!value) continue;

            if (field in arrays) {
              arrays[field].add(value);
            } else if (!scalar[field]) {
              scalar[field] = value;
            }
          }

          // Validation: only import rows with both name and company.
          if (!scalar.fullName?.trim() || !scalar.company?.trim()) {
            continue;
          }

          const contactData = {
            fullName: scalar.fullName,
            jobTitle: scalar.jobTitle,
            company: scalar.company,
            mobileNumbers: Array.from(arrays.mobileNumbers),
            telephoneNumbers: Array.from(arrays.telephoneNumbers),
            emails: Array.from(arrays.emails).map((e) => e.toLowerCase()),
            website: scalar.website,
            address: scalar.address,
            companyLocation: scalar.companyLocation,
            linkedin: scalar.linkedin,
          };

          const orClauses: any[] = [];
          for (const e of contactData.emails) orClauses.push({ emails: { has: e } });
          for (const m of contactData.mobileNumbers) orClauses.push({ mobileNumbers: { has: m } });
          for (const t of contactData.telephoneNumbers) orClauses.push({ telephoneNumbers: { has: t } });
          if (contactData.fullName && contactData.company) {
            orClauses.push({
              AND: [
                { fullName: contactData.fullName },
                { company: contactData.company },
              ],
            });
          }

          const exists = await prisma.contact.findFirst({
            where: { OR: orClauses.length ? orClauses : undefined as any },
          });

          if (!exists) {
            const createdContact = await prisma.contact.create({
              data: contactData,
            });
            console.log(`[Scan] Created contact from spreadsheet: ${createdContact}`);
            // await pushResearchTask(createdContact);
            created.push(createdContact);
          } else {
            // Track the duplicate for the user.
            const existingEmails = new Set(
              (exists.emails ?? []).map((e: string) => String(e).toLowerCase())
            );
            const matchedEmails = contactData.emails.filter(
              (e) => existingEmails.has(String(e).toLowerCase())
            );
            const matchedBy =
              matchedEmails.length > 0
                ? `email (${matchedEmails[0]})`
                : `name+company (${contactData.fullName} / ${contactData.company})`;

            duplicates.push({
              row: rowIndex,
              fullName: contactData.fullName,
              company: contactData.company,
              matchedBy,
              existingId: exists.id,
            });
          }
        }
       

      }
      console.log(`[Scan] Duplicate found : ${duplicates.length}`);
      return NextResponse.json({
        success: true,
        data: created,
        duplicates,
      });
    }

    if (!file.type || !ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          success: false,
          error: "Unsupported file type. Upload a business card image (JPEG, PNG, WebP).",
        },
        { status: 415 }
      );
    }

    // Image path
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: "Image is too large. Please upload a file under 8MB.",
        },
        { status: 413 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const data = await extractCardFromImage(base64, file.type);

    if (!data.fullName?.trim() || !data.company?.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "No valid business card detected. Name and company are required.",
        },
        { status: 400 }
      );
    }

    // Avoid duplicates: check existing contacts by emails / phones / name+company
    const emailCandidates = (data.emails ?? []).map((e) => String(e).toLowerCase());
    const mobileCandidates = (data.mobileNumbers ?? []).map((m) => String(m).replace(/[^+0-9]/g, ""));
    const telCandidates = (data.telephoneNumbers ?? []).map((t) => String(t).replace(/[^+0-9]/g, ""));

    const orClauses: any[] = [];
    for (const e of emailCandidates) orClauses.push({ emails: { has: e } });
    for (const m of mobileCandidates) orClauses.push({ mobileNumbers: { has: m } });
    for (const t of telCandidates) orClauses.push({ telephoneNumbers: { has: t } });
    if (data.fullName && data.company) orClauses.push({ AND: [{ fullName: data.fullName }, { company: data.company }] });

    const existing = await prisma.contact.findFirst({ where: { OR: orClauses.length ? orClauses : undefined as any } });

    if (!existing) {
      // No match — create new record
      const created = await prisma.contact.create({
        data: {
          fullName: data.fullName,
          jobTitle: data.jobTitle,
          company: data.company,

          mobileNumbers: data.mobileNumbers ?? [],
          telephoneNumbers: data.telephoneNumbers ?? [],

          emails: (data.emails ?? []).map((e) => String(e).toLowerCase()),

          website: data.website,
          address: data.address,
          companyLocation: data.companyLocation,

          linkedin: data.linkedin,

          rawNotes: data.rawNotes,
        },
      });

      await pushResearchTask(created);
      return NextResponse.json({ success: true, data: created });
    }

    // If found, determine whether there is any new information to merge
    const existingEmails = new Set((existing.emails ?? []).map((e) => String(e).toLowerCase()));
    const matchedEmails = (data.emails ?? []).filter((e) => existingEmails.has(String(e).toLowerCase()));
    const matchedBy = matchedEmails.length > 0
      ? `email (${matchedEmails[0]})`
      : `name+company (${data.fullName} / ${data.company})`;
    const existingMobiles = new Set((existing.mobileNumbers ?? []).map((m) => String(m).replace(/[^+0-9]/g, "")));
    const existingTels = new Set((existing.telephoneNumbers ?? []).map((t) => String(t).replace(/[^+0-9]/g, "")));

    const newEmails = (data.emails ?? []).filter((e) => !existingEmails.has(String(e).toLowerCase()));
    const newMobiles = (data.mobileNumbers ?? []).filter((m) => !existingMobiles.has(String(m).replace(/[^+0-9]/g, "")));
    const newTels = (data.telephoneNumbers ?? []).filter((t) => !existingTels.has(String(t).replace(/[^+0-9]/g, "")));

    const fieldsToUpdate: any = {};

    if (newEmails.length > 0) fieldsToUpdate.emails = Array.from(new Set([...(existing.emails ?? []).map(String), ...newEmails.map(String).map((s) => s.toLowerCase())]));
    if (newMobiles.length > 0) fieldsToUpdate.mobileNumbers = Array.from(new Set([...(existing.mobileNumbers ?? []).map(String), ...newMobiles.map(String)]));
    if (newTels.length > 0) fieldsToUpdate.telephoneNumbers = Array.from(new Set([...(existing.telephoneNumbers ?? []).map(String), ...newTels.map(String)]));

    // For scalar fields, update if incoming has data and existing doesn't
    if (data.jobTitle && !existing.jobTitle) fieldsToUpdate.jobTitle = data.jobTitle;
    if (data.company && !existing.company) fieldsToUpdate.company = data.company;
    if (data.website && !existing.website) fieldsToUpdate.website = data.website;
    if (data.address && !existing.address) fieldsToUpdate.address = data.address;
    if (data.companyLocation && !existing.companyLocation) fieldsToUpdate.companyLocation = data.companyLocation;
    if (data.linkedin && !existing.linkedin) fieldsToUpdate.linkedin = data.linkedin;

    // Merge rawNotes by appending new JSON if different
    if (data.rawNotes && data.rawNotes !== existing.rawNotes) {
      try {
        const merged = { existing: JSON.parse(String(existing.rawNotes || "{}")), incoming: JSON.parse(String(data.rawNotes)) };
        fieldsToUpdate.rawNotes = JSON.stringify(merged);
      } catch {
        fieldsToUpdate.rawNotes = data.rawNotes;
      }
    }

      if (Object.keys(fieldsToUpdate).length === 0) {
        // Nothing new — skip saving
        return NextResponse.json({
          success: true,
          data: existing,
          message: "duplicate_skipped",
          alreadyExists: true,
          matchedBy,
        });
      }

      const updated = await prisma.contact.update({ where: { id: existing.id }, data: fieldsToUpdate });
      await pushResearchTask(updated);
      return NextResponse.json({
        success: true,
        data: updated,
        message: "merged",
        alreadyExists: true,
        matchedBy,
      });
  } catch (err) {
    console.error("Scan error:", err);

    const message =
      err instanceof Error
        ? err.message
        : "Something went wrong while scanning the card.";

    return NextResponse.json<ScanResponse>(
      {
        success: false,
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}