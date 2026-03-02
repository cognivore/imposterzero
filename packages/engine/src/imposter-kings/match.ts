import type { PlayerId, GameDef } from "@imposter-zero/types";

import { roundScore } from "./scoring.js";
import type { IKState } from "./state.js";
import type { IKAction } from "./actions.js";
import { type ActionSelector, playGame } from "../runtime.js";

export interface MatchState {
  readonly scores: ReadonlyArray<number>;
  readonly roundsPlayed: number;
  readonly targetScore: number;
  readonly numPlayers: number;
}

export const createMatch = (
  numPlayers: number,
  targetScore: number = 7,
): MatchState => ({
  scores: Array.from({ length: numPlayers }, () => 0),
  roundsPlayed: 0,
  targetScore,
  numPlayers,
});

export const applyRoundResult = (
  match: MatchState,
  roundScores: ReadonlyArray<number>,
): MatchState => ({
  ...match,
  scores: match.scores.map((s, i) => s + roundScores[i]!),
  roundsPlayed: match.roundsPlayed + 1,
});

export const matchWinners = (match: MatchState): ReadonlyArray<PlayerId> =>
  match.scores.reduce<PlayerId[]>((acc, s, i) => {
    if (s >= match.targetScore) acc.push(i as PlayerId);
    return acc;
  }, []);

export const isMatchOver = (match: MatchState): boolean =>
  matchWinners(match).length > 0;

export interface MatchResult {
  readonly match: MatchState;
  readonly roundResults: ReadonlyArray<ReadonlyArray<number>>;
}

export const playMatch = (
  game: GameDef<IKState, IKAction>,
  numPlayers: number,
  select: ActionSelector<IKState, IKAction>,
  targetScore: number = 7,
  maxRounds: number = 200,
): MatchResult => {
  let match = createMatch(numPlayers, targetScore);
  const roundResults: Array<ReadonlyArray<number>> = [];

  while (!isMatchOver(match) && match.roundsPlayed < maxRounds) {
    const trace = playGame(game, numPlayers, select);
    const scores = roundScore(trace.finalState);
    roundResults.push(scores);
    match = applyRoundResult(match, scores);
  }

  return { match, roundResults };
};
