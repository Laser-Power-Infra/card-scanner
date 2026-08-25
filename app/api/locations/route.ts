import { NextRequest, NextResponse } from "next/server";
import { geocodeFallback } from "@/lib/location";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const location = typeof body?.location === "string" ? body.location.trim() : "";

    if (!location) {
      return NextResponse.json(
        { success: false, error: "Location is required." },
        { status: 400 }
      );
    }

    const coords = await geocodeFallback(location);

    if (!coords) {
      return NextResponse.json({ success: false, lat: null, lng: null });
    }

    return NextResponse.json({ success: true, lat: coords[0], lng: coords[1] });
  } catch (error) {
    console.error("Geocode error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to geocode location." },
      { status: 500 }
    );
  }
}
