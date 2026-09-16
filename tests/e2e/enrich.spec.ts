import { test, expect } from "@playwright/test";
import { unlock } from "./helpers";

test("enrich a lead with Apollo (fake) adds named people", async ({ page }) => {
  await unlock(page);
  await page.goto("/");
  await page.getByLabel("Zip code").fill("77084");
  await page.getByRole("button", { name: "Run search" }).click();
  await expect(page).toHaveURL(/\/searches/, { timeout: 30_000 });
  await expect(page.locator('[data-testid="search-card"][data-status="complete"]').first()).toBeVisible({ timeout: 45_000 });

  await page.goto("/leads");
  await page.getByTestId("lead-row").first().click();
  await expect(page.getByTestId("lead-detail")).toBeVisible();

  await page.getByTestId("enrich-button").click();
  await expect(page.getByText("Enrichment queued")).toBeVisible();
  await expect(page.getByTestId("people-row").first()).toContainText("Maria Lopez", { timeout: 15_000 });
  await expect(page.getByTestId("people-section")).toContainText("Owner");
});
