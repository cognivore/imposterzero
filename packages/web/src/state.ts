import { useReducer } from "react";
import type { PlayerId } from "@imposter-zero/types";
import type { IKState, IKAction, IKSetupAction, IKPlayAction } from "@imposter-zero/engine";
import type { LobbyState, RoomSummary } from "./lobby-types.js";
import type { IKServerMessage } from "./ws-client.js";

// ---------------------------------------------------------------------------
// Client phase — discriminated union with narrowed legalActions per phase
// ---------------------------------------------------------------------------

export type ClientPhase =
  | { readonly _tag: "connecting" }
  | {
      readonly _tag: "browser";
      readonly me: string;
      readonly token: string;
      readonly rooms: readonly RoomSummary[];
    }
  | {
      readonly _tag: "lobby";
      readonly me: string;
      readonly myIndex: PlayerId | null;
      readonly token: string;
      readonly roomId: string;
      readonly lobby: LobbyState;
    }
  | {
      readonly _tag: "setup";
      readonly me: string;
      readonly myIndex: PlayerId;
      readonly token: string;
      readonly roomId: string;
      readonly gameState: IKState;
      readonly legalActions: readonly IKSetupAction[];
      readonly activePlayer: PlayerId;
      readonly numPlayers: number;
    }
  | {
      readonly _tag: "play";
      readonly me: string;
      readonly myIndex: PlayerId;
      readonly token: string;
      readonly roomId: string;
      readonly gameState: IKState;
      readonly legalActions: readonly IKPlayAction[];
      readonly activePlayer: PlayerId;
      readonly numPlayers: number;
    }
  | {
      readonly _tag: "scoring";
      readonly me: string;
      readonly token: string;
      readonly roomId: string;
      readonly roundScores: readonly number[];
      readonly matchScores: readonly number[];
      readonly roundsPlayed: number;
      readonly numPlayers: number;
    }
  | {
      readonly _tag: "finished";
      readonly me: string;
      readonly token: string;
      readonly roomId: string;
      readonly winners: readonly PlayerId[];
      readonly finalScores: readonly number[];
      readonly numPlayers: number;
    };

// ---------------------------------------------------------------------------
// Actions dispatched into the reducer
// ---------------------------------------------------------------------------

export type GameAction =
  | { readonly _tag: "connected" }
  | { readonly _tag: "disconnected" }
  | { readonly _tag: "server_message"; readonly message: IKServerMessage };

// ---------------------------------------------------------------------------
// Phase accessors — safe alternatives to structural `in` checks
// ---------------------------------------------------------------------------

const identity = (phase: ClientPhase): { readonly me: string; readonly token: string } =>
  phase._tag === "connecting" ? { me: "", token: "" } : { me: phase.me, token: phase.token };

const roomIdOf = (phase: ClientPhase): string => {
  switch (phase._tag) {
    case "connecting":
    case "browser":
      return "";
    default:
      return phase.roomId;
  }
};

const findMyIndex = (lobby: LobbyState, me: string): PlayerId | null => {
  const idx = lobby.players.findIndex((p) => p.id === me);
  return idx === -1 ? null : idx;
};

const myIndexOf = (phase: ClientPhase): PlayerId =>
  phase._tag === "lobby" ? (phase.myIndex ?? 0)
  : phase._tag === "setup" || phase._tag === "play" ? phase.myIndex
  : 0;

const numPlayersOf = (phase: ClientPhase, fallback: number): number => {
  switch (phase._tag) {
    case "setup":
    case "play":
    case "scoring":
    case "finished":
      return phase.numPlayers;
    case "connecting":
    case "browser":
    case "lobby":
      return fallback;
  }
};

// ---------------------------------------------------------------------------
// Action type guards — proper narrowing instead of `as` casts
// ---------------------------------------------------------------------------

const isSetupAction = (a: IKAction): a is IKSetupAction => a.kind === "commit";
const isPlayAction = (a: IKAction): a is IKPlayAction =>
  a.kind === "play" || a.kind === "disgrace";

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const initialPhase: ClientPhase = { _tag: "connecting" };

const reduce = (phase: ClientPhase, action: GameAction): ClientPhase => {
  if (action._tag === "disconnected") return { _tag: "connecting" };
  if (action._tag === "connected") return phase;

  const msg = action.message;

  switch (msg.type) {
    case "welcome":
      return {
        _tag: "browser",
        me: msg.playerId,
        token: msg.token,
        rooms: [],
      };

    case "room_list": {
      const { me, token } = identity(phase);
      if (phase._tag === "browser") {
        return { ...phase, rooms: msg.rooms };
      }
      return {
        _tag: "browser",
        me,
        token,
        rooms: msg.rooms,
      };
    }

    case "room_created":
    case "room_joined": {
      const { me, token } = identity(phase);
      return {
        _tag: "lobby",
        me,
        myIndex: null,
        token,
        roomId: msg.roomId,
        lobby: { kind: "waiting", minPlayers: 2, maxPlayers: 4, players: [] },
      };
    }

    case "lobby_state": {
      const { me, token } = identity(phase);
      const rid = roomIdOf(phase);
      return {
        _tag: "lobby",
        me,
        myIndex: findMyIndex(msg.lobby, me),
        token,
        roomId: rid,
        lobby: msg.lobby,
      };
    }

    case "game_start":
      return phase;

    case "state": {
      const { me, token } = identity(phase);
      const myIndex = myIndexOf(phase);
      const numPlayers = msg.state.numPlayers;
      const rid = roomIdOf(phase);

      if (msg.state.phase === "setup") {
        return {
          _tag: "setup",
          me,
          myIndex,
          token,
          roomId: rid,
          gameState: msg.state,
          legalActions: msg.legalActions.filter(isSetupAction),
          activePlayer: msg.activePlayer,
          numPlayers,
        };
      }

      return {
        _tag: "play",
        me,
        myIndex,
        token,
        roomId: rid,
        gameState: msg.state,
        legalActions: msg.legalActions.filter(isPlayAction),
        activePlayer: msg.activePlayer,
        numPlayers,
      };
    }

    case "round_over": {
      const { me, token } = identity(phase);
      const rid = roomIdOf(phase);
      return {
        _tag: "scoring",
        me,
        token,
        roomId: rid,
        roundScores: msg.scores,
        matchScores: msg.matchScores,
        roundsPlayed: msg.roundsPlayed,
        numPlayers: numPlayersOf(phase, msg.scores.length),
      };
    }

    case "match_over": {
      const { me, token } = identity(phase);
      const rid = roomIdOf(phase);
      return {
        _tag: "finished",
        me,
        token,
        roomId: rid,
        winners: msg.winners,
        finalScores: msg.finalScores,
        numPlayers: numPlayersOf(phase, msg.finalScores.length),
      };
    }

    case "error":
      return phase;
  }
};

export const useGameReducer = () => {
  const [phase, dispatch] = useReducer(reduce, initialPhase);
  return { phase, dispatch } as const;
};
