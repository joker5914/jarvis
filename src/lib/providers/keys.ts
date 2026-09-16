import { prisma } from "@/lib/db";
import { decryptString } from "@/lib/crypto";

const ENV_NAMES = { google: "GOOGLE_MAPS_API_KEY", apollo: "APOLLO_API_KEY" } as const;

export async function getProviderKey(provider: keyof typeof ENV_NAMES): Promise<string | null> {
  const fromEnv = process.env[ENV_NAMES[provider]];
  if (fromEnv) return fromEnv;
  const secret = process.env.APP_SECRET;
  if (!secret) return null;
  const cfg = await prisma.providerConfig.findUnique({ where: { provider } });
  if (!cfg?.encryptedKey) return null;
  return decryptString(cfg.encryptedKey, secret);
}

export async function isProviderConfigured(provider: keyof typeof ENV_NAMES): Promise<boolean> {
  if ((process.env.PROVIDER_MODE ?? "fake") === "fake") return true;
  return (await getProviderKey(provider)) !== null;
}
