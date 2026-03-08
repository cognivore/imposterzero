import type { PlayerId } from "@imposter-zero/types";

import { playerZones, type IKState } from "./state.js";
import { isKingFaceUp } from "./selectors.js";
import { isTerminal } from "./rules/terminal.js";

const hasResources = (state: IKState, player: PlayerId): boolean => {
  const zones = playerZones(state, player);
  return zones.hand.length > 0 || zones.successor !== null;
};

const stuckAndWinner = (state: IKState): { stuck: PlayerId; winner: PlayerId } => {
  const stuck = state.forcedLoser ?? state.activePlayer;
  let winner = ((stuck - 1 + state.numPlayers) % state.numPlayers) as PlayerId;
  for (let i = 0; i < state.numPlayers; i++) {
    if (!state.eliminatedPlayers.includes(winner)) break;
    winner = ((winner - 1 + state.numPlayers) % state.numPlayers) as PlayerId;
  }
  return { stuck, winner };
};

const score2p = (state: IKState): ReadonlyArray<number> => {
  const { stuck, winner } = stuckAndWinner(state);
  const scores = [0, 0];
  scores[winner] += 1;
  if (isKingFaceUp(state, winner)) scores[winner] += 1;
  if (hasResources(state, stuck)) scores[winner] += 1;
  return scores;
};

const score3p = (state: IKState): ReadonlyArray<number> => {
  const { stuck, winner } = stuckAndWinner(state);
  const scores = [0, 0, 0];

  scores[winner] += 1;
  if (isKingFaceUp(state, winner)) scores[winner] += 1;
  for (let p = 0; p < 3; p++) {
    if (p !== winner && hasResources(state, p)) {
      scores[winner] += 1;
    }
  }

  const second = [0, 1, 2].find(
    (p) => p !== winner && p !== stuck && !state.eliminatedPlayers.includes(p as PlayerId),
  );
  if (second !== undefined) scores[second] += 1;

  return scores;
};

const teamOf = (player: PlayerId): 0 | 1 => (player % 2 === 0 ? 0 : 1);
const teammates = (team: 0 | 1): [PlayerId, PlayerId] =>
  team === 0 ? [0, 2] : [1, 3];

const score4p = (state: IKState): ReadonlyArray<number> => {
  const { winner } = stuckAndWinner(state);
  const winningTeam = teamOf(winner);
  const [m1, m2] = teammates(winningTeam);

  const faceUpKings =
    (isKingFaceUp(state, m1) ? 1 : 0) + (isKingFaceUp(state, m2) ? 1 : 0);
  const teamScore = 1 + faceUpKings;

  const scores = [0, 0, 0, 0];
  scores[m1] = teamScore;
  scores[m2] = teamScore;
  return scores;
};

export const roundScore = (state: IKState): ReadonlyArray<number> => {
  if (!isTerminal(state)) {
    return Array.from({ length: state.numPlayers }, () => 0);
  }

  switch (state.numPlayers) {
    case 2: return score2p(state);
    case 3: return score3p(state);
    case 4: return score4p(state);
    default: return Array.from({ length: state.numPlayers }, () => 0);
  }
};
