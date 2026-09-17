"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Tag } from "@prisma/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { categoryLabel } from "@/lib/config/categories";
import { PRODUCTS, packageLabel } from "@/lib/config/packages";
import { isEnrichIssueMessage, latestEnrichIssue } from "@/lib/leads/enrichActivity";
import { formatDate, timeAgo, titleCase } from "@/lib/format";
import { watchEnrichment, type WatchableDetail } from "./useEnrichmentWatch";
import { CopyButton } from "./CopyButton";
import { QualityBadge } from "./QualityBadge";
import { SourceBadge } from "./SourceBadge";

const ENRICH_WATCH_INTERVAL_MS = 2000;
const ENRICH_WATCH_TIMEOUT_MS = 90_000;

type Contact = { id: string; type: string; value: string; personName: string | null; personTitle: string | null; validationStatus: string; source: string };
type Project = { id: string; projectNumber: string; projectName: string; estimatedCost: number | null; startDate: string | null; completionDate: string | null; scopeOfWork: string | null; ownerName: string | null; ownerPhone: string | null; timingWindow: string | null };
type Detail = {
  id: string; name: string; formattedAddress: string | null; zip: string | null; phone: string | null; websiteUrl: string | null;
  primaryCategory: string | null; source: string; exclusion: string; exclusionReasons: string[];
  contactQualityBand: "green" | "yellow" | "red"; contactQualityScore: number; contactQualityReasons: { code: string; points: number; detail: string }[] | null;
  suggestedPackage: string | null; currentProviderHint: string | null; currentProviderEvidence: string | null;
  outreachStatus: string; productsPitched: string[]; notes: string; websiteReachable: boolean | null; websiteError: string | null;
  contacts: Contact[]; tags: { tag: Tag }[]; activity: { id: string; kind: string; message: string; createdAt: string }[]; projects: Project[];
  lastEnrichedAt: string | null;
};

type Person = { key: string; name: string; title: string | null; email: string | null; linkedin: string | null; source: string };
type CreditStatus = { used: number; cap: number; remaining: number; maxPeople: number };

/** Groups contacts that carry a `personName` (Apollo-enriched) into one row per person,
 * pairing that person's email and LinkedIn contact rows together. */
function groupPeople(contacts: Contact[]): Person[] {
  const byName = new Map<string, Person>();
  for (const c of contacts) {
    if (!c.personName) continue;
    let p = byName.get(c.personName);
    if (!p) {
      p = { key: c.personName, name: c.personName, title: c.personTitle, email: null, linkedin: null, source: c.source };
      byName.set(c.personName, p);
    }
    if (!p.title && c.personTitle) p.title = c.personTitle;
    if (c.type === "email" && !p.email) p.email = c.value;
    if (c.type === "linkedin" && !p.linkedin) p.linkedin = c.value;
  }
  return [...byName.values()];
}

const STATUSES = ["not_contacted", "contacted", "interested", "not_a_fit", "customer"];
// Base UI translation: pass `items` so the trigger shows the matching label
// immediately, since <Select.Value> otherwise resolves labels only from
// <Select.Item>s that have already mounted in the (portalled, closed-by-default) popup.
const STATUS_ITEMS = STATUSES.map((s) => ({ value: s, label: titleCase(s) }));
const GROUPS: { key: string; label: string; types: string[] }[] = [
  { key: "email", label: "Emails", types: ["email"] },
  { key: "phone", label: "Phones", types: ["phone"] },
  { key: "social", label: "Social & LinkedIn", types: ["linkedin", "facebook", "instagram", "twitter", "yelp", "other"] },
];

