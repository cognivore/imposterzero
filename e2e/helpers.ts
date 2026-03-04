import type { Page } from "@playwright/test";

export const setName = async (page: Page, name: string): Promise<void> => {
  await page.fill(".name-input", name);
  await page.click("button:has-text('Set Name')");
  await page.waitForSelector(".name-card", { state: "detached", timeout: 5000 });
};

export const waitForBrowser = async (page: Page): Promise<void> => {
  await page.waitForSelector(".browser-title", { timeout: 10000 });
};

export const getBackupKey = async (page: Page): Promise<string> => {
  const el = page.locator(".backup-key");
  await el.waitFor({ timeout: 5000 });
  return (await el.textContent()) ?? "";
};
