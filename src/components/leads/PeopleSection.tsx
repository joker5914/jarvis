"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import type { CandidateSet } from "@/lib/enrichment/candidates";
import type { PersonLike } from "@/lib/leads/pocConfidence";
import { pocConfidence } from "@/lib/leads/pocConfidence";
import { CopyButton } from "./CopyButton";
import { SourceBadge } from "./SourceBadge";

export type Person = PersonLike & { key: string; email: string | null; linkedin: string | null };

type CreditStatus = { remaining: number };

/**
 * People section of the lead drawer (Plan 10 Task 2): the confidence line, the revealed-people
 * list (unchanged from before the split), and the free candidate picker — "Find people" lists
 * everything Apollo's search already shows for free, and each candidate reveals for one credit.
 * LeadDetail keeps the fetch logic (POST /candidates, POST /enrich { apolloId }) and passes down
 * plain callbacks so this component stays presentational.
 */
export function PeopleSection({
  people,
  candidates,
  costsCredit,
  primaryPerson,
  revealedApolloIds,
  suppressedApolloIds,
  enriching,
  credits,
  lastEnrichedAt,
  onFindPeople,
  onReveal,
}: {
  people: Person[];
  candidates: CandidateSet | null;
  /** Client-side hint, computed with the same `domainFromUrl` rule the server uses: this
   * business has no usable domain, so a "Find people" call will fall back to a credited
   * Organization Search rather than a free People Search. Only ever labels the button before the
   * click — the response's own `costsCredit` (LeadDetail's `findPeople`) is what the success
   * toast reports, since this prop is never overwritten by it. */
  costsCredit: boolean;
  /** `Business.primaryPerson` — the manual pointer a rep sets by hand. Passed straight through
   * to `pocConfidence` (not derived from `people`'s own `isPrimary` flags): a hand-added primary
   * contact with only a name and title creates no Contact row (Task 3), so `people` alone can't
   * always be trusted to carry it. */
  primaryPerson: string | null;
  /** Apollo ids that already have a revealed Contact row — those candidates show "Revealed"
   * instead of a Reveal button. */
  revealedApolloIds: Set<string>;
  /** Defensive filter only: `findCandidates` already drops suppressed ids before storing the
   * set, but a stale set fetched before a later suppression shouldn't show a suppressed person
   * either. */
  suppressedApolloIds: string[];
  enriching: boolean;
  credits: CreditStatus | null;
  lastEnrichedAt: string | null;
  onFindPeople: () => Promise<void>;
  onReveal: (apolloId: string) => Promise<void>;
}) {
  const [finding, setFinding] = useState(false);
  const [revealingId, setRevealingId] = useState<string | null>(null);

  const confidence = pocConfidence(people, candidates, primaryPerson);
  const confidenceClass =
    confidence.level === "staff" || confidence.level === "manager"
      ? "text-amber-700 dark:text-amber-400"
      : "text-muted-foreground";

  const suppressed = new Set(suppressedApolloIds);
  const visibleCandidates = (candidates?.candidates ?? []).filter((c) => !suppressed.has(c.apolloId));

  async function handleFind() {
    setFinding(true);
    try {
      await onFindPeople();
    } finally {
      setFinding(false);
    }
  }

  async function handleReveal(apolloId: string) {
    setRevealingId(apolloId);
    try {
      await onReveal(apolloId);
    } finally {
      setRevealingId(null);
    }
  }

  const findLabel = candidates ? "Refresh candidates" : "Find people";
  const findButtonLabel = costsCredit ? `${findLabel} (1 credit)` : findLabel;
  const revealDisabled = enriching || revealingId !== null;

  return (
    <section className="border-t pt-4 space-y-3" data-testid="people-section">
      <h3 className="text-sm font-semibold">People</h3>
      <p className={`text-xs ${confidenceClass}`} data-testid="poc-confidence">
        {confidence.label}
      </p>

      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">No named contacts yet.</p>
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
      {lastEnrichedAt && <p className="text-xs text-muted-foreground">Enriched {timeAgo(lastEnrichedAt)}</p>}

      <div className="space-y-2 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            data-testid="find-people-button"
            disabled={finding || (credits?.remaining === 0 && costsCredit)}
            onClick={handleFind}
          >
            {finding ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Searching…
              </span>
            ) : (
              findButtonLabel
            )}
          </Button>
          {candidates && (
            <span className="whitespace-nowrap text-xs text-muted-foreground">Searched {timeAgo(candidates.fetchedAt)}</span>
          )}
        </div>

        {visibleCandidates.length > 0 && (
          <ul className="space-y-1.5" data-testid="candidate-list">
            {visibleCandidates.map((c) => {
              const revealed = revealedApolloIds.has(c.apolloId);
              return (
                <li
                  key={c.apolloId}
                  data-testid="candidate-row"
                  className="flex flex-col gap-1.5 border-t pt-1.5 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0 truncate text-sm" title={c.title ? `${c.firstName ?? "Unnamed"}, ${c.title}` : (c.firstName ?? "Unnamed")}>
                    <span className="font-medium">{c.firstName ?? "Unnamed"}</span>
                    {c.title && <span className="text-muted-foreground"> · {c.title}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`rounded px-1 text-[10px] ${c.hasEmail ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"}`}
                      >
                        {c.hasEmail ? "has email" : "no email"}
                      </span>
                      {revealed ? (
                        <span className="text-xs text-muted-foreground">Revealed</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="reveal-button"
                          disabled={!c.hasEmail || revealDisabled}
                          aria-label={`Reveal ${c.firstName ?? "this person"} (1 credit)`}
                          onClick={() => handleReveal(c.apolloId)}
                        >
                          {revealingId === c.apolloId ? (
                            <span className="flex items-center gap-1.5">
                              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                              Revealing…
                            </span>
                          ) : (
                            "Reveal (1 credit)"
                          )}
                        </Button>
                      )}
                    </span>
                    {/* Rendered as plain text, not a `title` on the (disabled) button — a
                        disabled button never fires hover/focus events, so a tooltip-only hint
                        there is unreachable by mouse, keyboard or screen reader alike. */}
                    {!c.hasEmail && !revealed && (
                      <span className="text-xs text-muted-foreground">Apollo has no email for this person</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
