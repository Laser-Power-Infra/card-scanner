import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { token, password } = await req.json();

    if (!token || !password) {
      return NextResponse.json(
        {
          success: false,
          message: "Token and password are required.",
        },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        {
          success: false,
          message: "Password must be at least 6 characters.",
        },
        { status: 400 }
      );
    }

    // Find the reset token
    const reset = await prisma.passwordResetToken.findUnique({
      where: {
        token,
      },
    });

    // Check if token exists and is not expired
    if (!reset || reset.expiresAt < new Date()) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid or expired reset token.",
        },
        { status: 400 }
      );
    }

    // Find the user using the email stored in the token
    const user = await prisma.user.findUnique({
      where: {
        email: reset.email,
      },
    });

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "User not found.",
        },
        { status: 404 }
      );
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update the user's password
    await prisma.user.update({
      where: {
        email: reset.email,
      },
      data: {
        password: hashedPassword,
      },
    });

    // Delete the reset token after successful password reset
    await prisma.passwordResetToken.delete({
      where: {
        id: reset.id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Password has been reset successfully.",
    });
  } catch (error) {
    console.error("Reset Password Error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Internal Server Error",
      },
      {
        status: 500,
      }
    );
  }
}