import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Public by decision, same rule as /api/contacts: the session is read to
  // narrow the enrichment select, not to refuse. See the note on
  // PUBLIC_API_PATHS in lib/permissions.ts.
  const session = await getCurrentSession();

  try {
    const { id } = await params;

    const contact = await prisma.contact.findUnique({
      where: { id },
      include: { enrichment: session ? true : { select: { status: true } } },
    });

    if (!contact) {
      return NextResponse.json(
        { success: false, error: "Contact not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, contact });
  } catch (error) {
    console.error("Fetch profile error:", error);

    return NextResponse.json(
      { success: false, error: "Failed to fetch profile." },
      { status: 500 }
    );
  }
}
