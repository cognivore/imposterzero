import { ok, err, type Result } from "@imposter-zero/types";

import type {
  IKBeginRecruitAction,
  IKRecruitAction,
  IKRecommissionAction,
  IKMusteringAction,
  IKAction,
} from "../actions.js";
import type { TransitionError } from "../errors.js";
import type { IKState } from "../state.js";
import { playerZones, nextPlayer } from "../state.js";
import { replacePlayerZones } from "./shared.js";
import type { IKPlayerZones } from "../zones.js";

export const applyBeginRecruitSafe = (
  state: IKState,
  action: IKBeginRecruitAction,
): Result<TransitionError, IKState> => {
  const zones = playerZones(state, state.activePlayer);

  const exhaustCard = zones.army.find((c) => c.id === action.exhaustCardId);
  if (!exhaustCard) return err({ kind: "card_not_in_army", cardId: action.exhaustCardId });

  const nextZones: IKPlayerZones = {
    ...zones,
    army: zones.army.filter((c) => c.id !== action.exhaustCardId),
    exhausted: [...zones.exhausted, exhaustCard],
  };

  return ok({
    ...state,
    players: replacePlayerZones(state.players, state.activePlayer, nextZones),
    hasExhaustedThisMustering: true,
  });
};

export const applyRecruitSafe = (
  state: IKState,
  action: IKRecruitAction,
): Result<TransitionError, IKState> => {
  if (!state.hasExhaustedThisMustering) {
    return err({ kind: "must_exhaust_for_first_recruit" });
  }

  const zones = playerZones(state, state.activePlayer);

  const handCard = zones.hand.find((c) => c.id === action.discardFromHandId);
  if (!handCard) return err({ kind: "card_not_in_hand", cardId: action.discardFromHandId });

  const armyCard = zones.army.find((c) => c.id === action.takeFromArmyId);
  if (!armyCard) return err({ kind: "card_not_in_army", cardId: action.takeFromArmyId });

  const nextZones: IKPlayerZones = {
    ...zones,
    hand: [...zones.hand.filter((c) => c.id !== action.discardFromHandId), armyCard],
    army: zones.army.filter((c) => c.id !== action.takeFromArmyId),
    recruitDiscard: [...zones.recruitDiscard, handCard],
  };

  return ok({
    ...state,
    players: replacePlayerZones(state.players, state.activePlayer, nextZones),
    armyRecruitedIds: [...state.armyRecruitedIds, action.takeFromArmyId],
  });
};

export const applyRecommissionSafe = (
  state: IKState,
  action: IKRecommissionAction,
): Result<TransitionError, IKState> => {
  const zones = playerZones(state, state.activePlayer);

  const ex1 = zones.army.find((c) => c.id === action.exhaust1Id);
  if (!ex1) return err({ kind: "card_not_in_army", cardId: action.exhaust1Id });
  const ex2 = zones.army.find((c) => c.id === action.exhaust2Id && c.id !== action.exhaust1Id);
  if (!ex2) return err({ kind: "card_not_in_army", cardId: action.exhaust2Id });

  const recover = zones.exhausted.find((c) => c.id === action.recoverFromExhaustId);
  if (!recover) return err({ kind: "card_not_exhausted", cardId: action.recoverFromExhaustId });

  const nextZones: IKPlayerZones = {
    ...zones,
    army: [
      ...zones.army.filter((c) => c.id !== action.exhaust1Id && c.id !== action.exhaust2Id),
      recover,
    ],
    exhausted: [
      ...zones.exhausted.filter((c) => c.id !== action.recoverFromExhaustId),
      ex1,
      ex2,
    ],
  };

  return ok({
    ...state,
    players: replacePlayerZones(state.players, state.activePlayer, nextZones),
    hasExhaustedThisMustering: true,
  });
};

export const applyEndMusteringSafe = (
  state: IKState,
): Result<TransitionError, IKState> => {
  const done = state.musteringPlayersDone + 1;
  if (done >= state.numPlayers) {
    return ok({
      ...state,
      phase: "setup" as const,
      activePlayer: state.firstPlayer,
      musteringPlayersDone: done,
      hasExhaustedThisMustering: false,
    });
  }
  return ok({
    ...state,
    activePlayer: state.firstPlayer,
    musteringPlayersDone: done,
    hasExhaustedThisMustering: false,
  });
};

export const applyMusteringSafe = (
  state: IKState,
  action: IKMusteringAction,
): Result<TransitionError, IKState> => {
  switch (action.kind) {
    case "begin_recruit":
      return applyBeginRecruitSafe(state, action);
    case "recruit":
      return applyRecruitSafe(state, action);
    case "recommission":
      return applyRecommissionSafe(state, action);
    case "end_mustering":
      return applyEndMusteringSafe(state);
  }
};

export const legalMusteringActions = (state: IKState): ReadonlyArray<IKAction> => {
  const zones = playerZones(state, state.activePlayer);
  const actions: IKAction[] = [];

  actions.push({ kind: "end_mustering" });

  if (!state.hasExhaustedThisMustering && zones.army.length > 0) {
    for (const card of zones.army) {
      actions.push({ kind: "begin_recruit", exhaustCardId: card.id });
    }
  }

  if (state.hasExhaustedThisMustering && zones.army.length > 0 && zones.hand.length > 0) {
    for (const handCard of zones.hand) {
      for (const armyCard of zones.army) {
        actions.push({
          kind: "recruit",
          discardFromHandId: handCard.id,
          takeFromArmyId: armyCard.id,
        });
      }
    }
  }

  if (zones.army.length >= 2 && zones.exhausted.length >= 1) {
    for (let i = 0; i < zones.army.length; i++) {
      for (let j = i + 1; j < zones.army.length; j++) {
        for (const recover of zones.exhausted) {
          actions.push({
            kind: "recommission",
            exhaust1Id: zones.army[i]!.id,
            exhaust2Id: zones.army[j]!.id,
            recoverFromExhaustId: recover.id,
          });
        }
      }
    }
  }

  return actions;
};
