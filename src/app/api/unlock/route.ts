import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions, safeRedirectPath } from "@/lib/session";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const passphrase = String(form.get("passphrase") ?? "");
  const next = String(form.get("next") ?? "/");
  const expected = process.env.APP_PASSPHRASE ?? "";
  const secret = process.env.APP_SECRET ?? "";
  if (!expected || !secret) {
    return new NextResponse("APP_PASSPHRASE/APP_SECRET not configured", { status: 500 });
  }
  if (!safeEqual(passphrase, expected)) {
    const url = new URL("/unlock", req.url);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }
  const token = await createSessionToken(secret);
  const safeNext = safeRedirectPath(next);
  const res = NextResponse.redirect(new URL(safeNext, req.url), {
    status: 303,
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
