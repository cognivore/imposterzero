import { describe, it, expect } from "vitest";

import { deal } from "../deal.js";
import { regulationDeck } from "../card.js";
import { legalActions, apply, applySafe, isTerminal } from "../rules.js";
import { playerZones, nextPlayer } from "../state.js";
import { hasCommittedSetup, allPlayersCommittedSetup } from "../selectors.js";
import type { IKAction, IKSetupAction } from "../actions.js";
import type { IKState } from "../state.js";

const seededRandom = (seed: number) => {
  let s = seed;
  return (): number => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const makeState = (numPlayers: number, seed = 42): IKState =>
  deal(regulationDeck(numPlayers), numPlayers, seededRandom(seed));

const firstCommit = (state: IKState): IKSetupAction => {
  const actions = legalActions(state);
  expect(actions.length).toBeGreaterThan(0);
  const commit = actions.find((a): a is IKSetupAction => a.kind === "commit");
  expect(commit).toBeDefined();
  return commit!;
};

const commitAllPlayers = (initial: IKState): IKState => {
  let state = initial;
  for (let i = 0; i < initial.numPlayers; i++) {
    const commit = firstCommit(state);
    state = apply(state, commit);
  }
  return state;
};

describe("setup phase", () => {
  describe("legal commit actions", () => {
    it("generates commit actions for all hand pairs", () => {
      const state = makeState(2);
      const actions = legalActions(state);
      const hand = playerZones(state, 0).hand;
      const expectedCount = hand.length * (hand.length - 1);
      expect(actions).toHaveLength(expectedCount);
      expect(actions.every((a) => a.kind === "commit")).toBe(true);
    });

    it("all commits have distinct successor and dungeon", () => {
      const state = makeState(2);
      const actions = legalActions(state) as ReadonlyArray<IKSetupAction>;
      for (const a of actions) {
        expect(a.successorId).not.toBe(a.dungeonId);
      }
    });

    it("all commit card IDs reference cards in hand", () => {
      const state = makeState(3);
      const hand = playerZones(state, 0).hand;
      const handIds = new Set(hand.map((c) => c.id));
      const actions = legalActions(state) as ReadonlyArray<IKSetupAction>;
      for (const a of actions) {
        expect(handIds.has(a.successorId)).toBe(true);
        expect(handIds.has(a.dungeonId)).toBe(true);
      }
    });
  });

  describe("applying commit", () => {
    it("sets successor and dungeon", () => {
      const state = makeState(2);
      const commit = firstCommit(state);
      const next = apply(state, commit);
      const zones = playerZones(next, 0);
      expect(zones.successor).not.toBeNull();
      expect(zones.dungeon).not.toBeNull();
      expect(zones.successor!.card.id).toBe(commit.successorId);
      expect(zones.dungeon!.card.id).toBe(commit.dungeonId);
    });

    it("removes committed cards from hand", () => {
      const state = makeState(2);
      const commit = firstCommit(state);
      const handBefore = playerZones(state, 0).hand.length;
      const next = apply(state, commit);
      const handAfter = playerZones(next, 0).hand.length;
      expect(handAfter).toBe(handBefore - 2);
    });

    it("advances active player", () => {
      const state = makeState(2);
      const commit = firstCommit(state);
      const next = apply(state, commit);
      expect(next.activePlayer).toBe(nextPlayer(state));
    });

    it("increments turn count", () => {
      const state = makeState(2);
      const commit = firstCommit(state);
      const next = apply(state, commit);
      expect(next.turnCount).toBe(1);
    });
  });

  describe("re-commit rejection", () => {
    it("returns no legal actions for already-committed player", () => {
      const state = makeState(3);
      const commit = firstCommit(state);
      const afterP0 = apply(state, commit);
      const p1Commit = firstCommit(afterP0);
      const afterP1 = apply(afterP0, p1Commit);
      const afterP1Back = { ...afterP1, activePlayer: 0 as const };
      expect(legalActions(afterP1Back)).toHaveLength(0);
    });
  });

  describe("phase transition", () => {
    it.each([2, 3, 4])("transitions to play after all %d players commit", (n) => {
      const state = commitAllPlayers(makeState(n));
      expect(state.phase).toBe("play");
    });

    it("resets active player to 0 on phase transition", () => {
      const state = commitAllPlayers(makeState(3));
      expect(state.activePlayer).toBe(0);
    });

    it("is not terminal after setup", () => {
      const state = commitAllPlayers(makeState(2));
      expect(isTerminal(state)).toBe(false);
    });

    it("stays in setup until last player commits", () => {
      const state = makeState(3);
      const after1 = apply(state, firstCommit(state));
      expect(after1.phase).toBe("setup");
      const after2 = apply(after1, firstCommit(after1));
      expect(after2.phase).toBe("setup");
    });
  });

  describe("illegal actions during setup", () => {
    it("throws on play action during setup", () => {
      const state = makeState(2);
      expect(() => apply(state, { kind: "play", cardId: 0 })).toThrow();
    });

    it("throws on disgrace during setup", () => {
      const state = makeState(2);
      expect(() => apply(state, { kind: "disgrace" })).toThrow();
    });

    it("throws when committing same card as successor and dungeon", () => {
      const state = makeState(2);
      const cardId = playerZones(state, 0).hand[0]!.id;
      expect(() =>
        apply(state, { kind: "commit", successorId: cardId, dungeonId: cardId }),
      ).toThrow();
    });

    it("throws when committing cards not in hand", () => {
      const state = makeState(2);
      expect(() =>
        apply(state, { kind: "commit", successorId: 999, dungeonId: 998 }),
      ).toThrow();
    });
  });

  describe("applySafe error paths", () => {
    it("returns phase_mismatch for play during setup", () => {
      const state = makeState(2);
      const result = applySafe(state, { kind: "play", cardId: 0 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("phase_mismatch");
    });

    it("returns same_card_commit for identical successor/dungeon", () => {
      const state = makeState(2);
      const cardId = playerZones(state, 0).hand[0]!.id;
      const result = applySafe(state, { kind: "commit", successorId: cardId, dungeonId: cardId });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("same_card_commit");
    });

    it("returns cards_not_found for missing cards", () => {
      const state = makeState(2);
      const result = applySafe(state, { kind: "commit", successorId: 999, dungeonId: 998 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("cards_not_found");
    });

    it("returns ok for valid commit", () => {
      const state = makeState(2);
      const commit = firstCommit(state);
      const result = applySafe(state, commit);
      expect(result.ok).toBe(true);
    });
  });
});
