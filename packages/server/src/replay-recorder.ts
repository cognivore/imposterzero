/**
 * Replay recorder — thin delegation layer that constructs ReplayEvents
 * and forwards them to a ReplaySink. No buffering, no internal state.
 */

import type { ReplaySink } from "@imposter-zero/types";

export interface ReplayRecorder<S, A> {
  readonly startMatch: (meta: {
    readonly matchId: string;
    readonly roomId: string;
    readonly playerNames: ReadonlyArray<string>;
    readonly numPlayers: number;
    readonly targetScore: number;
    readonly startedAt: number;
  }) => void;

  readonly startRound: (round: number, initialState: S, timestamp: number) => void;

  readonly recordAction: (
    round: number,
    playerIdx: number,
    playerId: string,
    action: A,
    isTimeout: boolean,
    timestamp: number,
  ) => void;

  readonly endRound: (
    round: number,
    finalState: S,
    scores: ReadonlyArray<number>,
    matchScores: ReadonlyArray<number>,
    timestamp: number,
  ) => void;

  readonly endMatch: (
    winners: ReadonlyArray<number>,
    finalScores: ReadonlyArray<number>,
    timestamp: number,
  ) => void;
}

export const createReplayRecorder = <S, A>(sink: ReplaySink<S, A>): ReplayRecorder<S, A> => ({
  startMatch: (meta) =>
    sink({ type: "match_start", ...meta }),

  startRound: (round, initialState, timestamp) =>
    sink({ type: "round_start", round, initialState, timestamp }),

  recordAction: (round, playerIdx, playerId, action, isTimeout, timestamp) =>
    sink({ type: "action", round, playerIdx, playerId, action, isTimeout, timestamp }),

  endRound: (round, finalState, scores, matchScores, timestamp) =>
    sink({ type: "round_end", round, finalState, scores, matchScores, timestamp }),

  endMatch: (winners, finalScores, timestamp) =>
    sink({ type: "match_end", winners, finalScores, timestamp }),
});

export const nullRecorder: ReplayRecorder<unknown, unknown> = {
  startMatch: () => {},
  startRound: () => {},
  recordAction: () => {},
  endRound: () => {},
  endMatch: () => {},
};
