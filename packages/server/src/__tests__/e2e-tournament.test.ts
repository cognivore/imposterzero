import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { createImposterKingsGame, type IKAction, type IKState } from "@imposter-zero/engine";
import { startServer, type ServerHandle } from "../ws-server.js";
import { createNeuralStrategy, RandomStrategy, type NeuralPolicy, type BotStrategy } from "../bot-player.js";
import { BotClient, createBotsInRoom, closeBots } from "./bot-client.js";
import type { OutboundMessage } from "../room.js";
import type { PlayerId } from "@imposter-zero/types";

// ---------------------------------------------------------------------------
// Model zoo loader
// ---------------------------------------------------------------------------

interface ZooEntry {
  readonly name: string;
  readonly picker: (state: IKState, player: PlayerId, legal: ReadonlyArray<IKAction>) => IKAction;
}

const findPolicy = (filename: string): string | null => {
  const candidates = [
    resolve(process.cwd(), `training/${filename}`),
    resolve(__dirname, `../../../../training/${filename}`),
    resolve(__dirname, `../../../../../training/${filename}`),
  ];
  for (const p of candidates) {
    try { readFileSync(p); return p; } catch { /* next */ }
  }
  return null;
};

const loadZoo = (): ZooEntry[] => {
  const zoo: ZooEntry[] = [
    { name: "random", picker: (_s, _p, legal) => legal[Math.floor(Math.random() * legal.length)]! },
  ];

  const neuralModels = [
    { name: "fast", file: "policy_3p_fast.json" },
    { name: "hourtrain", file: "policy_3p_hourtrain.json" },
    { name: "fasthourtrained", file: "policy_3p_fasthourtrained.json" },
    { name: "hourhourtrained", file: "policy_3p_hourhourtrained.json" },
    { name: "hourtrainedvs", file: "policy_3p_hourtrainedvs.json" },
  ];

  for (const { name, file } of neuralModels) {
    const path = findPolicy(file);
    if (!path) continue;
    try {
      const policy = JSON.parse(readFileSync(path, "utf-8")) as NeuralPolicy;
      const strategy = createNeuralStrategy(policy);
      zoo.push({ name, picker: (s, p, l) => strategy.selectAction(s, p, l) });
    } catch {
      /* skip malformed */
    }
  }

  return zoo;
};

// ---------------------------------------------------------------------------
// Match infrastructure
// ---------------------------------------------------------------------------

type Picker = (state: IKState, player: PlayerId, legal: ReadonlyArray<IKAction>) => IKAction;

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
  const url = `ws://127.0.0.1:${server.port}`;
  const bots = await createBotsInRoom(url, 3, 3, targetScore);
  for (const bot of bots) bot.fireReady();
  for (const bot of bots) await bot.drainMessages(3 + 1);
  return { server, bots };
};

// ---------------------------------------------------------------------------
// Combinatorics
// ---------------------------------------------------------------------------

const combinations3 = <T>(items: readonly T[]): readonly [T, T, T][] => {
  const result: [T, T, T][] = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      for (let k = j + 1; k < items.length; k++)
        result.push([items[i]!, items[j]!, items[k]!]);
  return result;
};

// ---------------------------------------------------------------------------
// Tournament
// ---------------------------------------------------------------------------

let handles: { server: ServerHandle; bots: BotClient[] }[] = [];

afterEach(async () => {
  for (const h of handles) {
    closeBots(h.bots);
    await h.server.close();
  }
  handles = [];
});

describe("3p model zoo round-robin tournament", () => {
  it("round-robin: every 3-model combination plays, standings printed", async () => {
    const zoo = loadZoo();
    if (zoo.length < 3) {
      console.log("  Skipping tournament: need at least 3 models, found", zoo.length);
      return;
    }

    const matchups = combinations3(zoo);
    const matchesPerMatchup = 6;
    const targetScore = 3;

    const wins: Record<string, number> = {};
    const played: Record<string, number> = {};
    for (const e of zoo) { wins[e.name] = 0; played[e.name] = 0; }

    console.log(`\n  Tournament: ${zoo.length} models, ${matchups.length} matchups, ${matchesPerMatchup} games each`);
    console.log(`  Models: ${zoo.map((e) => e.name).join(", ")}\n`);

    for (const [a, b, c] of matchups) {
      const trio = [a, b, c] as const;
      const matchWins = [0, 0, 0];

      for (let g = 0; g < matchesPerMatchup; g++) {
        const h = await create3pGame(targetScore);
        handles.push(h);

        const pickers: [Picker, Picker, Picker] = [trio[0].picker, trio[1].picker, trio[2].picker];
        const scores = await play3pMatch(pickers, h.bots[0]!, h.bots);
        const maxScore = Math.max(...scores);
        for (let s = 0; s < 3; s++) {
          if (scores[s] === maxScore) matchWins[s]++;
        }
      }

      for (let s = 0; s < 3; s++) {
        wins[trio[s].name] += matchWins[s];
        played[trio[s].name] += matchesPerMatchup;
      }

      const tag = trio.map((e, i) => `${e.name}=${matchWins[i]}`).join(" ");
      console.log(`  ${tag}`);
    }

    const standings = zoo
      .map((e) => ({
        name: e.name,
        wins: wins[e.name]!,
        played: played[e.name]!,
        rate: played[e.name]! > 0 ? wins[e.name]! / played[e.name]! : 0,
      }))
      .sort((a, b) => b.rate - a.rate);

    console.log("\n  === STANDINGS ===");
    console.log("  " + "Model".padEnd(22) + "Wins".padStart(6) + "Played".padStart(8) + "Win %".padStart(8));
    console.log("  " + "-".repeat(44));
    for (const s of standings) {
      console.log(
        "  " +
        s.name.padEnd(22) +
        String(s.wins).padStart(6) +
        String(s.played).padStart(8) +
        `${(s.rate * 100).toFixed(1)}%`.padStart(8),
      );
    }
    console.log("");

    const randomRate = standings.find((s) => s.name === "random")?.rate ?? 1;
    const bestTrained = standings.find((s) => s.name !== "random");
    expect(bestTrained).toBeDefined();
    expect(bestTrained!.rate).toBeGreaterThan(randomRate);
  }, 300_000);
});
