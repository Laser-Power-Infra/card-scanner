import { NextRequest } from "next/server";

export function isHttps(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return req.headers.get("x-forwarded-proto") === "https";
}
