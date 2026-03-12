import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { deal } from "../deal.js";
import { regulationDeck } from "../card.js";
import { legalActions, apply, isTerminal } from "../rules.js";
import type { IKState } from "../state.js";

const seededRandom = (seed: number) => {
  let s = seed;
  return (): number => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const collectAllCardIds = (state: IKState): number[] => {
  const ids: number[] = [];
  for (const p of state.players) {
    ids.push(...p.hand.map((c) => c.id));
    ids.push(p.king.card.id);
    if (p.successor) ids.push(p.successor.card.id);
    if (p.dungeon) ids.push(p.dungeon.card.id);
    if (p.squire) ids.push(p.squire.card.id);
    ids.push(...p.antechamber.map((c) => c.id));
    ids.push(...p.parting.map((c) => c.id));
    ids.push(...p.army.map((c) => c.id));
    ids.push(...p.exhausted.map((c) => c.id));
    ids.push(...p.recruitDiscard.map((c) => c.id));
  }
  for (const e of state.shared.court) ids.push(e.card.id);
  if (state.shared.accused) ids.push(state.shared.accused.id);
  if (state.shared.forgotten) ids.push(state.shared.forgotten.card.id);
  ids.push(...state.shared.condemned.map((e) => e.card.id));
  return ids;
};

const validateInvariants = (state: IKState): string[] => {
  const violations: string[] = [];

  const ids = collectAllCardIds(state);
  if (new Set(ids).size !== ids.length) {
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    violations.push(`Duplicate card IDs: [${[...new Set(dupes)].join(", ")}]`);
  }

  for (let p = 0; p < state.numPlayers; p++) {
    if (state.players[p]!.hand.length < 0) {
      violations.push(`Player ${p} has negative hand size`);
    }
  }

  if (state.numPlayers !== state.players.length) {
    violations.push(
      `numPlayers (${state.numPlayers}) !== players.length (${state.players.length})`,
    );
  }

  for (let p = 0; p < state.numPlayers; p++) {
    if (state.eliminatedPlayers.includes(p as import("@imposter-zero/types").PlayerId)) continue;
    const zones = state.players[p]!;
    const hasSuccessor = zones.successor !== null;
    const hasDungeon = zones.dungeon !== null;
    const kingDown = zones.king.face === "down";
    if (hasSuccessor !== hasDungeon && !kingDown && state.phase !== "resolving" && state.phase !== "end_of_turn") {
      violations.push(`Player ${p}: successor/dungeon mismatch (${hasSuccessor}/${hasDungeon})`);
    }
  }

  return violations;
};

describe("state invariants", () => {
  describe("after deal", () => {
    it.each([2, 3, 4])("all invariants hold for %d-player deal", (n) => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100000 }), (seed) => {
          const state = deal(regulationDeck(n), n, seededRandom(seed));
          const violations = validateInvariants(state);
          expect(violations).toEqual([]);
        }),
        { numRuns: 50 },
      );
    });
  });

  describe("through random playout", () => {
    it.each([2, 3, 4])("invariants hold at every step for %d players", (n) => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100000 }), (seed) => {
          const rng = seededRandom(seed);
          let state = deal(regulationDeck(n), n, rng);
          let step = 0;

          while (!isTerminal(state) && step < 200) {
            const violations = validateInvariants(state);
            if (violations.length > 0) {
              throw new Error(`Step ${step}: ${violations.join("; ")}`);
            }

            const legal = legalActions(state);
            if (legal.length === 0) break;
            const actionIdx = Math.floor(rng() * legal.length);
            state = apply(state, legal[actionIdx]!);
            step++;
          }

          const finalViolations = validateInvariants(state);
          expect(finalViolations).toEqual([]);
        }),
        { numRuns: 30 },
      );
    });
  });

  describe("card conservation through playout", () => {
    it.each([2, 3, 4])("total card count is constant for %d players", (n) => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100000 }), (seed) => {
          const rng = seededRandom(seed);
          let state = deal(regulationDeck(n), n, rng);
          const initialCount = collectAllCardIds(state).length;
          let step = 0;

          while (!isTerminal(state) && step < 200) {
            const legal = legalActions(state);
            if (legal.length === 0) break;
            const actionIdx = Math.floor(rng() * legal.length);
            state = apply(state, legal[actionIdx]!);
            step++;

            const currentCount = collectAllCardIds(state).length;
            if (currentCount !== initialCount) {
              throw new Error(
                `Step ${step}: card count changed from ${initialCount} to ${currentCount}`,
              );
            }
          }
        }),
        { numRuns: 30 },
      );
    });
  });

  describe("game termination", () => {
    it.each([2, 3, 4])("random playout always terminates for %d players", (n) => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100000 }), (seed) => {
          const rng = seededRandom(seed);
          let state = deal(regulationDeck(n), n, rng);
          let step = 0;

          while (!isTerminal(state) && step < 200) {
            const legal = legalActions(state);
            if (legal.length === 0) break;
            const actionIdx = Math.floor(rng() * legal.length);
            state = apply(state, legal[actionIdx]!);
            step++;
          }

          expect(isTerminal(state)).toBe(true);
          expect(step).toBeLessThan(200);
        }),
        { numRuns: 50 },
      );
    });
  });
});
