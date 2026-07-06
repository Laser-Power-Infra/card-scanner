import { NextRequest, NextResponse } from "next/server";
import { extractCardFromImage } from "@/lib/extractCard";
import { prisma } from "@/lib/prisma";
import type { ScanResponse } from "@/types/card";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const MAX_BYTES = 8 * 1024 * 1024;

export async function GET() {
  return NextResponse.json({
    status: "ok",
    apiKeyPresent: !!process.env.OPENAI_API_KEY,
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("image");

    if (!file || !(file instanceof File)) {
      return NextResponse.json<ScanResponse>(
        {
          success: false,
          error: "No image file was received.",
        },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json<ScanResponse>(
        {
          success: false,
          error:
            "Unsupported file type. Please upload JPEG, PNG, WEBP or GIF.",
        },
        { status: 415 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json<ScanResponse>(
        {
          success: false,
          error: "Image must be under 8MB.",
        },
        { status: 413 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const data = await extractCardFromImage(
      base64,
      file.type
    );

    // SAVE TO DATABASE
    await prisma.contact.create({
      data: {
        fullName: data.fullName,
        jobTitle: data.jobTitle,
        company: data.company,

        mobileNumbers: data.mobileNumbers,
        telephoneNumbers: data.telephoneNumbers,

        emails: data.emails,

        website: data.website,

        address: data.address,

        companyLocation: data.companyLocation,

        linkedin: data.linkedin,

        rawNotes: data.rawNotes,
      },
    });

    return NextResponse.json<ScanResponse>({
      success: true,
      data,
    });
  } catch (err) {
    console.error("Scan error:", err);

    return NextResponse.json<ScanResponse>(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "Something went wrong while scanning the card.",
      },
      {
        status: 500,
      }
    );
  }
}