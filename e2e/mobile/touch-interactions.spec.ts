import { test, expect } from "@playwright/test";
import { reachSetupPhase } from "../helpers.js";

test.describe("touch interactions", () => {
  test.setTimeout(60_000);
  test.use({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });

  test("hand cards are visible and tappable in setup", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "TouchInspect");

    const cards = page.locator(".tt-hand .card-perspective");
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    await cards.first().tap();
  });

  test("multiple hand cards render on touch device", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "ModalContent");

    const cards = page.locator(".tt-hand .card-perspective");
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test("interactive cards respond to tap without error", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "ModalClose");

    const interactive = page.locator(".tt-hand .card-perspective--interactive");
    await expect(interactive.first()).toBeVisible({ timeout: 5000 });
    await interactive.first().tap();
    await page.waitForTimeout(200);
  });

  test("card elements have card-front content", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "BackdropClose");

    const cards = page.locator(".tt-hand .card-perspective");
    await expect(cards.first()).toBeVisible({ timeout: 5000 });

    const name = cards.first().locator(".card-name");
    await expect(name).toBeVisible({ timeout: 3000 });
    const text = await name.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });
});
