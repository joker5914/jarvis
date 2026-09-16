import type { Page } from "@playwright/test";

export async function unlock(page: Page) {
  await page.goto("/unlock");
  await page.getByPlaceholder("Passphrase").fill("test-pass");
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL("**/");
}
