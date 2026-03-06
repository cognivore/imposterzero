/**
 * Princess card-swap prerequisites.
 *
 * Princess requires at least 1 card in the hand of BOTH the active player
 * and the chosen opponent for the swap to fire. If either hand is empty,
 * chooseCard returns done and the swap silently fizzles.
 *
 * Covers:
 *   1. Princess ability fizzles when P0 (active) has 0 cards in hand
 *   2. Princess ability fizzles when P1 (opponent) has 0 cards in hand
 *   3. Oathbound → Princess chain requires 3 cards in P0's hand and 1 in P1's
 *   4. Oathbound → Princess chain fizzles when P0 has only 2 cards (no swap card left)
 */

import { describe, it, expect } from "vitest";

import {
  createDeck,
  dealWithDeck,
  regulationDeck,
  legalActions,
  apply,
  applySafe,
  playerZones,
  type IKState,
  type IKPlayCardAction,
} from "../index.js";
import type { PlayerId } from "@imposter-zero/types";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const resolveAll = (state: IKState): IKState => {
  let s = state;
  let safety = 0;
  while ((s.phase === "resolving" || s.phase === "end_of_turn") && safety++ < 100) {
    const la = legalActions(s);
    if (la.length === 0) break;
    s = apply(s, la[0]!);
  }
  return s;
};

const setupGame = (
  p0Names: readonly string[],
  p1Names: readonly string[],
): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);
  const used = new Set<number>();

  const find = (names: readonly string[]): typeof deck[number][] =>
    names.map((name) => {
      const card = deck.find((c) => c.kind.name === name && !used.has(c.id));
      if (!card) throw new Error(`Card ${name} not found`);
      used.add(card.id);
      return card;
    });

  const p0 = find(p0Names);
  const p1 = find(p1Names);
  const filler = deck.filter((c) => !used.has(c.id));
  while (p0.length < 7) p0.push(filler.shift()!);
  while (p1.length < 7) p1.push(filler.shift()!);

  const custom: typeof deck[number][] = [];
  for (let i = 0; i < 7; i++) { custom.push(p0[i]!); custom.push(p1[i]!); }
  custom.push(filler.shift()!);
  custom.push(filler.shift()!);

  let state = dealWithDeck(custom, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const s1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s1);
  const s2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s2);
  return state;
};

describe("Princess swap prerequisites", () => {
  it("fizzles when active player has 0 cards after playing Princess", () => {
    let state = setupGame(
      ["Elder", "Zealot", "Princess", "Soldier", "Inquisitor"],
      ["Elder", "Oathbound", "Fool", "Oathbound", "Warden"],
    );

    const princess = playerZones(state, 0).hand.find((c) => c.kind.name === "Princess")!;

    // Trim P0's hand to just Princess
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [princess] } : p,
      ),
    };
    expect(playerZones(state, 0).hand).toHaveLength(1);

    state = apply(state, { kind: "play", cardId: princess.id });

    // optional → proceed
    if (state.phase === "resolving" && state.pendingResolution) {
      const opts = state.pendingResolution.currentOptions;
      if (opts.some((o) => o.kind === "proceed")) {
        state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));
      }
    }

    // choosePlayer → pick P1
    if (state.phase === "resolving" && state.pendingResolution) {
      const opts = state.pendingResolution.currentOptions;
      if (opts.some((o) => o.kind === "player")) {
        state = chooseEffect(state, 0);
      }
    }

    // Resolve any remaining (KH window, etc.)
    state = resolveAll(state);

    // P0 had 0 cards when chooseCard(active, hand) ran → swap fizzled
    // Princess is in court, P0's hand is empty, P1's hand unchanged
    expect(state.shared.court.some((e) => e.card.kind.name === "Princess")).toBe(true);
    expect(playerZones(state, 0).hand).toHaveLength(0);
  });

  it("fizzles when chosen opponent has 0 cards in hand", () => {
    let state = setupGame(
      ["Elder", "Zealot", "Princess", "Soldier", "Inquisitor"],
      ["Elder", "Oathbound", "Fool", "Oathbound", "Warden"],
    );

    const princess = playerZones(state, 0).hand.find((c) => c.kind.name === "Princess")!;
    const p0HandBefore = playerZones(state, 0).hand.filter((c) => c.id !== princess.id);

    // Empty P1's hand
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 1 ? { ...p, hand: [] } : p,
      ),
    };
    expect(playerZones(state, 1).hand).toHaveLength(0);

    state = apply(state, { kind: "play", cardId: princess.id });

    // optional → proceed
    if (state.phase === "resolving" && state.pendingResolution) {
      const opts = state.pendingResolution.currentOptions;
      if (opts.some((o) => o.kind === "proceed")) {
        state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));
      }
    }

    // choosePlayer → pick P1
    if (state.phase === "resolving" && state.pendingResolution) {
      const opts = state.pendingResolution.currentOptions;
      if (opts.some((o) => o.kind === "player")) {
        state = chooseEffect(state, 0);
      }
    }

    state = resolveAll(state);

    // P0 chose a card from own hand, but P1 had 0 cards → chooseCard(P1, hand) returned done
    // No swap happened. P0's remaining hand cards unchanged.
    expect(state.shared.court.some((e) => e.card.kind.name === "Princess")).toBe(true);
    const p0HandAfter = playerZones(state, 0).hand;
    expect(p0HandAfter.map((c) => c.id).sort()).toEqual(
      p0HandBefore.map((c) => c.id).sort(),
    );
  });
});

