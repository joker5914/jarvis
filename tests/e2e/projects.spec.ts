import { test, expect } from "@playwright/test";
import { unlock } from "./helpers";

test.describe.configure({ mode: "serial" });

test("sync pulls Houston projects and hides excluded ones by default", async ({ page }) => {
  await unlock(page);
  await page.goto("/projects");
  await page.getByTestId("sync-now").click();
  await expect(page.getByTestId("sync-bar")).toContainText(/last synced|new/, { timeout: 30_000 });
  await expect(page.getByTestId("project-row")).toHaveCount(2);
  await expect(page.getByText("Bella Nails & Spa").first()).toBeVisible();
  await expect(page.getByText("Memorial Hermann")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Show excluded (enterprise)" }).click();
  await expect(page.getByText("Memorial Hermann").first()).toBeVisible();
});

test("find business auto-links a confident match and the lead shows project timing", async ({ page }) => {
  await unlock(page);
  await page.goto("/projects?q=bella");
  await page.getByTestId("find-business").first().click();
  await expect(page.getByText(/Linked to a Google listing/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Bella Nails & Spa" })).toBeVisible({ timeout: 15_000 });

  await page.goto("/leads?source=tdlr");
  await expect(page.getByTestId("leads-count")).toContainText("1 lead");
  await expect(page.getByText("Opening soon").first()).toBeVisible();
});

test("weak match offers candidates and can create a lead from the project", async ({ page }) => {
  await unlock(page);
  await page.goto("/projects?q=corner");
  await page.getByTestId("find-business").first().click();
  await expect(page.getByTestId("find-dialog")).toBeVisible();
  await page.getByTestId("create-from-project").click();
  await expect(page.getByText("Lead created from project")).toBeVisible();
  await page.goto("/leads?source=tdlr&q=corner");
  await expect(page.getByTestId("leads-count")).toContainText("1 lead");
});
