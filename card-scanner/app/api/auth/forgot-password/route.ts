import { NextResponse } from "next/server";
import crypto from "crypto";

import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json(
        {
          success: false,
          message: "Email is required.",
        },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    // Don't reveal whether the email exists
    if (!user) {
      return NextResponse.json({
        success: true,
        message:
          "If an account exists with this email, a password reset link has been generated.",
      });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString("hex");

    // Expire after 1 hour
    const expiry = new Date(Date.now() + 1000 * 60 * 60);

    await prisma.passwordResetToken.create({
      data: {
        email: user.email,
        token,
        expiresAt: expiry,
      },
    });

    const origin = new URL(req.url).origin;
    const resetLink = `${origin}/reset-password/${token}`;

    // TODO:
    // Replace this with Nodemailer, Resend, SendGrid, etc.
    console.log("=======================================");
    console.log("PASSWORD RESET LINK");
    console.log(resetLink);
    console.log("=======================================");

    return NextResponse.json({
      success: true,
      message:
        "Password reset link generated successfully. Check the server console.",
      resetLink,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        message: "Something went wrong.",
      },
      {
        status: 500,
      }
    );
  }
}