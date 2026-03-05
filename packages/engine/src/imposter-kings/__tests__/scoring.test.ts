import { describe, it, expect } from "vitest";

import { deal } from "../deal.js";
import { regulationDeck } from "../card.js";
import { legalActions, apply, isTerminal } from "../rules.js";
import { isKingFaceUp } from "../selectors.js";
import { playerZones } from "../state.js";
import { roundScore } from "../scoring.js";
import type { IKSetupAction } from "../actions.js";
import type { IKState } from "../state.js";
import type { PlayerId } from "@imposter-zero/types";

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

const hasResources = (state: IKState, player: PlayerId): boolean => {
  const zones = playerZones(state, player);
  return zones.hand.length > 0 || zones.successor !== null;
};

describe("roundScore", () => {
  it("returns all zeros for non-terminal state", () => {
    const state = toPlayPhase(2);
    expect(roundScore(state)).toEqual([0, 0]);
  });

  describe("2-player scoring", () => {
    it("winner gets at least 1 point", () => {
      const terminal = playToTerminal(2, 42);
      const scores = roundScore(terminal);
      const stuck = terminal.activePlayer;
      const winner = ((stuck - 1 + 2) % 2) as PlayerId;
      expect(scores[winner]).toBeGreaterThanOrEqual(1);
      expect(scores[stuck]).toBe(0);
    });

    it("winner gets +1 for face-up king", () => {
      for (const seed of [42, 99, 137, 200, 301]) {
        const terminal = playToTerminal(2, seed);
        if (!isTerminal(terminal)) continue;

        const stuck = terminal.activePlayer;
        const winner = ((stuck - 1 + 2) % 2) as PlayerId;
        const scores = roundScore(terminal);

        let expected = 1;
        if (isKingFaceUp(terminal, winner)) expected += 1;
        if (hasResources(terminal, stuck)) expected += 1;

        expect(scores[winner]).toBe(expected);
        expect(scores[stuck]).toBe(0);
      }
    });

    it("scores are non-negative", () => {
      for (const seed of [42, 55, 77, 100, 150]) {
        const terminal = playToTerminal(2, seed);
        if (!isTerminal(terminal)) continue;
        for (const s of roundScore(terminal)) {
          expect(s).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("max possible 2p score is 3", () => {
      for (const seed of [42, 55, 77, 100, 150, 200, 300]) {
        const terminal = playToTerminal(2, seed);
        if (!isTerminal(terminal)) continue;
        const scores = roundScore(terminal);
        for (const s of scores) {
          expect(s).toBeLessThanOrEqual(3);
        }
      }
    });
  });

  describe("3-player scoring", () => {
    it("winner gets at least 1 point, stuck gets 0", () => {
      const terminal = playToTerminal(3, 42);
      const stuck = terminal.activePlayer;
      const winner = ((stuck - 1 + 3) % 3) as PlayerId;
      const scores = roundScore(terminal);

      expect(scores[winner]).toBeGreaterThanOrEqual(1);
      expect(scores[stuck]).toBe(0);
    });

    it("second place gets exactly 1 point", () => {
      for (const seed of [42, 55, 77, 99, 150]) {
        const terminal = playToTerminal(3, seed);
        if (!isTerminal(terminal)) continue;

        const stuck = terminal.activePlayer;
        const winner = ((stuck - 1 + 3) % 3) as PlayerId;
        const second = [0, 1, 2].find((p) => p !== winner && p !== stuck)!;
        const scores = roundScore(terminal);

        expect(scores[second]).toBe(1);
      }
    });

    it("winner bonus for opponents with resources", () => {
      for (const seed of [42, 99, 137, 200, 301]) {
        const terminal = playToTerminal(3, seed);
        if (!isTerminal(terminal)) continue;

        const stuck = terminal.activePlayer;
        const winner = ((stuck - 1 + 3) % 3) as PlayerId;
        const scores = roundScore(terminal);

        let expected = 1;
        if (isKingFaceUp(terminal, winner)) expected += 1;
        for (let p = 0; p < 3; p++) {
          if (p !== winner && hasResources(terminal, p)) expected += 1;
        }

        expect(scores[winner]).toBe(expected);
      }
    });

    it("scores length matches player count", () => {
      const terminal = playToTerminal(3, 42);
      expect(roundScore(terminal)).toHaveLength(3);
    });
  });

  describe("4-player scoring (2v2)", () => {
    it("team members get equal scores", () => {
      for (const seed of [42, 55, 77, 99, 150]) {
        const terminal = playToTerminal(4, seed);
        if (!isTerminal(terminal)) continue;

        const scores = roundScore(terminal);
        expect(scores[0]).toBe(scores[2]); // team 0
        expect(scores[1]).toBe(scores[3]); // team 1
      }
    });

    it("winning team gets at least 1 point each", () => {
      const terminal = playToTerminal(4, 42);
      const stuck = terminal.activePlayer;
      const winner = ((stuck - 1 + 4) % 4) as PlayerId;
      const scores = roundScore(terminal);

      expect(scores[winner]).toBeGreaterThanOrEqual(1);
    });

    it("losing team gets 0", () => {
      for (const seed of [42, 55, 77, 99, 150]) {
        const terminal = playToTerminal(4, seed);
        if (!isTerminal(terminal)) continue;

        const stuck = terminal.activePlayer;
        const winner = ((stuck - 1 + 4) % 4) as PlayerId;
        const winningTeam = winner % 2;
        const scores = roundScore(terminal);

        if (winningTeam === 0) {
          expect(scores[1]).toBe(0);
          expect(scores[3]).toBe(0);
        } else {
          expect(scores[0]).toBe(0);
          expect(scores[2]).toBe(0);
        }
      }
    });

    it("bonus for face-up kings on winning team", () => {
      for (const seed of [42, 55, 77, 99, 150, 200, 301]) {
        const terminal = playToTerminal(4, seed);
        if (!isTerminal(terminal)) continue;

        const stuck = terminal.activePlayer;
        const winner = ((stuck - 1 + 4) % 4) as PlayerId;
        const winningTeam = winner % 2 === 0 ? 0 : 1;
        const [m1, m2]: [PlayerId, PlayerId] =
          winningTeam === 0 ? [0, 2] : [1, 3];
        const scores = roundScore(terminal);

        const faceUpKings =
          (isKingFaceUp(terminal, m1) ? 1 : 0) +
          (isKingFaceUp(terminal, m2) ? 1 : 0);

        expect(scores[m1]).toBe(1 + faceUpKings);
        expect(scores[m2]).toBe(1 + faceUpKings);
      }
    });

    it("max 4p team score is 3 (1 base + 2 kings)", () => {
      for (const seed of [42, 55, 77, 99, 150]) {
        const terminal = playToTerminal(4, seed);
        if (!isTerminal(terminal)) continue;
        for (const s of roundScore(terminal)) {
          expect(s).toBeLessThanOrEqual(3);
        }
      }
    });

    it("scores length matches player count", () => {
      const terminal = playToTerminal(4, 42);
      expect(roundScore(terminal)).toHaveLength(4);
    });
  });
});
