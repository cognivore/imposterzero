import { test, expect } from "@playwright/test";
import { waitForBrowser, reachSetupPhase, reachPlayPhase } from "../helpers.js";

test.describe("responsive layout", () => {
  test("card short text visible on normal-size cards in setup", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await reachSetupPhase(page, "ShortTextCheck");

    const shortTexts = page.locator(".card-short-text");
    await expect(shortTexts.first()).toBeVisible({ timeout: 5000 });
    const count = await shortTexts.count();
    expect(count).toBeGreaterThan(0);

    const text = await shortTexts.first().textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
    expect(text).not.toBe("undefined");
  });

  test("card divider visible on normal-size cards", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await reachSetupPhase(page, "DividerCheck");

    const dividers = page.locator(".card-divider");
    await expect(dividers.first()).toBeVisible({ timeout: 5000 });
    expect(await dividers.count()).toBeGreaterThan(0);
  });

  test("status bar hidden on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 400 });
    await page.goto("/");
    await reachPlayPhase(page, "MobileStatus");

    const statusBar = page.locator(".status-bar");
    await expect(statusBar).toBeHidden({ timeout: 3000 });
  });

  test("preview zone hidden on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 400 });
    await page.goto("/");
    await reachSetupPhase(page, "MobilePreview");

    const previewZone = page.locator(".preview-zone");
    await expect(previewZone).toBeHidden({ timeout: 3000 });
  });

  test("cards render within expected size range on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await reachSetupPhase(page, "DesktopSize");

    const card = page.locator(".hand .card-perspective").first();
    await expect(card).toBeVisible({ timeout: 5000 });
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(80);
    expect(box!.width).toBeLessThanOrEqual(130);
  });

  test("preview zone occupies right side on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await reachSetupPhase(page, "PreviewLayout");

    const zone = page.locator(".preview-zone");
    await expect(zone).toBeVisible({ timeout: 5000 });
    const box = await zone.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThan(800);
  });
});
