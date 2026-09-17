# SDR Lead Gen Dashboard — Plan 8: Lead Detail Polish and Email Extraction Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lead detail (drawer and `/leads/[id]`) tidy and balanced on a 375 px phone and on desktop, fix the drawer chrome so "Open full page" never collides with the close button, and stop the website extractor from accepting emails glued to adjacent text (e.g. `name@gmail.comsubmitthanks`).

**Architecture:** Layout-only changes inside `LeadDetail.tsx` and `LeadDrawer.tsx` using the existing shadcn tokens: a header stack (title → badges → category/address → action buttons → suggested pitch → enrich block), contact rows as a two-column grid with a `min-w-0` truncating value and a pinned trailing control group, uniform section headings and dividers. The extractor gets a bounded TLD match with an allow-list and a boundary check, applied in both the HTML scanner and `normalizeEmail`; a one-off script removes stored emails that fail the corrected validator.

**Tech Stack:** Next.js 15.5, React 19, Tailwind 4, shadcn Base UI, Vitest 5, Playwright (existing suite; screenshots for critique only).

**Spec:** `docs/superpowers/specs/2026-09-15-sdr-lead-gen-dashboard-design.md` section 8 (Lead detail; "Responsive: … the drawer becomes full-screen"), section 9 (contact extractor tests). User ruling (2026-09-17, screenshot): "organized better and cleaner … not tidy and balanced … the link at the top right interferes with the close button".

## Global Constraints

- Node 22.22.3 via nvm (`export PATH="/c/Users/cgill/AppData/Roaming/nvm/v22.22.3:$PATH"`). Pinned majors unchanged.
- shadcn **Base UI**: no `asChild`; `render` prop; `nativeButton={false}` on a Button rendering `<a>`; `Select` takes `items`; `Checkbox` uses `onCheckedChange(boolean)`.
- Keep every existing `data-testid` (`lead-detail`, `enrich-button`, `enrich-estimate`, `enrich-excluded-note`, `people-section`, `people-row`, `status-select`, `notes`, and any others in the file) and all behaviour (enrich, status, products, tags, notes autosave). Browser suite stays at 13 and green.
- Design principles from the brief: existing tokens and type; sentence-case labels (no all-caps group labels); one rule between sections with identical spacing; nothing overflows at 375 px; dark and light mode both verified.
- Never reset the dev database (real data). The cleanup script deletes only `Contact` rows of type `email` whose value fails the corrected validator; it prints a dry-run count first.
- Commit per task, conventional message ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; author flags `git -c user.name="cgillett5914" -c user.email="cgillett5914@gmail.com"`. `npx tsc --noEmit` is the source of truth. Stop servers by PID only; the dev server on 3000 and the worker stay running (the dev server hot-reloads the UI).

## File structure

```
src/components/leads/LeadDrawer.tsx     sticky chrome row: link left, close right (pr for the × button)
src/components/leads/LeadDetail.tsx     header stack, action buttons, enrich block, contact grid rows, section rhythm
src/components/leads/CopyButton.tsx     (only if a compact icon-only variant is needed)
src/lib/extract/normalize.ts            EMAIL_RE bounded TLD + allow-list
src/lib/extract/website.ts              EMAIL_SCAN_RE bounded + boundary; prefer mailto hrefs
scripts/cleanup-invalid-emails.ts       one-off, dry-run first
tests/unit/extract/normalize.test.ts, tests/unit/extract/website.test.ts (+cases)
```

---

### Task 1: Lead detail layout (drawer + page)

**Files:**
- Modify: `src/components/leads/LeadDrawer.tsx`, `src/components/leads/LeadDetail.tsx` (and `CopyButton.tsx` only if needed)

**Interfaces:** none new; props unchanged (`LeadDetail({ id, onChanged? })`, `LeadDrawer({ id, onClose, onChanged })`).

- [ ] **Step 1: Drawer chrome**

In `LeadDrawer.tsx` replace the right-aligned link block with a chrome row that reserves space for the sheet's absolute close button (the `SheetContent` close sits at `top-4 right-4`):

