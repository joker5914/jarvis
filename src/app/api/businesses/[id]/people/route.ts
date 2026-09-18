import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { getBusinessDetail } from "@/lib/leads/queries";
import { normalizeEmail } from "@/lib/extract/normalize";

/** Trim + collapse internal whitespace (Plan 10 Task 3 amendment) — applied to every
 * `personName`/`primaryPerson` this route writes, so a hand-typed "Albert   Reyes" or
 * "  Albert Reyes" matches an existing contact's `personName` exactly on the next lookup instead
 * of silently forking into a second, whitespace-different "person." Case is left alone
 * (case-preserving): matching against an existing name is done case-insensitively (see
 * `sameName` below), but the value actually stored keeps whatever case the rep typed. */
function normalizePersonName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function sameName(a: string | null | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

const postBodySchema = z.object({
  name: z.string().min(1).max(120),
  title: z.string().max(120).optional(),
  email: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  note: z.string().max(500).optional(),
  setPrimary: z.boolean().optional(),
});

/**
 * Add a person by hand (Plan 10 Task 3) — the manual-knowledge path for a lead where no database
 * knows the real point of contact (the Pearland Coffee Roasters "Albert" case the plan opens
 * with). Only an email or a phone produces a `Contact` row; a name (plus, optionally, a title)
 * alone is still a fully valid submission — `groupPeople` (LeadDetail.tsx) synthesizes a bare row
 * for a `primaryPerson` with no `Contact` row of its own, using `primaryPersonTitle` for the title
 * if one was given.
 */
export const POST = handle(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const existing = await prisma.business.findFirst({
    where: { id, ownerId: actor.id },
    select: { id: true, primaryPerson: true, notes: true, contacts: { select: { personName: true } } },
  });
  if (!existing) throw new ApiError(404, "Business not found");

  const body = await parseJson(req, postBodySchema);
  const name = normalizePersonName(body.name);
  if (!name) throw new ApiError(400, "Enter a name.");
  const title = body.title?.trim() || null;
  const note = body.note?.trim() || null;
  const phone = body.phone?.trim() || null;
  let email: string | null = null;
  if (body.email) {
    email = normalizeEmail(body.email);
    if (!email) throw new ApiError(400, "Enter a valid email address.");
  }
  const setPrimary = body.setPrimary ?? true;

  const nameAlreadyExists =
    sameName(existing.primaryPerson, name) || existing.contacts.some((c) => sameName(c.personName, name));
  const hasIdentifyingInfo = !!email || !!phone || !!title;
  if (!hasIdentifyingInfo && nameAlreadyExists) {
    throw new ApiError(400, `${name} already has a contact — add an email, phone, or title to add a new entry.`);
  }

  const rows: { type: "email" | "phone"; value: string }[] = [];
  if (email) rows.push({ type: "email", value: email });
  if (phone) rows.push({ type: "phone", value: phone });

  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      await tx.contact.upsert({
        where: { businessId_type_value: { businessId: id, type: r.type, value: r.value } },
        create: { ownerId: actor.id, businessId: id, type: r.type, value: r.value, source: "manual", personName: name, personTitle: title },
        update: { source: "manual", personName: name, personTitle: title },
      });
    }
    await tx.business.update({
      where: { id },
      data: {
        ...(setPrimary ? { primaryPerson: name, primaryPersonTitle: title } : {}),
        ...(note ? { notes: existing.notes ? `${existing.notes}\nContact note (${name}): ${note}` : `Contact note (${name}): ${note}` } : {}),
      },
    });
    await tx.activityLog.create({
      data: { ownerId: actor.id, businessId: id, kind: "poc_updated", message: `Added ${name}${title ? `, ${title}` : ""} by hand${setPrimary ? " (set as primary)" : ""}` },
    });
  });

  const business = await getBusinessDetail(id, actor.id);
  return json({ business }, 200);
});

const patchBodySchema = z
  .object({
    primaryPerson: z.string().max(120).nullable().optional(),
    suppressApolloId: z.string().min(1).optional(),
  })
  .refine((b) => (b.primaryPerson !== undefined) !== (b.suppressApolloId !== undefined), {
    message: "Provide exactly one of primaryPerson or suppressApolloId",
  });

/**
 * `PATCH /people` (Plan 10 Task 3): set/clear the manual primary-contact pointer, or suppress a
 * revealed Apollo person as "not the decision-maker." The two are mutually exclusive per call
 * (the body schema's `.refine` above) since they're unrelated actions with different side
 * effects — a suppress can also clear `primaryPerson` as a side effect (see below), but a caller
 * never sets both in the same request.
 */
