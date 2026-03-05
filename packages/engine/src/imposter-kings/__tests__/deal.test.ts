import { describe, it, expect } from "vitest";

import { deal, createDeck, shuffle } from "../deal.js";
import { regulationDeck, KING_CARD_KIND } from "../card.js";
import type { IKState } from "../state.js";

const seededRandom = (seed: number) => {
  let s = seed;
  return (): number => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const totalCards = (state: IKState): number => {
  const handCards = state.players.reduce((n, p) => n + p.hand.length, 0);
  const kingCards = state.players.length;
  const successorCards = state.players.filter((p) => p.successor !== null).length;
  const dungeonCards = state.players.filter((p) => p.dungeon !== null).length;
  const antechamberCards = state.players.reduce((n, p) => n + p.antechamber.length, 0);
  const partingCards = state.players.reduce((n, p) => n + p.parting.length, 0);
  const courtCards = state.shared.court.length;
  const accusedCards = state.shared.accused !== null ? 1 : 0;
  const forgottenCards = state.shared.forgotten !== null ? 1 : 0;
  const armyCards = state.shared.army.length;
  const condemnedCards = state.shared.condemned.length;
  return handCards + kingCards + successorCards + dungeonCards + antechamberCards + partingCards + courtCards + accusedCards + forgottenCards + armyCards + condemnedCards;
};

const allCardIds = (state: IKState): number[] => {
  const ids: number[] = [];
  for (const p of state.players) {
    ids.push(...p.hand.map((c) => c.id));
    ids.push(p.king.card.id);
    if (p.successor) ids.push(p.successor.card.id);
    if (p.dungeon) ids.push(p.dungeon.card.id);
    ids.push(...p.antechamber.map((c) => c.id));
    ids.push(...p.parting.map((c) => c.id));
  }
  for (const e of state.shared.court) ids.push(e.card.id);
  if (state.shared.accused) ids.push(state.shared.accused.id);
  if (state.shared.forgotten) ids.push(state.shared.forgotten.card.id);
  ids.push(...state.shared.army.map((c) => c.id));
  ids.push(...state.shared.condemned.map((e) => e.card.id));
  return ids;
};

describe("createDeck", () => {
  it("assigns sequential IDs starting from 0", () => {
    const kinds = regulationDeck(2);
    const deck = createDeck(kinds);
    expect(deck.map((c) => c.id)).toEqual(Array.from({ length: kinds.length }, (_, i) => i));
  });

  it("preserves kind ordering", () => {
    const kinds = regulationDeck(2);
    const deck = createDeck(kinds);
    deck.forEach((card, i) => {
      expect(card.kind).toBe(kinds[i]);
    });
  });
});

describe("shuffle", () => {
  it("preserves all elements", () => {
    const items = [1, 2, 3, 4, 5];
    const shuffled = shuffle(items, seededRandom(42));
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it("is deterministic with same seed", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const a = shuffle(items, seededRandom(123));
    const b = shuffle(items, seededRandom(123));
    expect(a).toEqual(b);
  });

  it("does not mutate the input", () => {
    const items = Object.freeze([1, 2, 3, 4, 5]);
    shuffle(items, seededRandom(1));
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("deal", () => {
  describe.each([2, 3, 4] as const)("%d players", (numPlayers) => {
    const rng = seededRandom(42);
    const state = deal(regulationDeck(numPlayers), numPlayers, rng);

    it("starts in setup phase", () => {
      expect(state.phase).toBe("crown");
    });

    it("starts with player 0 active", () => {
      expect(state.activePlayer).toBe(0);
    });

    it("starts with turn count 0", () => {
      expect(state.turnCount).toBe(0);
    });

    it("creates correct number of players", () => {
      expect(state.players).toHaveLength(numPlayers);
      expect(state.numPlayers).toBe(numPlayers);
    });

    it("gives each player at least 2 hand cards for setup", () => {
      for (const p of state.players) {
        expect(p.hand.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("gives each player a face-up king", () => {
      for (const p of state.players) {
        expect(p.king.face).toBe("up");
        expect(p.king.card.kind).toBe(KING_CARD_KIND);
      }
    });

    it("starts with no successor or dungeon", () => {
      for (const p of state.players) {
        expect(p.successor).toBeNull();
        expect(p.dungeon).toBeNull();
      }
    });

    it("starts with empty court", () => {
      expect(state.shared.court).toHaveLength(0);
    });

    it("has all unique card IDs", () => {
      const ids = allCardIds(state);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("reserve policy", () => {
    it("reserves accused + forgotten for 2 players", () => {
      const state = deal(regulationDeck(2), 2, seededRandom(1));
      expect(state.shared.accused).not.toBeNull();
      expect(state.shared.forgotten).not.toBeNull();
    });

    it("reserves accused + forgotten for 3 players", () => {
      const state = deal(regulationDeck(3), 3, seededRandom(1));
      expect(state.shared.accused).not.toBeNull();
      expect(state.shared.forgotten).not.toBeNull();
    });

    it("reserves only accused for 4 players (no forgotten)", () => {
      const state = deal(regulationDeck(4), 4, seededRandom(1));
      expect(state.shared.accused).not.toBeNull();
      expect(state.shared.forgotten).toBeNull();
    });
  });

  describe("total card conservation", () => {
    it.each([2, 3, 4])("all deck cards + kings accounted for with %d players", (n) => {
      const kinds = regulationDeck(n);
      const state = deal(kinds, n, seededRandom(99));
      const deckSize = kinds.length;
      const kingCount = n;
      expect(totalCards(state)).toBe(deckSize + kingCount);
    });
  });

  describe("edge cases", () => {
    it("rejects 1 player", () => {
      expect(() => deal(regulationDeck(2), 1)).toThrow(RangeError);
    });

    it("rejects 5 players", () => {
      expect(() => deal(regulationDeck(4), 5)).toThrow(RangeError);
    });
  });
});
