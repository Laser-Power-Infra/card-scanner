import { NextResponse } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { isHttps } from "@/lib/httpsCheck";
import { isRateLimited, setRateLimit } from "@/lib/rateLimit";

export async function POST(req: Request) {
  if (!isHttps(req as any)) {
    return NextResponse.json(
      { success: false, message: "HTTPS required" },
      { status: 403 }
    );
  }

  try {
    const { email, name } = await req.json();

    if (!email || !name) {
      return NextResponse.json(
        { success: false, message: "Email and name are required." },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        name: normalizedName,
      },
    });

    if (!user) {
      return NextResponse.json({
        success: true,
        message: "If an account exists with these details, a password reset link has been generated.",
      });
    }

    const rateKey = `forgot-password:${normalizedEmail}`;
    if (isRateLimited(rateKey, 5 * 60 * 1000)) {
      return NextResponse.json(
        { success: false, message: "Please wait 5 minutes before requesting another reset." },
        { status: 429 }
      );
    }

    const defaultPassword = crypto.randomBytes(12).toString("base64url");
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    const expiry = new Date(Date.now() + 60 * 60 * 1000);

    const token = crypto.randomBytes(32).toString("hex");

    await prisma.passwordResetToken.create({
      data: {
        email: normalizedEmail,
        token,
        passwordHash,
        expiresAt: expiry,
      },
    });

    setRateLimit(rateKey, 5 * 60 * 1000);

    return NextResponse.json({
      success: true,
      message: "If an account exists with these details, a password reset link has been generated.",
      defaultPassword,
      expiresAt: expiry,
    });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong." },
      { status: 500 }
    );
  }
}
