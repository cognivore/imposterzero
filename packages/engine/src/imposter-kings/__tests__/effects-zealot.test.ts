/**
 * Tests for the Zealot playOverride condition.
 *
 * Zealot: "If your King is flipped, you may play this card on any
 * non-Royalty card."
 *
 * Scenarios:
 *   1. King not flipped: Zealot (value 3) not in legal actions when
 *      threshold > 3 and King is face-up.
 *   2. King flipped + non-Royalty throne: Zealot IS in legal actions
 *      and can be played.
 */

import { describe, it, expect } from "vitest";

import {
  createDeck,
  dealWithDeck,
  regulationDeck,
  legalActions,
  apply,
  playerZones,
  type IKState,
  type IKPlayCardAction,
} from "../index.js";

/**
 * Builds a 2-player game with deterministic hands:
 *   P0 hand (after setup): Zealot + filler
 *   Court seeded with a Sentry (value 8, non-Royalty) face-up so threshold = 8.
 */
const setupZealotGame = (): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);

  const zealotCards = deck.filter((c) => c.kind.name === "Zealot");
  const otherCards = deck.filter((c) => c.kind.name !== "Zealot");

  const customDeck: typeof deck[number][] = [];
  const p0Cards = [
    otherCards[0]!, otherCards[1]!,
    zealotCards[0]!, otherCards[2]!, otherCards[3]!, otherCards[4]!, otherCards[5]!,
  ];
  const p1Cards = [
    otherCards[6]!, otherCards[7]!,
    otherCards[15]!, otherCards[8]!, otherCards[9]!, otherCards[10]!, otherCards[11]!,
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

  const sentryCard = playerZones(state, 1).hand.find((c) => c.kind.name === "Sentry")
    ?? playerZones(state, 0).hand.find((c) => c.kind.name === "Sentry");

  if (sentryCard) {
    const owner = playerZones(state, 0).hand.some((c) => c.id === sentryCard.id) ? 0 : 1;
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === owner ? { ...p, hand: p.hand.filter((c) => c.id !== sentryCard.id) } : p,
      ),
      shared: {
        ...state.shared,
        court: [{ card: sentryCard, face: "up" as const, playedBy: owner as 0 | 1 }],
      },
    };
  }

  return state;
};

describe("Zealot playOverride", () => {
  it("King not flipped: Zealot not in legal actions when below threshold", () => {
    const state = setupZealotGame();
    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(0);
    expect(playerZones(state, 0).king.face).toBe("up");

    const zealot = playerZones(state, 0).hand.find((c) => c.kind.name === "Zealot")!;
    expect(zealot).toBeDefined();

    const legal = legalActions(state);
    const zealotPlay = legal.find(
      (a): a is IKPlayCardAction => a.kind === "play" && a.cardId === zealot.id,
    );
    expect(zealotPlay).toBeUndefined();

    console.log("  King face-up: Zealot not playable (value 3 < threshold 8)");
  });

  it("King flipped + non-Royalty throne: Zealot is in legal actions and can be played", () => {
    let state = setupZealotGame();

    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, king: { ...p.king, face: "down" as const } } : p,
      ),
    };
    expect(playerZones(state, 0).king.face).toBe("down");

    const zealot = playerZones(state, 0).hand.find((c) => c.kind.name === "Zealot")!;
    const legal = legalActions(state);
    const zealotPlay = legal.find(
      (a): a is IKPlayCardAction => a.kind === "play" && a.cardId === zealot.id,
    );
    expect(zealotPlay).toBeDefined();

    state = apply(state, { kind: "play", cardId: zealot.id });

    expect(state.phase).toBe("play");
    expect(state.activePlayer).toBe(1);
    expect(state.shared.court.some((e) => e.card.id === zealot.id && e.face === "up")).toBe(true);

    console.log("  King flipped: Zealot playable via override, placed in court");
  });
});
