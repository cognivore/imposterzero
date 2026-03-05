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

export const createRoomWithBot = async (page: Page, name: string): Promise<void> => {
  await setName(page, name);
  await page.click("button:has-text('2')", { strict: false });
  await page.click("button:has-text('Create Room')");
  await page.waitForSelector(".lobby-title", { timeout: 5000 });
  await page.click("button:has-text('+ Add Bot')");
  await page.click("button:has-text('Ready')");
};

export const passCrownPhase = async (page: Page): Promise<void> => {
  const crownChoice = page.locator(".crown-choice").first();
  const setupSlots = page.locator(".setup-slots");
  const handArea = page.locator(".hand-area");
  await Promise.race([
    crownChoice.waitFor({ timeout: 10000 }).then(async () => {
      await crownChoice.click();
    }),
    setupSlots.waitFor({ timeout: 10000 }),
    handArea.waitFor({ timeout: 10000 }),
  ]);
};

export const completeSetup = async (page: Page): Promise<void> => {
  const commitBtn = page.locator("button:has-text('Commit Selection')");
  await commitBtn.waitFor({ timeout: 10000 });
  const cards = page.locator(".hand .card-perspective--interactive");
  await cards.first().click();
  await cards.nth(1).click();
  await commitBtn.click();
};

export const reachSetupPhase = async (page: Page, name: string): Promise<void> => {
  await createRoomWithBot(page, name);
  await passCrownPhase(page);
  await page.waitForSelector(".setup-slots", { timeout: 10000 });
};

export const reachPlayPhase = async (page: Page, name: string): Promise<void> => {
  await reachSetupPhase(page, name);
  await completeSetup(page);
  await page.waitForSelector(".hand-area h3", { timeout: 15000 });
};
