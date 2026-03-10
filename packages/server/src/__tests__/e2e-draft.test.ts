import { describe, it, expect, afterEach } from "vitest";
import * as fc from "fast-check";
import { createImposterKingsGame, SIGNATURE_CARD_NAMES, BASE_ARMY_NAMES } from "@imposter-zero/engine";
import { startServer, type ServerHandle } from "../ws-server.js";
import { BotClient, createBots, closeBots } from "./bot-client.js";
import type { OutboundMessage } from "../room.js";
import type { DraftPhaseView } from "@imposter-zero/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnyMsg = OutboundMessage | { readonly type: string; [k: string]: unknown };

const extractDraftPhase = (m: AnyMsg): DraftPhaseView | null =>
  m.type === "draft_state"
    ? (m as Record<string, unknown>).draftPhase as DraftPhaseView
    : null;

const isTournament = (m: AnyMsg): boolean =>
  m.type === "draft_state" && (m as Record<string, unknown>).tournament === true;

const seededRng = (seed: number) => {
  let s = Math.abs(seed) || 1;
  return (): number => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const pickRandom = <T>(arr: readonly T[], rng: () => number): T =>
  arr[Math.floor(rng() * arr.length)]!;

const pickN = <T>(arr: readonly T[], n: number, rng: () => number): T[] => {
  const pool = [...arr];
  const result: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    result.push(pool.splice(idx, 1)[0]!);
  }
  return result;
};

// ---------------------------------------------------------------------------
// Per-bot draft handler: drives a single bot through the entire draft
// ---------------------------------------------------------------------------

const driveBotDraft = async (
  bot: BotClient,
  rng: () => number,
): Promise<{ signatures: readonly string[]; tournament: boolean }> => {
  let mySignatures: readonly string[] = [];
  let wasTournament = false;

  for (let step = 0; step < 40; step++) {
    if (bot.received.some((m) => m.type === "game_start")) break;
    const msg = await bot.drainUntil(
      (m) => m.type === "game_start" || m.type === "draft_state",
      10_000,
    );
    if (msg.type === "game_start") break;

    wasTournament = isTournament(msg);
    const dp = extractDraftPhase(msg);
    if (!dp) continue;

    switch (dp.tag) {
      case "selection": {
        if (dp.submitted) continue;
        const picks = pickN([...dp.pool], dp.selectionsNeeded, rng);
        bot.fireDraftSelect(picks);
        break;
      }
      case "draft_order": {
        if (!dp.amChooser) continue;
        bot.send({ type: "draft_order", goFirst: rng() < 0.5 });
        break;
      }
      case "drafting": {
        if (!dp.amCurrentPicker) continue;
        const card = pickRandom(dp.faceUp, rng);
        bot.send({ type: "draft_pick", card });
        break;
      }
      case "complete": {
        const me = bot.received.findIndex((m) => m.type === "draft_state" && (m as Record<string, unknown>).draftPhase !== undefined);
        if (me >= 0) {
          const lastDraft = [...bot.received].reverse().find((m) => {
            const p = extractDraftPhase(m);
            return p?.tag === "complete";
          });
          if (lastDraft) {
            const cp = extractDraftPhase(lastDraft)!;
            if (cp.tag === "complete") mySignatures = cp.playerSignatures.flat();
          }
        }
        break;
      }
      default:
        break;
    }
  }

  return { signatures: mySignatures, tournament: wasTournament };
};

// ---------------------------------------------------------------------------
// Full E2E: draft + play to completion
// ---------------------------------------------------------------------------

