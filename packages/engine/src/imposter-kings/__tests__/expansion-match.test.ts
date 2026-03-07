import { describe, it, expect } from "vitest";
import { TERMINAL, type ActivePlayer, type PlayerId } from "@imposter-zero/types";

import {
  type IKState,
  type IKAction,
  legalActions,
  apply,
  isTerminal,
  currentPlayer,
  BASE_ARMY_KINDS,
} from "../index.js";
import {
  buildPlayerArmies,
  createExpansionRound,
  exhaustArmyCardsPostRound,
  playExpandedMatch,
  type PlayerArmy,
} from "../expansion-match.js";
import { REGULATION_2P_EXPANSION } from "../config.js";

const seededRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
};

const randomSelect = (
  rng: () => number,
) => (
  _state: IKState,
  legal: ReadonlyArray<IKAction>,
  _player: ActivePlayer,
): IKAction => legal[Math.floor(rng() * legal.length)]!;

describe("Expansion Round (2p with Army)", () => {
  it("creates round with correct hand/army sizes", () => {
    const sigs = [
      ["Aegis", "Exile", "Ancestor"] as const,
      ["Stranger", "Conspiracist", "Flagbearer"] as const,
    ];
    const armies = buildPlayerArmies(REGULATION_2P_EXPANSION, sigs);
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));

    expect(state.players[0]!.hand.length).toBe(9);
    expect(state.players[1]!.hand.length).toBe(9);
    expect(state.players[0]!.army.length).toBe(8);
    expect(state.players[1]!.army.length).toBe(8);
    expect(state.phase).toBe("crown");
  });

  it("random play with army completes without errors (5 games)", () => {
    const simpleArmies: ReadonlyArray<PlayerArmy> = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
    ];

    for (let i = 0; i < 5; i++) {
      const rng = seededRng(i * 7919);
      const state = createExpansionRound(REGULATION_2P_EXPANSION, simpleArmies, 0, rng);
      const select = randomSelect(rng);

      let s = state;
      let steps = 0;
      while (!isTerminal(s) && steps < 500) {
        const legal = legalActions(s);
        if (legal.length === 0) break;
        const action = select(s, legal, currentPlayer(s));
        s = apply(s, action);
        steps++;
      }

      expect(isTerminal(s)).toBe(true);
    }
  });
});

describe("Expansion Match (multi-round)", () => {
  it("plays to target score with army persistence", () => {
    const simpleArmies: ReadonlyArray<PlayerArmy> = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
    ];
    const rng = seededRng(123);

    const result = playExpandedMatch(
      REGULATION_2P_EXPANSION,
      simpleArmies,
      randomSelect(rng),
      0,
      3,
      50,
      rng,
    );

    expect(result.match.roundsPlayed).toBeGreaterThan(0);
    expect(result.match.scores.some((s) => s >= 3)).toBe(true);
    expect(result.roundResults.length).toBe(result.match.roundsPlayed);
  });
});

describe("Army exhaustion across rounds", () => {
  it("exhaustArmyCardsPostRound preserves exhausted state", () => {
    const armies: ReadonlyArray<PlayerArmy> = [
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: BASE_ARMY_KINDS.slice(3, 5) },
      { available: BASE_ARMY_KINDS.slice(0, 3), exhausted: [] },
    ];
    const state = createExpansionRound(REGULATION_2P_EXPANSION, armies, 0, seededRng(42));

    const result = exhaustArmyCardsPostRound(state, armies);
    expect(result[0]!.exhausted.length).toBe(2);
    expect(result[1]!.exhausted.length).toBe(0);
  });
});