export const PATCH = handle(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const existing = await prisma.business.findFirst({
    where: { id, ownerId: actor.id },
    select: { id: true, primaryPerson: true, primaryPersonTitle: true, suppressedApolloIds: true, candidates: true, contacts: true },
  });
  if (!existing) throw new ApiError(404, "Business not found");

  const body = await parseJson(req, patchBodySchema);

  if (body.primaryPerson !== undefined) {
    if (body.primaryPerson === null) {
      await prisma.business.update({ where: { id }, data: { primaryPerson: null, primaryPersonTitle: null } });
    } else {
      const normalized = normalizePersonName(body.primaryPerson);
      // Must match an existing person on this business — either a Contact row's personName, or
      // (a primary re-set to the name it already carries) the current primaryPerson itself.
      const matchedContact = existing.contacts.find((c) => sameName(c.personName, normalized));
      const matchesCurrentPrimary = sameName(existing.primaryPerson, normalized);
      if (!matchedContact && !matchesCurrentPrimary) {
        throw new ApiError(400, "That name does not match an existing person on this lead.");
      }
      // Case-preserving: store the name exactly as it already appears on the matching Contact
      // row (or the current primaryPerson, if that's what matched) — not whatever case this call
      // happened to be typed in.
      const canonicalName = matchedContact?.personName ?? existing.primaryPerson ?? normalized;
      // A contact-backed match takes its title from that contact row (the freshest source of
      // truth for a title Apollo or a prior manual add already recorded); re-confirming a
      // synthesized-only primary (no Contact row at all — see POST /people's doc comment) keeps
      // whatever title it already had instead of wiping it back to null.
      const canonicalTitle = matchedContact
        ? (existing.contacts.find((c) => sameName(c.personName, normalized) && c.personTitle)?.personTitle ?? null)
        : matchesCurrentPrimary
          ? existing.primaryPersonTitle
          : null;
      await prisma.business.update({ where: { id }, data: { primaryPerson: canonicalName, primaryPersonTitle: canonicalTitle } });
    }
    const business = await getBusinessDetail(id, actor.id);
    return json({ business }, 200);
  }

  // suppressApolloId branch
  const apolloId = body.suppressApolloId as string;
  const rowsToDelete = existing.contacts.filter((c) => c.source === "apollo" && c.apolloId === apolloId);
  const candidateSet = existing.candidates as { candidates?: { apolloId: string; firstName: string | null }[] } | null;
  // Normally a revealed person's own Contact row carries the name; falls back to the stored
  // candidate list's first name for the (UI-unreachable, but route-legal) case of suppressing an
  // id that was never actually revealed, so the activity row still names someone instead of
  // reading "Removed the person."
  const removedName =
    rowsToDelete.find((r) => r.personName)?.personName ??
    candidateSet?.candidates?.find((c) => c.apolloId === apolloId)?.firstName ??
    "the person";
  const clearsPrimary = sameName(existing.primaryPerson, removedName) && removedName !== "the person";
  const nextSuppressed = existing.suppressedApolloIds.includes(apolloId)
    ? existing.suppressedApolloIds
    : [...existing.suppressedApolloIds, apolloId];
  const nextCandidates = candidateSet
    ? { ...candidateSet, candidates: (candidateSet.candidates ?? []).filter((c) => c.apolloId !== apolloId) }
    : candidateSet;

  await prisma.$transaction([
    prisma.contact.deleteMany({ where: { businessId: id, source: "apollo", apolloId } }),
    prisma.business.update({
      where: { id },
      data: {
        suppressedApolloIds: { set: nextSuppressed },
        // Never actually `null` here (see `nextCandidates`'s ternary above) — only ever the
        // filtered object, or `undefined` (leave untouched) when there was no set to begin with —
        // so this sidesteps Prisma's Json-field null-vs-undefined ambiguity (which would otherwise
        // need `Prisma.JsonNull`) entirely.
        candidates: (nextCandidates ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
        ...(clearsPrimary ? { primaryPerson: null, primaryPersonTitle: null } : {}),
      },
    }),
    prisma.activityLog.create({
      data: { ownerId: actor.id, businessId: id, kind: "poc_updated", message: `Removed ${removedName} (not the decision-maker)` },
    }),
  ]);

  const business = await getBusinessDetail(id, actor.id);
  return json({ business }, 200);
});
