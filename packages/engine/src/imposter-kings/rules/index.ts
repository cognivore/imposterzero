import { err, ok, type Result } from "@imposter-zero/types";

import type { IKAction, IKCrownAction } from "../actions.js";
import { type TransitionError, transitionErrorMessage } from "../errors.js";
import type { IKState } from "../state.js";
import { applyCommitSafe } from "./setup.js";
import {
  applyPlaySafe,
  applyDisgraceSafe,
  applyEffectChoiceSafe,
  applyEndOfTurnSafe,
} from "./play.js";

export { legalActions } from "./legal.js";
export { isTerminal, currentPlayer, returns } from "./terminal.js";

const applyCrownSafe = (
  state: IKState,
  action: IKCrownAction,
): Result<TransitionError, IKState> => {
  if (action.firstPlayer < 0 || action.firstPlayer >= state.numPlayers) {
    return err({ kind: "invalid_first_player", player: action.firstPlayer });
  }
  return ok({
    ...state,
    phase: "setup" as const,
    activePlayer: action.firstPlayer,
    firstPlayer: action.firstPlayer,
    turnCount: state.turnCount + 1,
  });
};

export const applySafe = (state: IKState, action: IKAction): Result<TransitionError, IKState> => {
  if (state.phase === "crown") {
    if (action.kind !== "crown") {
      return err({ kind: "phase_mismatch", phase: "crown", actionKind: action.kind });
    }
    return applyCrownSafe(state, action);
  }

  if (state.phase === "setup") {
    if (action.kind !== "commit") {
      return err({ kind: "phase_mismatch", phase: "setup", actionKind: action.kind });
    }
    return applyCommitSafe(state, action);
  }

  if (state.phase === "resolving") {
    if (action.kind !== "effect_choice") {
      return err({ kind: "phase_mismatch", phase: "resolving", actionKind: action.kind });
    }
    return applyEffectChoiceSafe(state, action.choice);
  }

  if (state.phase === "end_of_turn") {
    if (action.kind !== "play") {
      return err({ kind: "phase_mismatch", phase: "end_of_turn", actionKind: action.kind });
    }
    return applyEndOfTurnSafe(state, action.cardId);
  }

  if (action.kind === "commit" || action.kind === "crown" || action.kind === "effect_choice") {
    return err({ kind: "phase_mismatch", phase: "play", actionKind: action.kind });
  }

  return action.kind === "play"
    ? applyPlaySafe(state, action.cardId)
    : applyDisgraceSafe(state);
};

export const apply = (state: IKState, action: IKAction): IKState => {
  const result = applySafe(state, action);
  if (result.ok) return result.value;
  throw new Error(transitionErrorMessage(result.error));
};
