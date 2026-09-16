import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { NextRequest } from "next/server";
import type { ProviderConfig, AppConfig, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptString } from "@/lib/crypto";
import { budgetStatus } from "@/lib/providers/budget";
import { loadConfig } from "@/lib/config/runtime";
import { GET as settingsGet } from "@/app/api/settings/route";
import { PUT as providerPut } from "@/app/api/settings/providers/[provider]/route";
import { PUT as configPut } from "@/app/api/settings/config/route";

const OWNER = "local-user";
const APP_SECRET = process.env.APP_SECRET!;
const noCtx = { params: Promise.resolve({}) };
const ctxFor = (provider: string) => ({ params: Promise.resolve({ provider }) });

function jsonReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

type SettingsPayload = { providers: { provider: string; source: string; enabled: boolean; dailyBudget: number; usedToday: number }[] };

async function getPayload(): Promise<SettingsPayload> {
  const res = await settingsGet({} as NextRequest, noCtx);
  expect(res.status).toBe(200);
  return res.json();
}

describe("Settings API", () => {
  // Snapshot/restore rows this test mutates so it never clobbers budgets other DB tests rely on.
  let providerSnapshot: ProviderConfig[];
  let appConfigSnapshot: AppConfig | null;

  beforeAll(async () => {
    providerSnapshot = await prisma.providerConfig.findMany({ where: { provider: { in: ["google", "apollo"] } } });
    appConfigSnapshot = await prisma.appConfig.findUnique({ where: { ownerId: OWNER } });
  });

  afterAll(async () => {
    await prisma.providerConfig.deleteMany({ where: { provider: { in: ["google", "apollo"] } } });
    for (const row of providerSnapshot) await prisma.providerConfig.create({ data: row });
    await prisma.appConfig.deleteMany({ where: { ownerId: OWNER } });
    if (appConfigSnapshot) {
      await prisma.appConfig.create({
        data: { ownerId: appConfigSnapshot.ownerId, overrides: appConfigSnapshot.overrides as Prisma.InputJsonValue },
      });
    }
  });

  it("stores an Apollo key encrypted, never echoes it, and (when no env key is set) clears back to none", async () => {
    const putRes = await providerPut(jsonReq({ key: "abc123zz" }), ctxFor("apollo"));
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(JSON.stringify(putBody)).not.toContain("abc123zz");
    expect(JSON.stringify(putBody)).not.toContain("encryptedKey");

    const row = await prisma.providerConfig.findUnique({ where: { provider: "apollo" } });
    expect(row?.encryptedKey).toBeTruthy();
    expect(row!.encryptedKey).not.toContain("abc123zz");
    expect(decryptString(row!.encryptedKey!, APP_SECRET)).toBe("abc123zz");

    const payload = await getPayload();
    const apollo = payload.providers.find((p) => p.provider === "apollo")!;
    expect(apollo.source).toBe("stored");
    expect(JSON.stringify(payload)).not.toContain("abc123zz");
    expect(JSON.stringify(payload)).not.toContain("encryptedKey");

    if (process.env.APOLLO_API_KEY) {
      // Per the brief: the env var wins over the stored key, so clearing the stored key would
      // still report source "env" here — skip rather than assert a false failure.
      console.warn("[settings.test] APOLLO_API_KEY is set in this environment; skipping the clear-to-none assertion");
      return;
    }
    const clearRes = await providerPut(jsonReq({ key: null }), ctxFor("apollo"));
    expect(clearRes.status).toBe(200);
    const clearBody = await clearRes.json();
    expect(clearBody.provider.source).toBe("none");
    const cleared = await prisma.providerConfig.findUnique({ where: { provider: "apollo" } });
    expect(cleared?.encryptedKey).toBeNull();
  });

  it("updates dailyBudget and enabled, reflected in GET and budgetStatus", async () => {
    const res = await providerPut(jsonReq({ dailyBudget: 50, enabled: false }), ctxFor("apollo"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider.dailyBudget).toBe(50);
    expect(body.provider.enabled).toBe(false);

    const payload = await getPayload();
    const apollo = payload.providers.find((p) => p.provider === "apollo")!;
    expect(apollo.dailyBudget).toBe(50);
    expect(apollo.enabled).toBe(false);
    expect((await budgetStatus("apollo")).limit).toBe(50);
  });

  it("rejects an unknown provider with 400", async () => {
    const res = await providerPut(jsonReq({ key: "abc123zz45" }), ctxFor("bing"));
    expect(res.status).toBe(400);
  });

  it("PUT config validates via zod (400 with the refine message) and persists valid overrides", async () => {
    const bad = await configPut(jsonReq({ projects: { highFitThreshold: 20, mediumFitThreshold: 30 } }), noCtx);
    expect(bad.status).toBe(400);
    const badBody = await bad.json();
    expect(badBody.error).toMatch(/greater than/);

    // A chain term guaranteed not to match any fixture business name used elsewhere in the suite.
    const good = await configPut(jsonReq({ exclusion: { chains: ["not-a-real-fixture-chain-zzq"] } }), noCtx);
    expect(good.status).toBe(200);
    const goodBody = await good.json();
    expect(goodBody.config.exclusion.chains).toEqual(["not-a-real-fixture-chain-zzq"]);

    const cfg = await loadConfig(OWNER);
    expect(cfg.exclusion.chains).toEqual(["not-a-real-fixture-chain-zzq"]);
  });
});
