import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveLocationCoords } from "@/lib/location";
import { requireApiSession } from "@/lib/permissions";

export async function POST(req: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;

  try {
    const body = await req.json();
    const location = typeof body?.location === "string" ? body.location.trim() : "";

    if (!location) {
      return NextResponse.json(
        { success: false, error: "Location is required." },
        { status: 400 }
      );
    }

    const query = location.toLowerCase();

    // 1. Check database cache
    const cached = await prisma.locationCache.findUnique({
      where: { query },
    });

    if (cached) {
      return NextResponse.json({
        success: true,
        lat: cached.latitude,
        lng: cached.longitude,
        cached: true,
      });
    }

    // 2. Resolve coordinates
    const coords = await resolveLocationCoords({
      companyLocation: location,
      address: location,
    });

    const lat = coords ? coords[0] : null;
    const lng = coords ? coords[1] : null;

    // 3. Save into LocationCache in DB
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
    } catch (saveErr) {
      console.error("Failed to cache location in DB:", saveErr);
    }

    return NextResponse.json({ success: true, lat, lng, cached: false });
  } catch (error) {
    console.error("Geocode error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to geocode location." },
      { status: 500 }
    );
  }
}
