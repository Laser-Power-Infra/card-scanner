import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { extractCardFromImage } from "@/lib/extractCard";
import type { CardData, ScanResponse } from "@/types/card";
import { prisma } from "@/lib/prisma";
import { publishProfileCollectionTask } from "@/lib/queue/profileCollection";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const MAX_BYTES = 8 * 1024 * 1024; // 8MB

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
      rawNotes: contact.rawNotes,
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
    const file = maybeImage as File | null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: "No file was received.",
        },
        { status: 400 }
      );
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
    await pushResearchTask(updated);
    return NextResponse.json({ success: true, data: updated, message: "merged" });
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