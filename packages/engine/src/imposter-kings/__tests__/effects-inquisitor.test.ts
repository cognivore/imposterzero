/**
 * Seeded deterministic test for the Inquisitor -> Queen -> Antechamber ETB chain.
 *
 * Scenario:
 *   1. Player 0 plays Inquisitor to empty court (always legal, threshold=0)
 *   2. Inquisitor effect: proceed -> name "Queen"
 *   3. Player 1 has Queen, forced to move it to antechamber
 *   4. Player 1's turn: plays a card from hand to court
 *   5. End-of-turn: Queen plays from antechamber, triggers disgrace-all
 *   6. Assert: all other court cards face-down
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
  type IKAction,
  type IKPlayCardAction,
} from "../index.js";
import type { CardName } from "../card.js";

const resolveUntilPlay = (state: IKState): IKState => {
  let s = state;
  let safety = 0;
  while (s.phase !== "play" && safety++ < 200) {
    const legal = legalActions(s);
    if (legal.length === 0) break;
    s = apply(s, legal[0]!);
  }
  return s;
};

const resolveAllNonPlay = (state: IKState): IKState => {
  let s = state;
  let safety = 0;
  while (
    (s.phase === "resolving" || s.phase === "end_of_turn") &&
    safety++ < 200
  ) {
    const legal = legalActions(s);
    if (legal.length === 0) break;
    s = apply(s, legal[0]!);
  }
  return s;
};

const chooseEffect = (state: IKState, idx: number): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice: idx });
  if (!result.ok) throw new Error(`effect_choice(${idx}) failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

describe("Inquisitor -> Queen antechamber ETB chain", () => {
  it("full chain: Inquisitor names Queen, Queen to antechamber, Queen ETB disgraces court", () => {
    const kinds = regulationDeck(2);
    const deck = createDeck(kinds);

    const inquisitorCards = deck.filter((c) => c.kind.name === "Inquisitor");
    const queenCards = deck.filter((c) => c.kind.name === "Queen");
    const otherCards = deck.filter(
      (c) => c.kind.name !== "Inquisitor" && c.kind.name !== "Queen",
    );

    // Custom deck: even indices -> P0, odd -> P1, last 2 -> accused/forgotten
    // First 2 cards in each hand get committed as successor/dungeon,
    // so put the important cards at position 2+
    const customDeck: typeof deck[number][] = [];
    const p0Cards = [
      otherCards[0]!, otherCards[1]!,  // will be committed
      inquisitorCards[0]!, otherCards[2]!, otherCards[3]!, otherCards[4]!, otherCards[5]!,
    ];
    const p1Cards = [
      otherCards[6]!, otherCards[7]!,  // will be committed
      queenCards[0]!, otherCards[8]!, otherCards[9]!, otherCards[10]!, otherCards[11]!,
    ];
    for (let i = 0; i < 7; i++) {
      customDeck.push(p0Cards[i]!);
      customDeck.push(p1Cards[i]!);
    }
    customDeck.push(otherCards[12]!);
    customDeck.push(otherCards[13]!);

    let state = dealWithDeck(customDeck, 2, 0);

    // Crown + setup
    state = apply(state, { kind: "crown", firstPlayer: 0 });
    const setup1 = legalActions(state).find((a) => a.kind === "commit")!;
    state = apply(state, setup1);
    const setup2 = legalActions(state).find((a) => a.kind === "commit")!;
    state = apply(state, setup2);
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);

    // Verify Inquisitor is in P0's hand after setup
    expect(playerZones(state, 0).hand.some((c) => c.kind.name === "Inquisitor")).toBe(true);
    expect(playerZones(state, 1).hand.some((c) => c.kind.name === "Queen")).toBe(true);

    // --- STEP 1: Player 0 plays Inquisitor to empty court (threshold=0) ---
    const inqCard = playerZones(state, 0).hand.find((c) => c.kind.name === "Inquisitor")!;
    state = apply(state, { kind: "play", cardId: inqCard.id });

    // Should enter resolving phase with optional pass/proceed
    expect(state.phase).toBe("resolving");
    const opts1 = state.pendingResolution!.currentOptions;
    const proceedIdx = opts1.findIndex((o) => o.kind === "proceed");
    expect(proceedIdx).not.toBe(-1);

    // --- STEP 2: Choose "proceed" (use ability) ---
    state = chooseEffect(state, proceedIdx);

    // Should be nameCard choice
    expect(state.phase).toBe("resolving");
    const nameOpts = state.pendingResolution!.currentOptions;
    expect(nameOpts.some((o) => o.kind === "cardName")).toBe(true);

    // --- STEP 3: Name "Queen" ---
    const queenIdx = nameOpts.findIndex(
      (o) => o.kind === "cardName" && o.name === "Queen",
    );
    expect(queenIdx).not.toBe(-1);
    state = chooseEffect(state, queenIdx);

    // --- STEP 4: Player 1 forced to choose their Queen ---
    // forEachOpponent: P1 has Queen, chooseCard presents it
    if (state.phase === "resolving" && state.pendingResolution) {
      const cardOpts = state.pendingResolution.currentOptions;
      if (cardOpts.length > 0 && cardOpts[0]!.kind === "card") {
        state = chooseEffect(state, 0);
      }
    }

    // Resolve remaining effects (end_of_turn if any)
    state = resolveAllNonPlay(state);

    // --- VERIFY: Queen is in Player 1's antechamber ---
    expect(playerZones(state, 1).antechamber.some((c) => c.kind.name === "Queen")).toBe(true);
    expect(state.activePlayer).toBe(1);
    expect(state.phase).toBe("play");

    const courtAfterInq = state.shared.court.length;
    console.log(`  After Inquisitor: court has ${courtAfterInq} cards, P1 antechamber has Queen`);

    // --- STEP 5: Player 1 plays a card from hand ---
    const p1Legal = legalActions(state);
    const p1HandPlay = p1Legal.find(
      (a): a is IKPlayCardAction =>
        a.kind === "play" &&
        playerZones(state, 1).hand.some((c) => c.id === a.cardId),
    );
    expect(p1HandPlay).toBeDefined();
    state = apply(state, p1HandPlay!);

    // --- STEP 6: End-of-turn should auto-play Queen from antechamber ---
    // Resolve everything (effects, end_of_turn antechamber play, Queen ETB)
    state = resolveAllNonPlay(state);

    // --- STEP 7: Assert Queen ETB fired ---
    const queenInCourt = state.shared.court.find(
      (e) => e.card.kind.name === "Queen",
    );
    expect(queenInCourt).toBeDefined();
    expect(queenInCourt!.face).toBe("up");

    const nonQueenCourt = state.shared.court.filter(
      (e) => e.card.kind.name !== "Queen",
    );
    expect(nonQueenCourt.length).toBeGreaterThan(0);
    const allDisgraced = nonQueenCourt.every((e) => e.face === "down");
    expect(allDisgraced).toBe(true);

    console.log(
      `  Chain complete: Queen from antechamber disgraced ${nonQueenCourt.length} court cards`,
    );
  });
});
