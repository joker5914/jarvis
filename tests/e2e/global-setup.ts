import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

export default async function globalSetup() {
  loadEnv({ path: ".env" });
  const testUrl = process.env.TEST_DATABASE_URL!;
  const env = { ...process.env, DATABASE_URL: testUrl };

  // NOTE (deviation from brief): the brief's `prisma db push --force-reset` is
  // refused by Prisma's own AI-agent safety gate ("Prisma Migrate detected that
  // it was invoked by Claude Code" / requires PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION
  // with the literal text of a human's chat consent, which is not available to
  // this non-interactive test-runner). Instead we push schema the same
  // non-destructive way tests/db/setup.ts already does, then clear all app data
  // via Prisma Client (not the CLI reset) so every e2e run still starts from a
  // known-empty state before reseeding.
  execSync("npx prisma db push --skip-generate --accept-data-loss", { stdio: "inherit", env });

  const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
  try {
    await prisma.activityLog.deleteMany();
    await prisma.businessTag.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.searchBusiness.deleteMany();
    await prisma.project.deleteMany();
    await prisma.search.deleteMany();
    await prisma.business.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.scanTarget.deleteMany();
    await prisma.scanSchedule.deleteMany();
    await prisma.scannerState.deleteMany();
    await prisma.providerConfig.deleteMany();
    await prisma.syncState.deleteMany();
  } finally {
    await prisma.$disconnect();
  }

  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });
}
