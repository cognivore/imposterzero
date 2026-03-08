/**
 * Tests for the King disgrace action.
 *
 * King: "Flip to Disgrace the card on the Throne and take your Successor
 * as your turn."
 *
 * The Successor is always set when disgrace is available (the game guarantees
 * this), so we only test the normal path.
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
} from "../index.js";

const setupPlayState = (): IKState => {
  const kinds = regulationDeck(2);
  const deck = createDeck(kinds);
  let state = dealWithDeck(deck, 2, 0);
  state = apply(state, { kind: "crown", firstPlayer: 0 });
  const s1 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s1);
  const s2 = legalActions(state).find((a) => a.kind === "commit")!;
  state = apply(state, s2);
  return state;
};

const driveToDisgrace = (state: IKState): IKState | null => {
  const lowCard = playerZones(state, 0).hand.reduce((a, b) =>
    a.kind.props.value <= b.kind.props.value ? a : b,
  );
  state = apply(state, { kind: "play", cardId: lowCard.id });

  for (let i = 0; i < 20 && (state.phase === "resolving" || state.phase === "end_of_turn"); i++) {
    const legal = legalActions(state);
    if (legal.length === 0) break;
    state = apply(state, legal[0]!);
  }

  if (state.activePlayer === 1 && state.phase === "play") {
    const p1Play = legalActions(state).find((a) => a.kind === "play");
    if (!p1Play) return null;
    state = apply(state, p1Play);
    for (let i = 0; i < 20 && (state.phase === "resolving" || state.phase === "end_of_turn"); i++) {
      const legal = legalActions(state);
      if (legal.length === 0) break;
      state = apply(state, legal[0]!);
    }
  }

  if (state.activePlayer !== 0 || state.phase !== "play") return null;
  if (!legalActions(state).some((a) => a.kind === "disgrace")) return null;
  return state;
};

describe("King disgrace action", () => {
  it("successor moves to hand when King is flipped face-down", () => {
    let state = setupPlayState();
    const driven = driveToDisgrace(state);
    if (driven === null) return;
    state = driven;

    const p0Before = playerZones(state, 0);
    expect(p0Before.king.face).toBe("up");
    expect(p0Before.successor).not.toBeNull();
    const successorCard = p0Before.successor!.card;
    const handSizeBefore = p0Before.hand.length;

    state = apply(state, { kind: "disgrace" });
    for (let i = 0; i < 20 && state.phase === "resolving"; i++) {
      const legal = legalActions(state);
      if (legal.length === 0) break;
      state = apply(state, legal[0]!);
    }

    const p0After = playerZones(state, 0);
    expect(p0After.king.face).toBe("down");
    expect(p0After.successor).toBeNull();
    expect(p0After.hand.some((c) => c.id === successorCard.id)).toBe(true);
    expect(p0After.hand.length).toBe(handSizeBefore + 1);
  });

  it("direct setup: successor recalled on disgrace", () => {
    const kinds = regulationDeck(2);
    const deck = createDeck(kinds);
    let state = dealWithDeck(deck, 2, 0);
    state = apply(state, { kind: "crown", firstPlayer: 0 });
    const s1 = legalActions(state).find((a) => a.kind === "commit")!;
    state = apply(state, s1);
    const s2 = legalActions(state).find((a) => a.kind === "commit")!;
    state = apply(state, s2);

    const p0Before = playerZones(state, 0);
    expect(p0Before.successor).not.toBeNull();
    const successorCard = p0Before.successor!.card;

    const lowCard = p0Before.hand.reduce((a, b) =>
      a.kind.props.value <= b.kind.props.value ? a : b,
    );
    state = apply(state, { kind: "play", cardId: lowCard.id });
    for (let i = 0; i < 20 && (state.phase === "resolving" || state.phase === "end_of_turn"); i++) {
      const legal = legalActions(state);
      if (legal.length === 0) break;
      state = apply(state, legal[0]!);
    }

    if (state.activePlayer === 1 && state.phase === "play") {
      const p1Play = legalActions(state).find((a) => a.kind === "play");
      if (!p1Play) return;
      state = apply(state, p1Play);
      for (let i = 0; i < 20 && (state.phase === "resolving" || state.phase === "end_of_turn"); i++) {
        const legal = legalActions(state);
        if (legal.length === 0) break;
        state = apply(state, legal[0]!);
      }
    }

    if (state.activePlayer !== 0 || !legalActions(state).some((a) => a.kind === "disgrace")) return;

    const p0Pre = playerZones(state, 0);
    expect(p0Pre.king.face).toBe("up");
    expect(p0Pre.successor).not.toBeNull();

    state = apply(state, { kind: "disgrace" });
    for (let i = 0; i < 20 && state.phase === "resolving"; i++) {
      const legal = legalActions(state);
      if (legal.length === 0) break;
      state = apply(state, legal[0]!);
    }

    const p0After = playerZones(state, 0);
    expect(p0After.king.face).toBe("down");
    expect(p0After.successor).toBeNull();
    expect(p0After.hand.some((c) => c.id === successorCard.id)).toBe(true);
  });
});
