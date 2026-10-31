import { NextRequest, NextResponse, after } from "next/server";
import { extractCardFromImage, extractCardFromImages, type CardImage } from "@/lib/extractCard";
import type { ScanResponse } from "@/types/card";
import { prisma } from "@/lib/prisma";
import {
  publishContactEnrichment,
  publishResearchTask,
} from "@/lib/queue/contactEnrichment";
import { processContactById } from "@/lib/contactPipeline";
import { resolveLocationCoords } from "@/lib/location";
import { MAX_CARD_PHOTOS } from "@/lib/scan";
import {
  buildOriginalImageKey,
  buildOriginalImageUrl,
  deleteOriginalImage,
  uploadOriginalImage,
} from "@/lib/s3";
import { contactDerivedFields, dedupeKey } from "@/lib/contact";
import * as XLSX from "xlsx";

async function preCacheLocation(locationText?: string | null) {
  if (!locationText) return;
  const query = locationText.trim().toLowerCase();
  if (!query) return;
  try {
    const existing = await prisma.locationCache.findUnique({ where: { query } });
    if (!existing) {
      const coords = await resolveLocationCoords({
        companyLocation: locationText,
        address: locationText,
      });
      await prisma.locationCache.upsert({
        where: { query },
        create: {
          query,
          normalizedQuery: query.replace(/\s+/g, " ").trim().toLowerCase(),
          latitude: coords ? coords[0] : null,
          longitude: coords ? coords[1] : null,
          resolved: true,
        },
        update: {},
      });
    }
  } catch (err) {
    console.error("[preCacheLocation] Error:", err);
  }
}

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

/**
 * New-contact event. Runs after the response is sent so a slow cleanup/LLM
 * pass never blocks the scan. Processes one contact at a time.
 */
async function runNewContactCleanup(ids: string[]) {
  // Bound the expensive name/job/company LLM pass on large spreadsheet imports.
  // Deterministic cleaning still runs for every row.
  const maxLlmRows = Number(process.env.CONTACT_CLEANUP_LLM_MAX ?? 25);
  let llmBudget = Number.isFinite(maxLlmRows) && maxLlmRows >= 0 ? maxLlmRows : 25;

  for (const id of ids) {
    try {
      const result = await processContactById(id, { llm: llmBudget > 0 });
      if (result.llmUsed) llmBudget -= 1;
      if (result.contact) {
        await publishContactEnrichment(result.contact);
      }
    } catch (err) {
      console.error(`[Scan] Post-create cleanup failed for contactId=${id}:`, err);
    }
  }
}

function scheduleNewContactCleanup(ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;

  try {
    after(() => runNewContactCleanup(unique));
  } catch {
    // outside a request scope (unit tests): run detached instead of failing
    void runNewContactCleanup(unique);
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    apiKeyPresent: !!process.env.OPENAI_API_KEY,
  });
}

// The object goes up before the row goes in, so a storage failure can never
// leave a contact whose image does not exist. Only the key is stored: a public
// URL would need a public bucket and a presigned one expires.
async function storeOriginalImage(
  file: File
): Promise<{ key: string; url: string }> {
  const key = buildOriginalImageKey(file.type, file.name);

  await uploadOriginalImage(key, Buffer.from(await file.arrayBuffer()), file.type);

  return { key, url: buildOriginalImageUrl(key) };
}

// The upload failed, so there is nothing to write and nothing to compensate.
// The message is fixed: an SDK error can name the bucket and the key, and this
// route answers anonymous callers.
function imageStorageFailed() {
  return NextResponse.json(
    {
      success: false,
      error: "Could not store the uploaded image. Please try again.",
    },
    { status: 500 }
  );
}

async function deleteUploadedImages(keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      await deleteOriginalImage(key);
    } catch (cleanupErr) {
      console.error(`[Scan] Failed to clean up object ${key}:`, cleanupErr);
    }
  }
}

/**
 * Runs `write` and, if the database rejects it, drops the objects we just
 * uploaded so the bucket does not accumulate unreferenced cards. The cleanup
 * is best-effort — the database error is the one worth reporting, so a failed
 * delete is logged and swallowed rather than replacing it.
 */
async function persistWithImageCleanup<T>(
  imageKeys: string[],
  write: () => Promise<T>
): Promise<T> {
  try {
    return await write();
  } catch (err) {
    for (const imageKey of imageKeys) {
      try {
        await deleteOriginalImage(imageKey);
      } catch (cleanupErr) {
        console.error(`[Scan] Failed to clean up object ${imageKey}:`, cleanupErr);
      }
    }

    throw err;
  }
}

