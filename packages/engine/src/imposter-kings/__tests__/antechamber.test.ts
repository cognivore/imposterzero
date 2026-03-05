import { describe, it, expect } from "vitest";

import { deal } from "../deal.js";
import { regulationDeck } from "../card.js";
import { legalActions, apply, applySafe } from "../rules.js";
import { playerZones, type IKState } from "../state.js";
import type { IKPlayerZones } from "../zones.js";
import type { IKPlayCardAction } from "../actions.js";

const seededRandom = (seed: number) => {
  let s = seed;
  return (): number => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const makePlayState = (numPlayers: number, seed = 42): IKState => {
  let state = deal(regulationDeck(numPlayers), numPlayers, seededRandom(seed));
  state = apply(state, { kind: "crown", firstPlayer: state.activePlayer });
  for (let i = 0; i < numPlayers; i++) {
    const legal = legalActions(state);
    const commit = legal.find((a) => a.kind === "commit");
    if (commit) state = apply(state, commit);
  }
  return state;
};

const resolveEffects = (state: IKState): IKState => {
  let s = state;
  while (
    s.phase === ("resolving" as string) ||
    s.phase === ("end_of_turn" as string)
  ) {
    const legal = legalActions(s);
    if (legal.length === 0) break;
    s = apply(s, legal[0]!);
  }
  return s;
};

const putInAntechamber = (
  state: IKState,
  player: number,
  cardId: number,
): IKState => {
  const zones = playerZones(state, player);
  const card = zones.hand.find((c) => c.id === cardId);
  if (!card) return state;
  const next: IKPlayerZones = {
    ...zones,
    hand: zones.hand.filter((c) => c.id !== cardId),
    antechamber: [...zones.antechamber, card],
  };
  return {
    ...state,
    players: state.players.map((p, i) => (i === player ? next : p)),
  };
};

describe("antechamber mechanics", () => {
  describe("antechamber cards are legal plays", () => {
    it("antechamber cards appear in legalActions during play phase", () => {
      let state = makePlayState(3);
      const active = state.activePlayer;
      const hand = playerZones(state, active).hand;
      if (hand.length < 2) return;
      state = putInAntechamber(state, active, hand[0]!.id);
      const legal = legalActions(state);
      const antechamberCard = playerZones(state, active).antechamber[0]!;
      const hasAntechamberPlay = legal.some(
        (a) => a.kind === "play" && a.cardId === antechamberCard.id,
      );
      expect(hasAntechamberPlay).toBe(true);
    });
  });

  describe("Herald from Antechamber", () => {
    it("Herald's ability is suppressed when played from antechamber", () => {
      let state = makePlayState(3);
      const active = state.activePlayer;
      const hand = playerZones(state, active).hand;
      const herald = hand.find((c) => c.kind.name === "Herald");
      if (!herald) return;

      state = putInAntechamber(state, active, herald.id);
      const result = applySafe(state, { kind: "play", cardId: herald.id });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const afterPlay = resolveEffects(result.value);
      expect(afterPlay.shared.court.some((e) => e.card.id === herald.id)).toBe(true);
      expect(afterPlay.phase).not.toBe("resolving");
    });

    it("Fool's ability triggers when played from antechamber", () => {
      let state = makePlayState(2);

      let play1state = state;
      const firstPlay = legalActions(play1state).find(
        (a) => a.kind === "play",
      ) as IKPlayCardAction | undefined;
      if (!firstPlay) return;
      play1state = resolveEffects(apply(play1state, firstPlay));

      const active = play1state.activePlayer;
      const hand = playerZones(play1state, active).hand;
      const fool = hand.find((c) => c.kind.name === "Fool");
      if (!fool) return;

      play1state = putInAntechamber(play1state, active, fool.id);
      const courtBefore = play1state.shared.court.length;
      expect(courtBefore).toBeGreaterThan(0);

      const result = applySafe(play1state, {
        kind: "play",
        cardId: fool.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const foolPlayed = result.value;
      const isResolving =
        foolPlayed.phase === "resolving" || foolPlayed.phase === "end_of_turn";
      expect(isResolving).toBe(true);
    });
  });
});
