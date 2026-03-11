/**
 * Deterministic game reconstruction from an initial state and action sequence.
 *
 * The dual of playGame: instead of selecting actions via a strategy,
 * replayRound feeds a predetermined action sequence through GameDef.apply.
 */

import type { GameDef } from "@imposter-zero/types";
import type { GameTrace } from "./runtime.js";

export const replayRound = <S, A>(
  game: GameDef<S, A>,
  initialState: S,
  actions: ReadonlyArray<A>,
): GameTrace<S, A> => {
  const history: Array<{ readonly state: S; readonly action: A }> = [];
  const finalState = actions.reduce((state, action) => {
    history.push({ state, action });
    return game.apply(state, action);
  }, initialState);

  return { history, finalState, returns: game.returns(finalState) };
};
