import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/permissions";

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;

  try {
    const contacts = await prisma.contact.findMany({
      include: {
        enrichment: true,
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