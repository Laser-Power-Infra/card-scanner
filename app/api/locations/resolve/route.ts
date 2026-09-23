import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveLocationCoords } from "@/lib/location";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const location = typeof body?.location === "string" ? body.location.trim() : "";

    if (!location) {
      return NextResponse.json(
        { success: false, error: "Location string is required." },
        { status: 400 }
      );
    }

    const query = location.toLowerCase();

    // 1. Check if it was already cached in DB
    const existing = await prisma.locationCache.findUnique({
      where: { query },
    });

    if (existing && existing.resolved) {
      console.log(
        `[Location API] (DB Hit) "${location}" -> [${existing.latitude}, ${existing.longitude}]`
      );
      return NextResponse.json({
        success: true,
        query,
        location,
        lat: existing.latitude,
        lng: existing.longitude,
        cached: true,
      });
    }

    // 2. Resolve coordinates using city lookup + geocoder fallback
    console.log(`[Location API] (Geocoding...) "${location}"`);
    const coords = await resolveLocationCoords({
      companyLocation: location,
      address: location,
    });

    const lat = coords ? coords[0] : null;
    const lng = coords ? coords[1] : null;

    // 3. Save into PostgreSQL LocationCache permanently (even if null, so unresolvable queries aren't re-queried)
    try {
      await prisma.locationCache.upsert({
        where: { query },
        create: {
          query,
          latitude: lat,
          longitude: lng,
          resolved: true,
        },
        update: {
          latitude: lat,
          longitude: lng,
          resolved: true,
        },
      });
      console.log(
        `[Location API] (Saved to DB) "${location}" -> [${lat}, ${lng}]`
      );
    } catch (saveErr) {
      console.error(`[Location API] Failed to save DB LocationCache for "${location}":`, saveErr);
    }

    return NextResponse.json({
      success: true,
      query,
      location,
      lat,
      lng,
      cached: false,
    });
  } catch (error) {
    console.error("[Location API] Resolve error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to resolve location." },
      { status: 500 }
    );
  }
}
