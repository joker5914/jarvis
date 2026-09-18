import { describe, it, expect, afterAll, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { POST as peoplePost, PATCH as peoplePatch } from "@/app/api/businesses/[id]/people/route";

// The routes resolve the actor via getActor(), which is always "local-user" (see src/lib/actor.ts).
const OWNER = "local-user";
const BIZ_NAME = "People Route Test Biz";

function jsonReq(body: unknown = {}): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

async function biz(over: Partial<Prisma.BusinessUncheckedCreateInput> = {}) {
  return prisma.business.create({
    data: { ownerId: OWNER, name: BIZ_NAME, source: "zip_search", ...over },
  });
}

async function cleanup() {
  await prisma.business.deleteMany({ where: { ownerId: OWNER, name: BIZ_NAME } });
  await prisma.business.deleteMany({ where: { name: "Other Owner's People Biz" } });
}
beforeEach(cleanup);
afterAll(cleanup);

describe("POST /businesses/:id/people — add a person by hand (Plan 10 Task 3)", () => {
  it("email + phone + title sets primary by default and creates two contact rows", async () => {
    const b = await biz();
    const res = await peoplePost(
      jsonReq({ name: "Albert", title: "Owner", email: "Albert@Pearland-Coffee.com", phone: " 281-555-1234 " }),
      ctxFor(b.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.primaryPerson).toBe("Albert");
    expect(body.business.primaryPersonTitle).toBe("Owner");

    const contacts = await prisma.contact.findMany({ where: { businessId: b.id }, orderBy: { type: "asc" } });
    expect(contacts).toHaveLength(2);
    const email = contacts.find((c) => c.type === "email");
    const phone = contacts.find((c) => c.type === "phone");
    expect(email?.value).toBe("albert@pearland-coffee.com"); // normalizeEmail lower-cases
    expect(email?.source).toBe("manual");
    expect(email?.personName).toBe("Albert");
    expect(email?.personTitle).toBe("Owner");
    // normalizePhone (E.164) — the same normalizer zipSearch/promote already use — not the raw
    // trimmed string.
    expect(phone?.value).toBe("+12815551234");
  });

  it("an invalid phone is rejected with 400 rather than stored as-is", async () => {
    const b = await biz();
    const res = await peoplePost(jsonReq({ name: "Albert", phone: "not-a-phone" }), ctxFor(b.id));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/valid phone/i);
    expect(await prisma.contact.count({ where: { businessId: b.id } })).toBe(0);
  });

  it("a hand-typed phone in a different format collides with an existing normalized row instead of duplicating it", async () => {
    const b = await biz();
    await prisma.contact.create({
      data: { ownerId: OWNER, businessId: b.id, type: "phone", value: "+12815551234", source: "website" },
    });
    const res = await peoplePost(jsonReq({ name: "Albert", phone: "(281) 555-1234" }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const phones = await prisma.contact.findMany({ where: { businessId: b.id, type: "phone" } });
    expect(phones).toHaveLength(1);
    expect(phones[0].value).toBe("+12815551234");
    expect(phones[0].personName).toBe("Albert"); // filled in since the existing row had none
  });

  // MUST fix (review): adding a person whose email is already an *Apollo*-sourced row must never
  // relabel it "manual" (that would make it immune to "not the decision-maker" suppression, which
  // only ever deletes source:"apollo" rows) or overwrite its personName (that could split it from
  // a sibling LinkedIn row under a different name next time groupPeople runs).
  it("adding a person over an existing Apollo-sourced contact row keeps source:apollo, keeps the Apollo personName, and keeps the Apollo title when the form title is blank", async () => {
    const b = await biz();
    await prisma.contact.create({
      data: { ownerId: OWNER, businessId: b.id, type: "email", value: "albert@pearland-coffee.com", source: "apollo", personName: "Albert Reyes", personTitle: "Owner", apolloId: "fake-albert" },
    });
    const res = await peoplePost(jsonReq({ name: "Albert", email: "albert@pearland-coffee.com" }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const row = await prisma.contact.findUniqueOrThrow({ where: { businessId_type_value: { businessId: b.id, type: "email", value: "albert@pearland-coffee.com" } } });
    expect(row.source).toBe("apollo");
    expect(row.apolloId).toBe("fake-albert");
    expect(row.personName).toBe("Albert Reyes"); // not overwritten to the form's "Albert"
    expect(row.personTitle).toBe("Owner"); // kept — the form left title blank

    // Still suppressible afterwards — proves the row genuinely stayed source:"apollo".
    const suppressRes = await peoplePatch(jsonReq({ suppressApolloId: "fake-albert" }), ctxFor(b.id));
    expect(suppressRes.status).toBe(200);
    expect(await prisma.contact.count({ where: { businessId: b.id } })).toBe(0);
  });

  it("adding a person over an existing Apollo row WITH a form title overwrites the title but still leaves source/personName alone", async () => {
    const b = await biz();
    await prisma.contact.create({
      data: { ownerId: OWNER, businessId: b.id, type: "email", value: "albert@pearland-coffee.com", source: "apollo", personName: "Albert Reyes", personTitle: "Assistant Manager", apolloId: "fake-albert" },
    });
    const res = await peoplePost(jsonReq({ name: "Albert", title: "Owner", email: "albert@pearland-coffee.com" }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const row = await prisma.contact.findUniqueOrThrow({ where: { businessId_type_value: { businessId: b.id, type: "email", value: "albert@pearland-coffee.com" } } });
    expect(row.source).toBe("apollo");
    expect(row.personName).toBe("Albert Reyes");
    expect(row.personTitle).toBe("Owner");
  });

  it("writes an activity row for the add", async () => {
    const b = await biz();
    const res = await peoplePost(jsonReq({ name: "Albert", title: "Owner", email: "albert@pearland-coffee.com" }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const activity = await prisma.activityLog.findFirst({ where: { businessId: b.id, kind: "poc_updated" }, orderBy: { createdAt: "desc" } });
    expect(activity?.message).toBe("Added Albert, Owner by hand (set as primary)");
  });

  it("a note on a business with empty notes is not prefixed with a stray newline", async () => {
    const b = await biz(); // notes defaults to ""
    const res = await peoplePost(jsonReq({ name: "Albert", email: "albert@pearland-coffee.com", note: "Met him at the counter." }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.notes).toBe("Contact note (Albert): Met him at the counter.");
  });

  it("setPrimary: false leaves the existing primary contact untouched", async () => {
    const b = await biz({ primaryPerson: "Existing Primary" });
    const res = await peoplePost(jsonReq({ name: "Someone Else", email: "someone@pearland-coffee.com", setPrimary: false }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.primaryPerson).toBe("Existing Primary");
  });

  it("a name with only a title (no email/phone) creates zero contact rows but still sets primaryPerson/primaryPersonTitle", async () => {
    const b = await biz();
    const res = await peoplePost(jsonReq({ name: "Albert", title: "Owner" }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.primaryPerson).toBe("Albert");
    expect(body.business.primaryPersonTitle).toBe("Owner");
    expect(await prisma.contact.count({ where: { businessId: b.id } })).toBe(0);
  });

  it("a bare new name (no title/email/phone) is a valid 200 — only a *repeat* submission with nothing new is a 400", async () => {
    const b = await biz();
    const first = await peoplePost(jsonReq({ name: "Albert" }), ctxFor(b.id));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.business.primaryPerson).toBe("Albert");

    // Same name again, still nothing but the name: no new information, so it's refused.
    const second = await peoplePost(jsonReq({ name: "Albert" }), ctxFor(b.id));
    expect(second.status).toBe(400);
    const secondBody = await second.json();
    expect(secondBody.error).toMatch(/already has a contact/i);
  });

  // Normalization (Task 3 amendment): trim + collapse internal whitespace, compared
  // case-insensitively, so a re-typed name with different spacing/casing is still recognized as
  // "the same person" for the 400-on-no-new-info rule.
  it("whitespace/case variants of an already-added name are recognized as the same person", async () => {
    const b = await biz();
    const first = await peoplePost(jsonReq({ name: "  Albert   Reyes  " }), ctxFor(b.id));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.business.primaryPerson).toBe("Albert Reyes"); // trimmed + collapsed

    const second = await peoplePost(jsonReq({ name: "albert reyes" }), ctxFor(b.id));
    expect(second.status).toBe(400);
  });

  it("an invalid email is rejected with 400 rather than stored as-is", async () => {
    const b = await biz();
    const res = await peoplePost(jsonReq({ name: "Albert", email: "not-an-email" }), ctxFor(b.id));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/valid email/i);
    expect(await prisma.contact.count({ where: { businessId: b.id } })).toBe(0);
  });

  it("a note is appended to Business.notes as 'Contact note (<name>): …'", async () => {
    const b = await biz({ notes: "Existing note." });
    const res = await peoplePost(jsonReq({ name: "Albert", email: "albert@pearland-coffee.com", note: "Met him at the counter." }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.notes).toBe("Existing note.\nContact note (Albert): Met him at the counter.");
  });

  it("returns 404 for another owner's business", async () => {
    const other = await prisma.business.create({ data: { ownerId: "some-other-owner", name: "Other Owner's People Biz", source: "zip_search" } });
    const res = await peoplePost(jsonReq({ name: "Albert" }), ctxFor(other.id));
    expect(res.status).toBe(404);
  });

  it("missing name is a 400 (zod)", async () => {
    const b = await biz();
    const res = await peoplePost(jsonReq({}), ctxFor(b.id));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /businesses/:id/people { primaryPerson } — set/clear the manual pointer", () => {
  it("must match an existing person's name on this business (case-insensitive) or is refused", async () => {
    const b = await biz();
    await prisma.contact.create({
      data: { ownerId: OWNER, businessId: b.id, type: "email", value: "addison@example.com", source: "apollo", personName: "Addison Neel", personTitle: "Owner", apolloId: "fake-a" },
    });
    const bad = await peoplePatch(jsonReq({ primaryPerson: "Nobody Here" }), ctxFor(b.id));
    expect(bad.status).toBe(400);

    const ok = await peoplePatch(jsonReq({ primaryPerson: "addison neel" }), ctxFor(b.id));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    // Case-preserving: stored as the Contact row's own personName, not the caller's casing.
    expect(body.business.primaryPerson).toBe("Addison Neel");
    expect(body.business.primaryPersonTitle).toBe("Owner");
  });

  // Normalization (review): PATCH primaryPerson trims + collapses whitespace before matching, the
  // same as POST /people, so "  addison   neel  " still matches "Addison Neel".
  it("whitespace variants of an existing person's name still match", async () => {
    const b = await biz();
    await prisma.contact.create({
      data: { ownerId: OWNER, businessId: b.id, type: "email", value: "addison@example.com", source: "apollo", personName: "Addison Neel", personTitle: "Owner", apolloId: "fake-a" },
    });
    const res = await peoplePatch(jsonReq({ primaryPerson: "  addison   neel  " }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.primaryPerson).toBe("Addison Neel");
  });

  it("null clears the primary contact", async () => {
    const b = await biz({ primaryPerson: "Albert", primaryPersonTitle: "Owner" });
    const res = await peoplePatch(jsonReq({ primaryPerson: null }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.primaryPerson).toBeNull();
    expect(body.business.primaryPersonTitle).toBeNull();
  });

  it("re-confirming a synthesized-only primary (no Contact row) keeps its title", async () => {
    const b = await biz({ primaryPerson: "Albert", primaryPersonTitle: "Owner" });
    const res = await peoplePatch(jsonReq({ primaryPerson: "Albert" }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.primaryPersonTitle).toBe("Owner");
  });

  it("rejects a body with both primaryPerson and suppressApolloId, and a body with neither", async () => {
    const b = await biz();
    const both = await peoplePatch(jsonReq({ primaryPerson: "Albert", suppressApolloId: "fake-a" }), ctxFor(b.id));
    expect(both.status).toBe(400);
    const neither = await peoplePatch(jsonReq({}), ctxFor(b.id));
    expect(neither.status).toBe(400);
  });
});

describe("PATCH /businesses/:id/people { suppressApolloId } — \"not the decision-maker\"", () => {
  async function bizWithRevealedApollo(name = "Addison Neel", title = "Owner", apolloId = "fake-addison") {
    const b = await biz({ primaryPerson: name, candidates: { fetchedAt: new Date().toISOString(), scope: "any", totalAtDomain: 1, candidates: [{ apolloId, firstName: name.split(" ")[0], title, hasEmail: true, orgName: null, rank: 0 }] } });
    await prisma.contact.create({
      data: { ownerId: OWNER, businessId: b.id, type: "email", value: "addison@example.com", source: "apollo", personName: name, personTitle: title, apolloId },
    });
    await prisma.contact.create({
      data: { ownerId: OWNER, businessId: b.id, type: "linkedin", value: "https://www.linkedin.com/in/addison", source: "apollo", personName: name, personTitle: title, apolloId },
    });
    return b;
  }

  it("deletes only the matching source:apollo + apolloId rows, adds the id to suppressedApolloIds, drops it from candidates, clears primary, and logs the removal", async () => {
    const b = await bizWithRevealedApollo();
    // A manual row that happens to share the same value shouldn't be touched by suppression
    // (Task 1 fix round R3: apolloId only ever lives on an already-Apollo-sourced row).
    await prisma.contact.create({
      data: { ownerId: OWNER, businessId: b.id, type: "phone", value: "555-999-0000", source: "manual", personName: "Unrelated Manual Person" },
    });

    const res = await peoplePatch(jsonReq({ suppressApolloId: "fake-addison" }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.business.primaryPerson).toBeNull();
    expect(body.business.primaryPersonTitle).toBeNull();
    expect(body.business.suppressedApolloIds).toContain("fake-addison");
    expect(body.business.candidates.candidates).toHaveLength(0);

    const remaining = await prisma.contact.findMany({ where: { businessId: b.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].source).toBe("manual");

    const activity = await prisma.activityLog.findFirst({ where: { businessId: b.id, kind: "poc_updated" }, orderBy: { createdAt: "desc" } });
    expect(activity?.message).toBe("Removed Addison Neel (not the decision-maker)");
  });

  it("does not clear primaryPerson when it names someone else", async () => {
    const b = await bizWithRevealedApollo("Addison Neel", "Owner", "fake-addison");
    await prisma.business.update({ where: { id: b.id }, data: { primaryPerson: "Albert", primaryPersonTitle: null } });
    const res = await peoplePatch(jsonReq({ suppressApolloId: "fake-addison" }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.primaryPerson).toBe("Albert");
  });

  it("suppressing the same id twice does not duplicate it in suppressedApolloIds", async () => {
    const b = await bizWithRevealedApollo();
    await peoplePatch(jsonReq({ suppressApolloId: "fake-addison" }), ctxFor(b.id));
    const res = await peoplePatch(jsonReq({ suppressApolloId: "fake-addison" }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.suppressedApolloIds.filter((x: string) => x === "fake-addison")).toHaveLength(1);
  });

  // Idempotency (review): a second suppress of an already-suppressed id is a true no-op — no
  // Contact deletes (there's nothing Apollo-sourced left for that id after the first call), and
  // no second activity row.
  it("suppressing an already-suppressed id writes no additional activity row", async () => {
    const b = await bizWithRevealedApollo();
    await peoplePatch(jsonReq({ suppressApolloId: "fake-addison" }), ctxFor(b.id));
    const countAfterFirst = await prisma.activityLog.count({ where: { businessId: b.id, kind: "poc_updated" } });
    const res = await peoplePatch(jsonReq({ suppressApolloId: "fake-addison" }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const countAfterSecond = await prisma.activityLog.count({ where: { businessId: b.id, kind: "poc_updated" } });
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  // 404 (review): an id that names neither a revealed Apollo Contact row nor a stored candidate
  // was never a real person this business knew about.
  it("an apolloId matching neither a Contact row nor a stored candidate is a 404", async () => {
    const b = await biz();
    const res = await peoplePatch(jsonReq({ suppressApolloId: "fake-nonexistent" }), ctxFor(b.id));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/unknown person/i);
  });

  // An id that's only in the free candidate list (never revealed) is still a legal suppress —
  // no Contact rows to delete, but it should still succeed and get added to suppressedApolloIds.
  it("suppressing a candidate-only id (never revealed) succeeds", async () => {
    const b = await biz({ candidates: { fetchedAt: new Date().toISOString(), scope: "any", totalAtDomain: 1, candidates: [{ apolloId: "fake-unrevealed", firstName: "Sam", title: "Barista", hasEmail: false, orgName: null, rank: 0 }] } });
    const res = await peoplePatch(jsonReq({ suppressApolloId: "fake-unrevealed" }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.suppressedApolloIds).toContain("fake-unrevealed");
    expect(body.business.candidates.candidates).toHaveLength(0);
  });

  // candidates: null (review) — a business that never ran "Find people" has no candidate JSON at
  // all; suppressing a revealed person's id must not crash trying to filter a null set.
  it("suppressing when Business.candidates is null (never searched) still works", async () => {
    const b = await biz({ primaryPerson: "Addison Neel" }); // no `candidates` set — stays null
    await prisma.contact.create({
      data: { ownerId: OWNER, businessId: b.id, type: "email", value: "addison@example.com", source: "apollo", personName: "Addison Neel", personTitle: "Owner", apolloId: "fake-addison" },
    });
    const res = await peoplePatch(jsonReq({ suppressApolloId: "fake-addison" }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.candidates).toBeNull();
    expect(body.business.suppressedApolloIds).toContain("fake-addison");
  });

  it("returns 404 for another owner's business", async () => {
    const other = await prisma.business.create({ data: { ownerId: "some-other-owner", name: "Other Owner's People Biz", source: "zip_search" } });
    const res = await peoplePatch(jsonReq({ suppressApolloId: "fake-a" }), ctxFor(other.id));
    expect(res.status).toBe(404);
  });
});
