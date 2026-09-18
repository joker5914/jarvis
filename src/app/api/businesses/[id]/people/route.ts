import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { getBusinessDetail } from "@/lib/leads/queries";
import { normalizeEmail, normalizePhone } from "@/lib/extract/normalize";

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
 * alone is still a fully valid submission — `groupPeople` (`src/lib/leads/groupPeople.ts`)
 * synthesizes a bare row for a `primaryPerson` with no `Contact` row of its own, using
 * `primaryPersonTitle` for the title if one was given.
 *
 * Fix round (review): the whole read-validate-write sequence now runs inside one
 * `prisma.$transaction`, so the `notes` append reads the row's current value and writes the
 * appended value atomically rather than risking a lost update against a concurrent edit. Two
 * correctness bugs in the per-row contact upsert are also fixed here: adding a person whose
 * email/phone already exists as an *Apollo*-sourced row used to (a) relabel that row
 * `source: "manual"`, which made it immune to "not the decision-maker" suppression (that only
 * ever deletes `source: "apollo"` rows — see the PATCH handler below), and (b) overwrite its
 * `personName`, which could split that person's email and LinkedIn rows into two different
 * "people" the next time `groupPeople` ran (they'd only match up again if it happened to be
 * retyped identically). Now an existing row's `source`/`apolloId` are never touched, and
 * `personName` is only filled in when the row doesn't already have one.
 */
export const POST = handle(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const body = await parseJson(req, postBodySchema);
  const name = normalizePersonName(body.name);
  if (!name) throw new ApiError(400, "Enter a name.");
  const title = body.title?.trim() || null;
  const note = body.note?.trim() || null;
  let phone: string | null = null;
  if (body.phone) {
    // Normalized to E.164 through the same `normalizePhone` zipSearch/promote already use, so a
    // hand-typed "(555) 123-4567" collides with an existing "+15551234567" row instead of
    // creating a duplicate Contact the unique constraint doesn't know is "the same number."
    phone = normalizePhone(body.phone);
    if (!phone) throw new ApiError(400, "Enter a valid phone number.");
  }
  let email: string | null = null;
  if (body.email) {
    email = normalizeEmail(body.email);
    if (!email) throw new ApiError(400, "Enter a valid email address.");
  }
  const setPrimary = body.setPrimary ?? true;
  const rows: { type: "email" | "phone"; value: string }[] = [];
  if (email) rows.push({ type: "email", value: email });
  if (phone) rows.push({ type: "phone", value: phone });

  await prisma.$transaction(async (tx) => {
    const existing = await tx.business.findFirst({
      where: { id, ownerId: actor.id },
      select: { id: true, primaryPerson: true, notes: true, contacts: { select: { personName: true } } },
    });
    if (!existing) throw new ApiError(404, "Business not found");

    const nameAlreadyExists =
      sameName(existing.primaryPerson, name) || existing.contacts.some((c) => sameName(c.personName, name));
    const hasIdentifyingInfo = !!email || !!phone || !!title;
    if (!hasIdentifyingInfo && nameAlreadyExists) {
      throw new ApiError(400, `${name} already has a contact — add an email, phone, or title to add a new entry.`);
    }

    for (const r of rows) {
      const existingRow = await tx.contact.findUnique({ where: { businessId_type_value: { businessId: id, type: r.type, value: r.value } } });
      if (existingRow) {
        // Never touch `source`/`apolloId` — an Apollo-sourced row stays Apollo-sourced (and
        // therefore still suppressible), regardless of who just hand-added the same email/phone.
        const data: { personName?: string; personTitle?: string } = {};
        // Only fill a *missing* name — never overwrite one, so an existing row (Apollo or
        // otherwise) doesn't get split from its sibling email/LinkedIn row under a different name.
        if (!existingRow.personName) data.personName = name;
        if (title) data.personTitle = title;
        if (Object.keys(data).length > 0) await tx.contact.update({ where: { id: existingRow.id }, data });
      } else {
        await tx.contact.create({ data: { ownerId: actor.id, businessId: id, type: r.type, value: r.value, source: "manual", personName: name, personTitle: title } });
      }
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
      // Must match an existing person on this business — either a Contact row's personName
      // (matched case-insensitively via `sameName`, against the same trimmed/collapsed form POST
      // /people writes), or — a primary re-set to the name it already carries — the current
      // primaryPerson itself (covers a synthesized-only primary with no Contact row at all).
      const matchedContact = existing.contacts.find((c) => sameName(c.personName, normalized));
      const matchesCurrentPrimary = sameName(existing.primaryPerson, normalized);
      if (!matchedContact && !matchesCurrentPrimary) {
        throw new ApiError(400, "That name does not match an existing person on this lead.");
      }
      // Case-preserving: store the name exactly as it already appears on the matching Contact
      // row (or the current primaryPerson, if that's what matched) — not whatever case/whitespace
      // this call happened to be typed in.
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

  // Idempotent (fix round): suppressing an id that's already suppressed is a no-op 200 — no
  // Contact deletes (there's nothing left to delete after the first call), no activity row (the
  // "Removed ..." row was already written once), no candidates/suppressedApolloIds rewrite.
  if (existing.suppressedApolloIds.includes(apolloId)) {
    const business = await getBusinessDetail(id, actor.id);
    return json({ business }, 200);
  }

  const rowsToDelete = existing.contacts.filter((c) => c.source === "apollo" && c.apolloId === apolloId);
  const candidateSet = existing.candidates as { candidates?: { apolloId: string; firstName: string | null }[] } | null;
  const matchesCandidate = candidateSet?.candidates?.some((c) => c.apolloId === apolloId) ?? false;
  // An id that isn't attached to any revealed Apollo Contact row and isn't in the stored
  // candidate list either was never a real person this business knew about — refuse rather than
  // silently "succeeding" at suppressing nothing and adding an id to `suppressedApolloIds` that
  // will never matter.
  if (rowsToDelete.length === 0 && !matchesCandidate) {
    throw new ApiError(404, "Unknown person");
  }
  const removedName = rowsToDelete.find((r) => r.personName)?.personName
    ?? candidateSet?.candidates?.find((c) => c.apolloId === apolloId)?.firstName
    ?? "the person";
  const clearsPrimary = sameName(existing.primaryPerson, removedName) && removedName !== "the person";
  const nextSuppressed = [...existing.suppressedApolloIds, apolloId];
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
