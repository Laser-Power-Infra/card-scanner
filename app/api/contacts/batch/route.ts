import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/permissions";
import { validateContact } from "@/lib/validation";

export async function PATCH(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { updates } = await req.json();

  const results = await Promise.all(
    updates.map(async ({ id, changes }: { id: string; changes: Record<string, unknown> }) => {
      const error = validateContact(changes);
      if (error) return { id, success: false, error };
      try {
        await prisma.contact.update({ where: { id }, data: changes });
        return { id, success: true };
      } catch {
        return { id, success: false, error: "Update failed" };
      }
    })
  );

  return NextResponse.json({ success: true, results });
}
