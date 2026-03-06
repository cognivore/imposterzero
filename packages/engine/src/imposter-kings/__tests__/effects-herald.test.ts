/**
 * Seeded deterministic tests for the Herald card effect.
 *
 * Herald (value 6, 3p-only): "Shuffle your Successor into your hand and
 * place a new Successor. Then you may play another card value 5 or higher
 * to take the Herald back into your hand. This ability is prevented if
 * played from your Antechamber."
 *
 * Scenarios:
 *   1. Full chain: swap successor + chain play value 5+ to retrieve Herald.
 *   2. Swap successor, skip chain play: Herald stays in court.
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
 * Builds a 2-player game using regulationDeck(3) to include Herald.
 * Herald in P0's hand. P0 has Warlord (new successor) and Soldier (value 5+ for chain play).
 */
const setupHeraldGame = (): IKState => {
  const kinds = regulationDeck(3);
  const deck = createDeck(kinds);

  const herald = deck.find((c) => c.kind.name === "Herald")!;
  const warlord = deck.find((c) => c.kind.name === "Warlord")!;
  const soldier = deck.find((c) => c.kind.name === "Soldier")!;
  const otherCards = deck.filter(
    (c) =>
      c.kind.name !== "Herald" &&
      c.kind.name !== "Warlord" &&
      c.kind.name !== "Soldier",
  );

  const customDeck: typeof deck[number][] = [];
  const p0Cards = [
    otherCards[0]!,
    otherCards[1]!,
    herald,
    warlord,
    soldier,
    otherCards[2]!,
    otherCards[3]!,
  ];
  const p1Cards = [
    otherCards[4]!,
    otherCards[5]!,
    otherCards[6]!,
    otherCards[7]!,
    otherCards[8]!,
    otherCards[9]!,
    otherCards[10]!,
  ];
  for (let i = 0; i < 7; i++) {
    customDeck.push(p0Cards[i]!);
    customDeck.push(p1Cards[i]!);
  }
  customDeck.push(otherCards[11]!);
  customDeck.push(otherCards[12]!);

  let state = dealWithDeck(customDeck, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const s1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s1);
  const s2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s2);

  return state;
};

describe("Herald card effect", () => {
  it("full chain: swap successor + chain play to retrieve Herald", () => {
    let state = setupHeraldGame();
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);

    const herald = playerZones(state, 0).hand.find((c) => c.kind.name === "Herald")!;
    const warlord = playerZones(state, 0).hand.find((c) => c.kind.name === "Warlord")!;
    const soldier = playerZones(state, 0).hand.find((c) => c.kind.name === "Soldier")!;
    const p0SuccessorBefore = playerZones(state, 0).successor?.card;
    expect(p0SuccessorBefore).toBeDefined();

    state = apply(state, { kind: "play", cardId: herald.id });

    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "card")).toBe(true);

    const warlordSuccIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === warlord.id,
    );
    expect(warlordSuccIdx).not.toBe(-1);
    state = chooseEffect(state, warlordSuccIdx);

    opts = state.pendingResolution!.currentOptions;
    expect(opts.some((o) => o.kind === "pass")).toBe(true);
    expect(opts.some((o) => o.kind === "proceed")).toBe(true);
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "card")).toBe(true);
    const soldierIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === soldier.id,
    );
    expect(soldierIdx).not.toBe(-1);
    state = chooseEffect(state, soldierIdx);

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    expect(playerZones(state, 0).hand.some((c) => c.id === herald.id)).toBe(true);
    expect(playerZones(state, 0).successor?.card.id).toBe(warlord.id);
    expect(playerZones(state, 0).successor?.card.id).not.toBe(p0SuccessorBefore!.id);
    expect(state.shared.court.some((e) => e.card.id === soldier.id)).toBe(true);
    expect(state.shared.court.every((e) => e.card.id !== herald.id)).toBe(true);

    console.log(
      `  Full chain: Herald in hand, Soldier in court, successor changed to ${warlord.kind.name}`,
    );
  });

  it("swap successor, skip chain play: Herald stays in court", () => {
    let state = setupHeraldGame();

    const herald = playerZones(state, 0).hand.find((c) => c.kind.name === "Herald")!;
    const warlord = playerZones(state, 0).hand.find((c) => c.kind.name === "Warlord")!;
    const p0SuccessorBefore = playerZones(state, 0).successor?.card;

    state = apply(state, { kind: "play", cardId: herald.id });

    let opts = state.pendingResolution!.currentOptions;
    const warlordSuccIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === warlord.id,
    );
    expect(warlordSuccIdx).not.toBe(-1);
    state = chooseEffect(state, warlordSuccIdx);

    opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "pass"));

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);
    expect(state.shared.court.some((e) => e.card.id === herald.id)).toBe(true);
    expect(playerZones(state, 0).hand.every((c) => c.id !== herald.id)).toBe(true);
    expect(playerZones(state, 0).successor?.card.id).toBe(warlord.id);
    expect(playerZones(state, 0).successor?.card.id).not.toBe(p0SuccessorBefore!.id);

    console.log("  Swap successor, skip chain play: Herald stays in court");
  });
});
