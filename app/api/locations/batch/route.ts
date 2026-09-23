import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveLocationCoords } from "@/lib/location";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawLocations = Array.isArray(body?.locations) ? body.locations : [];

    // Normalize and deduplicate location queries
    const locationMap = new Map<string, string>(); // normalized -> original
    for (const raw of rawLocations) {
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed) {
          const normalized = trimmed.toLowerCase();
          if (!locationMap.has(normalized)) {
            locationMap.set(normalized, trimmed);
          }
        }
      }
    }

    const normalizedQueries = Array.from(locationMap.keys());
    if (normalizedQueries.length === 0) {
      return NextResponse.json({ success: true, locations: {} });
    }

    // 1. Check existing entries in PostgreSQL LocationCache
    const cachedRecords = await prisma.locationCache.findMany({
      where: {
        query: { in: normalizedQueries },
      },
    });

    const result: Record<string, { lat: number | null; lng: number | null }> = {};
    const cachedQuerySet = new Set<string>();

    for (const record of cachedRecords) {
      cachedQuerySet.add(record.query);
      result[record.query] = {
        lat: record.latitude,
        lng: record.longitude,
      };
    }

    // 2. Resolve only the new/missing locations
    const missingQueries = normalizedQueries.filter((q) => !cachedQuerySet.has(q));

    for (const query of missingQueries) {
      const original = locationMap.get(query) || query;
      let coords: [number, number] | null = null;
      try {
        coords = await resolveLocationCoords({
          companyLocation: original,
          address: original,
        });
      } catch (err) {
        console.error(`Failed to resolve coords for "${original}":`, err);
      }

      const lat = coords ? coords[0] : null;
      const lng = coords ? coords[1] : null;

      result[query] = { lat, lng };

      // Persist into PostgreSQL LocationCache permanently
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
        console.error(`Failed to persist LocationCache for "${query}":`, saveErr);
      }
    }

    return NextResponse.json({
      success: true,
      locations: result,
      cachedCount: cachedRecords.length,
      newCount: missingQueries.length,
    });
  } catch (error) {
    console.error("Batch geocode error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to batch resolve locations." },
      { status: 500 }
    );
  }
}
