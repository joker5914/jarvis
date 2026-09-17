import { promises as dns } from "node:dns";
import { REQUEST_TIMEOUT_MS, USER_AGENT } from "@/lib/extract/website";
import { safeFetch } from "@/lib/net/safeFetch";
import { UnsafeUrlError } from "@/lib/net/ssrf";
import type { ValidationProvider } from "./types";

export class BuiltinValidationProvider implements ValidationProvider {
  async checkWebsite(url: string): Promise<{ reachable: boolean; error?: string }> {
    try {
      let res = await safeFetch(url, { method: "HEAD", headers: { "user-agent": USER_AGENT } }, { timeoutMs: REQUEST_TIMEOUT_MS });
      if (res.status === 405 || res.status === 403) {
        res = await safeFetch(url, { method: "GET", headers: { "user-agent": USER_AGENT } }, { timeoutMs: REQUEST_TIMEOUT_MS });
      }
      // Neither the HEAD response nor the GET fallback's body is ever read here — only the
      // status is checked — so release it explicitly rather than leaving it for the pinned
      // Agent's backstop timer.
      void res.body?.cancel().catch(() => {});
      return res.ok ? { reachable: true } : { reachable: false, error: `HTTP ${res.status}` };
    } catch (e) {
      const err = e as Error;
      if (err instanceof UnsafeUrlError) return { reachable: false, error: err.message };
      return { reachable: false, error: err?.name === "AbortError" ? "timeout" : err?.message ?? String(e) };
    }
  }

  async domainHasMx(domain: string): Promise<boolean> {
    try {
      const records = await dns.resolveMx(domain);
      return records.length > 0;
    } catch {
      return false;
    }
  }
}
