import { test, expect } from "@playwright/test";
import { unlock } from "./helpers";

test.describe.configure({ mode: "serial" });

test("store an Apollo key and budget", async ({ page }) => {
  await unlock(page);
  await page.goto("/settings");
  await expect(page.getByTestId("provider-apollo-status")).toHaveText(/Not configured|From environment/);
  await page.getByTestId("provider-apollo-key").fill("e2e-apollo-key-1234");
  await page.getByTestId("provider-apollo-save").click();
  await expect(page.getByText("Key saved")).toBeVisible();
  await expect(page.getByTestId("provider-apollo-status")).toHaveText("Stored");
  await page.getByTestId("provider-apollo-budget").fill("50");
  await page.getByTestId("provider-apollo-budget").blur();
  await expect(page.getByText("Budget saved")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("provider-apollo-budget")).toHaveValue("50");
});

test("config save is validated and persisted", async ({ page }) => {
  await unlock(page);
  await page.goto("/settings");
  await page.getByTestId("projects-high").fill("20");
  await page.getByTestId("projects-medium").fill("30");
  await page.getByTestId("settings-config-save").click();
  await expect(page.getByText(/greater than/)).toBeVisible();

  await page.getByTestId("projects-high").fill("70");
  // Other e2e spec files (leads.spec, projects.spec) run in parallel workers against the same
  // DB and depend on the *default* chain exclusions (e.g. "starbucks" hidden by default, "Bella
  // Nails & Spa" NOT excluded) staying intact for the duration of the whole `npm run test:e2e`
  // run. The exclusion-chains field replaces the whole chains list rather than merging with it
  // (see mergeConfig in src/lib/config/runtime.ts), so filling it with only new terms — as a
  // literal "bella nails\nstarbucks" would — drops every other default chain and starts
  // excluding "Bella Nails & Spa" (its name contains "bella nails" as a substring), breaking
  // projects.spec.ts and leads.spec.ts. To avoid both problems we append a term that matches no
  // fixture business to whatever the field already contains (the full default chain list),
  // instead of replacing it outright.
  const chainsField = page.getByTestId("exclusion-chains");
  const existingChains = await chainsField.inputValue();
  await chainsField.fill(`${existingChains}\nacme-not-a-real-chain-zzq`);
  await page.getByTestId("settings-config-save").click();
  await expect(page.getByText("Configuration saved")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("projects-high")).toHaveValue("70");
  await expect(page.getByTestId("exclusion-chains")).toHaveValue(/acme-not-a-real-chain-zzq/);
});
