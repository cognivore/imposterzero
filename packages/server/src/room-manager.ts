import { randomBytes } from "node:crypto";
import type { GameDef, RoomSummary } from "@imposter-zero/types";
import type { IKState, IKAction, CardName } from "@imposter-zero/engine";
import { buildPlayerArmies, expansionConfigForPlayers } from "@imposter-zero/engine";
import {
  type Room,
  type OutboundMessage,
  type RoomTransitionResult,
  type ExpansionState,
  createRoom,
  roomTransition,
  continueAfterScoring,
} from "./room.js";
import {
  type BotRegistry,
  emptyBotRegistry,
} from "./bot-player.js";

// ---------------------------------------------------------------------------
// ManagedRoom — per-room state wrapper
// ---------------------------------------------------------------------------

export interface ManagedRoom {
  readonly id: string;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly maxPlayers: number;
  readonly targetScore: number;
  readonly turnDuration: number;
  tournament: boolean;
  room: Room;
  botRegistry: BotRegistry;
  botCounter: number;
  turnTimer: ReturnType<typeof setTimeout> | null;
  botTimer: ReturnType<typeof setTimeout> | null;
  scoringTimer: ReturnType<typeof setTimeout> | null;
}

const generateRoomId = (): string => randomBytes(4).toString("hex");

// ---------------------------------------------------------------------------
// RoomStore — multi-room state container
// ---------------------------------------------------------------------------

export interface RoomStore {
  readonly rooms: Map<string, ManagedRoom>;
  readonly playerRoomMap: Map<string, string>;
}

export const emptyStore = (): RoomStore => ({
  rooms: new Map(),
  playerRoomMap: new Map(),
});

export const createManagedRoom = (
  store: RoomStore,
  game: GameDef<IKState, IKAction>,
  createdBy: string,
  maxPlayers: number,
  targetScore: number,
  turnDuration: number,
  now: number,
  expansionState: ExpansionState | null = null,
): ManagedRoom => {
  const id = generateRoomId();
  const managed: ManagedRoom = {
    id,
    createdBy,
    createdAt: now,
    maxPlayers,
    targetScore,
    turnDuration,
    tournament: true,
    room: createRoom(game, maxPlayers, targetScore, turnDuration, expansionState, true),
    botRegistry: emptyBotRegistry,
    botCounter: 0,
    turnTimer: null,
    botTimer: null,
    scoringTimer: null,
  };
  store.rooms.set(id, managed);
  return managed;
};

export const findRoomOfPlayer = (store: RoomStore, playerId: string): ManagedRoom | undefined => {
  const roomId = store.playerRoomMap.get(playerId);
  return roomId !== undefined ? store.rooms.get(roomId) : undefined;
};

export const addPlayerToRoom = (store: RoomStore, playerId: string, roomId: string): void => {
  store.playerRoomMap.set(playerId, roomId);
};

export const removePlayerFromRoom = (store: RoomStore, playerId: string): void => {
  store.playerRoomMap.delete(playerId);
};

export const playersInRoom = (store: RoomStore, roomId: string): ReadonlyArray<string> =>
  [...store.playerRoomMap.entries()]
    .filter(([, rid]) => rid === roomId)
    .map(([pid]) => pid);

export const browsersOnly = (store: RoomStore, allPlayerIds: ReadonlyArray<string>): ReadonlyArray<string> =>
  allPlayerIds.filter((pid) => !store.playerRoomMap.has(pid));

export const destroyRoom = (store: RoomStore, managed: ManagedRoom): void => {
  if (managed.turnTimer !== null) clearTimeout(managed.turnTimer);
  if (managed.botTimer !== null) clearTimeout(managed.botTimer);
  if (managed.scoringTimer !== null) clearTimeout(managed.scoringTimer);

  for (const [pid, rid] of store.playerRoomMap) {
    if (rid === managed.id) store.playerRoomMap.delete(pid);
  }

  store.rooms.delete(managed.id);
};

export const updateManagedRoomTargetScore = (managed: ManagedRoom, targetScore: number): void => {
  if (managed.room.phase !== "lobby") return;
  (managed as { targetScore: number }).targetScore = targetScore;
  managed.room = {
    ...managed.room,
    targetScore,
    match: { ...managed.room.match, targetScore },
  };
};

export const updateManagedRoomTournament = (managed: ManagedRoom, tournament: boolean): void => {
  managed.tournament = tournament;
  if (managed.room.phase === "lobby") {
    managed.room = { ...managed.room, tournament };
  }
};

const DEFAULT_SIGNATURES: ReadonlyArray<CardName> = ["Aegis", "Exile", "Ancestor"];

export const updateManagedRoomExpansion = (managed: ManagedRoom, expansion: boolean): void => {
  if (managed.room.phase !== "lobby") return;
  if (expansion) {
    const numPlayers = managed.maxPlayers;
    const config = expansionConfigForPlayers(numPlayers);
    const sigs = Array.from({ length: numPlayers }, () => DEFAULT_SIGNATURES);
    const armies = buildPlayerArmies(config, sigs);
    managed.room = {
      ...managed.room,
      expansionState: { config, playerArmies: armies },
    };
  } else {
    managed.room = {
      ...managed.room,
      expansionState: null,
    };
  }
};

export const toRoomSummary = (managed: ManagedRoom): RoomSummary => ({
  id: managed.id,
  playerCount: managed.room.lobby.players.length,
  maxPlayers: managed.maxPlayers,
  targetScore: managed.targetScore,
  phase: managed.room.phase,
  players: managed.room.lobby.players.map((p) => ({ id: p.id, ready: p.ready })),
});

export const listRoomSummaries = (store: RoomStore): ReadonlyArray<RoomSummary> =>
  [...store.rooms.values()].map(toRoomSummary);

const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;

export const pruneEmptyRooms = (store: RoomStore, now: number): void => {
  for (const [, managed] of store.rooms) {
    const playerCount = playersInRoom(store, managed.id).length;
    if (playerCount === 0 && now - managed.createdAt > EMPTY_ROOM_TTL_MS) {
      destroyRoom(store, managed);
    }
  }
};
