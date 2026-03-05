import { test, expect } from "@playwright/test";
import { reachSetupPhase } from "../helpers.js";

test.describe("touch interactions", () => {
  test.use({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });

  test("tap hand card opens inspect modal in setup", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "TouchInspect");

    const card = page.locator(".hand .card-perspective").first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.tap();

    await expect(page.locator(".inspect-modal-backdrop")).toBeVisible({ timeout: 3000 });
  });

  test("inspect modal shows card name and full text", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "ModalContent");

    const card = page.locator(".hand .card-perspective").first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.tap();

    await expect(page.locator(".inspect-modal-backdrop")).toBeVisible({ timeout: 3000 });

    const name = page.locator(".inspect-modal-card .preview-name");
    await expect(name).toBeVisible();
    expect(await name.textContent()).toBeTruthy();

    const fullText = page.locator(".inspect-modal-card .preview-full-text");
    await expect(fullText).toBeVisible();
    const text = await fullText.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });

  test("inspect modal closes on Close button tap", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "ModalClose");

    const card = page.locator(".hand .card-perspective").first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.tap();

    const modal = page.locator(".inspect-modal-backdrop");
    await expect(modal).toBeVisible({ timeout: 3000 });

    await page.click("button:has-text('Close')");
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });

  test("inspect modal closes on backdrop tap", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "BackdropClose");

    const card = page.locator(".hand .card-perspective").first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.tap();

    const modal = page.locator(".inspect-modal-backdrop");
    await expect(modal).toBeVisible({ timeout: 3000 });

    const box = await modal.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 10, box.y + 10);
    }
    await expect(modal).not.toBeVisible({ timeout: 3000 });
  });
});
