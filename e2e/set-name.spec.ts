import { test, expect } from "@playwright/test";
import { waitForBrowser } from "./helpers.js";

test("set name enables room creation", async ({ page }) => {
  await page.goto("/");
  await waitForBrowser(page);

  await expect(page.locator(".name-card")).toBeVisible();
  await expect(page.locator("button:has-text('Create Room')")).toBeDisabled();

  await page.fill(".name-input", "TestPlayer");
  await page.click("button:has-text('Set Name')");

  await expect(page.locator(".name-card")).not.toBeVisible({ timeout: 5000 });
  await expect(page.locator(".browser-footer")).toContainText("Playing as TestPlayer");
  await expect(page.locator("button:has-text('Create Room')")).toBeEnabled();
});
