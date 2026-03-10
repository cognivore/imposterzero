import { test, expect } from "@playwright/test";
import { reachSetupPhase, waitForBrowser, setName } from "../helpers.js";

test.describe("touch targets", () => {
  test.setTimeout(60_000);
  test.use({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });

  test("all visible buttons meet 44px minimum height", async ({ page }) => {
    await page.goto("/");
    await waitForBrowser(page);
    await setName(page, "BtnTarget");

    const buttons = page.locator(".btn");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      if (await btn.isVisible()) {
        const box = await btn.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test("hand cards meet 44px minimum width in setup", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "CardTarget");

    const cards = page.locator(".tt-hand .card-perspective");
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
