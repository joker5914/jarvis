import { test, expect } from "@playwright/test";
import { unlock } from "./helpers";

test.describe.configure({ mode: "serial" });

test("wrong passphrase is rejected, right one unlocks", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/unlock/);
  await page.getByPlaceholder("Passphrase").fill("nope");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("That passphrase is not right.")).toBeVisible();
  await unlock(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("run a zip search and see leads appear", async ({ page }) => {
  await unlock(page);
  await page.getByLabel("Zip code").fill("77084");
  await page.getByRole("button", { name: "Run search" }).click();
  await expect(page).toHaveURL(/\/searches/);
  await expect(page.locator('[data-testid="search-card"][data-status="complete"]').first()).toBeVisible({ timeout: 45_000 });

  await page.goto("/leads");
  await expect(page.getByTestId("leads-count")).toContainText(/\d+ leads/);
  await expect(page.getByTestId("lead-row").first()).toBeVisible();
  await expect(page.getByText("Starbucks")).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Show excluded (enterprise)" }).click();
  // Default sort is quality desc / name asc with 50/page; with showExcluded on,
  // the fixture set is large enough that Starbucks (low quality, "S") lands on
  // page 2. Narrow with the existing search filter so the assertion doesn't
  // depend on pagination.
  await page.getByPlaceholder("Business name").fill("Starbucks");
  // Both the table and the responsive card layout render in the DOM at once
  // (one hidden by CSS breakpoint), so getByText matches two nodes; .first()
  // avoids the strict-mode violation.
  await expect(page.getByText("Starbucks").first()).toBeVisible();
});

test("change outreach status and filter by it", async ({ page }) => {
  await unlock(page);
  await page.goto("/leads?q=restaurant%20One");
  await page.getByTestId("lead-row").first().click();
  await expect(page.getByTestId("lead-detail")).toBeVisible();
  await page.getByTestId("status-select").click();
  await page.getByRole("option", { name: "Contacted", exact: true }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/leads?status=contacted");
  await expect(page.getByTestId("leads-count")).toContainText("1 lead");
  await expect(page.getByTestId("lead-row")).toHaveCount(1);
});

test("notes autosave and export link carries filters", async ({ page }) => {
  await unlock(page);
  await page.goto("/leads?q=restaurant%20One");
  await page.getByTestId("lead-row").first().click();
  await page.getByTestId("notes").fill("Spoke with owner");
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByTestId("lead-row").first().click();
  await expect(page.getByTestId("notes")).toHaveValue("Spoke with owner");
  await expect(page.getByTestId("export-csv")).toHaveAttribute("href", /q=restaurant/);
});
