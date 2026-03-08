import { TERMINAL, type ActivePlayer, type PlayerId } from "@imposter-zero/types";

import type { IKState } from "../state.js";
import { legalActions } from "./legal.js";

export const isTerminal = (state: IKState): boolean =>
  state.forcedLoser !== null ||
  (state.phase === "play" && legalActions(state).length === 0);

export const currentPlayer = (state: IKState): ActivePlayer => {
  if (isTerminal(state)) return TERMINAL;
  if (state.phase === "resolving" && state.pendingResolution) {
    return state.pendingResolution.choosingPlayer;
  }
  return state.activePlayer;
};

export const returns = (state: IKState): ReadonlyArray<number> => {
  if (!isTerminal(state)) {
    return Array.from({ length: state.numPlayers }, () => 0);
  }

  const stuck = state.forcedLoser ?? state.activePlayer;
  let winner = ((stuck - 1 + state.numPlayers) % state.numPlayers) as PlayerId;
  for (let i = 0; i < state.numPlayers; i++) {
    if (!state.eliminatedPlayers.includes(winner)) break;
    winner = ((winner - 1 + state.numPlayers) % state.numPlayers) as PlayerId;
  }
  return Array.from({ length: state.numPlayers }, (_, player) => {
    if (player === winner) return 1;
    if (player === stuck) return -1;
    return 0;
  });
};
