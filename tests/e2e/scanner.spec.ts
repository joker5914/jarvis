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
  // ScannerPill (navbar) polls independently every 15s and isn't refreshed by
  // StatusCard's onChanged(), so this needs headroom past one poll cycle,
  // beyond the default 15s assertion timeout — otherwise it races the pill's
  // own interval and fails intermittently.
  await expect(page.getByTestId("scanner-pill")).toContainText("Resume", { timeout: 20_000 });

  await page.getByTestId("scanner-resume").click();
  await expect(page.getByTestId("scanner-state")).not.toHaveText("Paused", { timeout: 20_000 });

  await page.getByTestId("scanner-stop").click();
  await expect(page.getByTestId("scanner-state")).toHaveText("Disabled");
  await expect(page.getByTestId("scanner-activity")).toContainText("Stopped by user");
});
