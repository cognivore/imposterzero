import { type GameDef, type Result, ok, err } from "@imposter-zero/types";

export interface LobbyPlayer {
  readonly id: string;
  readonly ready: boolean;
}

interface LobbyBase {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly players: ReadonlyArray<LobbyPlayer>;
}

export interface WaitingLobbyState extends LobbyBase {
  readonly kind: "waiting";
}

export interface StartingLobbyState extends LobbyBase {
  readonly kind: "starting";
  readonly startingAt: number;
}

export interface InGameLobbyState extends LobbyBase {
  readonly kind: "in_game";
  readonly gameId: string;
  readonly startedAt: number;
}

export interface PostGameLobbyState extends LobbyBase {
  readonly kind: "post_game";
  readonly gameId: string;
  readonly finishedAt: number;
  readonly returns: ReadonlyArray<number>;
}

export type LobbyState =
  | WaitingLobbyState
  | StartingLobbyState
  | InGameLobbyState
  | PostGameLobbyState;

export type LobbyAction =
  | { readonly kind: "join"; readonly playerId: string }
  | { readonly kind: "leave"; readonly playerId: string }
  | { readonly kind: "ready"; readonly playerId: string; readonly ready: boolean; readonly now: number }
  | { readonly kind: "start"; readonly gameId: string; readonly now: number }
  | { readonly kind: "gameOver"; readonly returns: ReadonlyArray<number>; readonly now: number };

export type LobbyError =
  | { readonly kind: "join_during_game" }
  | { readonly kind: "lobby_full"; readonly maxPlayers: number }
  | { readonly kind: "leave_during_game" }
  | { readonly kind: "ready_during_game" }
  | { readonly kind: "not_starting" }
  | { readonly kind: "not_ready_or_quorum" }
  | { readonly kind: "game_over_not_in_game" }
  | { readonly kind: "returns_length_mismatch"; readonly expected: number; readonly received: number }
  | { readonly kind: "over_capacity"; readonly maxPlayers: number };

const allReady = (players: ReadonlyArray<LobbyPlayer>): boolean =>
  players.length > 0 && players.every((player) => player.ready);

const hasRequiredPlayers = (state: LobbyBase): boolean => state.players.length >= state.minPlayers;

const inCapacity = (state: LobbyBase): boolean => state.players.length <= state.maxPlayers;

const toWaiting = (state: LobbyBase, players: ReadonlyArray<LobbyPlayer>): WaitingLobbyState => ({
  kind: "waiting",
  minPlayers: state.minPlayers,
  maxPlayers: state.maxPlayers,
  players,
});

const maybeStarting = (state: LobbyBase, now: number): Result<LobbyError, LobbyState> => {
  if (!inCapacity(state)) {
    return err({ kind: "over_capacity", maxPlayers: state.maxPlayers });
  }

  if (hasRequiredPlayers(state) && allReady(state.players)) {
    return ok({
      kind: "starting",
      minPlayers: state.minPlayers,
      maxPlayers: state.maxPlayers,
      players: state.players,
      startingAt: now,
    });
  }

  return ok(toWaiting(state, state.players));
};

export const createLobby = (minPlayers: number, maxPlayers: number): LobbyState => {
  if (minPlayers < 1 || maxPlayers < minPlayers) {
    throw new RangeError(
      `Invalid lobby bounds minPlayers=${minPlayers}, maxPlayers=${maxPlayers}`,
    );
  }

  return { kind: "waiting", minPlayers, maxPlayers, players: [] };
};

export const createLobbyForGame = <S, A>(game: GameDef<S, A>): LobbyState =>
  createLobby(game.gameType.minPlayers, game.gameType.maxPlayers);

export const lobbyTransitionSafe = (
  state: LobbyState,
  action: LobbyAction,
): Result<LobbyError, LobbyState> => {
  if (action.kind === "join") {
    if (state.kind === "in_game") {
      return err({ kind: "join_during_game" });
    }

    if (state.players.some((player) => player.id === action.playerId)) {
      return ok(state);
    }

    if (state.players.length >= state.maxPlayers) {
      return err({ kind: "lobby_full", maxPlayers: state.maxPlayers });
    }

    const players = [...state.players, { id: action.playerId, ready: false }];
    return ok(toWaiting(state, players));
  }

  if (action.kind === "leave") {
    if (state.kind === "in_game") {
      return err({ kind: "leave_during_game" });
    }

    const players = state.players.filter((player) => player.id !== action.playerId);
    return ok(toWaiting(state, players));
  }

  if (action.kind === "ready") {
    if (state.kind === "in_game") {
      return err({ kind: "ready_during_game" });
    }

    const players = state.players.map((player) =>
      player.id === action.playerId ? { ...player, ready: action.ready } : player,
    );
    return maybeStarting({ ...state, players }, action.now);
  }

  if (action.kind === "start") {
    if (state.kind !== "starting") {
      return err({ kind: "not_starting" });
    }

    if (!hasRequiredPlayers(state) || !allReady(state.players)) {
      return err({ kind: "not_ready_or_quorum" });
    }

    return ok({
      kind: "in_game",
      minPlayers: state.minPlayers,
      maxPlayers: state.maxPlayers,
      players: state.players,
      gameId: action.gameId,
      startedAt: action.now,
    });
  }

  if (state.kind !== "in_game") {
    return err({ kind: "game_over_not_in_game" });
  }

  if (action.returns.length !== state.players.length) {
    return err({
      kind: "returns_length_mismatch",
      expected: state.players.length,
      received: action.returns.length,
    });
  }

  return ok({
    kind: "post_game",
    minPlayers: state.minPlayers,
    maxPlayers: state.maxPlayers,
    players: state.players,
    gameId: state.gameId,
    finishedAt: action.now,
    returns: action.returns,
  });
};

const lobbyErrorMessage = (e: LobbyError): string => {
  switch (e.kind) {
    case "join_during_game": return "Cannot join while game is in progress";
    case "lobby_full": return `Lobby is full (max ${e.maxPlayers})`;
    case "leave_during_game": return "Cannot leave through lobby reducer while game is in progress";
    case "ready_during_game": return "Cannot toggle ready state while game is in progress";
    case "not_starting": return "Lobby must be in starting state before start";
    case "not_ready_or_quorum": return "Cannot start before reaching player minimum with all players ready";
    case "game_over_not_in_game": return "gameOver is only valid while a game is in progress";
    case "returns_length_mismatch": return `returns length (${e.received}) must match player count (${e.expected})`;
    case "over_capacity": return `Lobby exceeds maxPlayers (${e.maxPlayers})`;
  }
};

export const lobbyTransition = (state: LobbyState, action: LobbyAction): LobbyState => {
  const result = lobbyTransitionSafe(state, action);
  if (result.ok) return result.value;
  throw new Error(lobbyErrorMessage(result.error));
};
