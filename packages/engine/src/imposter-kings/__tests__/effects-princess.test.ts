/**
 * Seeded deterministic tests for the Princess card effect.
 *
 * Princess: "You may pick a player. Both of you choose and swap a card."
 *
 * Scenarios:
 *   1. Use ability: P0 plays Princess -> proceed -> choose P1 -> P0 picks
 *      a card -> P1 picks a card -> cards are swapped between hands.
 *   2. Skip ability: P0 plays Princess -> pass -> no swap, turn advances.
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
} from "../index.js";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

/**
 * Builds a 2-player game with deterministic hands:
 *   P0 hand (after setup): Princess, Elder, Elder, Zealot, Inquisitor
 *   P1 hand (after setup): Soldier, Judge, Oathbound, Oathbound, Immortal
 */
const setupPrincessGame = (): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const princessCards = deck.filter((c) => c.kind.name === "Princess");
  const otherCards = deck.filter((c) => c.kind.name !== "Princess");

  const customDeck: typeof deck[number][] = [];
  const p0Cards = [
    otherCards[0]!, otherCards[1]!,
    princessCards[0]!, otherCards[2]!, otherCards[3]!, otherCards[4]!, otherCards[5]!,
  ];
  const p1Cards = [
    otherCards[6]!, otherCards[7]!,
    otherCards[8]!, otherCards[9]!, otherCards[10]!, otherCards[11]!, otherCards[12]!,
  ];
  for (let i = 0; i < 7; i++) {
    customDeck.push(p0Cards[i]!);
    customDeck.push(p1Cards[i]!);
  }
  customDeck.push(otherCards[13]!);
  customDeck.push(otherCards[14]!);

  let state = dealWithDeck(customDeck, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const setup1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, setup1);
  const setup2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, setup2);
  return state;
};

