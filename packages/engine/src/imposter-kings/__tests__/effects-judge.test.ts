/**
 * Seeded deterministic tests for the Judge card effect.
 *
 * Judge: "Guess a card name in an opponent's hand. If correct, you may play
 * a card to your Antechamber with a base value of 2 or more."
 *
 * Scenarios:
 *   1. Correct guess: P0 plays Judge, names "Queen", P1 has Queen -> P0
 *      plays Elder to antechamber -> Elder auto-plays to court at end-of-turn.
 *   2. Incorrect guess: P0 plays Judge, names "Fool", P1 has no Fool ->
 *      effect resolves immediately with no antechamber opportunity.
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
 *   P0 hand (after setup): Judge, Elder, Elder, Zealot, Inquisitor
 *   P1 hand (after setup): Queen, Soldier, Oathbound, Oathbound, Immortal
 */
const setupJudgeGame = (): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const judgeCards = deck.filter((c) => c.kind.name === "Judge");
  const queenCards = deck.filter((c) => c.kind.name === "Queen");
  const otherCards = deck.filter(
    (c) => c.kind.name !== "Judge" && c.kind.name !== "Queen",
  );

  const customDeck: typeof deck[number][] = [];
  const p0Cards = [
    otherCards[0]!, otherCards[1]!,
    judgeCards[0]!, otherCards[2]!, otherCards[3]!, otherCards[4]!, otherCards[5]!,
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

describe("Judge card effect", () => {
  it("correct guess: names Queen, plays card to antechamber, auto-plays to court", () => {
    let state = setupJudgeGame();
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);
    expect(playerZones(state, 0).hand.some((c) => c.kind.name === "Judge")).toBe(true);
    expect(playerZones(state, 1).hand.some((c) => c.kind.name === "Queen")).toBe(true);

    const p0HandBefore = playerZones(state, 0).hand.length;

    const judgeCard = playerZones(state, 0).hand.find((c) => c.kind.name === "Judge")!;
    state = apply(state, { kind: "play", cardId: judgeCard.id });

    // --- Outer optional: pass/proceed ---
    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    const proceedIdx = opts.findIndex((o) => o.kind === "proceed");
    expect(proceedIdx).not.toBe(-1);
    state = chooseEffect(state, proceedIdx);

    // --- choosePlayer: only P1 in 2-player ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts).toHaveLength(1);
    expect(opts[0]!.kind).toBe("player");
    state = chooseEffect(state, 0);

    // --- nameCard: choose "Queen" ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    const queenIdx = opts.findIndex(
      (o) => o.kind === "cardName" && o.name === "Queen",
    );
    expect(queenIdx).not.toBe(-1);
    state = chooseEffect(state, queenIdx);

    // --- checkZone succeeded -> inner optional: pass/proceed ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    const innerProceedIdx = opts.findIndex((o) => o.kind === "proceed");
    expect(innerProceedIdx).not.toBe(-1);
    state = chooseEffect(state, innerProceedIdx);

    // --- chooseCard: eligible cards from P0's hand (base value >= 2) ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o.kind === "card")).toBe(true);

    const chosenCardId = (opts[0] as { kind: "card"; cardId: number }).cardId;
    state = chooseEffect(state, 0);

    // --- Effect done + end-of-turn antechamber auto-play ---
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    expect(state.shared.court.some((e) => e.card.id === chosenCardId)).toBe(true);
    expect(playerZones(state, 0).antechamber).toHaveLength(0);

    expect(state.shared.court).toHaveLength(2);
    expect(state.shared.court.some((e) => e.card.id === judgeCard.id)).toBe(true);

    expect(playerZones(state, 0).hand).toHaveLength(p0HandBefore - 2);

    console.log(
      `  Correct guess: Judge played, card ${chosenCardId} auto-played from antechamber to court`,
    );
  });

  it("incorrect guess: names Fool, effect resolves with no antechamber play", () => {
    let state = setupJudgeGame();
    const p0HandBefore = playerZones(state, 0).hand.length;

    const judgeCard = playerZones(state, 0).hand.find((c) => c.kind.name === "Judge")!;
    state = apply(state, { kind: "play", cardId: judgeCard.id });

    // --- Outer optional: proceed ---
    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    // --- choosePlayer: P1 ---
    expect(state.phase).toBe("resolving");
    state = chooseEffect(state, 0);

    // --- nameCard: choose "Fool" (P1 does not have Fool) ---
    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    const foolIdx = opts.findIndex(
      (o) => o.kind === "cardName" && o.name === "Fool",
    );
    expect(foolIdx).not.toBe(-1);
    expect(playerZones(state, 1).hand.every((c) => c.kind.name !== "Fool")).toBe(true);

    state = chooseEffect(state, foolIdx);

    // --- checkZone failed -> done -> end-of-turn -> P1's turn ---
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    expect(playerZones(state, 0).antechamber).toHaveLength(0);
    expect(state.shared.court).toHaveLength(1);
    expect(state.shared.court[0]!.card.id).toBe(judgeCard.id);
    expect(playerZones(state, 0).hand).toHaveLength(p0HandBefore - 1);

    console.log("  Incorrect guess: no antechamber play, turn advanced to P1");
  });
});
