import { test, expect } from "@playwright/test";
import { unlock } from "./helpers";

test.describe.configure({ mode: "serial" });

test("scanner is disabled until the schedule is enabled, then runs a target zip", async ({ page }) => {
  await unlock(page);
  await page.goto("/scanner");
  await expect(page.getByTestId("scanner-state")).toHaveText("Disabled");

  await page.getByTestId("schedule-enabled").click();
  await page.getByTestId("schedule-save").click();
  await expect(page.getByText("Schedule saved")).toBeVisible();

  await page.getByTestId("target-zip").fill("77084");
  await page.getByTestId("target-add").click();
  await expect(page.getByTestId("target-row")).toHaveCount(1);

  // The planner only picks a zip search once a TDLR sync has succeeded at least once
  // (tdlrLastSuccessfulAt gates it ahead of any target). This test must pass standalone
  // (`npx playwright test tests/e2e/scanner.spec.ts`), so it can't rely on projects.spec.ts
  // having already synced — sync directly via the API and poll until it's done (`running` is
  // false) rather than just "not running yet", since that's also true for an instant before
  // the fire-and-forget sync has actually started; `lastSuccessfulAt` set confirms it finished.
  //
  // projects.spec.ts's own first test does the same thing, and Playwright runs spec files
  // across parallel workers, so both can be racing this at once. Only POST when no sync has
  // ever succeeded yet (a POST while one is already running/queued just 409s harmlessly, but
  // skipping it when we already know a successful sync exists avoids two callers both passing
  // isSyncRunning()'s check before either's fire-and-forget sync has actually started).
  const before = await (await page.request.get("/api/projects/sync")).json();
  if (!before.lastSuccessfulAt) await page.request.post("/api/projects/sync");
  await expect
    .poll(
      async () => {
        const status = await (await page.request.get("/api/projects/sync")).json();
        return !status.running && !!status.lastSuccessfulAt;
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  await page.getByTestId("scanner-run-now").click();
  await expect(page.getByTestId("scanner-state")).toHaveText("Running", { timeout: 20_000 });
  await expect(page.getByTestId("scanner-status")).toContainText("Zip search 77084");

  await page.goto("/searches");
  await expect(page.locator('[data-testid="search-card"]').first()).toContainText("77084");
  await expect(page.locator('[data-testid="search-card"][data-status="complete"]').first()).toBeVisible({ timeout: 45_000 });
});

test("pause takes effect and resume continues; stop disables", async ({ page }) => {
  await unlock(page);
  await page.goto("/scanner");
  await page.getByTestId("scanner-pause").click();
  await expect(page.getByTestId("scanner-state")).toHaveText("Paused");
  await expect(page.getByTestId("scanner-pill")).toContainText("Resume");

  await page.getByTestId("scanner-resume").click();
  await expect(page.getByTestId("scanner-state")).not.toHaveText("Paused", { timeout: 20_000 });

  await page.getByTestId("scanner-stop").click();
  await expect(page.getByTestId("scanner-state")).toHaveText("Disabled");
  await expect(page.getByTestId("scanner-activity")).toContainText("Stopped by user");
});
