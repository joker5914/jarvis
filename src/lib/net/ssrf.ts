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

function isPrivateV4(ip: string): boolean {
  return ip === "255.255.255.255" || PRIVATE_V4.some((c) => inV4Range(ip, c));
}

/**
 * Parses an IPv6 literal (optionally with a `%zone` suffix, and optionally with
 * an embedded dotted-decimal IPv4 tail) into its 16 raw bytes. Returns null for
 * anything that doesn't parse as a well-formed IPv6 address.
 */
export function parseIPv6(input: string): Uint8Array | null {
  let ip = input;
  const pct = ip.indexOf("%");
  if (pct !== -1) ip = ip.slice(0, pct);
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (ip.length === 0) return null;

  // An embedded dotted-decimal IPv4 tail (e.g. "::ffff:127.0.0.1") replaces the
  // last two 16-bit groups.
  const lastColon = ip.lastIndexOf(":");
  const tail = ip.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = tail.split(".");
    if (octets.length !== 4) return null;
    const bytes4 = octets.map((o) => Number(o));
    if (bytes4.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null;
    const hi = ((bytes4[0] << 8) | bytes4[1]).toString(16);
    const lo = ((bytes4[2] << 8) | bytes4[3]).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleColonCount = ip.split("::").length - 1;
  if (doubleColonCount > 1) return null;

  let groups: string[];
  if (doubleColonCount === 1) {
    const [left, right] = ip.split("::");
    const head = left ? left.split(":") : [];
    const tailGroups = right ? right.split(":") : [];
    const missing = 8 - (head.length + tailGroups.length);
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill("0"), ...tailGroups];
  } else {
    groups = ip.split(":");
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = groups[i];
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const val = parseInt(g, 16);
    bytes[i * 2] = (val >> 8) & 0xff;
    bytes[i * 2 + 1] = val & 0xff;
  }
  return bytes;
}

function ipv4FromBytes(bytes: Uint8Array | number[]): string {
  return Array.from(bytes).join(".");
}

const NAT64_PREFIX = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];

function isPrivateIPv6Bytes(bytes: Uint8Array): boolean {
  const allZero = bytes.every((b) => b === 0);
  if (allZero) return true; // "::"

  const first10Zero = Array.from(bytes.slice(0, 10)).every((b) => b === 0);
  if (first10Zero && bytes[10] === 0xff && bytes[11] === 0xff) {
    // ::ffff:0:0/96 — IPv4-mapped
    return isPrivateV4(ipv4FromBytes(bytes.slice(12, 16)));
  }
  if (first10Zero && bytes[10] === 0 && bytes[11] === 0) {
    const low32 = bytes.slice(12, 16);
    const low32NonZero = Array.from(low32).some((b) => b !== 0);
    if (!low32NonZero) return true; // "::1" or "::" already handled, but be safe
    // ::/96 — deprecated IPv4-compatible
    return isPrivateV4(ipv4FromBytes(low32));
  }
  if (NAT64_PREFIX.every((b, i) => bytes[i] === b)) {
    // 64:ff9b::/96 — NAT64
    return isPrivateV4(ipv4FromBytes(bytes.slice(12, 16)));
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    // 2002::/16 — 6to4
    return isPrivateV4(ipv4FromBytes(bytes.slice(2, 6)));
  }
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // fec0::/10 site local (deprecated)
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast

  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind !== 6) return true; // not an IP at all: treat as unsafe
  const bytes = parseIPv6(ip);
  if (!bytes) return true; // unparsable: fail closed
  return isPrivateIPv6Bytes(bytes);
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
