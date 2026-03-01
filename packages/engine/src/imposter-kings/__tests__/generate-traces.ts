/**
 * Generates golden traces for cross-language parity testing.
 * Run via: npx tsx packages/engine/src/imposter-kings/__tests__/generate-traces.ts
 * Outputs JSON fixtures to training/tests/fixtures/
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { regulationDeck } from "../card.js";
import { deal } from "../deal.js";
import { legalActions, apply, isTerminal, currentPlayer, returns } from "../rules.js";
import { encodeAction, type ActionCodecConfig } from "../actions.js";
import { playerZones } from "../state.js";
import { throneValue } from "../selectors.js";
import type { IKState } from "../state.js";

const seededRandom = (seed: number) => {
  let s = seed;
  return (): number => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

interface TraceStep {
  activePlayer: number;
  phase: string;
  legalActionCount: number;
  encodedAction: number;
  throneValue: number;
  courtSize: number;
  handSizes: number[];
}

interface Trace {
  seed: number;
  numPlayers: number;
  deckSize: number;
  maxCardId: number;
  initialHands: number[][];
  initialHandValues: number[][];
  accused: number | null;
  accusedValue: number | null;
  forgotten: number | null;
  steps: TraceStep[];
  terminalReturns: number[];
  totalSteps: number;
}

const generateTrace = (numPlayers: number, seed: number): Trace => {
  const rng = seededRandom(seed);
  const kinds = regulationDeck(numPlayers);
  const state = deal(kinds, numPlayers, rng);
  const deckSize = kinds.length;
  const maxCardId = deckSize + numPlayers - 1;
  const codecConfig: ActionCodecConfig = { maxCardId };

  const initialHands = state.players.map((p) => p.hand.map((c) => c.id));
  const initialHandValues = state.players.map((p) => p.hand.map((c) => c.kind.props.value));
  const accused = state.shared.accused?.id ?? null;
  const accusedValue = state.shared.accused?.kind.props.value ?? null;
  const forgotten = state.shared.forgotten?.card.id ?? null;

  const steps: TraceStep[] = [];
  let current: IKState = state;

  while (!isTerminal(current)) {
    const legal = legalActions(current);
    if (legal.length === 0) break;
    const action = legal[0]!;
    const encoded = encodeAction(action, codecConfig);

    steps.push({
      activePlayer: current.activePlayer,
      phase: current.phase,
      legalActionCount: legal.length,
      encodedAction: encoded,
      throneValue: throneValue(current),
      courtSize: current.shared.court.length,
      handSizes: current.players.map((p) => p.hand.length),
    });

    current = apply(current, action);
  }

  return {
    seed,
    numPlayers,
    deckSize,
    maxCardId,
    initialHands,
    initialHandValues,
    accused,
    accusedValue,
    forgotten,
    steps,
    terminalReturns: [...returns(current)],
    totalSteps: steps.length,
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixtureDir = join(__dirname, "../../../../../training/tests/fixtures");

mkdirSync(fixtureDir, { recursive: true });

const traces = [
  generateTrace(2, 42),
  generateTrace(2, 123),
  generateTrace(2, 999),
];

for (const trace of traces) {
  const filename = `trace_${trace.numPlayers}p_seed${trace.seed}.json`;
  writeFileSync(join(fixtureDir, filename), JSON.stringify(trace, null, 2) + "\n");
  console.log(`Generated ${filename}: ${trace.totalSteps} steps`);
}

console.log("Done.");
