import { ok, err, type Result, type PlayerId } from "@imposter-zero/types";

import type { IKSetupAction } from "../actions.js";
import type { TransitionError } from "../errors.js";
import { nextPlayer, playerZones, type IKState } from "../state.js";
import { allPlayersCommittedSetup } from "../selectors.js";
import type { KingFacet, IKPlayerZones } from "../zones.js";
import { replacePlayerZones } from "./shared.js";

export const commitActionsForHand = (
  hand: ReadonlyArray<IKPlayerZones["hand"][number]>,
  facet: KingFacet = "default",
): ReadonlyArray<IKSetupAction> => {
  if (facet === "masterTactician") {
    return hand.flatMap((successor) =>
      hand
        .filter((dungeon) => dungeon.id !== successor.id)
        .flatMap((dungeon) =>
          hand
            .filter((squire) => squire.id !== successor.id && squire.id !== dungeon.id)
            .map((squire) => ({
              kind: "commit" as const,
              successorId: successor.id,
              dungeonId: dungeon.id,
              squireId: squire.id,
            })),
        ),
    );
  }
  return hand.flatMap((successor) =>
    hand
      .filter((dungeon) => dungeon.id !== successor.id)
      .map((dungeon) => ({
        kind: "commit" as const,
        successorId: successor.id,
        dungeonId: dungeon.id,
      })),
  );
};

const revealCharismaticSuccessors = (state: IKState): IKState => {
  const revealed: PlayerId[] = [];
  for (let i = 0; i < state.numPlayers; i++) {
    if (state.players[i]!.king.facet === "charismatic") {
      revealed.push(i as PlayerId);
    }
  }
  return revealed.length > 0
    ? { ...state, revealedSuccessors: [...state.revealedSuccessors, ...revealed] }
    : state;
};

export const applyCommitSafe = (
  state: IKState,
  action: IKSetupAction,
): Result<TransitionError, IKState> => {
  if (action.successorId === action.dungeonId) {
    return err({ kind: "same_card_commit", cardId: action.successorId });
  }

  const activePlayer = state.activePlayer;
  const active = playerZones(state, activePlayer);
  const facet = active.king.facet;
  const successor = active.hand.find((card) => card.id === action.successorId);
  const dungeon = active.hand.find((card) => card.id === action.dungeonId);

  if (successor === undefined || dungeon === undefined) {
    return err({ kind: "cards_not_found", successorId: action.successorId, dungeonId: action.dungeonId });
  }

  const selected = new Set([action.successorId, action.dungeonId]);

  let squireEntry: IKPlayerZones["squire"] = null;
  if (facet === "masterTactician") {
    if (action.squireId === undefined || action.squireId === null) {
      return err({ kind: "cards_not_found", successorId: action.successorId, dungeonId: action.dungeonId });
    }
    const squireCard = active.hand.find((card) => card.id === action.squireId);
    if (!squireCard) {
      return err({ kind: "cards_not_found", successorId: action.successorId, dungeonId: action.dungeonId });
    }
    selected.add(action.squireId);
    squireEntry = { card: squireCard, face: "down" };
  }

  const nextActive: IKPlayerZones = {
    ...active,
    hand: active.hand.filter((card) => !selected.has(card.id)),
    successor: { card: successor, face: "down" },
    dungeon: { card: dungeon, face: "down" },
    squire: squireEntry,
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

  return ok(revealCharismaticSuccessors({
    ...intermediate,
    phase: "play",
    activePlayer: intermediate.firstPlayer,
  }));
};