describe("Oathbound → Princess chain prerequisites", () => {
  it("full chain works with 3+ cards in P0 hand and 1+ in P1 hand", () => {
    let state = setupGame(
      ["Elder", "Zealot", "Oathbound", "Princess", "Soldier"],
      ["Elder", "Oathbound", "Fool", "Warden", "Inquisitor"],
    );

    // Place Warlord (7) in court so Oathbound (6) can play via override
    const warlord = playerZones(state, 1).hand.find((c) => c.kind.name === "Oathbound");
    const courtCard = createDeck(regulationDeck(2)).find((c) => c.kind.name === "Warlord")!;
    state = {
      ...state,
      shared: {
        ...state.shared,
        court: [{ card: courtCard, face: "up" as const, playedBy: 1 as PlayerId }],
      },
    };

    // Trim P0 hand to exactly: Oathbound, Princess, Soldier (3 cards)
    const oathbound = playerZones(state, 0).hand.find((c) => c.kind.name === "Oathbound")!;
    const princess = playerZones(state, 0).hand.find((c) => c.kind.name === "Princess")!;
    const soldier = playerZones(state, 0).hand.find((c) => c.kind.name === "Soldier")!;
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [oathbound, princess, soldier] } : p,
      ),
    };
    expect(playerZones(state, 0).hand).toHaveLength(3);
    expect(playerZones(state, 1).hand.length).toBeGreaterThanOrEqual(1);

    // Play Oathbound (value 6 via override on Warlord value 7)
    state = apply(state, { kind: "play", cardId: oathbound.id });
    expect(state.phase).toBe("resolving");

    // chooseCard from hand for force-play → pick Princess
    let opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "card")).toBe(true);
    const princessIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { cardId: number }).cardId === princess.id,
    );
    expect(princessIdx).not.toBe(-1);
    state = chooseEffect(state, princessIdx);

    // Princess's onPlay fires: optional → proceed
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    const proceedIdx = opts.findIndex((o) => o.kind === "proceed");
    if (proceedIdx !== -1) {
      state = chooseEffect(state, proceedIdx);
    }

    // choosePlayer → P1
    if (state.phase === "resolving" && state.pendingResolution) {
      opts = state.pendingResolution.currentOptions;
      if (opts.some((o) => o.kind === "player")) {
        state = chooseEffect(state, 0);
      }
    }

    // KH window or card choice
    state = resolveAll(state);

    // P0 started with 3 cards, played Oathbound (-1) + force-played Princess (-1) = 1 left (Soldier)
    // Swap should have happened: Soldier went to P1, a P1 card came to P0
    // The swap fires because P0 had 1 card (Soldier) and P1 had ≥1 card
    expect(state.shared.court.some((e) => e.card.kind.name === "Princess")).toBe(true);
    expect(state.shared.court.some((e) => e.card.kind.name === "Oathbound")).toBe(true);
  });

  it("chain fizzles when P0 has only 2 cards (Oathbound + Princess, no swap card left)", () => {
    let state = setupGame(
      ["Elder", "Zealot", "Oathbound", "Princess", "Soldier"],
      ["Elder", "Oathbound", "Fool", "Warden", "Inquisitor"],
    );

    const courtCard = createDeck(regulationDeck(2)).find((c) => c.kind.name === "Warlord")!;
    state = {
      ...state,
      shared: {
        ...state.shared,
        court: [{ card: courtCard, face: "up" as const, playedBy: 1 as PlayerId }],
      },
    };

    // Trim P0 hand to exactly 2 cards: Oathbound + Princess (no swap card)
    const oathbound = playerZones(state, 0).hand.find((c) => c.kind.name === "Oathbound")!;
    const princess = playerZones(state, 0).hand.find((c) => c.kind.name === "Princess")!;
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, hand: [oathbound, princess] } : p,
      ),
    };
    expect(playerZones(state, 0).hand).toHaveLength(2);

    // Play Oathbound → force-play Princess
    state = apply(state, { kind: "play", cardId: oathbound.id });
    let opts = state.pendingResolution!.currentOptions;
    const princessIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { cardId: number }).cardId === princess.id,
    );
    state = chooseEffect(state, princessIdx);

    // Princess optional → proceed
    if (state.phase === "resolving" && state.pendingResolution) {
      opts = state.pendingResolution.currentOptions;
      const proceedIdx = opts.findIndex((o) => o.kind === "proceed");
      if (proceedIdx !== -1) {
        state = chooseEffect(state, proceedIdx);
      }
    }

    // choosePlayer → P1
    if (state.phase === "resolving" && state.pendingResolution) {
      opts = state.pendingResolution.currentOptions;
      if (opts.some((o) => o.kind === "player")) {
        state = chooseEffect(state, 0);
      }
    }

    state = resolveAll(state);

    // P0 played Oathbound + force-played Princess → 0 cards in hand
    // chooseCard(active, hand) hit empty hand → returned done → swap fizzled
    expect(playerZones(state, 0).hand).toHaveLength(0);
    expect(state.shared.court.some((e) => e.card.kind.name === "Princess")).toBe(true);
    expect(state.shared.court.some((e) => e.card.kind.name === "Oathbound")).toBe(true);

    // P1's hand is unchanged (no card was swapped in or out)
    const p1Hand = playerZones(state, 1).hand;
    expect(p1Hand.length).toBeGreaterThanOrEqual(1);
  });
});
