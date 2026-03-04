import { ok, err, type Result } from "@imposter-zero/types";

import type { IKSetupAction } from "../actions.js";
import type { TransitionError } from "../errors.js";
import { nextPlayer, playerZones, type IKState } from "../state.js";
import { allPlayersCommittedSetup } from "../selectors.js";
import type { IKPlayerZones } from "../zones.js";
import { replacePlayerZones } from "./shared.js";

export const commitActionsForHand = (
  hand: ReadonlyArray<IKPlayerZones["hand"][number]>,
): ReadonlyArray<IKSetupAction> =>
  hand.flatMap((successor) =>
    hand
      .filter((dungeon) => dungeon.id !== successor.id)
      .map((dungeon) => ({
        kind: "commit" as const,
        successorId: successor.id,
        dungeonId: dungeon.id,
      })),
  );

export const applyCommitSafe = (
  state: IKState,
  action: IKSetupAction,
): Result<TransitionError, IKState> => {
  if (action.successorId === action.dungeonId) {
    return err({ kind: "same_card_commit", cardId: action.successorId });
  }

  const activePlayer = state.activePlayer;
  const active = playerZones(state, activePlayer);
  const successor = active.hand.find((card) => card.id === action.successorId);
  const dungeon = active.hand.find((card) => card.id === action.dungeonId);

  if (successor === undefined || dungeon === undefined) {
    return err({ kind: "cards_not_found", successorId: action.successorId, dungeonId: action.dungeonId });
  }

  const selected = new Set([action.successorId, action.dungeonId]);
  const nextActive: IKPlayerZones = {
    ...active,
    hand: active.hand.filter((card) => !selected.has(card.id)),
    successor: { card: successor, face: "down" },
    dungeon: { card: dungeon, face: "down" },
  };

  const players = replacePlayerZones(state.players, activePlayer, nextActive);
  const intermediate: IKState = {
    ...state,
    players,
    activePlayer: nextPlayer(state),
    turnCount: state.turnCount + 1,
  };

  if (!allPlayersCommittedSetup(intermediate)) {
    return ok(intermediate);
  }

  return ok({
    ...intermediate,
    phase: "play",
    activePlayer: intermediate.firstPlayer,
  });
};