export function LeadDetail({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const router = useRouter();
  const [b, setB] = useState<Detail | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newTag, setNewTag] = useState("");
  const [notes, setNotes] = useState("");
  const [enriching, setEnriching] = useState(false);
  const [chainActionPending, setChainActionPending] = useState(false);
  const [credits, setCredits] = useState<CreditStatus | null>(null);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cancels an in-flight watchEnrichment poll loop (e.g. the drawer closes or switches to a
  // different lead) so a stale timer never touches this component's state after it's gone.
  const enrichWatchController = useRef<AbortController | null>(null);
  // Aborts on a different lead being shown (the drawer can swap `id` without fully unmounting
  // LeadDetail — see also the `key={id}` belt-and-braces fix on LeadDrawer) as well as on real
  // unmount, so a watch started for one lead never lands on another's state. Also resets
  // `enriching` here (not just in enrich()'s finally): the component is still mounted across an
  // id swap, so the *next* lead's button must not be stuck reading "Enriching…" from the old
  // one's in-flight watch, which resolves "timeout" (aborted) and — by design — skips touching
  // state itself once it sees its own controller was aborted.
  useEffect(() => {
    return () => {
      enrichWatchController.current?.abort();
      setEnriching(false);
    };
  }, [id]);

  async function load(opts: { quiet?: boolean } = {}): Promise<Detail | null> {
    // `quiet` skips the `setB(null)` blank-out: used after watchEnrichment resolves, so the
    // drawer doesn't flash back to "Loading…" once enrichment has already finished rendering.
    if (!opts.quiet) setB(null);
    const res = await fetch(`/api/businesses/${id}`, { cache: "no-store" });
    if (!res.ok) { toast.error("Could not load lead"); return null; }
    const { business } = await res.json();
    setB(business);
    setNotes(business.notes);
    return business as Detail;
  }
  async function loadCredits() {
    const res = await fetch("/api/enrichment/credits", { cache: "no-store" });
    if (!res.ok) return;
    setCredits(await res.json());
  }
  useEffect(() => { load(); fetch("/api/tags").then((r) => r.json()).then((d) => setTags(d.items ?? [])); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadCredits(); }, []);

  useEffect(() => () => { if (notesTimer.current) clearTimeout(notesTimer.current); }, []);

  async function patch(body: Record<string, unknown>, opts: { quiet?: boolean; refresh?: boolean } = {}) {
    const { quiet = false, refresh = true } = opts;
    const res = await fetch(`/api/businesses/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return toast.error("Save failed");
    const { business } = await res.json();
    setB(business);
    if (refresh) onChanged?.();
    if (!quiet) toast.success("Saved");
  }

  async function enrich() {
    setEnriching(true);
    enrichWatchController.current?.abort(); // a stale watch from a previous click, if any
    const controller = new AbortController();
    enrichWatchController.current = controller;
    try {
      const res = await fetch(`/api/businesses/${id}/enrich`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: b?.lastEnrichedAt != null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast.error(data.error ?? "Apollo is not configured", {
          action: { label: "Settings", onClick: () => router.push(data.settingsHref ?? "/settings") },
        });
        return;
      }
      if (!res.ok) { toast.error(data.error ?? "Enrichment failed"); return; }
      toast.success("Enrichment queued");
      onChanged?.();
      // Server-time baseline, not browser time: the newest enriched activity (or lastEnrichedAt)
      // from the detail already loaded before this click, so "newer than since" compares two
      // server timestamps instead of a client clock against a server one. A lead that has never
      // been enriched has neither, so epoch always counts as "before".
      const priorEnriched = b?.activity.find((a) => a.kind === "enriched");
      const since = priorEnriched
        ? new Date(priorEnriched.createdAt)
        : b?.lastEnrichedAt
          ? new Date(b.lastEnrichedAt)
          : new Date(0);
      const result = await watchEnrichment({
        businessId: id,
        since,
        fetchDetail: async (): Promise<WatchableDetail> => {
          const r = await fetch(`/api/businesses/${id}`, { cache: "no-store" });
          if (!r.ok) throw new Error(`Could not load lead (HTTP ${r.status})`); // treated as a failed poll — watchEnrichment keeps retrying
          const { business } = await r.json();
          return business as WatchableDetail;
        },
        intervalMs: ENRICH_WATCH_INTERVAL_MS,
        timeoutMs: ENRICH_WATCH_TIMEOUT_MS,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return; // unmounted/switched leads mid-watch — don't touch state
      const fresh = await load({ quiet: true }); // avoid re-blanking a drawer that's already rendered
      await loadCredits();
      onChanged?.();
      if (result === "done") {
        const newest = fresh?.activity.find((a) => a.kind === "enriched");
        // An unavailable/paused/failed/org-mismatch outcome already surfaces as the amber
        // `lastEnrichIssue` line below the button (from the same activity row) — toasting it too
        // would just duplicate that message.
        if (newest && !isEnrichIssueMessage(newest.message)) toast.success(newest.message);
      } else {
        toast("Still working — check the activity log in a minute");
      }
    } finally {
      if (!controller.signal.aborted) setEnriching(false);
    }
  }

  // "Not an SMB (chain)" action (Plan 9 Task 3): adds this lead's chain key to the owner's chain
  // list and re-scores every business, so a name-alike lead (e.g. another location of the same
  // brand) gets excluded in the same click. `rescore.newlyExcluded` (fix round: counts only
  // businesses the PATCH route attributes to *this* chain key, not incidental unrelated flips —
  // see route.ts's N6 comment) already includes this business itself, so the toast's "N similar
  // leads" figure subtracts one (floored at 0).
  async function markAsChain() {
    if (!b) return;
    const name = b.name;
    setChainActionPending(true);
    try {
      const res = await fetch(`/api/businesses/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ markAsChain: true }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "Could not mark as chain"); return; }
      // Honest zero (fix round, review N6): should be impossible after the chainKeyFor fix (the
      // key always matches the name it was built from), but a false "Excluded" toast is worse
      // than an extra guard if some other reason ever prevents the flip.
      if (data.business?.exclusion === "none") { toast.error(`Could not exclude ${name}`); return; }
      const extra = Math.max(0, (data.rescore?.newlyExcluded ?? 1) - 1);
      toast.success(extra > 0 ? `Excluded ${name} and ${extra} similar lead${extra === 1 ? "" : "s"}` : `Excluded ${name}`);
      await load({ quiet: true });
      onChanged?.();
    } finally {
      setChainActionPending(false);
    }
  }

  // "Restore as SMB" un-mark path (fix round): the inverse action, scoped to just this business
  // (see the PATCH route's clearChain branch for why it doesn't cascade to look-alikes the way
  // markAsChain's rescore does).
  async function restoreAsSmb() {
    if (!b) return;
    const name = b.name;
    setChainActionPending(true);
    try {
      const res = await fetch(`/api/businesses/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ clearChain: true }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error ?? "Could not restore as SMB"); return; }
      toast.success(`Restored ${name}`);
      await load({ quiet: true });
      onChanged?.();
    } finally {
      setChainActionPending(false);
    }
  }

  function onNotes(v: string) {
    setNotes(v);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => patch({ notes: v }, { quiet: true, refresh: false }), 800);
  }

  async function createTag() {
    const name = newTag.trim();
    if (!name) return;
    const res = await fetch("/api/tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    if (!res.ok) return toast.error("Could not create tag");
    const { tag } = await res.json();
    setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
    setNewTag("");
    await patch({ tagIds: [...(b?.tags.map((t) => t.tag.id) ?? []), tag.id] });
  }

  if (!b) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const userTagIds = new Set(b.tags.map((t) => t.tag.id));
  const linkedinSearch = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(b.name)}`;
  const people = groupPeople(b.contacts);

  const address = b.formattedAddress?.replace(/,\s*(USA|United States)$/i, "");
  // Surfaces the latest unavailable/paused enrich attempt so a click that silently failed (e.g.
  // a plan-blocked Apollo endpoint, a budget pause) stays visible on refresh, not just as a
  // one-shot toast — but only while it's still the most recent enrich outcome, so a later
  // successful re-enrich clears the line instead of leaving a stale warning underneath it.
  const lastEnrichIssue = latestEnrichIssue(b.activity);

  return (
    <div className="space-y-4" data-testid="lead-detail">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold leading-tight sm:text-xl [overflow-wrap:anywhere]">{b.name}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <QualityBadge band={b.contactQualityBand} score={b.contactQualityScore} />
          <SourceBadge source={b.source} />
        </div>
        <div className="text-sm text-muted-foreground">
          <p>{categoryLabel(b.primaryCategory)}</p>
          {address && <p>{address}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {b.phone && (
            <>
              <Button size="sm" variant="outline" nativeButton={false} render={<a href={`tel:${b.phone}`} />}>
                Call {b.phone}
              </Button>
              <CopyButton value={b.phone} label="Phone" />
            </>
          )}
          {b.websiteUrl && (
            <Button size="sm" variant="outline" nativeButton={false} render={<a href={b.websiteUrl} target="_blank" rel="noreferrer" />}>
              Website{b.websiteReachable === false ? " (unreachable)" : ""}
            </Button>
          )}
          <Button size="sm" variant="outline" nativeButton={false} render={<a href={linkedinSearch} target="_blank" rel="noreferrer" />}>
            Search LinkedIn
          </Button>
        </div>
        {b.exclusion !== "none" && <p className="text-xs text-red-600">Excluded: {b.exclusionReasons.join(", ")}</p>}
        {b.suggestedPackage && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
            <dt className="text-muted-foreground">Suggested pitch</dt>
            <dd>{packageLabel(b.suggestedPackage)}</dd>
          </dl>
        )}
        {b.currentProviderHint && (
          <p className="text-sm"><span className="text-muted-foreground">Current provider (hint):</span> {b.currentProviderHint}
            {b.currentProviderEvidence && <span className="block text-xs text-muted-foreground">“{b.currentProviderEvidence}”</span>}</p>
        )}
        <div className="space-y-1">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            {b.exclusion === "none" ? (
              <>
                <Button size="sm" variant="outline" data-testid="enrich-button" disabled={enriching || credits?.remaining === 0} onClick={enrich}>
                  {enriching ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      Enriching…
                    </span>
                  ) : b.lastEnrichedAt ? "Re-enrich" : "Enrich with Apollo"}
                </Button>
                {credits && (
                  <span className="text-xs text-muted-foreground" data-testid="enrich-estimate">
                    ~{credits.maxPeople} credit{credits.maxPeople === 1 ? "" : "s"} · {credits.remaining} left this cycle
                  </span>
                )}
                {/* N9: disabled while enriching too — a click here mid-enrich would race the
                    reveal loop's own exclusion checks against this button's PATCH. */}
                <Button size="sm" variant="ghost" data-testid="mark-chain-button" disabled={enriching || chainActionPending} onClick={markAsChain}>
                  {chainActionPending ? "Excluding…" : "Not an SMB (chain)"}
                </Button>
              </>
            ) : (
              <>
                <span className="text-xs text-muted-foreground" data-testid="enrich-excluded-note">
                  Excluded — not enriched
                </span>
                {b.exclusionReasons.some((r) => r.startsWith("chain:")) && (
                  <Button size="sm" variant="ghost" data-testid="restore-smb-button" disabled={chainActionPending} onClick={restoreAsSmb}>
                    {chainActionPending ? "Restoring…" : "Restore as SMB"}
                  </Button>
                )}
              </>
            )}
          </div>
          {b.exclusion === "none" && credits?.remaining === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">Monthly Apollo credit cap reached — adjust in Settings</p>
          )}
          {b.exclusion === "none" && lastEnrichIssue && (
            <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="enrich-last-error">{lastEnrichIssue.message}</p>
          )}
        </div>
      </div>

      <section className="border-t pt-4 space-y-3">
        <h3 className="text-sm font-semibold">Contacts</h3>
        {GROUPS.map((g) => {
          const list = b.contacts.filter((c) => g.types.includes(c.type));
          if (list.length === 0) return null;
          return (
            <div key={g.key} className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">{g.label}</div>
              <ul className="space-y-1">
                {list.map((c) => (
                  <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 text-sm">
                    <span className="min-w-0 truncate" title={c.value}>
                      {c.type === "email" ? <a href={`mailto:${c.value}`} className="hover:underline">{c.value}</a>
                        : c.type === "phone" ? <a href={`tel:${c.value}`} className="hover:underline">{c.value}</a>
                        : <a href={c.value} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{titleCase(c.type)}: {c.value.replace(/^https?:\/\/(www\.)?/, "")}</a>}
                      {c.personName && <span className="text-muted-foreground"> · {c.personName}{c.personTitle ? `, ${c.personTitle}` : ""}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className={`rounded px-1 text-[10px] ${c.validationStatus === "valid" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : c.validationStatus === "invalid" ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"}`}>{titleCase(c.validationStatus)}</span>
                      <span className="text-xs text-muted-foreground">{c.source}</span>
                      {(c.type === "email" || c.type === "phone") && <CopyButton value={c.value} label={titleCase(c.type)} />}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {b.contacts.length === 0 && <p className="text-sm text-muted-foreground">No contacts found yet.</p>}
        {b.contactQualityReasons && b.contactQualityReasons.length > 0 && (
          <p className="text-xs text-muted-foreground">Why {b.contactQualityBand}: {b.contactQualityReasons.map((r) => `${r.detail} +${r.points}`).join(" · ")}</p>
        )}
      </section>

      <section className="border-t pt-4 space-y-3" data-testid="people-section">
        <h3 className="text-sm font-semibold">People</h3>
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">No named contacts yet. Enrich with Apollo to find decision-makers.</p>
        ) : (
          <ul className="space-y-1">
            {people.map((p) => (
              <li key={p.key} data-testid="people-row" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 text-sm">
                <span className="min-w-0 truncate" title={p.title ? `${p.name}, ${p.title}` : p.name}>
                  <span className="font-medium">{p.name}</span>
                  {p.title && <span className="text-muted-foreground"> · {p.title}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <SourceBadge source={p.source} />
                  {p.linkedin && <a className="hover:underline" href={p.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
                  {p.email && <CopyButton value={p.email} label={p.email} />}
                </span>
              </li>
            ))}
          </ul>
        )}
        {b.lastEnrichedAt && <p className="text-xs text-muted-foreground">Enriched {timeAgo(b.lastEnrichedAt)}</p>}
      </section>

      <section className="border-t pt-4 space-y-3">
        <h3 className="text-sm font-semibold">Outreach</h3>
        <div className="space-y-1">
          <Label htmlFor="status">Status</Label>
          <Select value={b.outreachStatus} onValueChange={(v) => { if (v != null) patch({ outreachStatus: v }); }} items={STATUS_ITEMS}>
            <SelectTrigger id="status" data-testid="status-select"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Products pitched</Label>
          <div className="mt-1 flex flex-wrap gap-3">
            {PRODUCTS.map((p) => (
              <label key={p.slug} className="flex items-center gap-1 text-sm">
                <Checkbox checked={b.productsPitched.includes(p.slug)}
                  onCheckedChange={(c) => patch({ productsPitched: c ? [...b.productsPitched, p.slug] : b.productsPitched.filter((x) => x !== p.slug) })} />
                {p.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label>Tags</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {tags.filter((t) => !t.isSystem).map((t) => (
              <button key={t.id} type="button"
                aria-pressed={userTagIds.has(t.id)}
                className={`rounded-full border px-2 py-0.5 text-xs ${userTagIds.has(t.id) ? "text-white" : "text-muted-foreground"}`}
                style={userTagIds.has(t.id) ? { background: t.color, borderColor: t.color } : undefined}
                onClick={() => patch({ tagIds: userTagIds.has(t.id) ? [...userTagIds].filter((x) => x !== t.id) : [...userTagIds, t.id] })}>
                {t.name}
              </button>
            ))}
            <form onSubmit={(e) => { e.preventDefault(); createTag(); }} className="flex gap-1">
              <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="New tag" className="h-7 w-28 text-xs" />
              <Button type="submit" size="sm" variant="outline" className="h-7">Add</Button>
            </form>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" value={notes} onChange={(e) => onNotes(e.target.value)} rows={4} placeholder="Autosaves as you type" data-testid="notes" />
        </div>
      </section>

      {b.projects.length > 0 && (
        <section className="border-t pt-4 space-y-3">
          <h3 className="text-sm font-semibold">TDLR project</h3>
          {b.projects.map((p) => (
            <div key={p.id} className="rounded-md border p-3 text-sm">
              <div className="font-medium">{p.projectName} <span className="text-muted-foreground">({p.projectNumber})</span></div>
              <div className="text-muted-foreground">{formatDate(p.startDate)} → {formatDate(p.completionDate)}{p.estimatedCost != null ? ` · $${p.estimatedCost.toLocaleString()}` : ""}{p.timingWindow ? ` · ${titleCase(p.timingWindow)}` : ""}</div>
              {p.scopeOfWork && <div className="mt-1 text-muted-foreground">{p.scopeOfWork}</div>}
              {p.ownerName && <div className="mt-1">Owner: {p.ownerName}{p.ownerPhone ? ` · ${p.ownerPhone}` : ""}</div>}
            </div>
          ))}
        </section>
      )}

      <section className="border-t pt-4 space-y-3">
        <h3 className="text-sm font-semibold">Activity</h3>
        <ul className="space-y-1 text-sm">
          {b.activity.map((a) => (
            <li key={a.id} className="flex gap-2"><span className="w-16 shrink-0 text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span><span className="min-w-0 [overflow-wrap:anywhere]">{a.message}</span></li>
          ))}
          {b.activity.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
        </ul>
      </section>
    </div>
  );
}
