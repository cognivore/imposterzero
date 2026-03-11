/**
 * Generic replay event types for any GameDef<S, A>.
 *
 * A match replay is an ordered stream of these events, sufficient to
 * reconstruct the full game trace deterministically via GameDef.apply.
 */

export type MatchStartEvent = {
  readonly type: "match_start";
  readonly matchId: string;
  readonly roomId: string;
  readonly playerNames: ReadonlyArray<string>;
  readonly numPlayers: number;
  readonly targetScore: number;
  readonly startedAt: number;
};

export type RoundStartEvent<S> = {
  readonly type: "round_start";
  readonly round: number;
  readonly initialState: S;
  readonly timestamp: number;
};

export type ActionEvent<A> = {
  readonly type: "action";
  readonly round: number;
  readonly playerIdx: number;
  readonly playerId: string;
  readonly action: A;
  readonly isTimeout: boolean;
  readonly timestamp: number;
};

export type RoundEndEvent<S> = {
  readonly type: "round_end";
  readonly round: number;
  readonly finalState: S;
  readonly scores: ReadonlyArray<number>;
  readonly matchScores: ReadonlyArray<number>;
  readonly timestamp: number;
};

export type MatchEndEvent = {
  readonly type: "match_end";
  readonly winners: ReadonlyArray<number>;
  readonly finalScores: ReadonlyArray<number>;
  readonly timestamp: number;
};

export type ReplayEvent<S, A> =
  | MatchStartEvent
  | RoundStartEvent<S>
  | ActionEvent<A>
  | RoundEndEvent<S>
  | MatchEndEvent;

export type ReplaySink<S, A> = (event: ReplayEvent<S, A>) => void;
