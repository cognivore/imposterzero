import { test, expect } from "@playwright/test";
import { waitForBrowser, setName } from "./helpers.js";

test("create and join room", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto("/");
  await waitForBrowser(pageA);
  await setName(pageA, "HostPlayer");

  await pageA.click("button:has-text('2')", { strict: false });
  await pageA.click("button:has-text('Create Room')");
  await expect(pageA.locator(".lobby-title")).toBeVisible({ timeout: 5000 });
  await expect(pageA.locator(".player-count")).toContainText("1 / 2");

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto("/");
  await waitForBrowser(pageB);
  await setName(pageB, "JoinerPlayer");

  await expect(pageB.locator(".room-entry")).toBeVisible({ timeout: 5000 });
  await pageB.click(".room-entry button:has-text('Join')");
  await expect(pageB.locator(".lobby-title")).toBeVisible({ timeout: 5000 });

  await expect(pageA.locator(".player-count")).toContainText("2 / 2", { timeout: 5000 });

  await ctxA.close();
  await ctxB.close();
});
