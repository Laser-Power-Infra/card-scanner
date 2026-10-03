import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

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

    const user = await prisma.user.findUnique({
      where: { email: reset.email },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 404 }
      );
    }

    // The default password is already hashed in the token record's email lookup.
    // We need to get the hashed password from the forgot-password step.
    // Actually, we stored the hashed password in the PasswordResetToken? No.
    // Let me re-think: forgot-password generates a default password, hashes it,
    // and stores the hash somewhere. But PasswordResetToken only has email, token, expiresAt.
    // We need to store the hashed default password in the token record.
    // Let me check the schema... PasswordResetToken has: id, email, token, expiresAt, createdAt.
    // No password field. So we need to add one, or use a different approach.

    // For now, let's add a passwordHash field to PasswordResetToken.
    // But that requires a schema change. Let me use a simpler approach:
    // Store the hashed password in the token itself? No.
    // Better: add a passwordHash column to PasswordResetToken.

    // Actually, let me re-read the plan. The plan says:
    // "Store in PasswordResetToken table with 1-hour expiry (reuse existing table)"
    // But the table doesn't have a password field. So we need to add one.

    // Let me add passwordHash to PasswordResetToken in the schema.
    // For now, I'll write the code assuming the field exists.

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
