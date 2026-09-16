"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

// The most recent query string handed to the router that it has not committed yet.
// Module-level (not per hook instance) so every filter control on the page composes
// its update on top of the same in-flight state: a checkbox followed by a debounced
// search-box write must not clobber each other while the first navigation is pending.
let pending: URLSearchParams | null = null;

/** URL-backed filter state shared by the Leads and Projects pages. */
export function useLeadFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Once the router commits a navigation, the URL is authoritative again.
  useEffect(() => {
    pending = null;
  }, [params]);

  const set = useCallback(
    (key: string, value: string | null) => {
      const base =
        pending ?? new URLSearchParams(typeof window !== "undefined" ? window.location.search : params.toString());
      const next = new URLSearchParams(base.toString());
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
      if (key !== "page") next.delete("page");
      pending = next;
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const reset = useCallback(() => {
    pending = new URLSearchParams();
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  return { params, set, reset };
}
