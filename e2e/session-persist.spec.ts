import { test, expect } from "@playwright/test";
import { waitForBrowser, setName, getBackupKey } from "./helpers.js";

test("session persists across page reload", async ({ page }) => {
  await page.goto("/");
  await waitForBrowser(page);

  await setName(page, "PersistMe");
  const keyBefore = await getBackupKey(page);
  expect(keyBefore.length).toBeGreaterThan(0);

  await page.reload();
  await waitForBrowser(page);

  await expect(page.locator(".name-card")).not.toBeVisible({ timeout: 5000 });
  await expect(page.locator(".browser-footer")).toContainText("Playing as PersistMe");

  const keyAfter = await getBackupKey(page);
  expect(keyAfter).toBe(keyBefore);
});
