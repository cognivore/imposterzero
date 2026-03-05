import { describe, it, expect, afterEach } from "vitest";
import { createImposterKingsGame, type IKAction, type IKState } from "@imposter-zero/engine";
import { startServer, type ServerHandle } from "../ws-server.js";
import { BotClient, createBotsInRoom, closeBots } from "./bot-client.js";
import type { OutboundMessage } from "../room.js";
import type { PlayerId } from "@imposter-zero/types";

// Trained neural policies are for the pre-effects game and are no longer valid.
// This tournament verifies that random bots can complete 3p games reliably
// under the effects-enabled engine.

type Picker = (state: IKState, player: PlayerId, legal: ReadonlyArray<IKAction>) => IKAction;

const randomPicker: Picker = (_s, _p, legal) =>
  legal[Math.floor(Math.random() * legal.length)]!;

const play3pMatch = async (
  pickers: readonly [Picker, Picker, Picker],
  observer: BotClient,
  allBots: BotClient[],
): Promise<ReadonlyArray<number>> => {
  let finalScores: ReadonlyArray<number> = [];
  let safety = 0;

  while (safety++ < 8_000) {
    const msg = await observer.waitForMessage(15_000);
    if (msg.type === "state") {
      const s = msg as OutboundMessage & { type: "state" };
      const active = s.activePlayer;
      if (s.legalActions.length > 0 && active >= 0 && active < 3) {
        allBots[active]!.fireAction(
          pickers[active]!(s.state as IKState, active as PlayerId, s.legalActions),
        );
      }
    } else if (msg.type === "match_over") {
      finalScores = (msg as OutboundMessage & { type: "match_over" }).finalScores;
      break;
    }
  }
  return finalScores;
};

const create3pGame = async (targetScore: number): Promise<{ server: ServerHandle; bots: BotClient[] }> => {
  const server = startServer(createImposterKingsGame(), {
    port: 0,
    targetScore,
    autoAdvanceScoring: true,
  });
  await server.ready;
  const url = `ws://127.0.0.1:${server.port}`;
  const bots = await createBotsInRoom(url, 3, 3, targetScore);
  for (const bot of bots) bot.fireReady();
  for (const bot of bots) await bot.drainMessages(3 + 1);
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

describe("3p random tournament (post-effects reset)", () => {
  it("random-only: 6 games complete successfully", async () => {
    const targetScore = 3;
    const totalGames = 6;

    for (let g = 0; g < totalGames; g++) {
      const h = await create3pGame(targetScore);
      try {
        const scores = await play3pMatch(
          [randomPicker, randomPicker, randomPicker],
          h.bots[0]!,
          h.bots,
        );
        expect(Math.max(...scores)).toBeGreaterThanOrEqual(targetScore);
      } finally {
        closeBots(h.bots);
        await h.server.close();
      }
    }
  }, 120_000);
});
