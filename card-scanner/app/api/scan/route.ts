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

      // Save extracted contact to database
      await prisma.contact.create({
        data: {
          fullName: data.fullName,
          jobTitle: data.jobTitle,
          company: data.company,

          mobileNumbers: data.mobileNumbers ?? [],
          telephoneNumbers: data.telephoneNumbers ?? [],

          emails: data.emails ?? [],

          website: data.website,
          address: data.address,
          companyLocation: data.companyLocation,

          linkedin: data.linkedin,

          rawNotes: data.rawNotes,
        },
      });

      return NextResponse.json({ success: true, data });
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

          const raw = JSON.stringify({ headers, row: obj, pairs: cols });

          const contactData = {
            fullName: obj.name || obj.fullname || obj["Full Name"] || null,
            jobTitle: obj.jobtitle || obj.title || null,
            company: obj.company || null,
            mobileNumbers: obj.mobile ? [String(obj.mobile)] : obj.phone ? [String(obj.phone)] : [],
            telephoneNumbers: obj.telephone ? [String(obj.telephone)] : [],
            emails: obj.email ? [String(obj.email)] : [],
            website: obj.website || null,
            address: obj.address || null,
            companyLocation: obj.location || null,
            linkedin: obj.linkedin || null,
            rawNotes: raw,
          };

          // Check for duplicates before creating
          const emailCandidate = (contactData.emails && contactData.emails[0]) || null;
          const mobileCandidate = (contactData.mobileNumbers && contactData.mobileNumbers[0]) || null;
          const telCandidate = (contactData.telephoneNumbers && contactData.telephoneNumbers[0]) || null;

          const exists = await prisma.contact.findFirst({
            where: {
              OR: [
                emailCandidate ? { emails: { has: emailCandidate } } : undefined,
                mobileCandidate ? { mobileNumbers: { has: mobileCandidate } } : undefined,
                telCandidate ? { telephoneNumbers: { has: telCandidate } } : undefined,
                contactData.fullName && contactData.company ? { AND: [{ fullName: contactData.fullName }, { company: contactData.company }] } : undefined,
              ].filter(Boolean) as any,
            },
          });

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