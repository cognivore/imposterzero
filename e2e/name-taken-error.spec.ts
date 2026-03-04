import { test, expect } from "@playwright/test";
import { waitForBrowser, setName } from "./helpers.js";

test("duplicate name shows error", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto("/");
  await waitForBrowser(pageA);
  await setName(pageA, "UniqueOne");

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto("/");
  await waitForBrowser(pageB);

  await pageB.fill(".name-input", "UniqueOne");
  await pageB.click("button:has-text('Set Name')");

  await expect(pageB.locator(".name-error")).toContainText("taken", { timeout: 5000 });
  await expect(pageB.locator(".name-card")).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
