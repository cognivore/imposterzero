import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ImposterKingsGame } from "@imposter-zero/engine";
import {
  type BotStrategy,
  type TabularPolicy,
  type NeuralPolicy,
  RandomStrategy,
  createTabularStrategy,
  createNeuralStrategy,
  createCompositeStrategy,
  createEffectsAwareStrategy,
  modelHashName,
} from "./bot-player.js";
import { startServer } from "./ws-server.js";

const parseIntOr = (env: string | undefined, fallback: number): number => {
  if (env === undefined || env === "") return fallback;
  const n = parseInt(env, 10);
  return Number.isNaN(n) ? fallback : n;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const policyPaths = (name: string): readonly string[] => [
  process.env[`BOT_POLICY_${name.toUpperCase()}`],
  resolve(__dirname, `../../../training/${name}`),
  resolve(__dirname, `../../training/${name}`),
  resolve(process.cwd(), `training/${name}`),
].filter((p): p is string => p !== undefined);

const tryLoadJson = <T>(candidates: readonly string[], label: string): { data: T; path: string } | null => {
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        return { data: JSON.parse(readFileSync(path, "utf-8")) as T, path };
      } catch (e) {
        console.error(`[bot] Failed to parse ${label} at ${path}:`, e instanceof Error ? e.message : e);
      }
    }
  }
  return null;
};

const loadBotStrategy = (): { strategy: BotStrategy; policyLabel: string } => {
  const strategies = new Map<number, BotStrategy>();
  let policyLabel = "random";

  const tab2p =
    tryLoadJson<TabularPolicy>(policyPaths("policy_2p_8h.json"), "2p tabular (8h)") ??
    tryLoadJson<TabularPolicy>(policyPaths("policy.json"), "2p tabular");
  if (tab2p) {
    const s = tab2p.data.metadata?.info_states ?? Object.keys(tab2p.data.policy).length;
    const it = tab2p.data.metadata?.iterations ?? 0;
    const ver = tab2p.data.metadata?.game_version ?? "unknown";
    policyLabel = `mccfr-${ver}-${it}-${s}`;
    console.log(`[bot] 2p tabular: ${s} info states, ${it.toLocaleString()} iterations (${tab2p.path})`);
    strategies.set(2, createTabularStrategy(tab2p.data));
  }

  const nn3p = tryLoadJson<NeuralPolicy>(policyPaths("policy_3p.json"), "3p neural");
  if (nn3p) {
    const { input_size, hidden_size, output_size } = nn3p.data.metadata;
    const wr = (nn3p.data.metadata.win_rate_vs_random as number | undefined) ?? 0;
    console.log(`[bot] 3p neural: ${input_size}->${hidden_size}->${output_size} MLP, wr=${(wr * 100).toFixed(1)}% (${nn3p.path})`);
    strategies.set(3, createNeuralStrategy(nn3p.data));
  }

  if (strategies.size === 0) {
    console.warn("[bot] WARNING: No trained bot policies found — bots will play randomly.");
    console.warn("[bot] To train:");
    console.warn("[bot]   2p: python training/train.py --output training/policy.json");
    console.warn("[bot]   3p: python training/train_neural.py --output training/policy_3p.json");
    return { strategy: RandomStrategy, policyLabel };
  }

  const missing = [2, 3].filter((n) => !strategies.has(n));
  if (missing.length > 0) {
    console.log(`[bot] No policy for ${missing.map((n) => `${n}p`).join(", ")} — will use random`);
  }

  return { strategy: createCompositeStrategy(strategies), policyLabel };
};

const port = parseIntOr(process.env.PORT, 30588);
const targetScore = parseIntOr(process.env.TARGET_SCORE, 7);
const replayDir = process.env.REPLAY_DIR ?? join(process.cwd(), "data", "replays");
const { strategy: baseStrategy, policyLabel } = loadBotStrategy();
const botStrategy = createEffectsAwareStrategy(baseStrategy);
const botModelName = modelHashName(policyLabel);

const handle = startServer(ImposterKingsGame, {
  port,
  targetScore,
  autoAdvanceScoring: false,
  botDelayMs: 400,
  botStrategy,
  replayDir,
  botModelName,
});

handle.ready.then(
  () => {
    console.log(`Imposter Kings server listening on ws://localhost:${handle.port}`);
    console.log(`[bot] Model name: "${botModelName}" (${policyLabel})`);
    console.log(`[replay] Saving replays to ${replayDir}`);
  },
  (e: unknown) => console.error("Server failed to start:", e),
);
