import {
  type GameDef,
  type PlayerId,
  type ActivePlayer,
  type Result,
  ok,
  err,
  TERMINAL,
} from "@imposter-zero/types";

export interface GameSession<S, A> {
  readonly game: GameDef<S, A>;
  readonly state: S;
  readonly turnDeadline: number;
  readonly turnDuration: number;
  readonly playerMapping: ReadonlyMap<string, PlayerId>;
}

export type SessionError =
  | { readonly kind: "not_active_player"; readonly expected: ActivePlayer; readonly received: PlayerId }
  | { readonly kind: "timed_out"; readonly deadline: number; readonly now: number }
  | { readonly kind: "game_terminal" }
  | { readonly kind: "illegal_action"; readonly message: string }
  | { readonly kind: "player_count_out_of_range"; readonly numPlayers: number; readonly min: number; readonly max: number };

export type TimeoutPolicy = "forfeit" | "pass";

export const startSession = <S, A>(
  game: GameDef<S, A>,
  numPlayers: number,
  playerMapping: ReadonlyMap<string, PlayerId>,
  turnDuration: number,
  now: number,
  initialState?: S,
): GameSession<S, A> => {
  if (turnDuration <= 0) {
    throw new RangeError(`turnDuration must be positive, received ${turnDuration}`);
  }

  if (playerMapping.size !== numPlayers) {
    throw new Error(
      `playerMapping size (${playerMapping.size}) must match numPlayers (${numPlayers})`,
    );
  }

  const { minPlayers, maxPlayers } = game.gameType;
  if (numPlayers < minPlayers || numPlayers > maxPlayers) {
    throw new RangeError(
      `numPlayers ${numPlayers} is outside game bounds [${minPlayers}, ${maxPlayers}]`,
    );
  }

  return {
    game,
    state: initialState ?? game.create(numPlayers),
    turnDuration,
    turnDeadline: now + turnDuration,
    playerMapping,
  };
};

export const applySessionAction = <S, A>(
  session: GameSession<S, A>,
  action: A,
  now: number,
): GameSession<S, A> => {
  if (session.game.isTerminal(session.state)) {
    return session;
  }

  const nextState = session.game.apply(session.state, action);
  if (session.game.isTerminal(nextState)) {
    return {
      ...session,
      state: nextState,
      turnDeadline: now,
    };
  }

  return {
    ...session,
    state: nextState,
    turnDeadline: now + session.turnDuration,
  };
};

export const applyPlayerAction = <S, A>(
  session: GameSession<S, A>,
  playerId: PlayerId,
  action: A,
  now: number,
): Result<SessionError, GameSession<S, A>> => {
  if (session.game.isTerminal(session.state)) {
    return err({ kind: "game_terminal" });
  }

  if (now > session.turnDeadline) {
    return err({ kind: "timed_out", deadline: session.turnDeadline, now });
  }

  const expected = session.game.currentPlayer(session.state);
  if (expected === TERMINAL) {
    return err({ kind: "game_terminal" });
  }

  if (playerId !== expected) {
    return err({ kind: "not_active_player", expected, received: playerId });
  }

  try {
    const nextState = session.game.apply(session.state, action);
    if (session.game.isTerminal(nextState)) {
      return ok({ ...session, state: nextState, turnDeadline: now });
    }
    return ok({
      ...session,
      state: nextState,
      turnDeadline: now + session.turnDuration,
    });
  } catch (e) {
    return err({
      kind: "illegal_action",
      message: e instanceof Error ? e.message : String(e),
    });
  }
};

export const applyTimeout = <S, A>(
  session: GameSession<S, A>,
  now: number,
  _policy: TimeoutPolicy,
): GameSession<S, A> => {
  if (session.game.isTerminal(session.state) || !isTimedOut(session, now)) {
    return session;
  }

  const legal = session.game.legalActions(session.state);
  if (legal.length === 0) {
    return session;
  }

  const defaultAction = legal[0]!;
  return applySessionAction(session, defaultAction, now);
};

export const isTimedOut = <S, A>(session: GameSession<S, A>, now: number): boolean =>
  session.turnDeadline <= now;
