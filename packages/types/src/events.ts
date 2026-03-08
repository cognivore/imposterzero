/**
 * Client-server WebSocket protocol.
 * Generic over the game's State and Action representations.
 */

import type { PlayerId } from "./protocol.js";
import type { Result } from "./result.js";
import { ok, err } from "./result.js";

// ---------------------------------------------------------------------------
// Branded Token newtype
// ---------------------------------------------------------------------------

declare const TokenBrand: unique symbol;
export type Token = string & { readonly [TokenBrand]: never };
export const mkToken = (raw: string): Token => raw as Token;

// ---------------------------------------------------------------------------
// Room summary (shared between client and server)
// ---------------------------------------------------------------------------

export interface RoomSummary {
  readonly id: string;
  readonly playerCount: number;
  readonly maxPlayers: number;
  readonly targetScore: number;
  readonly phase: "lobby" | "drafting" | "playing" | "scoring" | "finished";
  readonly players: ReadonlyArray<{ readonly id: string; readonly ready: boolean }>;
}

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export type ClientMessage<A = unknown> =
  | { readonly type: "set_name"; readonly name: string }
  | { readonly type: "list_rooms" }
  | { readonly type: "create_room"; readonly maxPlayers: number; readonly targetScore: number }
  | { readonly type: "join_room"; readonly roomId: string }
  | { readonly type: "leave_room" }
  | { readonly type: "update_settings"; readonly targetScore?: number; readonly expansion?: boolean }
  | { readonly type: "draft_select"; readonly cards: ReadonlyArray<string> }
  | { readonly type: "join"; readonly gameId: string }
  | { readonly type: "ready"; readonly ready: boolean }
  | { readonly type: "action"; readonly action: A }
  | { readonly type: "auth"; readonly token?: string; readonly name?: string }
  | { readonly type: "add_bot" }
  | { readonly type: "observe" };

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export type ServerMessage<S = unknown, A = unknown, L = unknown> =
  | { readonly type: "welcome"; readonly token: string; readonly playerId: string; readonly name: string | null }
  | { readonly type: "name_accepted"; readonly name: string }
  | { readonly type: "room_list"; readonly rooms: ReadonlyArray<RoomSummary> }
  | { readonly type: "room_created"; readonly roomId: string }
  | { readonly type: "room_joined"; readonly roomId: string }
  | { readonly type: "room_settings"; readonly targetScore: number; readonly maxPlayers: number; readonly hostId: string; readonly expansion?: boolean }
  | { readonly type: "lobby_state"; readonly lobby: L }
  | { readonly type: "game_start"; readonly numPlayers: number }
  | {
      readonly type: "draft_state";
      readonly signaturePool: ReadonlyArray<string>;
      readonly mySelections: ReadonlyArray<string>;
      readonly selectionsNeeded: number;
      readonly allReady: boolean;
      readonly playerNames: ReadonlyArray<string>;
    }
  | {
      readonly type: "state";
      readonly state: S;
      readonly legalActions: ReadonlyArray<A>;
      readonly activePlayer: PlayerId;
      readonly playerNames: ReadonlyArray<string>;
      readonly turnDeadline: number;
    }
  | {
      readonly type: "round_over";
      readonly state: S;
      readonly scores: ReadonlyArray<number>;
      readonly matchScores: ReadonlyArray<number>;
      readonly roundsPlayed: number;
      readonly playerNames: ReadonlyArray<string>;
      readonly reviewDeadline: number;
    }
  | {
      readonly type: "scoring_ready";
      readonly readyPlayers: ReadonlyArray<string>;
    }
  | {
      readonly type: "match_over";
      readonly winners: ReadonlyArray<PlayerId>;
      readonly finalScores: ReadonlyArray<number>;
      readonly playerNames: ReadonlyArray<string>;
    }
  | { readonly type: "error"; readonly message: string };

export type ServerMessageType = ServerMessage["type"];

// ---------------------------------------------------------------------------
// Total decoder for JSON boundary
// ---------------------------------------------------------------------------

export type ParseError =
  | { readonly kind: "invalid_json"; readonly raw: string }
  | { readonly kind: "missing_type" }
  | { readonly kind: "unknown_type"; readonly type: string };

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "welcome",
  "name_accepted",
  "room_list",
  "room_created",
  "room_joined",
  "room_settings",
  "lobby_state",
  "game_start",
  "draft_state",
  "state",
  "round_over",
  "scoring_ready",
  "match_over",
  "error",
]);

export const parseServerMessage = <S = unknown, A = unknown, L = unknown>(
  raw: string,
): Result<ParseError, ServerMessage<S, A, L>> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({ kind: "invalid_json", raw });
  }

  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
    return err({ kind: "missing_type" });
  }

  const type: unknown = parsed.type;
  if (typeof type !== "string" || !KNOWN_TYPES.has(type)) {
    return err({ kind: "unknown_type", type: String(type) });
  }

  // The final `as` is intentional: we validate `type` against KNOWN_TYPES
  // but don't decode each field — the generic boundary trusts the serializer.
  return ok(parsed as ServerMessage<S, A, L>);
};
