import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { findCandidates, type CandidateSet } from "@/lib/enrichment/candidates";
import { getProviders } from "@/lib/providers";
import { isProviderConfigured, isProviderEnabled } from "@/lib/providers/keys";
import { apolloPlanBlocked } from "@/lib/providers/apollo";
import { APOLLO_PLAN_BLOCK_MESSAGE } from "@/lib/providers/errors";
import { BudgetExhaustedError } from "@/lib/providers/budget";

/** Same provider gates as POST /businesses/:id/enrich (configured/enabled/plan-block), reused
 * here since "Find people" is also an Apollo call — just a free one. */
async function providerGateError() {
  if (!(await isProviderConfigured("apollo"))) {
    return json({ error: "Apollo API key is not configured", settingsHref: "/settings" }, 409);
  }
  if (!(await isProviderEnabled("apollo"))) {
    return json({ error: "Apollo is disabled in Settings", settingsHref: "/settings" }, 409);
  }
  if ((await apolloPlanBlocked()).blocked) {
    return json({ error: APOLLO_PLAN_BLOCK_MESSAGE, settingsHref: "/settings" }, 409);
  }
  return null;
}

/** Runs `findCandidates` inline: it is a free (no-credit) Apollo call, so unlike enrich there is
 * no reason to queue it — the rep waits a moment and sees the candidate list right away. */
export const POST = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const b = await prisma.business.findFirst({ where: { id, ownerId: actor.id }, select: { id: true } });
  if (!b) throw new ApiError(404, "Business not found");
  const gateError = await providerGateError();
  if (gateError) return gateError;
  try {
    const candidates = await findCandidates(id, actor.id, { providers: getProviders(), log: () => {} });
    return json({ candidates }, 200);
  } catch (e) {
    if (e instanceof BudgetExhaustedError) return json({ error: "Apollo daily call budget exhausted" }, 409);
    throw e;
  }
});

export const GET = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const b = await prisma.business.findFirst({ where: { id, ownerId: actor.id }, select: { candidates: true } });
  if (!b) throw new ApiError(404, "Business not found");
  return json({ candidates: (b.candidates as unknown as CandidateSet | null) ?? null }, 200);
});
