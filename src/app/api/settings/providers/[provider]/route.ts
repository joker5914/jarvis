import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { encryptString } from "@/lib/crypto";
import { budgetStatus } from "@/lib/providers/budget";

const PROVIDER_LABELS: Record<string, string> = { google: "Google Places", apollo: "Apollo.io" };
const ENV_NAMES: Record<string, string> = { google: "GOOGLE_MAPS_API_KEY", apollo: "APOLLO_API_KEY" };

const bodySchema = z.object({
  key: z.string().min(8).max(512).optional().nullable(),
  enabled: z.boolean().optional(),
  dailyBudget: z.number().int().min(1).max(100_000).optional(),
});

export const PUT = handle(async (req, ctx) => {
  const { provider } = await ctx.params;
  if (provider !== "google" && provider !== "apollo") throw new ApiError(400, "Unknown provider");
  // Owner seam, kept consistent with every other route handler even though ProviderConfig is
  // global (not per-owner) today.
  await getActor();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  const parsed = bodySchema.parse(body);

  const data: { encryptedKey?: string | null; enabled?: boolean; dailyBudget?: number } = {};
  if (parsed.key === null) {
    data.encryptedKey = null;
  } else if (parsed.key !== undefined) {
    const secret = process.env.APP_SECRET;
    if (!secret) throw new ApiError(500, "APP_SECRET is not configured");
    data.encryptedKey = encryptString(parsed.key, secret);
  }
  if (parsed.enabled !== undefined) data.enabled = parsed.enabled;
  if (parsed.dailyBudget !== undefined) data.dailyBudget = parsed.dailyBudget;

  await prisma.providerConfig.upsert({
    where: { provider },
    update: data,
    create: { provider, ...data },
  });

  const row = await prisma.providerConfig.findUnique({ where: { provider } });
  const env = process.env[ENV_NAMES[provider]];
  const status = await budgetStatus(provider);
  const source: "env" | "stored" | "none" = env ? "env" : row?.encryptedKey ? "stored" : "none";
  return json({
    provider: {
      provider,
      label: PROVIDER_LABELS[provider],
      source,
      enabled: row?.enabled ?? true,
      dailyBudget: status.limit,
      usedToday: status.used,
    },
  });
});