```tsx
<SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl">
  <SheetTitle className="sr-only">Lead detail</SheetTitle>
  {id && (
    <>
      <div className="sticky top-0 z-10 flex h-12 items-center border-b bg-background pl-5 pr-14">
        <Link href={`/leads/${id}`} className="text-sm text-blue-600 hover:underline dark:text-blue-400">Open full page</Link>
      </div>
      <div className="p-5">
        <LeadDetail id={id} onChanged={onChanged} />
      </div>
    </>
  )}
</SheetContent>
```
(`pr-14` keeps the link clear of the × at `right-4`; verify the close button's actual offset in `src/components/ui/sheet.tsx` and adjust.)

- [ ] **Step 2: Header stack in `LeadDetail.tsx`**

Replace the header cluster with, in order (all left-aligned, `space-y-2`):
1. `<h2 className="text-lg font-semibold leading-tight sm:text-xl [overflow-wrap:anywhere]">{b.name}</h2>`
2. Badge row: `<div className="flex flex-wrap items-center gap-2"><QualityBadge …/><SourceBadge …/></div>`
3. Category and address as two muted lines: `categoryLabel(b.primaryCategory)` and `formattedAddress` with a trailing `, USA`/`, United States` stripped for display (`addr.replace(/,\s*(USA|United States)$/i, "")`).
4. Action row: `<div className="flex flex-wrap gap-2">` of small outline Buttons: phone (`render={<a href={\`tel:…\`} />}` + `nativeButton={false}`, text `Call (281) 997-7663`) followed by the existing `CopyButton`, `Website` (external link Button), `Search LinkedIn` (external link Button). Links open in a new tab with `rel="noreferrer"`.
5. `Suggested pitch` as a definition row: `<dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm"><dt className="text-muted-foreground">Suggested pitch</dt><dd>{packageLabel(…)}</dd></dl>` (only when present).
6. Enrich block, on its own line, never inline with badges: `<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">` containing the existing `enrich-button` Button and the `enrich-estimate` span (`text-xs text-muted-foreground`), or the `enrich-excluded-note` when excluded. Keep the disabled/zero-credit note beneath as a second line.

- [ ] **Step 3: Contact rows**

Each contact renders as a grid row that cannot overflow:

```tsx
<li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 text-sm">
  <span className="min-w-0 truncate" title={c.value}>{c.value}</span>
  <span className="flex shrink-0 items-center gap-1">
    <ValidationBadge status={c.validationStatus} />   {/* existing badge component or inline; sentence case: Valid / Invalid / Unchecked / Unreachable */}
    <span className="text-xs text-muted-foreground">{c.source}</span>
    {(c.type === "email" || c.type === "phone") && <CopyButton value={c.value} label={titleCase(c.type)} />}
  </span>
</li>
```
Group labels (`Emails`, `Phones`, `Social & LinkedIn`) become `text-xs font-medium text-muted-foreground` in sentence case (drop `uppercase`). Social links: the visible text is the host + path truncated (`truncate` in the value column), the full URL on `title`. The quality reasons paragraph becomes `Why {band}: reason +N · reason +N` in `text-xs text-muted-foreground`.

- [ ] **Step 4: Section rhythm**

Every section: `<section className="border-t pt-4 space-y-3">` with `<h3 className="text-sm font-semibold">`. The header block has no top border. Remove ad-hoc `mt-*` spacing; the outer container is `space-y-4`. People rows use the same grid pattern as contacts (name + title in the value column, LinkedIn/email/copy pinned right). Activity rows: time column `w-16 shrink-0` and message `min-w-0 [overflow-wrap:anywhere]`.

- [ ] **Step 5: Critique with screenshots**

Against the e2e server (fake data; unlock helper uses the test passphrase): write a throwaway Playwright script in the scratchpad (not committed) that unlocks, runs a search, opens the first lead drawer, and screenshots at `375×812` and `1280×800` in both color schemes (`page.emulateMedia({ colorScheme })`). Save the four PNGs to the scratchpad and look at them; fix anything that wraps mid-phrase, overflows, or misaligns. Then run `npm run test:e2e` (13).

- [ ] **Step 6: Verify, commit**

```bash
npx tsc --noEmit && npm run lint && npm test && npm run test:e2e
git add -A && git commit -m "feat(leads): tidy lead detail — drawer chrome, header stack, action row, truncating contact rows, uniform sections

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Email extraction boundary fix and cleanup

**Files:**
- Modify: `src/lib/extract/normalize.ts`, `src/lib/extract/website.ts`, `tests/unit/extract/normalize.test.ts`, `tests/unit/extract/website.test.ts`
- Create: `scripts/cleanup-invalid-emails.ts`

**Live evidence (dev DB, 2026-09-17):** 149 of 960 stored email contacts are suspect, in three classes: (a) text glued after the domain — `chefstevehaug@gmail.compowered`, `info@eatportara.compackages`; (b) text glued before the address — `77581info@eatportara.com…`, `-229-4384chefstevehaug@…`, `440-8500pearlandtx15-007@gyrorepublic.com…` (adjacent text nodes concatenated without a separator, so phone digits and zips ran into the local part); (c) site-builder placeholders — `filler@godaddy.com…`. All three must be fixed at extraction time and cleaned from the database.

**Interfaces:**
- `KNOWN_TLDS` (exported from `normalize.ts`): a Set of plausible TLDs — country codes are covered by the 2-letter rule; include the common generics `com net org edu gov mil biz info io co us name pro mobi asia` and a generous list of gTLDs a small business might use (`app dev tech online site store shop xyz me tv cc style studio salon dental clinic cafe pizza restaurant bar beer coffee fitness yoga photography design law legal realty homes house auto cars repair services solutions group llc inc ltd health care vet pet dog kids school academy church farm garden florist boutique fashion hair beauty spa nails tattoo ink art gallery music events wedding photo media news blog live life world city agency company center email cloud digital global network systems software team tools works zone club fun games plus one today now best top new`). `isPlausibleTld(tld)` = `tld.length === 2 || KNOWN_TLDS.has(tld)`.
- `PLACEHOLDER_EMAIL_RE` (exported): rejects `filler@godaddy.com`, `*@example.com|example.org|example.net|domain.com|email.com|yourdomain.com|yourcompany.com|company.com|test.com|sentry.io|wixpress.com|squarespace.com|godaddy.com|mysite.com|website.com`, and locals `noreply|no-reply|donotreply|filler|placeholder|user|username|yourname|name` at those or any domain when the domain is also a builder domain.
- `normalizeEmail(raw)` returns null unless the TLD is plausible and the address is not a placeholder.
- Scanner text assembly in `website.ts`: before scanning text for emails, insert a separator at every tag boundary so adjacent text nodes cannot fuse (e.g. load the HTML after `html.replace(/>/g, "> ")`, or walk text nodes and join with `" "`); `EMAIL_SCAN_RE` becomes `/(?<![a-z0-9._%+-])([a-z0-9._%+-]+)@([a-z0-9.-]+)\.([a-z]{2,24})(?![a-z])/gi`; when the captured TLD is not plausible, take its longest plausible prefix (`comsubmitthanks` → `com`, `stylestore` → `style`); if none, drop the match. Locals that begin with a phone/zip fragment (`^\d{5}(?=[a-z])`, `^-?\d{3}-\d{4}`) are trimmed to the part after the fragment (`77581info` → `info`, `-229-4384chefstevehaug` → `chefstevehaug`) when the remainder is ≥ 2 chars and starts with a letter; otherwise dropped.
- `mailto:` hrefs are always preferred over scanned text for the same address.

- [ ] **Step 1: Failing unit tests**

`normalize.test.ts`: `normalizeEmail("a@gmail.comsubmitthanks")` → null; `normalizeEmail("a@gmail.com")` → `a@gmail.com`; `normalizeEmail("a@shop.online")` → ok; `normalizeEmail("a@x.zz")` → ok (2-letter); `normalizeEmail("a@x.notatld")` → null.
`website.test.ts`: HTML text `Contact: blacklisttattoocotx@gmail.comSubmitThanks` yields exactly `blacklisttattoocotx@gmail.com`; `mailto:info@example.com?subject=Hi` yields `info@example.com`; `sales@shop.onlineOrder now` yields `sales@shop.online`; `foo@bar.notatld` yields nothing.

- [ ] **Step 2: Implement**, run the unit suites, then the cleanup script:

```ts
// scripts/cleanup-invalid-emails.ts — run with: node --env-file=.env --import=tsx scripts/cleanup-invalid-emails.ts [--apply]
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/extract/normalize";
const apply = process.argv.includes("--apply");
const rows = await prisma.contact.findMany({ where: { type: "email" }, select: { id: true, value: true, businessId: true, ownerId: true } });
// A stored value is junk when the corrected validator rejects it, OR its local part carries a
// phone/zip fragment glued from adjacent page text (syntactically valid, semantically wrong).
const GLUED_LOCAL = /^(-?\d{3}-\d{4}|\d{5})[a-z]/i;
const bad = rows.filter((r) => normalizeEmail(r.value) !== r.value || GLUED_LOCAL.test(r.value.split("@")[0]));
console.log(`${bad.length} of ${rows.length} email contacts are junk`);
for (const r of bad.slice(0, 30)) console.log("  ", r.value);
if (apply && bad.length) {
  await prisma.contact.deleteMany({ where: { id: { in: bad.map((r) => r.id) } } });
  const byOwner = new Map<string, Set<string>>();
  for (const r of bad) { if (!byOwner.has(r.ownerId)) byOwner.set(r.ownerId, new Set()); byOwner.get(r.ownerId)!.add(r.businessId); }
  const { recomputeContactQuality } = await import("@/lib/jobs/zipSearch");
  const { enqueueWebsiteRecheck } = await import("@/lib/jobs/enqueue");
  for (const [ownerId, ids] of byOwner) {
    for (const id of ids) await recomputeContactQuality(id);
    // Re-scrape with the fixed extractor so the real addresses come back (batches of 25, like the Scanner).
    const list = [...ids];
    for (let i = 0; i < list.length; i += 25) await enqueueWebsiteRecheck(list.slice(i, i + 25), ownerId);
    console.log(`owner ${ownerId}: re-scored ${ids.size} businesses, queued ${Math.ceil(list.length / 25)} re-check batches`);
  }
  console.log(`deleted ${bad.length}`);
}
await prisma.$disconnect();
```
Run it dry first (report the count and samples), then with `--apply`.

- [ ] **Step 3: Verify, commit**

```bash
npm test && npm run test:db && npx tsc --noEmit && npm run lint
git add -A && git commit -m "fix(extract): bound email top-level domains (no more name@gmail.comsubmitthanks); cleanup script for stored junk emails

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done criteria for Plan 8

- Drawer: "Open full page" and the close button sit on one chrome row without overlap on phone and desktop.
- Header, action row, enrich block, contact rows and sections lay out cleanly at 375 px and 1280 px in light and dark mode; no horizontal overflow anywhere in the drawer or the page.
- No stored or newly extracted email has text glued past its top-level domain; the dev database's junk email rows are removed and affected businesses re-scored.
- Suites green (e2e 13).
