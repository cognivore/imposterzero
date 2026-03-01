/**
 * Client-server WebSocket protocol.
 * Generic over the game's State and Action representations.
 */

export type ClientMessage<A = unknown> =
  | { readonly type: "join"; readonly gameId: string }
  | { readonly type: "ready"; readonly ready: boolean }
  | { readonly type: "action"; readonly action: A }
  | { readonly type: "observe" };

export type ServerMessage<S = unknown, A = unknown, L = unknown> =
  | { readonly type: "state"; readonly state: S }
  | { readonly type: "legal_actions"; readonly actions: ReadonlyArray<A> }
  | { readonly type: "lobby_state"; readonly lobby: L }
  | { readonly type: "turn_timer"; readonly deadline: number; readonly remainingMs: number }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "game_over"; readonly returns: ReadonlyArray<number> };
