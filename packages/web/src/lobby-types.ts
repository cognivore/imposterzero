/**
 * Lobby state types mirroring the server's lobby module.
 * Declared here so the web package depends on types/engine only, never server.
 */

export interface LobbyPlayer {
  readonly id: string;
  readonly ready: boolean;
}

export interface WaitingLobbyState {
  readonly kind: "waiting";
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly players: ReadonlyArray<LobbyPlayer>;
}

export interface StartingLobbyState {
  readonly kind: "starting";
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly players: ReadonlyArray<LobbyPlayer>;
  readonly startingAt: number;
}

export interface InGameLobbyState {
  readonly kind: "in_game";
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly players: ReadonlyArray<LobbyPlayer>;
  readonly gameId: string;
  readonly startedAt: number;
}

export interface PostGameLobbyState {
  readonly kind: "post_game";
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly players: ReadonlyArray<LobbyPlayer>;
  readonly gameId: string;
  readonly finishedAt: number;
  readonly returns: ReadonlyArray<number>;
}

export type LobbyState =
  | WaitingLobbyState
  | StartingLobbyState
  | InGameLobbyState
  | PostGameLobbyState;

export interface RoomSummary {
  readonly id: string;
  readonly playerCount: number;
  readonly maxPlayers: number;
  readonly targetScore: number;
  readonly phase: "lobby" | "drafting" | "playing" | "scoring" | "finished";
  readonly players: ReadonlyArray<{ readonly id: string; readonly ready: boolean }>;
}
