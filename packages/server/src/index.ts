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

export {
  createRoom,
  roomTransition,
  continueAfterScoring,
  type Room,
  type LobbyRoom,
  type PlayingRoom,
  type ScoringRoom,
  type FinishedRoom,
  type RoomPhase,
  type RoomAction,
  type RoomError,
  type OutboundMessage,
  type RoomTransitionResult,
} from "./room.js";

export {
  startServer,
  type ServerHandle,
  type ServerOptions,
} from "./ws-server.js";

export {
  ConnectionRegistry,
  type RegistryEntry,
  type RegistryOptions,
} from "./connection-registry.js";

export {
  type BotRegistry,
  type NonEmptyReadonlyArray,
  emptyBotRegistry,
  addBot,
  isBot,
  pickRandom,
} from "./bot-player.js";

export {
  type ManagedRoom,
  type RoomStore,
  emptyStore,
  createManagedRoom,
  findRoomOfPlayer,
  addPlayerToRoom,
  removePlayerFromRoom,
  playersInRoom,
  browsersOnly,
  destroyRoom,
  toRoomSummary,
  listRoomSummaries,
  pruneEmptyRooms,
  updateManagedRoomTargetScore,
} from "./room-manager.js";
