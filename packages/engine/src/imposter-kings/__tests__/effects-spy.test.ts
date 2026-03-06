/**
 * Seeded deterministic tests for the Spy card effect.
 *
 * Spy (value 8, 3p-only): "You may Disgrace this card after playing it to
 * look at all Successors. You may then force one player to change their
 * Successor with a card in their hand."
 *
 * Scenarios:
 *   1. Use ability, swap successor: Play Spy → proceed → disgrace → proceed
 *      → choose P1 → P1 picks hand card → successor swapped.
 *   2. Use ability, skip swap: Play Spy → proceed → disgrace → pass.
 *   3. Skip ability entirely: Play Spy → pass → Spy face-up, no changes.
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
 * Builds a 2-player game using regulationDeck(3) to include Spy.
 * Spy in P0's hand. 16-card custom deck for 2 players.
 */
const setupSpyGame = (): IKState => {
  const kinds = regulationDeck(3);
  const deck = createDeck(kinds);

  const spy = deck.find((c) => c.kind.name === "Spy")!;
  const otherCards = deck.filter((c) => c.kind.name !== "Spy");

  const customDeck: typeof deck[number][] = [];
  const p0Cards = [
    otherCards[0]!,
    otherCards[1]!,
    spy,
    otherCards[2]!,
    otherCards[3]!,
    otherCards[4]!,
    otherCards[5]!,
  ];
  const p1Cards = [
    otherCards[6]!,
    otherCards[7]!,
    otherCards[8]!,
    otherCards[9]!,
    otherCards[10]!,
    otherCards[11]!,
    otherCards[12]!,
  ];
  for (let i = 0; i < 7; i++) {
    customDeck.push(p0Cards[i]!);
    customDeck.push(p1Cards[i]!);
  }
  customDeck.push(otherCards[13]!);
  customDeck.push(otherCards[14]!);

  let state = dealWithDeck(customDeck, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const s1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s1);
  const s2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s2);

  return state;
};

describe("Spy card effect", () => {
  it("use ability, swap successor: P1 successor changed", () => {
    let state = setupSpyGame();
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);

    const spy = playerZones(state, 0).hand.find((c) => c.kind.name === "Spy")!;
    const p1SuccessorBefore = playerZones(state, 1).successor?.card;
    expect(p1SuccessorBefore).toBeDefined();
    const p1HandCard = playerZones(state, 1).hand[0]!;

    state = apply(state, { kind: "play", cardId: spy.id });

    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    expect(state.shared.court.find((e) => e.card.id === spy.id)?.face).toBe("down");

    opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    opts = state.pendingResolution!.currentOptions;
    expect(opts.some((o) => o.kind === "player")).toBe(true);
    state = chooseEffect(state, 0);

    opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "card")).toBe(true);
    const handCardIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === p1HandCard.id,
    );
    expect(handCardIdx).not.toBe(-1);
    state = chooseEffect(state, handCardIdx);

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    const p1SuccessorAfter = playerZones(state, 1).successor?.card;
    expect(p1SuccessorAfter).toBeDefined();
    expect(p1SuccessorAfter!.id).toBe(p1HandCard.id);
    expect(playerZones(state, 1).hand.some((c) => c.id === p1SuccessorBefore!.id)).toBe(true);

    console.log(
      `  Swap complete: P1 successor changed from ${p1SuccessorBefore!.kind.name} to ${p1HandCard.kind.name}`,
    );
  });

  it("use ability, skip swap: Spy disgraced, turn advances", () => {
    let state = setupSpyGame();

    const spy = playerZones(state, 0).hand.find((c) => c.kind.name === "Spy")!;
    const p1SuccessorBefore = playerZones(state, 1).successor?.card;

    state = apply(state, { kind: "play", cardId: spy.id });

    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "pass"));

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);
    expect(state.shared.court.find((e) => e.card.id === spy.id)?.face).toBe("down");
    expect(playerZones(state, 1).successor?.card.id).toBe(p1SuccessorBefore!.id);

    console.log("  Spy disgraced, swap skipped, turn advanced");
  });

  it("skip ability entirely: Spy face-up, no changes", () => {
    let state = setupSpyGame();

    const spy = playerZones(state, 0).hand.find((c) => c.kind.name === "Spy")!;
    const p1SuccessorBefore = playerZones(state, 1).successor?.card;

    state = apply(state, { kind: "play", cardId: spy.id });

    const opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "pass"));

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);
    expect(state.shared.court.find((e) => e.card.id === spy.id)?.face).toBe("up");
    expect(playerZones(state, 1).successor?.card.id).toBe(p1SuccessorBefore!.id);

    console.log("  Skip ability: Spy face-up, no changes");
  });
});
