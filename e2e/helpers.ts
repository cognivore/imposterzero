import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Seeded RNG for property-based browser tests
// ---------------------------------------------------------------------------

export type Rng = () => number;

export const seededRng = (seed: number): Rng => {
  let s = Math.abs(seed) || 1;
  return (): number => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

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

export const completeDraftSimple = async (page: Page): Promise<void> => {
  const fixedRng = seededRng(1);
  const draftCard = page.locator(".draft-card").first();
  const confirmBtn = page.locator("button:has-text('Confirm Selection')");
  const ttCourt = page.locator(".tt-court");
  const crownChoice = page.locator(".crown-choice");
  const setupSlots = page.locator(".setup-slots");
  const doneBtn = page.locator("button:has-text('Done')");

  const isDraftPhase = await Promise.race([
    draftCard.waitFor({ timeout: 10000 }).then(() => true),
    confirmBtn.waitFor({ timeout: 10000 }).then(() => true),
    ttCourt.waitFor({ timeout: 10000 }).then(() => false),
    crownChoice.waitFor({ timeout: 10000 }).then(() => false),
    setupSlots.waitFor({ timeout: 10000 }).then(() => false),
    doneBtn.waitFor({ timeout: 10000 }).then(() => false),
  ]).catch(() => false);

  if (!isDraftPhase) return;
  await completeDraftPhases(page, fixedRng);
};

export const createRoomWithBot = async (page: Page, name: string): Promise<void> => {
  await setName(page, name);
  await page.click("button:has-text('2')", { strict: false });
  await page.click("button:has-text('Create Room')");
  await page.waitForSelector(".lobby-title", { timeout: 5000 });
  await page.click("button:has-text('+ Add Bot')");
  await page.click("button:has-text('Ready')");
  await completeDraftSimple(page);
};

export const passCrownAndMustering = async (page: Page): Promise<void> => {
  for (let i = 0; i < 80; i++) {
    const setupSlots = page.locator(".setup-slots");
    if (await setupSlots.isVisible().catch(() => false)) return;

    const crownChoice = page.locator("button.crown-choice").first();
    if (await crownChoice.isVisible().catch(() => false)) {
      await crownChoice.dispatchEvent("click");
      await page.waitForTimeout(1000);
      continue;
    }

    const doneBtn = page.locator("button.btn-ghost:has-text('Done')");
    if (await doneBtn.isVisible().catch(() => false)) {
      await doneBtn.dispatchEvent("click");
      await page.waitForTimeout(1000);
      continue;
    }

    await page.waitForTimeout(500);
  }
};

export const completeSetup = async (page: Page): Promise<void> => {
  const cards = page.locator(".tt-hand .card-perspective--interactive");
  await cards.first().waitFor({ timeout: 10000 });
  await cards.first().click();
  await cards.nth(1).click();
  const commitBtn = page.locator("button:has-text('Commit')");
  await commitBtn.waitFor({ timeout: 5000 });
  await commitBtn.click();
};

export const reachSetupPhase = async (page: Page, name: string): Promise<void> => {
  await createRoomWithBot(page, name);
  await passCrownAndMustering(page);
  await page.waitForSelector(".setup-slots", { timeout: 15000 });
};

export const reachPlayPhase = async (page: Page, name: string): Promise<void> => {
  await reachSetupPhase(page, name);
  await completeSetup(page);
  await page.locator(".tt-hand .hand-zone__cards .card-perspective").first().waitFor({ timeout: 15000 });
};

// ---------------------------------------------------------------------------
// Draft-phase browser helpers
// ---------------------------------------------------------------------------

export const draftSelectCards = async (page: Page, count: number, rng: Rng): Promise<void> => {
  for (let picked = 0; picked < count; picked++) {
    const cards = page.locator(".draft-card:not(.draft-card--selected):not(.draft-card--disabled)");
    const available = await cards.count();
    if (available === 0) break;
    const idx = Math.floor(rng() * available);
    await cards.nth(idx).click();
    await page.waitForTimeout(100);
  }
  const confirmBtn = page.locator("button:has-text('Confirm Selection')");
  await confirmBtn.waitFor({ timeout: 5000 });
  await confirmBtn.click();
};

export const handleDraftOrder = async (page: Page, rng: Rng): Promise<void> => {
  const pickFirst = page.locator("button:has-text('Pick First')");
  const pickSecond = page.locator("button:has-text('Pick Second')");
  const visible = await pickFirst.isVisible().catch(() => false);
  if (!visible) return;
  if (rng() < 0.5) {
    await pickFirst.click();
  } else {
    await pickSecond.click();
  }
};

export const handleSnakeDraftPick = async (page: Page): Promise<void> => {
  const pickable = page.locator(".draft-pool .draft-card:not(.draft-card--disabled)");
  await pickable.first().waitFor({ state: "attached", timeout: 5000 }).catch(() => {});
  const count = await pickable.count();
  if (count > 0) {
    await pickable.first().click({ timeout: 3000 }).catch(() => {});
  }
};

const waitForTitleChange = async (page: Page, current: string, timeoutMs = 8000): Promise<void> => {
  await page.waitForFunction(
    (cur: string) => {
      const el = document.querySelector(".tt-phase-title");
      return el !== null && el.textContent !== cur;
    },
    current,
    { timeout: timeoutMs },
  ).catch(() => {});
};

export const completeDraftPhases = async (page: Page, rng: Rng): Promise<void> => {
  await page.locator(".tt-phase-title").waitFor({ timeout: 20000 });

  for (let guard = 0; guard < 40; guard++) {
    const titleEl = page.locator(".tt-phase-title");
    const text = (await titleEl.textContent({ timeout: 5000 }).catch(() => "")) ?? "";

    if (text.includes("Armies Assembled")) return;

    if (text.includes("Select Your Signature") || text.includes("Choose Your Secret")) {
      const confirmBtn = page.locator("button:has-text('Confirm Selection')");
      const confirmVisible = await confirmBtn.isVisible().catch(() => false);
      if (confirmVisible) {
        const needed = text.includes("Secret") ? 1 : 3;
        await draftSelectCards(page, needed, rng);
      }
      await waitForTitleChange(page, text);
      continue;
    }

    if (text === "Draft Pool") {
      const pickFirst = page.locator("button:has-text('Pick First')");
      if (await pickFirst.isVisible().catch(() => false)) {
        await handleDraftOrder(page, rng);
      }
      await waitForTitleChange(page, text);
      continue;
    }

    if (text === "Snake Draft") {
      const subtitle = (await page.locator(".tt-phase-subtitle").textContent().catch(() => "")) ?? "";
      if (subtitle.includes("Your turn")) {
        await handleSnakeDraftPick(page);
      }
      await page.waitForFunction(
        () => {
          const el = document.querySelector(".tt-phase-title");
          const sub = document.querySelector(".tt-phase-subtitle");
          return (el?.textContent !== "Snake Draft") || (sub?.textContent?.includes("Your turn"));
        },
        {},
        { timeout: 8000 },
      ).catch(() => {});
      continue;
    }

    if (text === "Signatures Revealed") {
      await waitForTitleChange(page, text);
      continue;
    }

    await page.waitForTimeout(300);
  }
};
