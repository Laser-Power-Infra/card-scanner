import { NextRequest, NextResponse } from "next/server";
import { extractCardFromImage } from "@/lib/extractCard";
import type { ScanResponse } from "@/types/card";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
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
    const file = formData.get("image");

    if (!file || !(file instanceof File)) {
      return NextResponse.json<ScanResponse>(
        { success: false, error: "No image file was received." },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json<ScanResponse>(
        {
          success: false,
          error: "Unsupported file type. Please upload a JPEG, PNG, WebP, or GIF.",
        },
        { status: 415 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json<ScanResponse>(
        { success: false, error: "Image is too large. Please upload a file under 8MB." },
        { status: 413 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const data = await extractCardFromImage(base64, file.type);

    return NextResponse.json<ScanResponse>({ success: true, data });
  } catch (err) {
    console.error("Scan error:", err);
    const message =
      err instanceof Error ? err.message : "Something went wrong while scanning the card.";
    return NextResponse.json<ScanResponse>({ success: false, error: message }, { status: 500 });
  }
}
