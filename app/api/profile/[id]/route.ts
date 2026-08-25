import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const contact = await prisma.contact.findUnique({
      where: { id },
      include: { enrichment: true },
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
