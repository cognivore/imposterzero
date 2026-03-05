import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ImposterKingsGame } from "@imposter-zero/engine";
import { type BotStrategy, RandomStrategy, createTabularStrategy, type TabularPolicy } from "./bot-player.js";
import { startServer } from "./ws-server.js";

const parseIntOr = (env: string | undefined, fallback: number): number => {
  if (env === undefined || env === "") return fallback;
  const n = parseInt(env, 10);
  return Number.isNaN(n) ? fallback : n;
};

type StrategyResult =
  | { readonly kind: "tabular"; readonly strategy: BotStrategy; readonly path: string; readonly states: number; readonly iterations: number }
  | { readonly kind: "random"; readonly strategy: BotStrategy; readonly searched: readonly string[] };

const loadBotStrategy = (): StrategyResult => {
  const envPath = process.env.BOT_POLICY_PATH;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const candidates = [
    envPath,
    resolve(__dirname, "../../../training/policy.json"),
    resolve(__dirname, "../../training/policy.json"),
    resolve(process.cwd(), "training/policy.json"),
  ].filter((p): p is string => p !== undefined);

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf-8");
        const policy = JSON.parse(raw) as TabularPolicy;
        const states = policy.metadata?.info_states ?? Object.keys(policy.policy).length;
        const iterations = policy.metadata?.iterations ?? 0;
        return { kind: "tabular", strategy: createTabularStrategy(policy), path, states, iterations };
      } catch (e) {
        console.error(`[bot] Failed to parse policy at ${path}:`, e instanceof Error ? e.message : e);
      }
    }
  }

  return { kind: "random", strategy: RandomStrategy, searched: candidates };
};

const port = parseIntOr(process.env.PORT, 30588);
const targetScore = parseIntOr(process.env.TARGET_SCORE, 7);
const result = loadBotStrategy();

if (result.kind === "tabular") {
  console.log(`[bot] Trained policy loaded: ${result.states} info states, ${result.iterations.toLocaleString()} iterations`);
  console.log(`[bot] Source: ${result.path}`);
} else {
  console.warn("[bot] WARNING: No trained bot policy found — bots will play randomly.");
  console.warn("[bot] Searched:");
  for (const p of result.searched) console.warn(`[bot]   - ${p}`);
  console.warn("[bot]");
  console.warn("[bot] To train a policy, run:");
  console.warn("[bot]   python training/train.py --iterations 2000000 --output training/policy.json");
  console.warn("[bot]");
  console.warn("[bot] Or set BOT_POLICY_PATH to a trained policy file.");
}

const handle = startServer(ImposterKingsGame, {
  port,
  targetScore,
  autoAdvanceScoring: false,
  botDelayMs: 400,
  botStrategy: result.strategy,
});

handle.ready.then(
  () => console.log(`Imposter Kings server listening on ws://localhost:${handle.port}`),
  (e: unknown) => console.error("Server failed to start:", e),
);
