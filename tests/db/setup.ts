import { execSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env" });
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL missing in .env");
process.env.DATABASE_URL = testUrl;
// DB tests always run against the fake providers regardless of the developer's .env (which may
// be switched to real mode for live testing); routes gate on isProviderConfigured, which is
// true only in fake mode when no keys exist in the test database.
process.env.PROVIDER_MODE = "fake";
delete process.env.GOOGLE_MAPS_API_KEY;
delete process.env.APOLLO_API_KEY;

execSync("npx prisma db push --skip-generate --accept-data-loss", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: testUrl },
});
