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
  // First visit to /searches compiles the route on the dev server; allow for a cold runner.
  await expect(page).toHaveURL(/\/searches/, { timeout: 30_000 });
  await expect(page.locator('[data-testid="search-card"][data-status="complete"]').first()).toBeVisible({ timeout: 45_000 });

  await page.goto("/leads");
  await expect(page.getByTestId("leads-count")).toContainText(/\d+ leads/);
  await expect(page.getByTestId("lead-row").first()).toBeVisible();
  await expect(page.getByText("Starbucks")).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Show excluded (enterprise)" }).click();
  // Wait for the toggle's navigation to land before typing, as a person effectively does.
  await expect(page).toHaveURL(/showExcluded=true/);
  // Default sort is quality desc / name asc with 50/page; with showExcluded on,
  // the fixture set is large enough that Starbucks (low quality, "S") lands on
  // page 2. Narrow with the existing search filter so the assertion doesn't
  // depend on pagination.
  await page.getByPlaceholder("Business name").fill("Starbucks");
  await expect(page).toHaveURL(/showExcluded=true.*q=Starbucks|q=Starbucks.*showExcluded=true/);
  // Both the table and the responsive card layout render in the DOM at once
  // (one hidden by CSS breakpoint), so getByText matches two nodes; .first()
  // avoids the strict-mode violation.
  await expect(page.getByText("Starbucks").first()).toBeVisible({ timeout: 15_000 });
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

test("mobile filter sheet search does not fight the hidden desktop instance", async ({ page }) => {
  // Regression test: LeadsView renders <LeadFilters> twice (desktop aside +
  // mobile sheet), both mounted at once via CSS `hidden`. Without the
  // dirty-flag guard, the debounced instance whose local `q` still reads ""
  // would see the other instance's URL push as drift and immediately null it
  // out, so typing in the sheet on a phone never stuck.
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  await page.goto("/leads");

  await page.getByRole("button", { name: "Filters" }).click();
  // LeadFilters renders once in the (CSS-hidden but still mounted) desktop
  // aside and again inside this sheet once it opens, both with the same
  // input id, so getByLabel("Search") resolves ambiguously; scope to the
  // open sheet instead.
  const sheet = page.locator('[data-slot="sheet-content"]');
  await sheet.getByPlaceholder("Business name").fill("restaurant One");

  await page.waitForURL(/q=restaurant/);
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/q=restaurant/);
  await expect(page.getByTestId("leads-count")).toContainText("1 lead");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(/q=restaurant/);
});
