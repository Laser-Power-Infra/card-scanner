import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const contacts = await prisma.contact.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });

  return NextResponse.json(contacts);
}