describe("Princess card effect", () => {
  it("use ability: both players choose a card, cards are swapped", () => {
    let state = setupPrincessGame();
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);

    const princess = playerZones(state, 0).hand.find((c) => c.kind.name === "Princess")!;
    const p0HandBefore = playerZones(state, 0).hand.filter((c) => c.id !== princess.id);
    const p1HandBefore = [...playerZones(state, 1).hand];

    const p0GiveCard = p0HandBefore[0]!;
    const p1GiveCard = p1HandBefore[0]!;

    state = apply(state, { kind: "play", cardId: princess.id });

    // --- optional: proceed ---
    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // --- choosePlayer: P1 (only opponent in 2p) ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts).toHaveLength(1);
    expect(opts[0]!.kind).toBe("player");
    state = chooseEffect(state, 0);

    // --- P0 chooses a card from own hand to give ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "card")).toBe(true);
    const p0GiveIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === p0GiveCard.id,
    );
    expect(p0GiveIdx).not.toBe(-1);
    state = chooseEffect(state, p0GiveIdx);

    // --- P1 chooses a card from own hand to give ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "card")).toBe(true);
    const p1GiveIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === p1GiveCard.id,
    );
    expect(p1GiveIdx).not.toBe(-1);
    state = chooseEffect(state, p1GiveIdx);

    // --- done -> endOfTurn -> P1's turn ---
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    expect(playerZones(state, 0).hand.some((c) => c.id === p1GiveCard.id)).toBe(true);
    expect(playerZones(state, 0).hand.every((c) => c.id !== p0GiveCard.id)).toBe(true);

    expect(playerZones(state, 1).hand.some((c) => c.id === p0GiveCard.id)).toBe(true);
    expect(playerZones(state, 1).hand.every((c) => c.id !== p1GiveCard.id)).toBe(true);

    console.log(
      `  Swap complete: P0 gave ${p0GiveCard.kind.name}, received ${p1GiveCard.kind.name}`,
    );
  });

  it("skip ability: no swap, turn advances", () => {
    let state = setupPrincessGame();

    const princess = playerZones(state, 0).hand.find((c) => c.kind.name === "Princess")!;
    const p0HandIds = playerZones(state, 0).hand
      .filter((c) => c.id !== princess.id)
      .map((c) => c.id);
    const p1HandIds = playerZones(state, 1).hand.map((c) => c.id);

    state = apply(state, { kind: "play", cardId: princess.id });

    // --- optional: pass ---
    expect(state.phase).toBe("resolving");
    const opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "pass"));

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    const p0HandAfter = playerZones(state, 0).hand.map((c) => c.id);
    const p1HandAfter = playerZones(state, 1).hand.map((c) => c.id);
    expect(p0HandAfter).toEqual(p0HandIds);
    expect(p1HandAfter).toEqual(p1HandIds);

    console.log("  Skip: hands unchanged, turn advanced");
  });

  it("combo: give Oathbound to opponent who has no follow-up card, stranding them", () => {
    const kinds = regulationDeck(2);
    const deck = createDeck(kinds);

    const princess = deck.find((c) => c.kind.name === "Princess")!;
    const oathbound = deck.find((c) => c.kind.name === "Oathbound")!;
    const elder = deck.find((c) => c.kind.name === "Elder")!;
    const filler = deck.filter(
      (c) => c.id !== princess.id && c.id !== oathbound.id && c.id !== elder.id,
    );

    const customDeck: typeof deck[number][] = [];
    const p0Cards = [
      filler[0]!, filler[1]!,
      princess, oathbound, filler[2]!, filler[3]!, filler[4]!,
    ];
    const p1Cards = [
      filler[5]!, filler[6]!,
      elder, filler[7]!, filler[8]!, filler[9]!, filler[10]!,
    ];
    for (let i = 0; i < 7; i++) {
      customDeck.push(p0Cards[i]!);
      customDeck.push(p1Cards[i]!);
    }
    customDeck.push(filler[11]!);
    customDeck.push(filler[12]!);

    let state = dealWithDeck(customDeck, 2, 0);
    state = apply(state, { kind: "crown", firstPlayer: 0 });
    const s1 = legalActions(state).find((a) => a.kind === "commit")!;
    state = apply(state, s1);
    const s2 = legalActions(state).find((a) => a.kind === "commit")!;
    state = apply(state, s2);

    // Trim hands to simulate late game: P0 keeps Princess + Oathbound, P1 keeps Elder
    state = {
      ...state,
      players: state.players.map((p, i) => {
        if (i === 0) return { ...p, hand: p.hand.filter((c) => c.id === princess.id || c.id === oathbound.id) };
        if (i === 1) return { ...p, hand: p.hand.filter((c) => c.id === elder.id) };
        return p;
      }),
    };

    expect(playerZones(state, 0).hand).toHaveLength(2);
    expect(playerZones(state, 1).hand).toHaveLength(1);

    // Play Princess (value 9) on empty court (threshold 0)
    state = apply(state, { kind: "play", cardId: princess.id });

    // proceed -> use ability
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // choose P1
    state = chooseEffect(state, 0);

    // P0 gives Oathbound
    opts = state.pendingResolution!.currentOptions;
    const giveOathIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === oathbound.id,
    );
    expect(giveOathIdx).not.toBe(-1);
    state = chooseEffect(state, giveOathIdx);

    // P1 gives Elder (only card)
    opts = state.pendingResolution!.currentOptions;
    expect(opts).toHaveLength(1);
    state = chooseEffect(state, 0);

    // Swap done -> P1's turn
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    // P0 now has Elder, P1 now has Oathbound
    expect(playerZones(state, 0).hand.some((c) => c.id === elder.id)).toBe(true);
    expect(playerZones(state, 1).hand.some((c) => c.id === oathbound.id)).toBe(true);

    // Threshold = 9 (Princess on throne)
    // P1 has Oathbound (value 6): can't play normally (6 < 9)
    // Override blocked: onHigherValue requires hand.length >= 2 but P1 has only 1 card
    const p1Legal = legalActions(state);
    const oathboundPlay = p1Legal.find(
      (a) => a.kind === "play" && a.cardId === oathbound.id,
    );
    expect(oathboundPlay).toBeUndefined();

    // P1's only option is to disgrace (flip King)
    expect(p1Legal.every((a) => a.kind === "disgrace")).toBe(true);
    expect(p1Legal).toHaveLength(1);

    console.log("  Combo: Oathbound stranded in P1's hand, forced to disgrace");
  });
});