export async function POST(req: NextRequest) {
  // Public by decision: anonymous visitors may scan. See PUBLIC_API_PATHS in
  // lib/permissions.ts. The 8 MB cap and the MIME allowlist further down are
  // now the only thing between an unauthenticated caller and a billable OpenAI
  // vision call, so they are load-bearing rather than cosmetic.
  try {
    const formData = await req.formData();
    const maybeImages = formData.getAll("images").filter((value): value is File => value instanceof File);
    const maybeImage = formData.get("image");
    const maybeFile = formData.get("file");

    // `images` is the two-photo contract. `image` and `file` remain accepted so
    // older clients and single-photo callers keep working.
    const photos = maybeImages.length
      ? maybeImages
      : [
          maybeImage instanceof File ? maybeImage : null,
          maybeFile instanceof File && maybeFile.type.startsWith("image/") ? maybeFile : null,
        ].filter((value): value is File => value !== null);

    const spreadsheet =
      photos.length === 0 && maybeFile instanceof File && isSpreadsheet(maybeFile)
        ? maybeFile
        : null;

    if (photos.length === 0 && !spreadsheet) {
      if (maybeFile instanceof File) {
        return NextResponse.json(
          {
            success: false,
            error: "Unsupported file type. Upload a business card image (JPEG, PNG, WebP).",
          },
          { status: 415 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: "No file was received.",
        },
        { status: 400 }
      );
    }

    if (photos.length > MAX_CARD_PHOTOS) {
      return NextResponse.json(
        {
          success: false,
          error: `Scan at most ${MAX_CARD_PHOTOS} photos at a time.`,
        },
        { status: 400 }
      );
    }

    // Spreadsheet import path (CSV/XLSX/XLS)
    if (spreadsheet) {
      const buffer = Buffer.from(await spreadsheet.arrayBuffer());
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const created: any[] = [];
      const createdIds: string[] = [];
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

          const key = dedupeKey(contactData);
          if (key) orClauses.push({ dedupeKey: key });

          const exists = orClauses.length
            ? await prisma.contact.findFirst({ where: { status: "active", OR: orClauses } })
            : null;

          if (!exists) {
            const createdContact = await prisma.contact.create({
              data: { ...contactData, ...contactDerivedFields(contactData) },
            });
            console.log(`[Scan] Created contact from spreadsheet: ${createdContact.id}`);
            preCacheLocation(createdContact.companyLocation || createdContact.address);
            createdIds.push(createdContact.id);
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
      scheduleNewContactCleanup(createdIds);
      return NextResponse.json({
        success: true,
        data: created,
        duplicates,
      });
    }

    for (const photo of photos) {
      if (!photo.type || !ALLOWED_IMAGE_TYPES.includes(photo.type)) {
        return NextResponse.json(
          {
            success: false,
            error: "Unsupported file type. Upload a business card image (JPEG, PNG, WebP).",
          },
          { status: 415 }
        );
      }

      if (photo.size > MAX_BYTES) {
        return NextResponse.json(
          {
            success: false,
            error: "Image is too large. Please upload a file under 8MB.",
          },
          { status: 413 }
        );
      }
    }

    const cardImages: CardImage[] = [];

    for (const photo of photos) {
      const arrayBuffer = await photo.arrayBuffer();
      cardImages.push({
        base64: Buffer.from(arrayBuffer).toString("base64"),
        mediaType: photo.type,
      });
    }

    const data =
      cardImages.length === 1
        ? await extractCardFromImage(cardImages[0].base64, cardImages[0].mediaType)
        : await extractCardFromImages(cardImages);

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

    const key = dedupeKey({ ...data, emails: emailCandidates, mobileNumbers: mobileCandidates, telephoneNumbers: telCandidates });
    if (key) orClauses.push({ dedupeKey: key });

    const existing = orClauses.length
      ? await prisma.contact.findFirst({ where: { status: "active", OR: orClauses } })
      : null;

    if (!existing) {
      // No match — create new record
      const stored: { key: string; url: string }[] = [];

      try {
        for (const photo of photos) {
          stored.push(await storeOriginalImage(photo));
        }
      } catch (uploadErr) {
        console.error("[Scan] Failed to upload the scanned image:", uploadErr);
        await deleteUploadedImages(stored.map((image) => image.key));
        return imageStorageFailed();
      }

      if (stored.length !== photos.length) {
        await deleteUploadedImages(stored.map((image) => image.key));
        return imageStorageFailed();
      }

      const created = await persistWithImageCleanup(stored.map((image) => image.key), () =>
        prisma.contact.create({
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

            originalImageUrl: stored[0]?.url ?? null,
            originalBackImageUrl: stored[1]?.url ?? null,

            ...contactDerivedFields({
              ...data,
              emails: (data.emails ?? []).map((e) => String(e).toLowerCase()),
              mobileNumbers: data.mobileNumbers ?? [],
              telephoneNumbers: data.telephoneNumbers ?? [],
            }),
          },
        })
      );

      preCacheLocation(created.companyLocation || created.address);
      scheduleNewContactCleanup([created.id]);
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

    // A stored image is never replaced. A contact that already has a front or
    // back keeps it, so a repeat scan of the same card uploads nothing and
    // cannot overwrite the reference; a missing slot takes a new photo, which
    // makes it a genuinely new field like every other merge above.
    const missingFront = !existing.originalImageUrl;
    const missingBack = !existing.originalBackImageUrl;
    const photosToStore = missingFront
      ? photos.slice(0, missingBack ? 2 : 1)
      : missingBack && photos.length > 1
        ? [photos[1]]
        : [];

    if (
      Object.keys(fieldsToUpdate).length === 0 &&
      photosToStore.length === 0
    ) {
      // Nothing new — skip saving
      return NextResponse.json({
        success: true,
        data: existing,
        message: "duplicate_skipped",
        alreadyExists: true,
        matchedBy,
      });
    }

    const stored: { key: string; url: string }[] = [];

    try {
      for (const photo of photosToStore) {
        stored.push(await storeOriginalImage(photo));
      }
    } catch (uploadErr) {
      console.error("[Scan] Failed to upload the scanned image:", uploadErr);
      await deleteUploadedImages(stored.map((image) => image.key));
      return imageStorageFailed();
    }

    const storedKeys = stored.map((image) => image.key);

    if (missingFront && stored.length > 0) {
      fieldsToUpdate.originalImageUrl = stored.shift()!.url;
    }

    if (missingBack && stored.length > 0) {
      fieldsToUpdate.originalBackImageUrl = stored.shift()!.url;
    }

    Object.assign(fieldsToUpdate, contactDerivedFields({ ...existing, ...fieldsToUpdate }));

    const updated = await persistWithImageCleanup(storedKeys, () =>
      prisma.contact.update({ where: { id: existing.id }, data: fieldsToUpdate })
    );

    preCacheLocation(updated.companyLocation || updated.address);
    await publishResearchTask(updated);
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
