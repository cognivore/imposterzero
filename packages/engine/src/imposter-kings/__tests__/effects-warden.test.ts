/**
 * Seeded deterministic tests for the Warden card effect.
 *
 * Warden (value 7): "If there are four or more faceup cards in the Court,
 * you may exchange any card from your hand with the Accused card."
 *
 * Scenarios:
 *   1. Precondition met, use ability: Court has 4+ face-up cards (Warden
 *      adds 5th). Proceed → choose hand card → accused swaps into hand.
 *   2. Precondition not met: Court has fewer than 4 face-up. Effect skips,
 *      turn advances.
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
 * Builds a 2-player game with Warden in P0's hand.
 * Seeds court with face-up cards for precondition tests.
 */
const setupWardenGame = (courtFaceUpCount: number): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const warden = deck.find((c) => c.kind.name === "Warden")!;
  const otherCards = deck.filter((c) => c.kind.name !== "Warden");

  const customDeck: typeof deck[number][] = [];
  const p0Cards = [
    otherCards[0]!,
    otherCards[1]!,
    warden,
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

  if (courtFaceUpCount > 0) {
    const courtCards: typeof deck[number][] = [];
    for (let i = 0; i < courtFaceUpCount; i++) {
      const donor = i % 2 === 0 ? 0 : 1;
      const hand = playerZones(state, donor).hand;
      const card = hand.find(
        (c) => c.id !== warden.id && !courtCards.some((cc) => cc.id === c.id),
      );
      if (card) {
        courtCards.push(card);
      }
    }
    state = {
      ...state,
      players: state.players.map((p, i) => {
        const removed = courtCards.filter((c) =>
          p.hand.some((h) => h.id === c.id),
        );
        if (removed.length === 0) return p;
        return {
          ...p,
          hand: p.hand.filter((c) => !removed.some((r) => r.id === c.id)),
        };
      }),
      shared: {
        ...state.shared,
        court: courtCards.map((card) => ({
          card,
          face: "up" as const,
          playedBy: (courtCards.indexOf(card) % 2) as 0 | 1,
        })),
      },
    };
  }

  return state;
};

describe("Warden card effect", () => {
  it("precondition met, use ability: hand card swaps with accused", () => {
    let state = setupWardenGame(3);
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);
    expect(state.shared.court.filter((e) => e.face === "up")).toHaveLength(3);

    const warden = playerZones(state, 0).hand.find((c) => c.kind.name === "Warden")!;
    const handCardToGive = playerZones(state, 0).hand.find(
      (c) => c.id !== warden.id,
    )!;
    const accusedBefore = state.shared.accused!;

    state = apply(state, { kind: "play", cardId: warden.id });

    expect(state.shared.court.filter((e) => e.face === "up")).toHaveLength(4);

    expect(state.phase).toBe("resolving");
    let opts = state.pendingResolution!.currentOptions;
    state = chooseEffect(state, opts.findIndex((o) => o.kind === "proceed"));

    expect(state.phase).toBe("resolving");
    opts = state.pendingResolution!.currentOptions;
    expect(opts.every((o) => o.kind === "card")).toBe(true);
    const handCardIdx = opts.findIndex(
      (o) => o.kind === "card" && (o as { kind: "card"; cardId: number }).cardId === handCardToGive.id,
    );
    expect(handCardIdx).not.toBe(-1);
    state = chooseEffect(state, handCardIdx);

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);

    expect(playerZones(state, 0).hand.some((c) => c.id === accusedBefore.id)).toBe(true);
    expect(playerZones(state, 0).hand.every((c) => c.id !== handCardToGive.id)).toBe(true);
    expect(state.shared.accused?.id).toBe(handCardToGive.id);

    console.log(
      `  Swap complete: P0 gave ${handCardToGive.kind.name}, received accused (${accusedBefore.kind.name})`,
    );
  });

  it("precondition not met: effect skips, turn advances", () => {
    let state = setupWardenGame(2);
    expect(state.shared.court.filter((e) => e.face === "up")).toHaveLength(2);

    const warden = playerZones(state, 0).hand.find((c) => c.kind.name === "Warden")!;
    const accusedBefore = state.shared.accused?.id;

    state = apply(state, { kind: "play", cardId: warden.id });

    expect(state.shared.court.filter((e) => e.face === "up")).toHaveLength(3);
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);
    expect(state.pendingResolution).toBeNull();
    expect(state.shared.accused?.id).toBe(accusedBefore);

    console.log("  Precondition not met: no resolving phase, turn advanced");
  });
});
