import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { getCurrentSession } from "@/lib/permissions";
import { isHttps } from "@/lib/httpsCheck";
import { clearRateLimit } from "@/lib/rateLimit";

export async function POST(req: Request) {
  if (!isHttps(req as any)) {
    return NextResponse.json(
      { success: false, message: "HTTPS required" },
      { status: 403 }
    );
  }

  const session = await getCurrentSession();
  if (!session?.user?.email) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const { newPassword, defaultPassword } = await req.json();

    if (!newPassword || !defaultPassword) {
      return NextResponse.json(
        { success: false, message: "New password and default password are required." },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { success: false, message: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    if (newPassword === defaultPassword) {
      return NextResponse.json(
        { success: false, message: "New password must be different from the default password." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }

    if (!user.mustResetPassword) {
      return NextResponse.json(
        { success: false, message: "Password reset not required." },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { email: session.user.email },
      data: {
        password: hashedPassword,
        mustResetPassword: false,
      },
    });

    clearRateLimit(`forgot-password:${session.user.email}`);

    return NextResponse.json({
      success: true,
      message: "Password has been reset successfully.",
    });
  } catch (error) {
    console.error("Force Reset Error:", error);
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}
