import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
      return NextResponse.json({
        success: true,
        cached: {},
        missing: [],
      });
    }

    // 1. Bulk query all existing entries from PostgreSQL LocationCache in 1 query
    const cachedRecords = await prisma.locationCache.findMany({
      where: {
        query: { in: normalizedQueries },
      },
    });

    const cachedMap: Record<string, { lat: number | null; lng: number | null }> = {};
    const resolvedSet = new Set<string>();

    for (const record of cachedRecords) {
      // If resolved, even if lat/lng is null (unresolvable), mark as resolved so we don't re-query
      if (record.resolved) {
        resolvedSet.add(record.query);
        cachedMap[record.query] = {
          lat: record.latitude,
          lng: record.longitude,
        };
      }
    }

    // 2. Identify only the missing queries not yet resolved in the DB
    const missingQueries: string[] = [];
    for (const q of normalizedQueries) {
      if (!resolvedSet.has(q)) {
        missingQueries.push(locationMap.get(q) || q);
      }
    }

    console.log(
      `[Location Cache] Bulk checked ${normalizedQueries.length} locations: ${resolvedSet.size} cached in DB, ${missingQueries.length} new to resolve.`
    );

    return NextResponse.json({
      success: true,
      cached: cachedMap,
      missing: missingQueries,
      totalChecked: normalizedQueries.length,
      cachedCount: resolvedSet.size,
      missingCount: missingQueries.length,
    });
  } catch (error) {
    console.error("[Location Cache] Bulk check error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to check location cache." },
      { status: 500 }
    );
  }
}
