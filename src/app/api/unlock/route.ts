import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions, safeRedirectPath } from "@/lib/session";
import { getActor } from "@/lib/actor";
import { unlockLimiter, unlockGlobalLimiter, clientKey } from "@/lib/auth/rateLimit";

const GLOBAL_KEY = "__global__";

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
  const key = clientKey(req);
  const clientGate = unlockLimiter.check(key);
  const globalGate = unlockGlobalLimiter.check(GLOBAL_KEY);
  const gate = !clientGate.allowed ? clientGate : !globalGate.allowed ? globalGate : clientGate;
  if (!clientGate.allowed || !globalGate.allowed) {
    const url = new URL("/unlock", req.url);
    url.searchParams.set("error", "locked");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303, headers: { "retry-after": String(gate.retryAfterSec ?? 900) } });
  }
  if (!safeEqual(passphrase, expected)) {
    unlockLimiter.recordFailure(key);
    unlockGlobalLimiter.recordFailure(GLOBAL_KEY);
    await new Promise((r) => setTimeout(r, 300)); // constant small delay on failure
    const url = new URL("/unlock", req.url);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }
  unlockLimiter.reset(key);
  const actor = await getActor();
  const token = await createSessionToken(secret, actor.id);
  const safeNext = safeRedirectPath(next);
  const res = NextResponse.redirect(new URL(safeNext, req.url), {
    status: 303,
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