const runDraftAndMatch = async (
  port: number,
  numPlayers: number,
  tournament: boolean,
  targetScore: number,
  seed: number,
): Promise<{
  draftCompleted: boolean;
  gameStarted: boolean;
  matchCompleted: boolean;
  allPlayersGot3Signatures: boolean;
  signaturesFromPool: boolean;
  noDuplicateSignaturesPerPlayer: boolean;
  tournamentModeUsed: boolean;
  finalScores: readonly number[];
  roundsPlayed: number;
}> => {
  const url = `ws://127.0.0.1:${port}`;
  const rng = seededRng(seed);

  const bots = await createBots(url, numPlayers);
  await bots[0]!.setName(`p0-${seed}`);
  const created = await bots[0]!.createRoom(numPlayers, targetScore);
  if (created.type !== "room_created") throw new Error(`room_created failed: ${created.type}`);
  const roomId = bots[0]!.roomId!;

  if (!tournament) {
    bots[0]!.send({ type: "update_settings", tournament: false });
    await bots[0]!.drainUntil((m) => m.type === "room_settings");
  }

  for (let i = 1; i < numPlayers; i++) {
    await bots[i]!.setName(`p${i}-${seed}`);
    await bots[i]!.joinRoom(roomId);
    await bots[i]!.drainUntil((m) => m.type === "lobby_state");
    for (let j = 0; j < i; j++) {
      await bots[j]!.drainUntil((m) => m.type === "lobby_state");
    }
  }

  for (const bot of bots) bot.fireReady();

  const draftResults = await Promise.all(
    bots.map((bot) => driveBotDraft(bot, rng)),
  );

  const draftCompleted = bots.every((b) =>
    b.received.some((m) => {
      const dp = extractDraftPhase(m);
      return dp?.tag === "complete";
    }),
  );

  const gameStarted = bots.every((b) =>
    b.received.some((m) => m.type === "game_start"),
  );

  const completeMessages = bots.map((b) => {
    const msgs = [...b.received].reverse();
    const last = msgs.find((m) => {
      const dp = extractDraftPhase(m);
      return dp?.tag === "complete";
    });
    return last ? extractDraftPhase(last)! : null;
  });

  const allComplete = completeMessages.every((c) => c !== null && c.tag === "complete");

  let allPlayersGot3Signatures = false;
  let signaturesFromPool = false;
  let noDuplicateSignaturesPerPlayer = false;

  if (allComplete) {
    const cp = completeMessages[0]!;
    if (cp.tag === "complete") {
      const sigs = cp.playerSignatures;
      allPlayersGot3Signatures = sigs.every((s) => s.length === 3);

      const poolNames = new Set(SIGNATURE_CARD_NAMES as readonly string[]);
      signaturesFromPool = sigs.every((s) => s.every((name) => poolNames.has(name)));

      noDuplicateSignaturesPerPlayer = sigs.every((s) => new Set(s).size === s.length);
    }
  }

  const tournamentModeUsed = numPlayers === 2
    ? draftResults.some((r) => r.tournament) === tournament
    : !draftResults.some((r) => r.tournament);

  let finalScores: readonly number[] = [];
  let roundsPlayed = 0;
  let matchCompleted = false;

  if (gameStarted) {
    const observer = bots[0]!;
    let safety = 0;
    while (safety++ < 5000) {
      const msg = await observer.waitForMessage(15_000);
      if (msg.type === "state") {
        const stateMsg = msg as OutboundMessage & { type: "state" };
        const legal = stateMsg.legalActions;
        if (legal.length > 0) {
          const action = legal[Math.floor(rng() * legal.length)]!;
          bots[stateMsg.activePlayer]!.fireAction(action);
        }
      } else if (msg.type === "round_over") {
        roundsPlayed = (msg as OutboundMessage & { type: "round_over" }).roundsPlayed;
      } else if (msg.type === "match_over") {
        const matchMsg = msg as OutboundMessage & { type: "match_over" };
        finalScores = matchMsg.finalScores;
        matchCompleted = true;
        break;
      }
    }
  }

  closeBots(bots);
  return {
    draftCompleted,
    gameStarted,
    matchCompleted,
    allPlayersGot3Signatures,
    signaturesFromPool,
    noDuplicateSignaturesPerPlayer,
    tournamentModeUsed,
    finalScores,
    roundsPlayed,
  };
};

// ---------------------------------------------------------------------------
// Property-based tests
// ---------------------------------------------------------------------------

