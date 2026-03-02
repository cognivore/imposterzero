import { describe, it, expect } from "vitest";

import {
  createMatch,
  applyRoundResult,
  matchWinners,
  isMatchOver,
  playMatch,
} from "../match.js";
import { createImposterKingsGame } from "../game.js";
import { randomSelector } from "../../runtime.js";
import type { PlayerId } from "@imposter-zero/types";

describe("createMatch", () => {
  it("initializes with zero scores", () => {
    const m = createMatch(3);
    expect(m.scores).toEqual([0, 0, 0]);
    expect(m.roundsPlayed).toBe(0);
    expect(m.targetScore).toBe(7);
    expect(m.numPlayers).toBe(3);
  });

  it("accepts custom target score", () => {
    const m = createMatch(2, 5);
    expect(m.targetScore).toBe(5);
  });
});

describe("applyRoundResult", () => {
  it("accumulates scores across rounds", () => {
    let m = createMatch(2);
    m = applyRoundResult(m, [2, 0]);
    expect(m.scores).toEqual([2, 0]);
    expect(m.roundsPlayed).toBe(1);

    m = applyRoundResult(m, [0, 3]);
    expect(m.scores).toEqual([2, 3]);
    expect(m.roundsPlayed).toBe(2);
  });

  it("does not mutate the original", () => {
    const m1 = createMatch(2);
    const m2 = applyRoundResult(m1, [1, 0]);
    expect(m1.scores).toEqual([0, 0]);
    expect(m1.roundsPlayed).toBe(0);
    expect(m2.scores).toEqual([1, 0]);
  });
});

describe("matchWinners", () => {
  it("returns empty when nobody reached target", () => {
    const m = applyRoundResult(createMatch(2, 7), [3, 2]);
    expect(matchWinners(m)).toEqual([]);
  });

  it("returns player who reached target", () => {
    let m = createMatch(2, 3);
    m = applyRoundResult(m, [3, 1]);
    expect(matchWinners(m)).toEqual([0 as PlayerId]);
  });

  it("returns multiple winners if tied at target", () => {
    let m = createMatch(2, 3);
    m = applyRoundResult(m, [3, 3]);
    expect(matchWinners(m)).toEqual([0 as PlayerId, 1 as PlayerId]);
  });

  it("returns player who exceeded target", () => {
    let m = createMatch(2, 3);
    m = applyRoundResult(m, [5, 0]);
    expect(matchWinners(m)).toEqual([0 as PlayerId]);
  });
});

describe("isMatchOver", () => {
  it("false when scores below target", () => {
    const m = createMatch(2, 7);
    expect(isMatchOver(m)).toBe(false);
  });

  it("true when someone reaches target", () => {
    let m = createMatch(2, 2);
    m = applyRoundResult(m, [2, 0]);
    expect(isMatchOver(m)).toBe(true);
  });
});

describe("playMatch", () => {
  it.each([2, 3, 4])("terminates with a winner for %d players", (n) => {
    const game = createImposterKingsGame();
    const result = playMatch(game, n, randomSelector(), 5, 200);
    expect(isMatchOver(result.match)).toBe(true);
    expect(matchWinners(result.match).length).toBeGreaterThanOrEqual(1);
  });

  it("round results sum to final scores", () => {
    const game = createImposterKingsGame();
    const result = playMatch(game, 2, randomSelector(), 5, 200);
    const totals = result.roundResults.reduce(
      (acc, round) => acc.map((s, i) => s + round[i]!),
      [0, 0],
    );
    expect(result.match.scores).toEqual(totals);
  });

  it("rounds played matches round results length", () => {
    const game = createImposterKingsGame();
    const result = playMatch(game, 2, randomSelector(), 5, 200);
    expect(result.match.roundsPlayed).toBe(result.roundResults.length);
  });

  it("respects maxRounds safety limit", () => {
    const game = createImposterKingsGame();
    const result = playMatch(game, 2, randomSelector(), 9999, 3);
    expect(result.match.roundsPlayed).toBeLessThanOrEqual(3);
  });
});
