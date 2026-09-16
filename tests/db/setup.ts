import { execSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env" });
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL missing in .env");
process.env.DATABASE_URL = testUrl;

execSync("npx prisma db push --skip-generate --accept-data-loss", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: testUrl },
});
