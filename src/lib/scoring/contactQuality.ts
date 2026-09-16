import { isValidPhoneNumber } from "libphonenumber-js";
import type { ScoreReason } from "./types";

export type QualityContact = {
  type: string;
  validationStatus: string;
  personName?: string | null;
  personTitle?: string | null;
};

export type ContactQualityInput = {
  websiteReachable: boolean | null;
  phone: string | null;
  contacts: QualityContact[];
};

export type QualityBand = "green" | "yellow" | "red";

export type ContactQualityResult = { score: number; band: QualityBand; reasons: ScoreReason[] };

const SOCIAL_TYPES = new Set(["linkedin", "facebook", "instagram", "twitter", "yelp"]);

export function qualityBandFor(score: number): QualityBand {
  if (score >= 70) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

export function scoreContactQuality(input: ContactQualityInput): ContactQualityResult {
  const reasons: ScoreReason[] = [];
  let score = 0;
  const add = (code: string, points: number, detail: string) => {
    reasons.push({ code, points, detail });
    score += points;
  };

  if (input.websiteReachable === true) add("website_reachable", 25, "website loads");

  const googlePhoneOk = !!input.phone && isValidPhoneNumber(input.phone, "US");
  const phoneContactOk = input.contacts.some(
    (c) => c.type === "phone" && c.validationStatus !== "invalid",
  );
  if (googlePhoneOk || phoneContactOk) add("phone", 20, "phone present and well-formed");

  if (input.contacts.some((c) => c.type === "email" && c.validationStatus === "valid")) {
    add("email_valid_mx", 30, "email with valid MX domain");
  }
  if (input.contacts.some((c) => c.personName && c.personTitle)) {
    add("named_person", 15, "named decision-maker with title");
  }
  if (input.contacts.some((c) => SOCIAL_TYPES.has(c.type))) {
    add("social_link", 10, "social or LinkedIn link");
  }

  return { score, band: qualityBandFor(score), reasons };
}
