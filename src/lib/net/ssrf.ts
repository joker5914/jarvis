import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Resolver = (host: string) => Promise<string[]>;

export const defaultResolver: Resolver = async (host) => {
  try {
    const all = await lookup(host, { all: true, verbatim: true });
    return all.map((a) => a.address);
  } catch {
    return [];
  }
};

export class UnsafeUrlError extends Error {
  constructor(public reason: string) {
    super(`unsafe url: ${reason}`);
    this.name = "UnsafeUrlError";
  }
}

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".internal", ".local", ".home.arpa"];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}
function inV4Range(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}
const PRIVATE_V4 = ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4"];

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ip === "255.255.255.255" || PRIVATE_V4.some((c) => inV4Range(ip, c));
  if (kind !== 6) return true; // not an IP at all: treat as unsafe
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (lower === "::" || lower === "::1") return true;
  const head = parseInt(lower.split(":")[0] || "0", 16);
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

export async function assertSafeUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("malformed");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError(`protocol ${url.protocol}`);
  if (url.username || url.password) throw new UnsafeUrlError("credentials in url");
  if (!ALLOWED_PORTS.has(url.port)) throw new UnsafeUrlError(`port ${url.port}`);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  if (bare === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => bare.endsWith(s))) throw new UnsafeUrlError(`host ${bare}`);
  if (isIP(bare)) {
    if (isPrivateAddress(bare)) throw new UnsafeUrlError(`private address ${bare}`);
    return url;
  }
  const addrs = await resolve(bare);
  if (addrs.length === 0) throw new UnsafeUrlError(`cannot resolve ${bare}`);
  const bad = addrs.find(isPrivateAddress);
  if (bad) throw new UnsafeUrlError(`private address ${bad} for ${bare}`);
  return url;
}
