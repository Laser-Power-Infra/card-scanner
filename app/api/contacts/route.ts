import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/permissions";

export async function GET() {
  // Not `requireApiSession()`: the directory is public by decision, and this
  // route shapes its response instead of refusing. An anonymous caller gets the
  // contact rows with `enrichment` narrowed to `status` -- enough for the
  // Enriched/Pending column and its filter, and nothing else.
  const session = await getCurrentSession();

  try {
    const contacts = await prisma.contact.findMany({
      include: {
        enrichment: session
          ? true
          : { select: { status: true } },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(contacts);
  } catch (error) {
    console.error("Fetch contacts error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch contacts",
      },
      {
        status: 500,
      }
    );
  }
}