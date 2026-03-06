/**
 * Seeded deterministic tests for the Soldier card effect.
 *
 * Soldier: "Say a card name. If any opponents have that card in their hand,
 * this card gains +2 value while on the Throne and you may Disgrace up to
 * three cards in the Court."
 *
 * Scenarios:
 *   1. Correct guess, skip disgrace: +2 modifier applied, throneValue = 7.
 *   2. Correct guess, use disgrace: Soldier disgraced in court (face-down).
 *   3. Incorrect guess: no modifier, no disgrace offered, throneValue = 5.
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
  throneValue,
  type IKState,
} from "../index.js";

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

/**
 * Builds a 2-player game with deterministic hands:
 *   P0 hand (after setup): Soldier, Elder, Elder, Zealot, Inquisitor
 *   P1 hand (after setup): Queen, Oathbound, Oathbound, Immortal, Warlord
 */
const setupSoldierGame = (): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const soldierCards = deck.filter((c) => c.kind.name === "Soldier");
  const queenCards = deck.filter((c) => c.kind.name === "Queen");
  const otherCards = deck.filter(
    (c) => c.kind.name !== "Soldier" && c.kind.name !== "Queen",
  );

  const customDeck: typeof deck[number][] = [];
  const p0Cards = [
    otherCards[0]!, otherCards[1]!,
    soldierCards[0]!, otherCards[2]!, otherCards[3]!, otherCards[4]!, otherCards[5]!,
  ];
  const p1Cards = [
    otherCards[6]!, otherCards[7]!,
    queenCards[0]!, otherCards[8]!, otherCards[9]!, otherCards[10]!, otherCards[11]!,
  ];
  for (let i = 0; i < 7; i++) {
    customDeck.push(p0Cards[i]!);
    customDeck.push(p1Cards[i]!);
  }
  customDeck.push(otherCards[12]!);
  customDeck.push(otherCards[13]!);

  let state = dealWithDeck(customDeck, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const setup1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, setup1);
  const setup2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, setup2);
  return state;
};

describe("Soldier card effect", () => {
  it("correct guess, skip disgrace: +2 modifier, throneValue = 7", () => {
    let state = setupSoldierGame();
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);
    expect(playerZones(state, 0).hand.some((c) => c.kind.name === "Soldier")).toBe(true);
    expect(playerZones(state, 1).hand.some((c) => c.kind.name === "Queen")).toBe(true);

    const soldierCard = playerZones(state, 0).hand.find((c) => c.kind.name === "Soldier")!;
    state = apply(state, { kind: "play", cardId: soldierCard.id });

    // --- nameCard: mandatory, no outer optional ---
    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "cardName")).toBe(true);
    const queenIdx = opts.findIndex(
      (o) => o.kind === "cardName" && o.name === "Queen",
    );
    expect(queenIdx).not.toBe(-1);
    state = chooseEffect(state, queenIdx);

    // --- anyOpponentHas succeeded -> addRoundModifier -> optional disgrace ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    const passIdx = opts.findIndex((o) => o.kind === "pass");
    expect(passIdx).not.toBe(-1);
    state = chooseEffect(state, passIdx);

    // --- done -> end-of-turn -> P1's turn ---
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    expect(throneValue(state)).toBe(7);
    expect(state.roundModifiers).toHaveLength(1);
    expect(state.roundModifiers[0]!.sourceCardId).toBe(soldierCard.id);

    console.log("  Correct guess (skip disgrace): throneValue = 7, modifier active");
  });

  it("correct guess, use disgrace: Soldier disgraced in court", () => {
    let state = setupSoldierGame();

    const soldierCard = playerZones(state, 0).hand.find((c) => c.kind.name === "Soldier")!;
    state = apply(state, { kind: "play", cardId: soldierCard.id });

    // --- nameCard: name "Queen" ---
    let opts = state.pendingResolution!.currentOptions;
    const queenIdx = opts.findIndex(
      (o) => o.kind === "cardName" && o.name === "Queen",
    );
    state = chooseEffect(state, queenIdx);

    // --- optional disgrace: proceed ---
    opts = state.pendingResolution!.currentOptions;
    const proceedIdx = opts.findIndex((o) => o.kind === "proceed");
    expect(proceedIdx).not.toBe(-1);
    state = chooseEffect(state, proceedIdx);

    // --- chooseCard: court has Soldier (only non-disgraced card) ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts).toHaveLength(1);
    expect(opts[0]!.kind).toBe("card");
    expect((opts[0] as { kind: "card"; cardId: number }).cardId).toBe(soldierCard.id);
    state = chooseEffect(state, 0);

    // --- nested optional for 2nd disgrace: pass ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "pass"));

    // --- done -> end-of-turn -> P1's turn ---
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    const soldierEntry = state.shared.court.find((e) => e.card.id === soldierCard.id)!;
    expect(soldierEntry.face).toBe("down");
    expect(throneValue(state)).toBe(1);

    console.log("  Correct guess (disgrace): Soldier face-down, throneValue = 1");
  });

  it("incorrect guess: no modifier, no disgrace offered, throneValue = 5", () => {
    let state = setupSoldierGame();

    const soldierCard = playerZones(state, 0).hand.find((c) => c.kind.name === "Soldier")!;
    state = apply(state, { kind: "play", cardId: soldierCard.id });

    // --- nameCard: name "Fool" (P1 does not have Fool) ---
    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    const foolIdx = opts.findIndex(
      (o) => o.kind === "cardName" && o.name === "Fool",
    );
    expect(foolIdx).not.toBe(-1);
    expect(playerZones(state, 1).hand.every((c) => c.kind.name !== "Fool")).toBe(true);

    state = chooseEffect(state, foolIdx);

    // --- anyOpponentHas failed -> done -> end-of-turn -> P1's turn ---
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    expect(throneValue(state)).toBe(5);
    expect(state.roundModifiers).toHaveLength(0);

    console.log("  Incorrect guess: no modifier, throneValue = 5");
  });
});
