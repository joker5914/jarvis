import { describe, it, expect } from "vitest";
import { isPrivateAddress, assertSafeUrl, UnsafeUrlError } from "@/lib/net/ssrf";

const resolveTo = (ips: string[]) => async () => ips;

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
    // Hex-hextet IPv4-mapped/compatible and tunneling forms (not the dotted-decimal shorthand).
    "::ffff:7f00:1", // ::ffff:127.0.0.1
    "::ffff:a9fe:a9fe", // ::ffff:169.254.169.254
    "::a9fe:a9fe", // deprecated IPv4-compatible ::169.254.169.254
    "64:ff9b::7f00:1", // NAT64 -> 127.0.0.1
    "2002:7f00:1::", // 6to4 -> 127.0.0.1
    "fe80::1%eth0", // link-local with zone id
  ])("flags %s as private", (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each([
    "8.8.8.8", "172.32.0.1", "104.18.0.1", "2606:4700::1111", "::ffff:8.8.8.8",
    "::ffff:808:808", // ::ffff:8.8.8.8 in hex-hextet form
    "64:ff9b::808:808", // NAT64 -> 8.8.8.8
    "2002:808:808::", // 6to4 -> 8.8.8.8
  ])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("assertSafeUrl", () => {
  it("accepts a public https host", async () => {
    const u = await assertSafeUrl("https://example.com/contact", resolveTo(["93.184.216.34"]));
    expect(u.hostname).toBe("example.com");
  });
  it.each(["ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)"])("rejects protocol %s", async (raw) => {
    await expect(assertSafeUrl(raw, resolveTo(["93.184.216.34"]))).rejects.toBeInstanceOf(UnsafeUrlError);
  });
  it("rejects localhost and .internal names before resolving", async () => {
    let resolved = false;
    const spy = async () => { resolved = true; return ["8.8.8.8"]; };
    for (const h of ["http://localhost/", "http://foo.localhost/", "http://metadata.internal/", "http://box.local/"]) {
      await expect(assertSafeUrl(h, spy)).rejects.toBeInstanceOf(UnsafeUrlError);
    }
    expect(resolved).toBe(false);
  });
  it("rejects literal private IPs and hosts that resolve to any private address", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data", resolveTo([]))).rejects.toThrow(/private/);
    await expect(assertSafeUrl("http://evil.example/", resolveTo(["8.8.8.8", "10.0.0.5"]))).rejects.toThrow(/private/);
    await expect(assertSafeUrl("http://[::1]/", resolveTo([]))).rejects.toThrow(/private/);
  });
  it("rejects userinfo, unresolvable hosts, and unusual ports", async () => {
    await expect(assertSafeUrl("http://user:pw@example.com/", resolveTo(["8.8.8.8"]))).rejects.toThrow(/credentials/);
    await expect(assertSafeUrl("http://nope.example/", resolveTo([]))).rejects.toThrow(/resolve/);
    await expect(assertSafeUrl("http://example.com:5432/", resolveTo(["8.8.8.8"]))).rejects.toThrow(/port/);
    await expect(assertSafeUrl("https://example.com:8443/", resolveTo(["8.8.8.8"]))).resolves.toBeInstanceOf(URL);
  });
  it("rejects a literal hex-hextet IPv4-mapped private address", async () => {
    await expect(assertSafeUrl("http://[::ffff:a9fe:a9fe]/", resolveTo([]))).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
