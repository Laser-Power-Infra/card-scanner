import { NextRequest, NextResponse } from "next/server";
import { extractCardFromImage } from "@/lib/extractCard";
import type { ScanResponse } from "@/types/card";
import { prisma } from "@/lib/prisma";

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

    // CSV import
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv") || file.type === "text/csv") {
      const text = await file.text();

      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        return NextResponse.json({ success: false, error: "CSV is empty." }, { status: 400 });
      }

      const splitLine = (ln: string) => ln.match(/(?:"([^"]*)")|([^,]+)/g)?.map((v) => v.replace(/^"|"$/g, "")) || [];

      const headers = splitLine(lines.shift()! ).map((h) => h.trim().toLowerCase());

      const created: any[] = [];

      for (const ln of lines) {
        const vals = splitLine(ln);
        const obj: any = {};
        headers.forEach((h, i) => {
          obj[h] = vals[i] ?? "";
        });

        const contactData = {
          fullName: obj.name || obj.fullname || obj["full name"] || null,
          jobTitle: obj.jobtitle || obj.title || null,
          company: obj.company || null,
          mobileNumbers: obj.mobile ? [obj.mobile] : obj.phone ? [obj.phone] : [],
          telephoneNumbers: obj.telephone ? [obj.telephone] : [],
          emails: obj.email ? [obj.email] : [],
          website: obj.website || null,
          address: obj.address || null,
          companyLocation: obj.location || null,
          linkedin: obj.linkedin || null,
          rawNotes: obj.notes || null,
        };

        const createdRec = await prisma.contact.create({ data: contactData });
        created.push(contactData);
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