import { describe, it, expect } from "vitest";

import { deal, createDeck } from "../deal.js";
import { regulationDeck } from "../card.js";
import { legalActions, apply, applySafe } from "../rules.js";
import { playerZones, type IKState } from "../state.js";
import type { IKPlayerZones } from "../zones.js";
import type { IKPlayCardAction } from "../actions.js";
import type { PlayerId } from "@imposter-zero/types";

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
  describe("antechamber cards are forced plays", () => {
    it("antechamber cards are the only legal plays during play phase", () => {
      let state = makePlayState(3);
      const active = state.activePlayer;
      const hand = playerZones(state, active).hand;
      if (hand.length < 2) return;
      state = putInAntechamber(state, active, hand[0]!.id);
      const legal = legalActions(state);
      const antechamberCard = playerZones(state, active).antechamber[0]!;

      const playActions = legal.filter((a) => a.kind === "play");
      expect(playActions).toHaveLength(1);
      expect(playActions[0]!.kind === "play" && playActions[0]!.cardId === antechamberCard.id).toBe(true);

      const hasHandPlay = legal.some(
        (a) => a.kind === "play" && hand.slice(1).some((c) => c.id === (a as IKPlayCardAction).cardId),
      );
      expect(hasHandPlay).toBe(false);
    });
  });

  describe("Oathbound from Antechamber", () => {
    it("Oathbound effect does not trigger when played from antechamber onto higher-value card", () => {
      let state = makePlayState(2);
      const active = state.activePlayer;

      const deck = createDeck(regulationDeck(2));
      const queenKind = deck.find((c) => c.kind.name === "Queen")!.kind;
      const oathboundKind = deck.find((c) => c.kind.name === "Oathbound")!.kind;

      const queenCard = { id: 9000, kind: queenKind };
      const oathboundCard = { id: 9001, kind: oathboundKind };

      const zones = playerZones(state, active);
      state = {
        ...state,
        players: state.players.map((p, i) =>
          i === active
            ? { ...p, hand: zones.hand, antechamber: [oathboundCard] }
            : p,
        ),
        shared: {
          ...state.shared,
          court: [{ card: queenCard, face: "up" as const, playedBy: ((1 - active) as PlayerId) }],
        },
      };

      expect(playerZones(state, active).antechamber).toHaveLength(1);
      expect(state.shared.court[0]!.card.kind.props.value).toBe(9);

      const legal = legalActions(state);
      const oathboundPlay = legal.find(
        (a) => a.kind === "play" && a.cardId === oathboundCard.id,
      );
      expect(oathboundPlay).toBeDefined();

      const result = applySafe(state, oathboundPlay!);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const afterPlay = resolveEffects(result.value);

      expect(afterPlay.shared.court.some((e) => e.card.id === oathboundCard.id)).toBe(true);

      const queenEntry = afterPlay.shared.court.find((e) => e.card.id === queenCard.id);
      expect(queenEntry).toBeDefined();
      expect(queenEntry!.face).toBe("up");

      expect(afterPlay.phase).toBe("play");
      expect(afterPlay.activePlayer).not.toBe(active);
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