describe("Draft E2E properties", () => {
  let server: ServerHandle;

  afterEach(async () => {
    if (server) await server.close();
  });

  it("tournament draft: 2p with random seeds always completes and produces valid armies", () => {
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50000 }), async (seed) => {
        server = startServer(createImposterKingsGame(), {
          port: 0,
          targetScore: 3,
          autoAdvanceScoring: true,
        });
        await server.ready;

        const result = await runDraftAndMatch(server.port, 2, true, 3, seed);
        await server.close();

        expect(result.draftCompleted).toBe(true);
        expect(result.gameStarted).toBe(true);
        expect(result.matchCompleted).toBe(true);
        expect(result.allPlayersGot3Signatures).toBe(true);
        expect(result.signaturesFromPool).toBe(true);
        expect(result.noDuplicateSignaturesPerPlayer).toBe(true);
        expect(result.tournamentModeUsed).toBe(true);
        expect(result.roundsPlayed).toBeGreaterThanOrEqual(1);
        expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(3);
      }),
      { numRuns: 5, endOnFailure: true },
    );
  }, 120_000);

  it("standard draft: 2p with random seeds always completes and produces valid armies", () => {
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50000 }), async (seed) => {
        server = startServer(createImposterKingsGame(), {
          port: 0,
          targetScore: 3,
          autoAdvanceScoring: true,
        });
        await server.ready;

        const result = await runDraftAndMatch(server.port, 2, false, 3, seed);
        await server.close();

        expect(result.draftCompleted).toBe(true);
        expect(result.gameStarted).toBe(true);
        expect(result.matchCompleted).toBe(true);
        expect(result.allPlayersGot3Signatures).toBe(true);
        expect(result.signaturesFromPool).toBe(true);
        expect(result.noDuplicateSignaturesPerPlayer).toBe(true);
        expect(result.tournamentModeUsed).toBe(true);
        expect(result.roundsPlayed).toBeGreaterThanOrEqual(1);
        expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(3);
      }),
      { numRuns: 5, endOnFailure: true },
    );
  }, 120_000);

  it("3p draft falls back to standard mode regardless of tournament flag", () => {
    fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50000 }),
        fc.boolean(),
        async (seed, tournamentFlag) => {
          server = startServer(createImposterKingsGame(), {
            port: 0,
            targetScore: 3,
            autoAdvanceScoring: true,
          });
          await server.ready;

          const result = await runDraftAndMatch(server.port, 3, tournamentFlag, 3, seed);
          await server.close();

          expect(result.draftCompleted).toBe(true);
          expect(result.gameStarted).toBe(true);
          expect(result.matchCompleted).toBe(true);
          expect(result.allPlayersGot3Signatures).toBe(true);
          expect(result.signaturesFromPool).toBe(true);
          expect(result.noDuplicateSignaturesPerPlayer).toBe(true);
          expect(result.tournamentModeUsed).toBe(true);
        },
      ),
      { numRuns: 3, endOnFailure: true },
    );
  }, 120_000);

  it("tournament 2p: both players always end up with exactly 3 distinct signature cards from the pool", () => {
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50000 }), async (seed) => {
        server = startServer(createImposterKingsGame(), {
          port: 0,
          targetScore: 3,
          autoAdvanceScoring: true,
        });
        await server.ready;

        const url = `ws://127.0.0.1:${server.port}`;
        const rng = seededRng(seed);
        const bots = await createBots(url, 2);

        await bots[0]!.setName(`a-${seed}`);
        await bots[0]!.createRoom(2, 3);
        const roomId = bots[0]!.roomId!;

        await bots[1]!.setName(`b-${seed}`);
        await bots[1]!.joinRoom(roomId);
        await bots[1]!.drainUntil((m) => m.type === "lobby_state");
        await bots[0]!.drainUntil((m) => m.type === "lobby_state");

        for (const bot of bots) bot.fireReady();
        await Promise.all(bots.map((bot) => driveBotDraft(bot, rng)));

        const allCompleteMsgs = bots.map((b) => {
          const last = [...b.received].reverse().find((m) => extractDraftPhase(m)?.tag === "complete");
          return last ? extractDraftPhase(last)! : null;
        });

        for (const cm of allCompleteMsgs) {
          expect(cm).not.toBeNull();
          if (cm?.tag !== "complete") continue;
          for (const playerSigs of cm.playerSignatures) {
            expect(playerSigs.length).toBe(3);
            expect(new Set(playerSigs).size).toBe(3);
            for (const name of playerSigs) {
              expect(SIGNATURE_CARD_NAMES).toContain(name);
            }
          }
        }

        closeBots(bots);
        await server.close();
      }),
      { numRuns: 10, endOnFailure: true },
    );
  }, 120_000);

  it("draft phases arrive in correct order for tournament mode", () => {
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50000 }), async (seed) => {
        server = startServer(createImposterKingsGame(), {
          port: 0,
          targetScore: 3,
          autoAdvanceScoring: true,
        });
        await server.ready;

        const url = `ws://127.0.0.1:${server.port}`;
        const rng = seededRng(seed);
        const bots = await createBots(url, 2);

        await bots[0]!.setName(`x-${seed}`);
        await bots[0]!.createRoom(2, 3);
        const roomId = bots[0]!.roomId!;

        await bots[1]!.setName(`y-${seed}`);
        await bots[1]!.joinRoom(roomId);
        await bots[1]!.drainUntil((m) => m.type === "lobby_state");
        await bots[0]!.drainUntil((m) => m.type === "lobby_state");

        for (const bot of bots) bot.fireReady();
        await Promise.all(bots.map((bot) => driveBotDraft(bot, rng)));

        for (const bot of bots) {
          const draftMsgs = bot.received
            .map(extractDraftPhase)
            .filter((dp): dp is DraftPhaseView => dp !== null);

          const tags = draftMsgs.map((dp) => dp.tag);
          const uniqueOrderedTags = tags.reduce<string[]>((acc, t) => {
            if (acc.length === 0 || acc[acc.length - 1] !== t) acc.push(t);
            return acc;
          }, []);

          expect(uniqueOrderedTags[0]).toBe("selection");

          const orderIdx = uniqueOrderedTags.indexOf("draft_order");
          const draftingIdx = uniqueOrderedTags.indexOf("drafting");
          const completeIdx = uniqueOrderedTags.indexOf("complete");

          if (orderIdx >= 0) expect(orderIdx).toBeGreaterThan(0);
          if (draftingIdx >= 0) expect(draftingIdx).toBeGreaterThan(orderIdx);
          if (completeIdx >= 0) expect(completeIdx).toBe(uniqueOrderedTags.length - 1);
        }

        closeBots(bots);
        await server.close();
      }),
      { numRuns: 10, endOnFailure: true },
    );
  }, 120_000);
});
