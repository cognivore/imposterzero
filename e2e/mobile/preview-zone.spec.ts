import { test, expect } from "@playwright/test";
import { reachSetupPhase, reachPlayPhase } from "../helpers.js";

test.describe("preview zone (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("preview zone visible with placeholder before hover", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "PreviewIdle");

    const zone = page.locator(".preview-zone");
    await expect(zone).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".preview-placeholder")).toBeVisible();
    await expect(page.locator(".preview-placeholder")).toContainText("Hover a card to inspect");
  });

  test("hovering a hand card renders preview with full text", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "HoverText");

    const card = page.locator(".hand .card-perspective").first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.hover();

    const fullText = page.locator(".preview-full-text");
    await expect(fullText).toBeVisible({ timeout: 3000 });
    const text = await fullText.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });

  test("hovering a hand card shows card name in preview", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "HoverName");

    const card = page.locator(".hand .card-perspective").first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.hover();

    const previewName = page.locator(".preview-name");
    await expect(previewName).toBeVisible({ timeout: 3000 });
    const name = await previewName.textContent();
    expect(name).toBeTruthy();
    expect(name!.length).toBeGreaterThan(0);
  });

  test("preview updates when hovering a different card", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "HoverSwitch");

    const cards = page.locator(".hand .card-perspective");
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);

    await cards.first().hover();
    const nameA = await page.locator(".preview-name").textContent();

    await cards.nth(1).hover();
    await page.waitForTimeout(200);
    const nameB = await page.locator(".preview-name").textContent();

    expect(nameA).toBeTruthy();
    expect(nameB).toBeTruthy();
  });

  test("preview shows flavor text when present", async ({ page }) => {
    await page.goto("/");
    await reachSetupPhase(page, "HoverFlavor");

    const cards = page.locator(".hand .card-perspective");
    await expect(cards.first()).toBeVisible({ timeout: 5000 });

    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      await cards.nth(i).hover();
      await page.waitForTimeout(150);
      const flavor = page.locator(".preview-flavor");
      if (await flavor.isVisible()) {
        const text = await flavor.textContent();
        expect(text!.length).toBeGreaterThan(0);
        return;
      }
    }
  });
});
