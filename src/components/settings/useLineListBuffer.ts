import { useRef, useState } from "react";

/**
 * Pure reducer behind `useLineListBuffer`: decide what the textarea's raw-text buffer should show
 * given its current contents, the latest list from outside (props), and the joined string this
 * component last emitted via its own `onChange`.
 *
 * Resyncing the buffer whenever the *identity* of the incoming list changes is wrong: every
 * `onChange` call from this component creates a new array (and usually a new parent object
 * wrapping it), so an identity check treats the component's own edit as an external change and
 * immediately overwrites the buffer with `list.join("\n")` -- which drops the trailing space or
 * blank line the user just typed, making it impossible to type "general manager" one character at
 * a time. Comparing the incoming list's *content* against what was last sent fixes that: a
 * round-tripped value that matches what we just emitted is not a resync, only a value that
 * genuinely differs (e.g. a reload after save, or another tab's edit) is.
 */
export function nextBufferState(prev: string, incomingList: string[], lastSent: string): string {
  const incoming = incomingList.join("\n");
  return incoming === lastSent ? prev : incoming;
}

/**
 * Backs a "one per line" textarea with a raw-text buffer that preserves exactly what the user
 * typed (spaces, blank lines, trailing newline) while still reporting a clean `string[]` upward.
 * Used by EnrichmentCard (titles, seniorities) and ExclusionCard (chains, positive/soft-negative
 * keywords).
 */
export function useLineListBuffer(list: string[], onChange: (next: string[]) => void): [string, (raw: string) => void] {
  const [text, setText] = useState(() => list.join("\n"));
  const lastSentRef = useRef(list.join("\n"));

  // Adjust the buffer during render (not in an effect) when an external change arrives, per
  // React's "storing information from previous renders" pattern -- this avoids a stale-buffer
  // flash between the prop update and a later effect running.
  const resynced = nextBufferState(text, list, lastSentRef.current);
  if (resynced !== text) {
    lastSentRef.current = list.join("\n");
    setText(resynced);
  }

  function handleChange(raw: string) {
    setText(raw);
    const next = raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    lastSentRef.current = next.join("\n");
    onChange(next);
  }

  return [text, handleChange];
}
