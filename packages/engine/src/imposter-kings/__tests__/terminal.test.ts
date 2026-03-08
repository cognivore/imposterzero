import { describe, it, expect } from "vitest";

import { deal } from "../deal.js";
import { regulationDeck } from "../card.js";
import { legalActions, apply, isTerminal, currentPlayer, returns } from "../rules.js";
import { TERMINAL } from "@imposter-zero/types";
import type { IKSetupAction } from "../actions.js";
import type { IKState } from "../state.js";

const seededRandom = (seed: number) => {
  let s = seed;
  return (): number => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const makeState = (numPlayers: number, seed = 42): IKState => {
  const dealt = deal(regulationDeck(numPlayers), numPlayers, seededRandom(seed));
  return apply(dealt, { kind: "crown", firstPlayer: dealt.activePlayer });
};

const firstCommit = (state: IKState): IKSetupAction =>
  legalActions(state).find((a): a is IKSetupAction => a.kind === "commit")!;

const toPlayPhase = (numPlayers: number, seed = 42): IKState => {
  let state = makeState(numPlayers, seed);
  for (let i = 0; i < numPlayers; i++) {
    state = apply(state, firstCommit(state));
  }
  return state;
};

const playToTerminal = (numPlayers: number, seed: number): IKState => {
  let state = toPlayPhase(numPlayers, seed);
  let safety = 0;
  while (!isTerminal(state) && safety < 200) {
    const legal = legalActions(state);
    if (legal.length === 0) break;
    state = apply(state, legal[0]!);
    safety++;
  }
  return state;
};

describe("terminal detection", () => {
  it("setup phase is never terminal", () => {
    const state = makeState(2);
    expect(isTerminal(state)).toBe(false);
  });

  it("play phase with legal actions is not terminal", () => {
    const state = toPlayPhase(2);
    expect(legalActions(state).length).toBeGreaterThan(0);
    expect(isTerminal(state)).toBe(false);
  });

  it("play phase with no legal actions is terminal", () => {
    const terminal = playToTerminal(2, 42);
    expect(isTerminal(terminal)).toBe(true);
    expect(legalActions(terminal)).toHaveLength(0);
  });
});

describe("currentPlayer", () => {
  it("returns active player during setup", () => {
    const state = makeState(2);
    expect(currentPlayer(state)).toBe(0);
  });

  it("returns active player during play", () => {
    const state = toPlayPhase(2);
    expect(currentPlayer(state)).toBe(state.activePlayer);
  });

  it("returns TERMINAL when game is over", () => {
    const terminal = playToTerminal(2, 42);
    expect(currentPlayer(terminal)).toBe(TERMINAL);
  });
});

describe("returns", () => {
  it("returns all zeros for non-terminal state", () => {
    const state = toPlayPhase(2);
    expect(returns(state)).toEqual([0, 0]);
  });

  it("sums to zero (zero-sum game)", () => {
    const terminal = playToTerminal(2, 42);
    const r = returns(terminal);
    expect(r.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("has exactly one winner (+1) and one loser (-1) for 2 players", () => {
    const terminal = playToTerminal(2, 42);
    const r = returns(terminal);
    expect(r).toHaveLength(2);
    expect(r.filter((v) => v === 1)).toHaveLength(1);
    expect(r.filter((v) => v === -1)).toHaveLength(1);
  });

  it("winner is the player before the stuck player", () => {
    const terminal = playToTerminal(2, 42);
    const r = returns(terminal);
    const stuck = terminal.activePlayer;
    const winner = (stuck - 1 + terminal.numPlayers) % terminal.numPlayers;
    expect(r[winner]).toBe(1);
    expect(r[stuck]).toBe(-1);
  });

  it.each([2, 3, 4])("returns length matches numPlayers (%d)", (n) => {
    const terminal = playToTerminal(n, 42);
    expect(returns(terminal)).toHaveLength(n);
  });

  it("non-involved players get 0 in multiplayer", () => {
    const terminal = playToTerminal(3, 42);
    const r = returns(terminal);
    const stuck = terminal.forcedLoser ?? terminal.activePlayer;
    let winner = ((stuck - 1 + terminal.numPlayers) % terminal.numPlayers) as import("@imposter-zero/types").PlayerId;
    for (let i = 0; i < terminal.numPlayers; i++) {
      if (!terminal.eliminatedPlayers.includes(winner)) break;
      winner = ((winner - 1 + terminal.numPlayers) % terminal.numPlayers) as import("@imposter-zero/types").PlayerId;
    }
    for (let p = 0; p < terminal.numPlayers; p++) {
      if (p !== stuck && p !== winner) {
        expect(r[p]).toBe(0);
      }
    }
  });
});
