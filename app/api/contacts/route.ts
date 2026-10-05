import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/permissions";

/** Upper bound on a single window, so a caller cannot ask for the whole table. */
const MAX_PAGE = 200;

export async function GET(req: NextRequest) {
  // Not `requireApiSession()`: the directory is public by decision, and this
  // route shapes its response instead of refusing. An anonymous caller gets the
  // contact rows with `enrichment` narrowed to `status` -- enough for the
  // Enriched/Pending column and its filter, and nothing else.
  const session = await getCurrentSession();

  try {
    // Optional windowing. With no `take` the response is the whole table, which
    // keeps the bare-array contract every existing caller relies on; the
    // directory passes `take` + `cursor` to render the first window before the
    // rest has been read.
    const params = new URL(req.url).searchParams;
    const takeParam = params.get("take");
    const cursor = params.get("cursor");

    const take = takeParam
      ? Math.min(Math.max(Number.parseInt(takeParam, 10) || 0, 1), MAX_PAGE)
      : undefined;

    const contacts = await prisma.contact.findMany({
      include: {
        enrichment: session
          ? true
          : { select: { status: true } },
      },
      // id is the tiebreak that makes the cursor stable when two rows share a
      // createdAt (bulk import writes them in the same millisecond).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(take
        ? { take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }
        : {}),
    });

    return NextResponse.json(contacts);
  } catch (error) {
    console.error("[Contacts] Failed to fetch contacts:", error);

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
