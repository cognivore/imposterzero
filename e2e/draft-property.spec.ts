import { test, expect, type Browser, type Page, type BrowserContext } from "@playwright/test";
import * as fc from "fast-check";
import { waitForBrowser, setName, completeDraftPhases, seededRng } from "./helpers.js";

test.setTimeout(120_000);

// ---------------------------------------------------------------------------
// Two-browser draft harness
// ---------------------------------------------------------------------------

interface TwoPlayerPages {
  ctxA: BrowserContext;
  ctxB: BrowserContext;
  host: Page;
  joiner: Page;
}

const openTwoPlayers = async (
  browser: Browser,
  hostName: string,
  joinerName: string,
): Promise<TwoPlayerPages> => {
  const ctxA = await browser.newContext();
  const host = await ctxA.newPage();
  await host.goto("/");
  await waitForBrowser(host);
  await setName(host, hostName);

  const ctxB = await browser.newContext();
  const joiner = await ctxB.newPage();
  await joiner.goto("/");
  await waitForBrowser(joiner);
  await setName(joiner, joinerName);

  return { ctxA, ctxB, host, joiner };
};

const createAndJoinRoom = async (host: Page, joiner: Page): Promise<void> => {
  await host.click("button:has-text('2')", { strict: false });
  await host.click("button:has-text('Create Room')");
  await host.waitForSelector(".lobby-title", { timeout: 5000 });

  const joinableRoom = joiner.locator(".room-entry:not(.room-active)").first();
  await expect(joinableRoom).toBeVisible({ timeout: 5000 });
  await joinableRoom.locator("button:has-text('Join')").click();
  await joiner.waitForSelector(".lobby-title", { timeout: 5000 });

  await expect(host.locator(".player-count")).toContainText("2 / 2", { timeout: 5000 });
};

const readyBoth = async (host: Page, joiner: Page): Promise<void> => {
  await host.click("button:has-text('Ready')");
  await joiner.click("button:has-text('Ready')");
};

const waitForGamePhase = async (page: Page): Promise<void> => {
  await page.locator(".tt-court").waitFor({ timeout: 25000 });
};

// ---------------------------------------------------------------------------
// Property: drive both players through draft, assert game starts
// ---------------------------------------------------------------------------

const runDraftProperty = async (
  browser: Browser,
  seed: number,
  tournament: boolean,
): Promise<void> => {
  const rng = seededRng(seed);
  const prefix = tournament ? "t" : "s";
  const { ctxA, ctxB, host, joiner } = await openTwoPlayers(
    browser,
    `${prefix}h-${seed}`,
    `${prefix}j-${seed}`,
  );

  try {
    await createAndJoinRoom(host, joiner);

    if (!tournament) {
      const label = host.locator("label:has-text('Tournament Draft')");
      await label.click();
      await host.waitForTimeout(500);
    }

    await readyBoth(host, joiner);

    await Promise.all([
      completeDraftPhases(host, rng),
      completeDraftPhases(joiner, rng),
    ]);

    await Promise.all([
      waitForGamePhase(host),
      waitForGamePhase(joiner),
    ]);

    await expect(host.locator(".tt-court")).toBeVisible();
    await expect(joiner.locator(".tt-court")).toBeVisible();
  } finally {
    await ctxA.close().catch(() => {});
    await ctxB.close().catch(() => {});
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Draft browser properties", () => {

  test("tournament mode: 2p draft completes and game starts across random seeds", async ({ browser }) => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50000 }), async (seed) => {
        await runDraftProperty(browser, seed, true);
      }),
      { numRuns: 3, endOnFailure: true },
    );
  });

  test("standard mode: 2p draft completes and game starts across random seeds", async ({ browser }) => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50000 }), async (seed) => {
        await runDraftProperty(browser, seed, false);
      }),
      { numRuns: 3, endOnFailure: true },
    );
  });

});
