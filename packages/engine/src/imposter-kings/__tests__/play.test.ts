import { describe, it, expect } from "vitest";

import { deal } from "../deal.js";
import { regulationDeck, ikCardOps } from "../card.js";
import { legalActions, apply, applySafe, isTerminal } from "../rules.js";
import { playerZones, throne } from "../state.js";
import { throneValue, isKingFaceUp } from "../selectors.js";
import type { IKSetupAction, IKPlayCardAction } from "../actions.js";
import type { IKState } from "../state.js";

const seededRandom = (seed: number) => {
  let s = seed;
  return (): number => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const makeState = (numPlayers: number, seed = 42): IKState =>
  deal(regulationDeck(numPlayers), numPlayers, seededRandom(seed));

const firstCommit = (state: IKState): IKSetupAction => {
  const actions = legalActions(state);
  const commit = actions.find((a): a is IKSetupAction => a.kind === "commit");
  return commit!;
};

const toPlayPhase = (numPlayers: number, seed = 42): IKState => {
  let state = makeState(numPlayers, seed);
  for (let i = 0; i < numPlayers; i++) {
    state = apply(state, firstCommit(state));
  }
  return state;
};

describe("play phase", () => {
  describe("legal play actions", () => {
    it("initially all hand cards are playable (throne empty, threshold=0)", () => {
      const state = toPlayPhase(2);
      const hand = playerZones(state, state.activePlayer).hand;
      const plays = legalActions(state).filter((a) => a.kind === "play");
      expect(plays).toHaveLength(hand.length);
    });

    it("includes disgrace when king is face-up and throne is occupied", () => {
      const state = toPlayPhase(2);
      const play = legalActions(state).find((a) => a.kind === "play") as IKPlayCardAction;
      const afterPlay = apply(state, play);
      const legal = legalActions(afterPlay);
      const hasDisgrace = legal.some((a) => a.kind === "disgrace");
      if (isKingFaceUp(afterPlay, afterPlay.activePlayer)) {
        expect(hasDisgrace).toBe(true);
      }
    });

    it("excludes cards below throne value", () => {
      const state = toPlayPhase(2);
      const play = legalActions(state).find((a) => a.kind === "play") as IKPlayCardAction;
      const afterPlay = apply(state, play);
      const threshold = throneValue(afterPlay);
      const legal = legalActions(afterPlay).filter((a) => a.kind === "play") as ReadonlyArray<IKPlayCardAction>;
      const hand = playerZones(afterPlay, afterPlay.activePlayer).hand;
      for (const a of legal) {
        const card = hand.find((c) => c.id === a.cardId)!;
        expect(ikCardOps.value(card)).toBeGreaterThanOrEqual(threshold);
      }
    });
  });

  describe("applying play", () => {
    it("places card on court face-up", () => {
      const state = toPlayPhase(2);
      const play = legalActions(state).find((a) => a.kind === "play") as IKPlayCardAction;
      const next = apply(state, play);
      expect(next.shared.court).toHaveLength(1);
      expect(next.shared.court[0]!.face).toBe("up");
      expect(next.shared.court[0]!.card.id).toBe(play.cardId);
    });

    it("records playedBy as the acting player", () => {
      const state = toPlayPhase(2);
      const play = legalActions(state).find((a) => a.kind === "play") as IKPlayCardAction;
      const next = apply(state, play);
      expect(next.shared.court[0]!.playedBy).toBe(state.activePlayer);
    });

    it("removes card from hand", () => {
      const state = toPlayPhase(2);
      const play = legalActions(state).find((a) => a.kind === "play") as IKPlayCardAction;
      const handBefore = playerZones(state, state.activePlayer).hand.length;
      const next = apply(state, play);
      const handAfter = playerZones(next, state.activePlayer).hand.length;
      expect(handAfter).toBe(handBefore - 1);
    });

    it("advances active player", () => {
      const state = toPlayPhase(2);
      const play = legalActions(state).find((a) => a.kind === "play") as IKPlayCardAction;
      const next = apply(state, play);
      expect(next.activePlayer).not.toBe(state.activePlayer);
    });

    it("court accumulates across turns", () => {
      let state = toPlayPhase(2);
      let moves = 0;
      while (!isTerminal(state) && moves < 20) {
        const legal = legalActions(state);
        const play = legal.find((a) => a.kind === "play");
        if (!play) break;
        state = apply(state, play);
        moves++;
      }
      expect(state.shared.court.length).toBe(moves);
    });
  });

  describe("disgrace semantics", () => {
    const findDisgraceState = (): { state: IKState; preDisgrace: IKState } | null => {
      for (let seed = 1; seed < 200; seed++) {
        let state = toPlayPhase(2, seed);
        let moves = 0;
        while (!isTerminal(state) && moves < 30) {
          const legal = legalActions(state);
          const disgrace = legal.find((a) => a.kind === "disgrace");
          if (disgrace) {
            return { state, preDisgrace: state };
          }
          const play = legal.find((a) => a.kind === "play");
          if (!play) break;
          state = apply(state, play);
          moves++;
        }
      }
      return null;
    };

    it("flips active player king face-down", () => {
      const found = findDisgraceState();
      expect(found).not.toBeNull();
      const { state } = found!;
      const player = state.activePlayer;
      expect(isKingFaceUp(state, player)).toBe(true);
      const next = apply(state, { kind: "disgrace" });
      expect(isKingFaceUp(next, player)).toBe(false);
    });

    it("flips throne card face-down", () => {
      const found = findDisgraceState();
      expect(found).not.toBeNull();
      const { state } = found!;
      const top = throne(state);
      expect(top).not.toBeNull();
      expect(top!.face).toBe("up");
      const next = apply(state, { kind: "disgrace" });
      const newTop = throne(next);
      expect(newTop!.face).toBe("down");
    });

    it("advances active player", () => {
      const found = findDisgraceState();
      expect(found).not.toBeNull();
      const { state } = found!;
      const next = apply(state, { kind: "disgrace" });
      expect(next.activePlayer).not.toBe(state.activePlayer);
    });

    it("does not remove any card from hand", () => {
      const found = findDisgraceState();
      expect(found).not.toBeNull();
      const { state } = found!;
      const handBefore = playerZones(state, state.activePlayer).hand.length;
      const next = apply(state, { kind: "disgrace" });
      const handAfter = playerZones(next, state.activePlayer).hand.length;
      expect(handAfter).toBe(handBefore);
    });
  });

  describe("illegal actions during play", () => {
    it("throws on commit during play phase", () => {
      const state = toPlayPhase(2);
      expect(() =>
        apply(state, { kind: "commit", successorId: 0, dungeonId: 1 }),
      ).toThrow();
    });

    it("throws when playing a card not in hand", () => {
      const state = toPlayPhase(2);
      expect(() => apply(state, { kind: "play", cardId: 999 })).toThrow();
    });
  });

  describe("applySafe error paths", () => {
    it("returns phase_mismatch for commit during play", () => {
      const state = toPlayPhase(2);
      const result = applySafe(state, { kind: "commit", successorId: 0, dungeonId: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("phase_mismatch");
    });

    it("returns card_not_in_hand for missing card", () => {
      const state = toPlayPhase(2);
      const result = applySafe(state, { kind: "play", cardId: 999 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("card_not_in_hand");
    });

    it("returns ok for valid play", () => {
      const state = toPlayPhase(2);
      const play = legalActions(state).find((a) => a.kind === "play")!;
      const result = applySafe(state, play);
      expect(result.ok).toBe(true);
    });
  });
});
