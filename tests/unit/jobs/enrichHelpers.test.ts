import { describe, it, expect } from "vitest";
import { domainFromUrl, cityFromAddress, canonicalLinkedin } from "@/lib/jobs/enrich";

describe("domainFromUrl", () => {
  it.each([
    ["https://www.BellaNails.com/contact", "bellanails.com"],
    ["http://cafe.example", "cafe.example"],
    ["bellanails.com", "bellanails.com"],
    [null, null], ["not a url", null], ["https://facebook.com/bella", null], ["https://sites.google.com/x", null],
  ])("%s → %s", (input, out) => expect(domainFromUrl(input)).toBe(out));
});

describe("cityFromAddress", () => {
  it.each([
    ["123 Main St, Houston, TX 77084, USA", "Houston"],
    ["500 Elm, Suite 2, Katy, TX 77450, United States", "Katy"],
    ["Houston, TX", "Houston"],
    [null, null], ["", null],
  ])("%s → %s", (input, out) => expect(cityFromAddress(input)).toBe(out));
});

describe("canonicalLinkedin", () => {
  it.each([
    ["linkedin.com/in/x/", "https://www.linkedin.com/in/x"],
    ["https://www.linkedin.com/in/x/", "https://www.linkedin.com/in/x"],
    ["https://evil.example/in/x", null],
    ["not a url", null],
  ])("%s → %s", (input, out) => expect(canonicalLinkedin(input)).toBe(out));
});
