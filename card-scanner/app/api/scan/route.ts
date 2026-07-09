import { NextRequest, NextResponse } from "next/server";
import { extractCardFromImage } from "@/lib/extractCard";
import type { ScanResponse } from "@/types/card";
import { prisma } from "@/lib/prisma";
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

export async function GET() {
  return NextResponse.json({
    status: "ok",
    apiKeyPresent: !!process.env.OPENAI_API_KEY,
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    // support both image uploads (key: image) and file imports (key: file)
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

    // Image path
    if (file.type && file.type.startsWith("image/") && ALLOWED_IMAGE_TYPES.includes(file.type)) {
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

        return NextResponse.json({ success: true, data: created });
      }

      // If found, determine whether there is any new information to merge
      const existingEmails = new Set((existing.emails ?? []).map((e) => String(e).toLowerCase()));
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
        return NextResponse.json({ success: true, data: existing, message: "duplicate_skipped" });
      }

      const updated = await prisma.contact.update({ where: { id: existing.id }, data: fieldsToUpdate });
      return NextResponse.json({ success: true, data: updated, message: "merged" });
    }

    // Spreadsheet import (CSV/XLSX/XLS)
    const name = file.name.toLowerCase();
    const isSpreadsheet =
      name.endsWith(".csv") ||
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      file.type === "text/csv" ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    if (isSpreadsheet) {
      const buffer = Buffer.from(await file.arrayBuffer());

      // Read workbook; for CSV this still works
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const created: any[] = [];

      // Iterate sheets and rows. Use header:1 to preserve all columns including empty or repeated headers.
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

        const headers: string[] = (rows.shift() || []).map((h: any, i: number) => {
          if (h === null || h === undefined || String(h).trim() === "") return `column_${i + 1}`;
          return String(h);
        });

        for (const row of rows) {
          // Build ordered pairs for all columns
          const cols = headers.map((hdr, i) => ({ header: hdr, value: row[i] ?? null }));
          const obj: Record<string, any> = {};
          headers.forEach((h, i) => {
            obj[h] = row[i] ?? null;
          });

          // Heuristics: scan every cell for emails, phones, linkedin, website
          const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
          const phoneRegex = /(?:\+?\d[\d ()-]{6,}\d)/;

          const emailSet = new Set<string>();
          const mobileSet = new Set<string>();
          const telSet = new Set<string>();

          let inferredName: string | null = null;
          let inferredCompany: string | null = null;
          let inferredJob: string | null = null;
          let inferredWebsite: string | null = null;
          let inferredLinkedin: string | null = null;

          for (let i = 0; i < headers.length; i++) {
            const hdr = headers[i];
            const rawVal = row[i];
            if (rawVal === null || rawVal === undefined) continue;
            const s = String(rawVal).trim();
            if (!s) continue;

            // Emails
            if (emailRegex.test(s)) {
              const m = s.match(emailRegex);
              if (m) emailSet.add(m[0].toLowerCase());
            }

            // Phones
            if (phoneRegex.test(s)) {
              const num = s.replace(/[^+0-9]/g, "");
              // Heuristic: treat as mobile if header contains mobile or phone label
              if (/mobile|cell|mobi|phone/i.test(hdr) || /mobile|cell|mobi|phone/i.test(s)) {
                mobileSet.add(num);
              } else {
                telSet.add(num);
              }
            }

            // Linkedin or site
            if (/linkedin/i.test(hdr) || /linkedin\.com/i.test(s)) {
              inferredLinkedin = s;
            }
            if (/website|url|site/i.test(hdr) || /https?:\/\//i.test(s)) {
              if (!inferredWebsite) inferredWebsite = s;
            }

            // Name heuristics based on header
            if (!inferredName && /name|full name|given name|first name|last name/i.test(hdr)) {
              inferredName = s;
            }

            // Company heuristics based on header
            if (!inferredCompany && /company|organisation|organization|employer|business|org|firm/i.test(hdr)) {
              inferredCompany = s;
            }

            // Job title
            if (!inferredJob && /title|position|designation|role|job/i.test(hdr)) {
              inferredJob = s;
            }
          }

          // Fall back: try to extract name/company from generic cells
          if (!inferredName) {
            // look for a cell that looks like a person name (two capitalized words)
            for (const v of Object.values(obj)) {
              if (!v) continue;
              const s = String(v).trim();
              if (/^[A-Z][a-z]+\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)?$/.test(s)) {
                inferredName = s;
                break;
              }
            }
          }

          if (!inferredCompany) {
            for (const v of Object.values(obj)) {
              if (!v) continue;
              const s = String(v).trim();
              if (/\b(LLC|Ltd|Pvt|Inc|Limited|Corporation|Corp|Company)\b/i.test(s)) {
                inferredCompany = s;
                break;
              }
            }
          }

          const allEmails = Array.from(emailSet);
          const allMobiles = Array.from(mobileSet);
          const allTels = Array.from(telSet);

          const raw = JSON.stringify({ headers, row: obj, pairs: cols, inferred: { allEmails, allMobiles, allTels, inferredName, inferredCompany, inferredJob, inferredWebsite, inferredLinkedin } });

          const contactData = {
            fullName: inferredName || obj.name || obj.fullname || obj["Full Name"] || null,
            jobTitle: inferredJob || obj.jobtitle || obj.title || null,
            company: inferredCompany || obj.company || null,
            mobileNumbers: allMobiles,
            telephoneNumbers: allTels,
            emails: allEmails,
            website: inferredWebsite || obj.website || null,
            address: obj.address || null,
            companyLocation: obj.location || null,
            linkedin: inferredLinkedin || obj.linkedin || null,
            rawNotes: raw,
          };

          // Build duplicate check clauses for all found identifiers
          const orClauses: any[] = [];
          for (const e of contactData.emails) orClauses.push({ emails: { has: e } });
          for (const m of contactData.mobileNumbers) orClauses.push({ mobileNumbers: { has: m } });
          for (const t of contactData.telephoneNumbers) orClauses.push({ telephoneNumbers: { has: t } });
          if (contactData.fullName && contactData.company) orClauses.push({ AND: [{ fullName: contactData.fullName }, { company: contactData.company }] });

          const exists = await prisma.contact.findFirst({ where: { OR: orClauses.length ? orClauses : undefined as any } });

          if (!exists) {
            await prisma.contact.create({ data: contactData });
            created.push(contactData);
          }
        }
      }

      return NextResponse.json({ success: true, data: created });
    }

    // BSF (assumed JSON) import
    if (name.endsWith(".bsf") || file.type === "application/json") {
      const txt = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(txt);
      } catch (e) {
        return NextResponse.json({ success: false, error: "Invalid BSF/JSON file." }, { status: 400 });
      }

      const items = Array.isArray(parsed) ? parsed : [parsed];
      const created: any[] = [];

      for (const item of items) {
        const contactData = {
          fullName: item.fullName || item.name || null,
          jobTitle: item.jobTitle || item.title || null,
          company: item.company || null,
          mobileNumbers: item.mobileNumbers || (item.phone ? [item.phone] : []) || [],
          telephoneNumbers: item.telephoneNumbers || [],
          emails: item.emails || (item.email ? [item.email] : []) || [],
          website: item.website || null,
          address: item.address || null,
          companyLocation: item.companyLocation || null,
          linkedin: item.linkedin || null,
          rawNotes: item.rawNotes || item.notes || null,
        };

        await prisma.contact.create({ data: contactData });
        created.push(contactData);
      }

      return NextResponse.json({ success: true, data: created });
    }

    return NextResponse.json(
      {
        success: false,
        error: "Unsupported file type. Upload an image, CSV, or BSF (JSON) file.",
      },
      { status: 415 }
    );
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