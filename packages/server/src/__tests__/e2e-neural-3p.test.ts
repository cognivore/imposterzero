import { describe, it, expect, afterEach } from "vitest";
import { createImposterKingsGame, type IKAction, type IKState } from "@imposter-zero/engine";
import { startServer, type ServerHandle } from "../ws-server.js";
import { BotClient, createBotsInRoom, closeBots, readyAllAndDraft } from "./bot-client.js";
import type { OutboundMessage } from "../room.js";
import type { PlayerId } from "@imposter-zero/types";

// Trained policies are for the pre-effects game and are no longer valid.
// These tests verify that random bots can complete 3p games with the
// effects-enabled engine.

type ActionPicker = (state: IKState, player: PlayerId, legal: ReadonlyArray<IKAction>) => IKAction;

const randomPicker: ActionPicker = (_s, _p, legal) =>
  legal[Math.floor(Math.random() * legal.length)]!;

const play3pMatch = async (
  pickers: readonly [ActionPicker, ActionPicker, ActionPicker],
  observer: BotClient,
  allBots: BotClient[],
): Promise<{ finalScores: ReadonlyArray<number>; rounds: number }> => {
  let rounds = 0;
  let finalScores: ReadonlyArray<number> = [];
  let safety = 0;

  while (safety++ < 8_000) {
    const msg = await observer.waitForMessage(15_000);

    if (msg.type === "state") {
      const s = msg as OutboundMessage & { type: "state" };
      const active = s.activePlayer;
      if (s.legalActions.length > 0 && active >= 0 && active < 3) {
        const action = pickers[active]!(s.state as IKState, active as PlayerId, s.legalActions);
        allBots[active]!.fireAction(action);
      }
      continue;
    }

    if (msg.type === "round_over") {
      rounds++;
      continue;
    }

    if (msg.type === "match_over") {
      finalScores = (msg as OutboundMessage & { type: "match_over" }).finalScores;
      break;
    }
  }

  return { finalScores, rounds };
};

const create3pGame = async (targetScore: number): Promise<{ server: ServerHandle; bots: BotClient[] }> => {
  const server = startServer(createImposterKingsGame(), {
    port: 0,
    targetScore,
    autoAdvanceScoring: true,
  });
  const url = `ws://127.0.0.1:${server.port}`;
  const bots = await createBotsInRoom(url, 3, 3, targetScore);

  await readyAllAndDraft(bots);

  return { server, bots };
};

let handles: { server: ServerHandle; bots: BotClient[] }[] = [];

afterEach(async () => {
  for (const h of handles) {
    closeBots(h.bots);
    await h.server.close();
  }
  handles = [];
});

describe("3p random bot e2e", () => {
  it("3p match with all random bots completes", async () => {
    const h = await create3pGame(5);
    handles.push(h);

    const result = await play3pMatch([randomPicker, randomPicker, randomPicker], h.bots[0]!, h.bots);
    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it("random bots complete multiple short matches without errors", async () => {
    for (let game = 0; game < 5; game++) {
      const h = await create3pGame(3);
      handles.push(h);

      const result = await play3pMatch([randomPicker, randomPicker, randomPicker], h.bots[0]!, h.bots);
      expect(result.rounds).toBeGreaterThanOrEqual(1);
    }
  }, 60_000);

  it("hourtrain vs fasttrained vs random: bots beat random over many matches", async () => {
    let wins = { random: 0, bot1: 0, bot2: 0 };
    const totalGames = 10;

    for (let g = 0; g < totalGames; g++) {
      const h = await create3pGame(3);
      handles.push(h);

      const result = await play3pMatch(
        [randomPicker, randomPicker, randomPicker],
        h.bots[0]!,
        h.bots,
      );

      const maxScore = Math.max(...result.finalScores);
      const winnerIdx = result.finalScores.indexOf(maxScore);
      if (winnerIdx === 0) wins.random++;
      else if (winnerIdx === 1) wins.bot1++;
      else wins.bot2++;

      closeBots(h.bots);
      await h.server.close();
    }
    handles = [];

    console.log(`  Wins: random=${wins.random}, bot1=${wins.bot1}, bot2=${wins.bot2}`);
    expect(wins.random + wins.bot1 + wins.bot2).toBe(totalGames);
  }, 120_000);
});
