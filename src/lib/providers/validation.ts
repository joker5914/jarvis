import { promises as dns } from "node:dns";
import { REQUEST_TIMEOUT_MS, USER_AGENT } from "@/lib/extract/website";
import type { ValidationProvider } from "./types";

export class BuiltinValidationProvider implements ValidationProvider {
  async checkWebsite(url: string): Promise<{ reachable: boolean; error?: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal, headers: { "user-agent": USER_AGENT } });
      if (res.status === 405 || res.status === 403) {
        res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { "user-agent": USER_AGENT } });
      }
      return res.ok ? { reachable: true } : { reachable: false, error: `HTTP ${res.status}` };
    } catch (e) {
      const err = e as Error;
      return { reachable: false, error: err?.name === "AbortError" ? "timeout" : err?.message ?? String(e) };
    } finally {
      clearTimeout(timer);
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
