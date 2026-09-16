import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error("TEST_DATABASE_URL missing in .env");
if (!testDb.includes("_test")) throw new Error("TEST_DATABASE_URL must point at a *_test database");

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/unlock",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: testDb,
      PROVIDER_MODE: "fake",
      JOB_MODE: "inline",
      APP_PASSPHRASE: "test-pass",
      APP_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234",
      GOOGLE_DAILY_BUDGET: "100000",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
