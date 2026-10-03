import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/permissions";
import { validateContact } from "@/lib/validation";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { changes } = await req.json();

  const error = validateContact(changes);
  if (error) {
    return NextResponse.json({ success: false, error }, { status: 400 });
  }

  try {
    const updated = await prisma.contact.update({
      where: { id },
      data: changes,
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    console.error("[Contacts] Update failed:", e);
    return NextResponse.json({ success: false, error: "Update failed" }, { status: 500 });
  }
}
