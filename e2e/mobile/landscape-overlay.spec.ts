import { test, expect } from "@playwright/test";
import { waitForBrowser, reachSetupPhase } from "../helpers.js";

test.describe("landscape overlay", () => {
  test("no overlay in browser phase even in portrait", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await waitForBrowser(page);

    await expect(page.locator(".browser-title")).toBeVisible();
    await expect(page.locator(".landscape-overlay")).not.toBeVisible();
  });

  test("no overlay in landscape during game", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/");
    await reachSetupPhase(page, "LandscapeOK");

    await expect(page.locator(".landscape-overlay")).not.toBeVisible();
    await expect(page.locator(".setup-slots")).toBeVisible();
  });

  test("overlay appears in portrait during setup phase", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/");
    await reachSetupPhase(page, "PortraitSetup");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);

    await expect(page.locator(".landscape-overlay")).toBeVisible({ timeout: 3000 });
  });

  test("overlay disappears on rotation back to landscape", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/");
    await reachSetupPhase(page, "RotateBack");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".landscape-overlay")).toBeVisible({ timeout: 3000 });

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator(".landscape-overlay")).not.toBeVisible({ timeout: 3000 });
  });
});
