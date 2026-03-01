import { err, type Result } from "@imposter-zero/types";

import type { IKAction } from "../actions.js";
import { type TransitionError, transitionErrorMessage } from "../errors.js";
import type { IKState } from "../state.js";
import { applyCommitSafe } from "./setup.js";
import { applyPlaySafe, applyDisgraceSafe } from "./play.js";

export { legalActions } from "./legal.js";
export { isTerminal, currentPlayer, returns } from "./terminal.js";

export const applySafe = (state: IKState, action: IKAction): Result<TransitionError, IKState> => {
  if (state.phase === "setup") {
    if (action.kind !== "commit") {
      return err({ kind: "phase_mismatch", phase: "setup", actionKind: action.kind });
    }
    return applyCommitSafe(state, action);
  }

  if (action.kind === "commit") {
    return err({ kind: "phase_mismatch", phase: "play", actionKind: "commit" });
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
