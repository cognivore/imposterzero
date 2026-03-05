import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { createImposterKingsGame, type IKAction, type IKState } from "@imposter-zero/engine";
import { startServer, type ServerHandle } from "../ws-server.js";
import { createNeuralStrategy, type NeuralPolicy } from "../bot-player.js";
import { BotClient, createBotsInRoom, closeBots } from "./bot-client.js";
import type { OutboundMessage } from "../room.js";
import type { PlayerId } from "@imposter-zero/types";

const loadNeuralPolicy = (): NeuralPolicy => {
  const candidates = [
    resolve(process.cwd(), "training/policy_3p.json"),
    resolve(__dirname, "../../../../training/policy_3p.json"),
    resolve(__dirname, "../../../../../training/policy_3p.json"),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as NeuralPolicy;
    } catch { /* try next */ }
  }
  throw new Error(`Cannot find policy_3p.json (searched: ${candidates.join(", ")})`);
};

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
      const m = msg as OutboundMessage & { type: "match_over" };
      finalScores = m.finalScores;
      break;
    }

    if (msg.type === "game_start") continue;
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

describe("3p neural bot e2e", () => {
  it("3p match with 2 neural bots + 1 random completes", async () => {
    const policy = loadNeuralPolicy();
    const nn = createNeuralStrategy(policy);
    const nnPicker: ActionPicker = (s, p, l) => nn.selectAction(s, p, l);

    const h = await create3pGame(5);
    handles.push(h);

    const result = await play3pMatch([randomPicker, nnPicker, nnPicker], h.bots[0]!, h.bots);
    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it("all-neural 3p match completes", async () => {
    const policy = loadNeuralPolicy();
    const nn = createNeuralStrategy(policy);
    const nnPicker: ActionPicker = (s, p, l) => nn.selectAction(s, p, l);

    const h = await create3pGame(5);
    handles.push(h);

    const result = await play3pMatch([nnPicker, nnPicker, nnPicker], h.bots[0]!, h.bots);
    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(Math.max(...result.finalScores)).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it("neural bots complete multiple short matches without errors", async () => {
    const policy = loadNeuralPolicy();
    const nn = createNeuralStrategy(policy);
    const nnPicker: ActionPicker = (s, p, l) => nn.selectAction(s, p, l);

    for (let game = 0; game < 5; game++) {
      const h = await create3pGame(3);
      handles.push(h);

      const result = await play3pMatch([randomPicker, nnPicker, nnPicker], h.bots[0]!, h.bots);
      expect(result.rounds).toBeGreaterThanOrEqual(1);
    }
  }, 60_000);

  it("neural bots win more often than random baseline", async () => {
    const policy = loadNeuralPolicy();
    const nn = createNeuralStrategy(policy);
    const nnPicker: ActionPicker = (s, p, l) => nn.selectAction(s, p, l);

    let neuralWins = 0;
    let randomWins = 0;
    const totalGames = 30;

    for (let g = 0; g < totalGames; g++) {
      const h = await create3pGame(3);
      handles.push(h);

      const result = await play3pMatch([randomPicker, nnPicker, nnPicker], h.bots[0]!, h.bots);
      const maxScore = Math.max(...result.finalScores);
      if (result.finalScores[0] === maxScore) randomWins++;
      if (result.finalScores[1] === maxScore || result.finalScores[2] === maxScore) neuralWins++;
    }

    expect(neuralWins).toBeGreaterThan(randomWins);
  }, 120_000);
});
