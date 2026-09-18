import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { getBusinessDetail } from "@/lib/leads/queries";
import { normalizeEmail, normalizePhone } from "@/lib/extract/normalize";
import { recomputeContactQuality, validateEmails } from "@/lib/jobs/zipSearch";
import { getProviders } from "@/lib/providers";

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
 * Fix round (review): the whole read-validate-write sequence runs inside one
 * `prisma.$transaction`. The `notes` append itself (Task 4 re-review — see below) is a single
 * atomic *and serialized* `UPDATE ... CASE` statement rather than a read-then-write against a
 * pre-fetched `notes` value, so two concurrent adds are properly ordered against each other
 * instead of one silently clobbering the other. Two correctness bugs in the per-row contact
 * upsert are also fixed here: adding a person whose email/phone already exists as an
 * *Apollo*-sourced row used to (a) relabel that row `source: "manual"`, which made it immune to
 * "not the decision-maker" suppression (that only ever deletes `source: "apollo"` rows — see the
 * PATCH handler below), and (b) overwrite its `personName`, which could split that person's email
 * and LinkedIn rows into two different "people" the next time `groupPeople` ran (they'd only
 * match up again if it happened to be retyped identically). Now an existing row's
 * `source`/`apolloId` are never touched, and `personName` is only filled in when the row doesn't
 * already have one.
 *
 * Fix round (Task 4 re-review): when a submitted email/phone lands on a row that *already* has a
 * `personName`, that row is the canonical identity for this person — `Business.primaryPerson`
 * (and `primaryPersonTitle`, when the form left title blank) now follows that existing name
 * rather than whatever the rep just retyped in the name field, so a slightly different
 * spelling/case never splits the primary contact from its own Contact rows in `groupPeople`.
 *
 * Fix round (whole-branch review, L1): the canonical name/title is now resolved in a first pass
 * over every row this request touches, *before* any write happens — the previous version resolved
 * it progressively during the same loop that also created rows, so a row with no existing match
 * (processed before a later row's match resolved the canonical identity) got written under the
 * rep's raw typed name instead. Now every new Contact row this call creates is written with
 * `personName: canonicalName` unconditionally, so two rows submitted in the same request (e.g. a
 * new phone number alongside an email that already belongs to a known "Albert Reyes") always agree
 * on one identity instead of `groupPeople` splitting them into two different people.
 *
 * Fix round (whole-branch review, M4): a submission that would write no Contact row at all and
 * isn't setting a primary either (`setPrimary: false` with neither email nor phone) does nothing
 * whatsoever — refused with a 400 rather than silently discarding whatever the rep typed (a title,
 * a note) into thin air.
 *
 * Fix round (whole-branch review, M5): `recomputeContactQuality` runs after every successful add
 * (a manual email/phone changes the score the same way an Apollo-sourced one would), and a newly
 * submitted email gets one `validateEmails` pass (a single MX lookup) so it doesn't sit as
 * "unchecked" until the next unrelated enrich/zip-search touches this business — failures are
 * tolerated (the add itself has already succeeded; a slow/broken MX check shouldn't roll it back).
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

  // M4: a submission with no email/phone (nothing to write as a Contact row) and not setting a
  // primary either would do literally nothing — a title or note typed into that form would just
  // be silently dropped. Checked before the transaction; cheap, no DB round trip needed.
  if (rows.length === 0 && !setPrimary) {
    throw new ApiError(400, "Add an email or phone, or set this person as primary.");
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.business.findFirst({
      where: { id, ownerId: actor.id },
      select: { id: true, primaryPerson: true, contacts: { select: { personName: true } } },
    });
    if (!existing) throw new ApiError(404, "Business not found");

    const nameAlreadyExists =
      sameName(existing.primaryPerson, name) || existing.contacts.some((c) => sameName(c.personName, name));
    const hasIdentifyingInfo = !!email || !!phone || !!title;
    if (!hasIdentifyingInfo && nameAlreadyExists) {
      throw new ApiError(400, `${name} already has a contact — add an email, phone, or title to add a new entry.`);
    }

    // L1: pass 1 — resolve the canonical identity from any row this request touches that already
    // carries a `personName`, before any write happens. `canonicalTitle` stays whatever that same
    // row's own `personTitle` was (or null) — never the form's `title` — so the two can be told
    // apart at the write sites below (an existing row's title is still overwritten outright by a
    // non-blank form title; a brand-new row prefers the already-known canonical title, per L1).
    let canonicalName: string | null = null;
    let canonicalTitle: string | null = null;
    const existingRowByKey = new Map<string, Awaited<ReturnType<typeof tx.contact.findUnique>>>();
    for (const r of rows) {
      const existingRow = await tx.contact.findUnique({ where: { businessId_type_value: { businessId: id, type: r.type, value: r.value } } });
      existingRowByKey.set(`${r.type}:${r.value}`, existingRow);
      if (existingRow?.personName && canonicalName === null) {
        canonicalName = existingRow.personName;
        canonicalTitle = existingRow.personTitle ?? null;
      }
    }
    canonicalName ??= name; // nothing on file yet for this person — this submission's own name is canonical

    // Pass 2: write, now that every row agrees on the same canonical identity.
    for (const r of rows) {
      const existingRow = existingRowByKey.get(`${r.type}:${r.value}`);
      if (existingRow) {
        // Never touch `source`/`apolloId` — an Apollo-sourced row stays Apollo-sourced (and
        // therefore still suppressible), regardless of who just hand-added the same email/phone.
        const data: { personName?: string; personTitle?: string } = {};
        // Only fill a *missing* name — never overwrite one, so an existing row (Apollo or
        // otherwise) doesn't get split from its sibling email/LinkedIn row under a different name.
        if (!existingRow.personName) data.personName = canonicalName;
        // A non-blank form title still overwrites an existing row's own title outright (unchanged
        // from before L1 — this is about *this* row's title, not the cross-row canonical one).
        if (title) data.personTitle = title;
        if (Object.keys(data).length > 0) await tx.contact.update({ where: { id: existingRow.id }, data });
      } else {
        // L1: a brand-new row has no title of its own to defer to — prefer the identity's
        // already-known canonical title over the form's, falling back to the form's title only
        // when nothing was already on file.
        await tx.contact.create({ data: { ownerId: actor.id, businessId: id, type: r.type, value: r.value, source: "manual", personName: canonicalName, personTitle: canonicalTitle ?? title } });
      }
    }

    if (setPrimary) {
      // The primary pointer keeps the form's title taking priority when given (unchanged — see
      // the Task 3 fix-round test "a submitted form title still wins..."), falling back to the
      // canonical title only when the form left title blank.
      await tx.business.update({ where: { id }, data: { primaryPerson: canonicalName, primaryPersonTitle: title ?? canonicalTitle } });
    }
    if (note) {
      // L1: the note is attributed to the canonical name, not the rep's raw typed one, so a note
      // added alongside a re-typed "Al" still reads as being about "Albert Reyes" in the log.
      const line = `Contact note (${canonicalName}): ${note}`;
      // Atomic AND serialized (fix round, Task 4 re-review): a single UPDATE ... CASE statement,
      // not a read-then-write against a pre-fetched `notes` value — the earlier version read
      // `existing.notes` once at the top of the transaction and wrote `existing.notes + line`
      // back, which is atomic (one transaction) but not serialized against a second concurrent
      // add under Postgres's default READ COMMITTED isolation: two adds racing this way could
      // both read the same starting value and one append would silently overwrite the other. This
      // statement instead reads and appends to the row's *current* value in the same round trip,
      // so concurrent adds are properly ordered and neither note is lost.
      await tx.$executeRaw`UPDATE "Business" SET "notes" = CASE WHEN "notes" = '' THEN ${line} ELSE "notes" || E'\n' || ${line} END WHERE "id" = ${id}`;
    }
    await tx.activityLog.create({
      data: { ownerId: actor.id, businessId: id, kind: "poc_updated", message: `Added ${canonicalName}${title ? `, ${title}` : ""} by hand${setPrimary ? " (set as primary)" : ""}` },
    });
  });

  // M5: quality/validation follow-up outside the transaction (both hit the database on their own
  // and don't need to be part of this one atomic write) — a newly submitted email gets a single MX
  // check so it doesn't sit "unchecked" until some unrelated job touches this business next, and
  // the contact-quality score/band reflect whatever this add just changed either way.
  if (email) {
    try {
      await validateEmails([id], { providers: getProviders(), log: () => {} });
    } catch {
      // Tolerated: the add itself already succeeded — a slow/broken MX lookup shouldn't undo it.
    }
  }
  await recomputeContactQuality(id);

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

  // Idempotent (fix round): suppressing an id that's already suppressed is a no-op 200 for the
  // parts that matter — no activity row (the "Removed ..." row was already written once), no
  // candidates/suppressedApolloIds rewrite. Whole-branch review M3: the delete itself still runs
  // (a query that normally deletes zero rows, since the first suppress already ran it, is cheap)
  // as a defensive guard against a revealed Apollo row somehow existing again for an id this
  // business already suppressed — better to actually enforce "never comes back" than to trust that
  // it can't happen and skip the check.
  if (existing.suppressedApolloIds.includes(apolloId)) {
    await prisma.contact.deleteMany({ where: { businessId: id, source: "apollo", apolloId } });
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
  // M5: suppression just hard-deleted Contact rows (see the deleteMany above), which can change
  // the quality score/band (e.g. losing the only named person on file) — recompute so the badge
  // doesn't keep showing a score for contacts that no longer exist.
  await recomputeContactQuality(id);

  const business = await getBusinessDetail(id, actor.id);
  return json({ business }, 200);
});
