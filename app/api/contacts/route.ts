import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const take = Math.min(
      Math.max(1, Number(searchParams.get("take")) || DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE
    );

    let cursor: { createdAt: Date; id: string } | null = null;
    const cursorParam = searchParams.get("cursor");
    if (cursorParam) {
      const [createdAt, id] = cursorParam.split("_");
      const date = new Date(createdAt);
      if (!createdAt || !id || Number.isNaN(date.getTime())) {
        return NextResponse.json(
          { success: false, error: "Invalid cursor" },
          { status: 400 }
        );
      }
      cursor = { createdAt: date, id };
    }

    const contacts = await prisma.contact.findMany({
      select: {
        id: true,
        fullName: true,
        jobTitle: true,
        company: true,
        mobileNumbers: true,
        telephoneNumbers: true,
        emails: true,
        website: true,
        address: true,
        companyLocation: true,
        linkedin: true,
        createdAt: true,
        enrichment: { select: { status: true } },
      },
      where: cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
    });

    const hasMore = contacts.length > take;
    const page = hasMore ? contacts.slice(0, take) : contacts;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? `${last.createdAt.toISOString()}_${last.id}` : null;

    return NextResponse.json({ contacts: page, nextCursor });
  } catch (error) {
    console.error("[Contacts] Failed to fetch contacts:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch contacts" },
      { status: 500 }
    );
  }
}
