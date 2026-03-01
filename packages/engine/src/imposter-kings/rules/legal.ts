import { ikCardOps } from "../card.js";
import type { IKAction } from "../actions.js";
import { playerZones, throne, type IKState } from "../state.js";
import { throneValue, isKingFaceUp } from "../selectors.js";
import { commitActionsForHand } from "./setup.js";

export const legalActions = (state: IKState): ReadonlyArray<IKAction> => {
  const active = playerZones(state, state.activePlayer);

  if (state.phase === "setup") {
    if (active.successor !== null || active.dungeon !== null) {
      return [];
    }
    return commitActionsForHand(active.hand);
  }

  const threshold = throneValue(state);
  const playable = active.hand
    .filter((card) => ikCardOps.value(card) >= threshold)
    .map((card) => ({ kind: "play" as const, cardId: card.id }));

  const canDisgrace = isKingFaceUp(state, state.activePlayer) && throne(state) !== null;
  return canDisgrace ? [...playable, { kind: "disgrace" }] : playable;
};
