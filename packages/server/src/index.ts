import type { GameDef, ServerMessage, ClientMessage } from "@imposter-zero/types";
import type { ActionSelector } from "@imposter-zero/engine";

/**
 * Placeholder — game server will live here.
 * Responsibilities:
 *   - Host game rooms over WebSocket
 *   - Maintain authoritative game state via engine
 *   - Bridge to Python inference server for bot actions
 */
export type ServerConfig<S, A> = {
  readonly game: GameDef<S, A>;
  readonly port: number;
};

export type { ServerMessage, ClientMessage, ActionSelector };

export {
  createLobby,
  createLobbyForGame,
  lobbyTransition,
  lobbyTransitionSafe,
  type LobbyPlayer,
  type WaitingLobbyState,
  type StartingLobbyState,
  type InGameLobbyState,
  type PostGameLobbyState,
  type LobbyState,
  type LobbyAction,
  type LobbyError,
} from "./lobby.js";

export {
  startSession,
  applySessionAction,
  applyPlayerAction,
  applyTimeout,
  isTimedOut,
  type GameSession,
  type SessionError,
  type TimeoutPolicy,
} from "./session.js";
