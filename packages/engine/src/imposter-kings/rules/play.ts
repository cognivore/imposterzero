import { ok, err, type Result } from "@imposter-zero/types";

import { ikCardOps } from "../card.js";
import type { TransitionError } from "../errors.js";
import { nextPlayer, playerZones, throne, type IKState } from "../state.js";
import { throneValue } from "../selectors.js";
import type { IKPlayerZones } from "../zones.js";
import { replacePlayerZones } from "./shared.js";

export const applyPlaySafe = (
  state: IKState,
  cardId: number,
): Result<TransitionError, IKState> => {
  const activePlayer = state.activePlayer;
  const active = playerZones(state, activePlayer);
  const card = active.hand.find((candidate) => candidate.id === cardId);

  if (card === undefined) {
    return err({ kind: "card_not_in_hand", cardId });
  }

  const requiredValue = throneValue(state);
  if (ikCardOps.value(card) < requiredValue) {
    return err({ kind: "insufficient_value", cardValue: ikCardOps.value(card), threshold: requiredValue });
  }

  const nextActive: IKPlayerZones = {
    ...active,
    hand: active.hand.filter((candidate) => candidate.id !== card.id),
  };

  const players = replacePlayerZones(state.players, activePlayer, nextActive);
  return ok({
    ...state,
    players,
    shared: {
      ...state.shared,
      court: [...state.shared.court, { card, face: "up", playedBy: activePlayer }],
    },
    activePlayer: nextPlayer(state),
    turnCount: state.turnCount + 1,
  });
};

export const applyDisgraceSafe = (
  state: IKState,
): Result<TransitionError, IKState> => {
  const activePlayer = state.activePlayer;
  const active = playerZones(state, activePlayer);
  const top = throne(state);

  if (top === null) {
    return err({ kind: "no_throne_for_disgrace" });
  }

  if (active.king.face === "down") {
    return err({ kind: "king_already_down" });
  }

  const nextActive: IKPlayerZones = {
    ...active,
    king: { ...active.king, face: "down" },
  };

  const topIndex = state.shared.court.length - 1;
  const court = state.shared.court.map((entry, idx) =>
    idx === topIndex ? { ...entry, face: "down" as const } : entry,
  );
  const players = replacePlayerZones(state.players, activePlayer, nextActive);

  return ok({
    ...state,
    players,
    shared: { ...state.shared, court },
    activePlayer: nextPlayer(state),
    turnCount: state.turnCount + 1,
  });
};
