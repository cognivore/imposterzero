import { test, expect } from "@playwright/test";
import { waitForBrowser, setName, getBackupKey } from "./helpers.js";

test("backup key import restores identity", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto("/");
  await waitForBrowser(pageA);
  await setName(pageA, "BackupUser");

  const key = await getBackupKey(pageA);
  expect(key.length).toBeGreaterThan(0);
  await ctxA.close();

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto("/");
  await waitForBrowser(pageB);

  await pageB.click("summary:has-text('Import key')");
  await pageB.fill(".import-row .name-input", key);
  await pageB.click("button:has-text('Import')");

  await waitForBrowser(pageB);
  await expect(pageB.locator(".browser-footer")).toContainText("Playing as BackupUser", { timeout: 10000 });

  const importedKey = await getBackupKey(pageB);
  expect(importedKey).toBe(key);
  await ctxB.close();
});
