import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { isHttps } from "@/lib/httpsCheck";

export async function POST(req: Request) {
  if (!isHttps(req as any)) {
    return NextResponse.json(
      { success: false, message: "HTTPS required" },
      { status: 403 }
    );
  }

  try {
    const { token } = await req.json();

    if (!token) {
      return NextResponse.json(
        { success: false, message: "Token is required." },
        { status: 400 }
      );
    }

    const reset = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!reset || reset.expiresAt < new Date()) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired reset token." },
        { status: 400 }
      );
    }

    if (!reset.passwordHash) {
      return NextResponse.json(
        { success: false, message: "Reset token is malformed." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: reset.email },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }

    await prisma.user.update({
      where: { email: reset.email },
      data: {
        password: reset.passwordHash,
        mustResetPassword: true,
      },
    });

    await prisma.passwordResetToken.delete({
      where: { id: reset.id },
    });

    return NextResponse.json({
      success: true,
      message: "Password reset confirmed. You can now log in with the default password.",
    });
  } catch (error) {
    console.error("Confirm Reset Error:", error);
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}
