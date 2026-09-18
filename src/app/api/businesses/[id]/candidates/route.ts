import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { loadConfig } from "@/lib/config/runtime";
import { assertCredits } from "@/lib/enrichment/credits";
import { findCandidates, type CandidateSet } from "@/lib/enrichment/candidates";
import { domainFromUrl } from "@/lib/jobs/enrich";
import { getProviders } from "@/lib/providers";
import { isProviderConfigured, isProviderEnabled } from "@/lib/providers/keys";
import { apolloPlanBlocked } from "@/lib/providers/apollo";
import { APOLLO_PLAN_BLOCK_MESSAGE, ProviderDisabledError, ProviderNotConfiguredError, ProviderPlanError } from "@/lib/providers/errors";
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

/** Runs `findCandidates` inline: it is (usually) a free Apollo call, so unlike enrich there is no
 * reason to queue it — the rep waits a moment and sees the candidate list right away. */
export const POST = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const b = await prisma.business.findFirst({ where: { id, ownerId: actor.id }, select: { id: true, exclusion: true, websiteUrl: true } });
  if (!b) throw new ApiError(404, "Business not found");
  // Fix round (R6): mirrors POST /businesses/:id/enrich's exclusion refusal — an excluded
  // business (a marked chain/enterprise) isn't a search target for either free or credited calls.
  if (b.exclusion !== "none") {
    return json({ error: "Excluded businesses are not enriched" }, 409);
  }
  const gateError = await providerGateError();
  if (gateError) return gateError;
  // Fix round (R7): with no usable domain, findCandidates (via searchPeople) falls back to
  // Apollo's Organization Search to resolve one from the business name — unlike People Search
  // itself, that call does cost one Apollo credit (see runEnrich's org-mismatch comment above
  // its own domain-less branch). Gate that case behind the same credit-cap check the enrich route
  // uses, and tell the caller this specific "Find people" click will cost a credit so the button
  // can say so (Task 2).
  const costsCredit = domainFromUrl(b.websiteUrl) === null;
  if (costsCredit) {
    const cfg = await loadConfig(actor.id);
    const capError = await assertCredits(actor.id, cfg);
    if (capError) return capError;
  }
  try {
    const candidates = await findCandidates(id, actor.id, { providers: getProviders(), log: () => {} });
    return json({ candidates, costsCredit }, 200);
  } catch (e) {
    // Fix round (R2): the proactive providerGateError() check above can go stale between that
    // check and this call (a live 403 the worker hasn't seen yet, a key disabled mid-request,
    // etc.) — mirrors how runEnrich's own catch block handles these same typed errors, so a
    // find-people click fails the same way an enrich click would, not with a generic 500.
    if (e instanceof BudgetExhaustedError) return json({ error: "Apollo daily call budget exhausted" }, 409);
    if (e instanceof ProviderPlanError) return json({ error: APOLLO_PLAN_BLOCK_MESSAGE, settingsHref: "/settings" }, 409);
    if (e instanceof ProviderNotConfiguredError) return json({ error: "Apollo API key is not configured", settingsHref: "/settings" }, 409);
    if (e instanceof ProviderDisabledError) return json({ error: "Apollo is disabled in Settings", settingsHref: "/settings" }, 409);
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
