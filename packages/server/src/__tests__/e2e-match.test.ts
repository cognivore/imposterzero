import { describe, it, expect, afterEach } from "vitest";
import { createImposterKingsGame, type IKAction } from "@imposter-zero/engine";
import { startServer, type ServerHandle } from "../ws-server.js";
import { BotClient, createBots, closeBots } from "./bot-client.js";
import type { OutboundMessage } from "../room.js";
import type { PlayerId } from "@imposter-zero/types";

let server: ServerHandle;
let bots: BotClient[];

afterEach(async () => {
  if (bots) closeBots(bots);
  if (server) await server.close();
});

interface MatchPlayResult {
  readonly finalScores: ReadonlyArray<number>;
  readonly winners: ReadonlyArray<PlayerId>;
  readonly roundScores: ReadonlyArray<ReadonlyArray<number>>;
  readonly roundsPlayed: number;
}

const setupAndStart = async (
  numPlayers: number,
  targetScore: number = 7,
): Promise<void> => {
  server = startServer(createImposterKingsGame(), {
    port: 0,
    targetScore,
    autoAdvanceScoring: true,
  });
  const url = `ws://127.0.0.1:${server.port}`;
  bots = await createBots(url, numPlayers);

  // Drain initial lobby_state for each bot
  for (const bot of bots) await bot.waitForMessage();

  // All join
  for (let i = 0; i < numPlayers; i++) {
    bots[i]!.fireJoin();
  }
  // Drain all join broadcasts (each join broadcast goes to all bots)
  for (const bot of bots) {
    await bot.drainMessages(numPlayers);
  }

  // All ready
  for (let i = 0; i < numPlayers; i++) {
    bots[i]!.fireReady();
  }

  // Each non-last ready: 1 lobby_state broadcast. Last ready: lobby_state(starting) + game_start + state.
  // Total: (n-1) + 3 = n+2. Drain n+1 to leave the initial "state" for the play loop.
  for (const bot of bots) {
    await bot.drainMessages(numPlayers + 1);
  }
};

const playMatchOverWS = async (
  numPlayers: number,
  observer: BotClient,
): Promise<MatchPlayResult> => {
  const roundScores: Array<ReadonlyArray<number>> = [];
  let finalScores: ReadonlyArray<number> = [];
  let winners: ReadonlyArray<PlayerId> = [];
  let roundsPlayed = 0;
  let safety = 0;
  const maxActions = 5000;

  while (safety++ < maxActions) {
    const msg = await observer.waitForMessage(10_000);

    if (msg.type === "state") {
      const stateMsg = msg as OutboundMessage & { type: "state" };
      const active = stateMsg.activePlayer;
      const legal = stateMsg.legalActions;
      if (legal.length > 0) {
        const action = legal[Math.floor(Math.random() * legal.length)]!;
        bots[active]!.fireAction(action);
      }
      continue;
    }

    if (msg.type === "round_over") {
      const roundMsg = msg as OutboundMessage & { type: "round_over" };
      roundScores.push(roundMsg.scores);
      roundsPlayed = roundMsg.roundsPlayed;
      continue;
    }

    if (msg.type === "match_over") {
      const matchMsg = msg as OutboundMessage & { type: "match_over" };
      finalScores = matchMsg.finalScores;
      winners = matchMsg.winners;
      break;
    }

    if (msg.type === "game_start") {
      continue;
    }
  }

  return { finalScores, winners, roundScores, roundsPlayed };
};

describe("E2E match to 7 points", () => {
  it("2-player match completes with a winner", async () => {
    await setupAndStart(2, 7);
    const result = await playMatchOverWS(2, bots[0]!);

    expect(result.winners.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(7);
    expect(result.roundsPlayed).toBeGreaterThanOrEqual(1);
    expect(result.roundScores).toHaveLength(result.roundsPlayed);
  }, 30_000);

  it("3-player match completes with a winner", async () => {
    await setupAndStart(3, 7);
    const result = await playMatchOverWS(3, bots[0]!);

    expect(result.winners.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(7);
    expect(result.roundsPlayed).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("4-player match completes with a winner", async () => {
    await setupAndStart(4, 7);
    const result = await playMatchOverWS(4, bots[0]!);

    expect(result.winners.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(7);
    expect(result.roundsPlayed).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("4-player teams: teammates always have equal scores", async () => {
    await setupAndStart(4, 7);
    const result = await playMatchOverWS(4, bots[0]!);

    expect(result.finalScores[0]).toBe(result.finalScores[2]);
    expect(result.finalScores[1]).toBe(result.finalScores[3]);
  }, 30_000);

  it("round scores accumulate to final scores", async () => {
    await setupAndStart(2, 7);
    const result = await playMatchOverWS(2, bots[0]!);

    const totals = result.roundScores.reduce(
      (acc, round) => acc.map((s, i) => s + round[i]!),
      Array.from({ length: 2 }, () => 0),
    );
    expect([...result.finalScores]).toEqual(totals);
  }, 30_000);

  it("round scores are all non-negative", async () => {
    await setupAndStart(2, 7);
    const result = await playMatchOverWS(2, bots[0]!);

    for (const round of result.roundScores) {
      for (const s of round) {
        expect(s).toBeGreaterThanOrEqual(0);
      }
    }
  }, 30_000);

  it("2-player max round score is 3", async () => {
    await setupAndStart(2, 7);
    const result = await playMatchOverWS(2, bots[0]!);

    for (const round of result.roundScores) {
      for (const s of round) {
        expect(s).toBeLessThanOrEqual(3);
      }
    }
  }, 30_000);

  it("short match (target=3) finishes quickly", async () => {
    await setupAndStart(2, 3);
    const result = await playMatchOverWS(2, bots[0]!);

    expect(result.winners.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(3);
  }, 15_000);
});
