import { TERMINAL, type ActivePlayer, type PlayerId } from "@imposter-zero/types";

import type { IKState } from "../state.js";
import { legalActions } from "./legal.js";

export const isTerminal = (state: IKState): boolean =>
  state.phase === "play" && legalActions(state).length === 0;

export const currentPlayer = (state: IKState): ActivePlayer =>
  isTerminal(state) ? TERMINAL : state.activePlayer;

export const returns = (state: IKState): ReadonlyArray<number> => {
  if (!isTerminal(state)) {
    return Array.from({ length: state.numPlayers }, () => 0);
  }

  const stuck = state.activePlayer;
  const winner = ((stuck - 1 + state.numPlayers) % state.numPlayers) as PlayerId;
  return Array.from({ length: state.numPlayers }, (_, player) => {
    if (player === winner) return 1;
    if (player === stuck) return -1;
    return 0;
  });
};
