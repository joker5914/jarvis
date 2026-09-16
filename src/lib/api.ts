import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { BudgetExhaustedError } from "@/lib/providers/budget";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  return schema.parse(body);
}

// Next 15 passes `{ params: Promise<{ id: string }> }` for dynamic segments. If `next build`
// reports an invalid route export type, change this to `Promise<any>`; the handlers only read strings.
type Ctx = { params: Promise<Record<string, string>> };

export function handle(fn: (req: NextRequest, ctx: Ctx) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.message }, e.status);
      if (e instanceof ZodError) return json({ error: "Validation failed", issues: e.issues }, 400);
      if (e instanceof BudgetExhaustedError) return json({ error: e.message }, 429);
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}`, e);
      return json({ error: "Internal error" }, 500);
    }
  };
}
