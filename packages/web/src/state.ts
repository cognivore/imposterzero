import { useReducer } from "react";
import type { PlayerId } from "@imposter-zero/types";
import type { IKState, IKAction, IKCrownAction, IKSetupAction, IKPlayAction, IKEffectChoiceAction } from "@imposter-zero/engine";
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
      readonly name: string | null;
      readonly token: string;
      readonly rooms: readonly RoomSummary[];
      readonly lastError: string | null;
    }
  | {
      readonly _tag: "lobby";
      readonly me: string;
      readonly name: string;
      readonly myIndex: PlayerId | null;
      readonly token: string;
      readonly roomId: string;
      readonly lobby: LobbyState;
      readonly targetScore: number;
      readonly maxPlayers: number;
      readonly hostId: string;
      readonly handHelper: boolean;
    }
  | {
      readonly _tag: "crown";
      readonly me: string;
      readonly name: string;
      readonly myIndex: PlayerId;
      readonly token: string;
      readonly roomId: string;
      readonly gameState: IKState;
      readonly legalActions: readonly IKCrownAction[];
      readonly activePlayer: PlayerId;
      readonly numPlayers: number;
      readonly playerNames: readonly string[];
    }
  | {
      readonly _tag: "setup";
      readonly me: string;
      readonly name: string;
      readonly myIndex: PlayerId;
      readonly token: string;
      readonly roomId: string;
      readonly gameState: IKState;
      readonly legalActions: readonly IKSetupAction[];
      readonly activePlayer: PlayerId;
      readonly numPlayers: number;
      readonly playerNames: readonly string[];
    }
  | {
      readonly _tag: "play";
      readonly me: string;
      readonly name: string;
      readonly myIndex: PlayerId;
      readonly token: string;
      readonly roomId: string;
      readonly gameState: IKState;
      readonly legalActions: readonly IKPlayAction[];
      readonly activePlayer: PlayerId;
      readonly numPlayers: number;
      readonly playerNames: readonly string[];
      readonly handHelper: boolean;
    }
  | {
      readonly _tag: "resolving";
      readonly me: string;
      readonly name: string;
      readonly myIndex: PlayerId;
      readonly token: string;
      readonly roomId: string;
      readonly gameState: IKState;
      readonly legalActions: readonly IKEffectChoiceAction[];
      readonly activePlayer: PlayerId;
      readonly numPlayers: number;
      readonly playerNames: readonly string[];
      readonly handHelper: boolean;
    }
  | {
      readonly _tag: "scoring";
      readonly me: string;
      readonly name: string;
      readonly myIndex: PlayerId;
      readonly token: string;
      readonly roomId: string;
      readonly gameState: IKState;
      readonly roundScores: readonly number[];
      readonly matchScores: readonly number[];
      readonly roundsPlayed: number;
      readonly numPlayers: number;
      readonly playerNames: readonly string[];
    }
  | {
      readonly _tag: "finished";
      readonly me: string;
      readonly name: string;
      readonly myIndex: PlayerId;
      readonly token: string;
      readonly roomId: string;
      readonly winners: readonly PlayerId[];
      readonly finalScores: readonly number[];
      readonly numPlayers: number;
      readonly playerNames: readonly string[];
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

const identity = (phase: ClientPhase): { readonly me: string; readonly token: string; readonly name: string | null } =>
  phase._tag === "connecting" ? { me: "", token: "", name: null } : { me: phase.me, token: phase.token, name: phase.name ?? null };

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
  : phase._tag === "crown" || phase._tag === "setup" || phase._tag === "play" || phase._tag === "resolving" ? phase.myIndex
  : phase._tag === "scoring" || phase._tag === "finished" ? phase.myIndex
  : 0;

const playerNamesOfPhase = (phase: ClientPhase, fallback: readonly string[]): readonly string[] => {
  switch (phase._tag) {
    case "crown":
    case "setup":
    case "play":
    case "resolving":
    case "scoring":
    case "finished":
      return phase.playerNames;
    default:
      return fallback;
  }
};

const numPlayersOf = (phase: ClientPhase, fallback: number): number => {
  switch (phase._tag) {
    case "crown":
    case "setup":
    case "play":
    case "resolving":
    case "scoring":
    case "finished":
      return phase.numPlayers;
    case "connecting":
    case "browser":
    case "lobby":
      return fallback;
  }
};

const handHelperOf = (phase: ClientPhase): boolean => {
  switch (phase._tag) {
    case "lobby":
    case "play":
    case "resolving":
      return phase.handHelper;
    default:
      return false;
  }
};

// ---------------------------------------------------------------------------
// Action type guards — proper narrowing instead of `as` casts
// ---------------------------------------------------------------------------

const isCrownAction = (a: IKAction): a is IKCrownAction => a.kind === "crown";
const isSetupAction = (a: IKAction): a is IKSetupAction => a.kind === "commit";
const isPlayAction = (a: IKAction): a is IKPlayAction =>
  a.kind === "play" || a.kind === "disgrace";
const isEffectChoiceAction = (a: IKAction): a is IKEffectChoiceAction =>
  a.kind === "effect_choice";

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
        name: msg.name ?? null,
        token: msg.token,
        rooms: [],
        lastError: null,
      };

    case "name_accepted": {
      if (phase._tag === "connecting") return phase;
      return { ...phase, name: msg.name, lastError: null } as ClientPhase;
    }

    case "room_list": {
      const { me, token, name } = identity(phase);
      if (phase._tag === "browser") {
        return { ...phase, rooms: msg.rooms };
      }
      return {
        _tag: "browser",
        me,
        name,
        token,
        rooms: msg.rooms,
        lastError: null,
      };
    }

    case "room_created":
    case "room_joined": {
      const { me, token, name } = identity(phase);
      return {
        _tag: "lobby",
        me,
        name: name ?? "",
        myIndex: null,
        token,
        roomId: msg.roomId,
        lobby: { kind: "waiting", minPlayers: 2, maxPlayers: 4, players: [] },
        targetScore: 7,
        maxPlayers: 4,
        hostId: "",
        handHelper: false,
      };
    }

    case "room_settings": {
      if (phase._tag === "lobby") {
        return {
          ...phase,
          targetScore: msg.targetScore,
          maxPlayers: msg.maxPlayers,
          hostId: msg.hostId,
          handHelper: (msg as Record<string, unknown>).handHelper === true ? true : phase.handHelper,
        };
      }
      return phase;
    }

    case "lobby_state": {
      const { me, token, name } = identity(phase);
      const rid = roomIdOf(phase);
      const lobbySettings = phase._tag === "lobby"
        ? { targetScore: phase.targetScore, maxPlayers: phase.maxPlayers, hostId: phase.hostId, handHelper: phase.handHelper }
        : { targetScore: 7, maxPlayers: 4, hostId: "", handHelper: false };
      return {
        _tag: "lobby",
        me,
        name: name ?? "",
        myIndex: findMyIndex(msg.lobby, name ?? me),
        token,
        roomId: rid,
        lobby: msg.lobby,
        ...lobbySettings,
      };
    }

    case "game_start":
      return phase;

    case "state": {
      const { me, token, name } = identity(phase);
      const myIndex = myIndexOf(phase);
      const numPlayers = msg.state.numPlayers;
      const rid = roomIdOf(phase);
      const playerNames = msg.playerNames ?? playerNamesOfPhase(phase, []);
      const handHelper = handHelperOf(phase);

      if (msg.state.phase === "crown") {
        return {
          _tag: "crown",
          me,
          name: name ?? "",
          myIndex,
          token,
          roomId: rid,
          gameState: msg.state,
          legalActions: msg.legalActions.filter(isCrownAction),
          activePlayer: msg.activePlayer,
          numPlayers,
          playerNames,
        };
      }

      if (msg.state.phase === "setup") {
        return {
          _tag: "setup",
          me,
          name: name ?? "",
          myIndex,
          token,
          roomId: rid,
          gameState: msg.state,
          legalActions: msg.legalActions.filter(isSetupAction),
          activePlayer: msg.activePlayer,
          numPlayers,
          playerNames,
        };
      }

      if (msg.state.phase === "resolving") {
        return {
          _tag: "resolving",
          me,
          name: name ?? "",
          myIndex,
          token,
          roomId: rid,
          gameState: msg.state,
          legalActions: msg.legalActions.filter(isEffectChoiceAction),
          activePlayer: msg.activePlayer,
          numPlayers,
          playerNames,
          handHelper,
        };
      }

      return {
        _tag: "play",
        me,
        name: name ?? "",
        myIndex,
        token,
        roomId: rid,
        gameState: msg.state,
        legalActions: msg.legalActions.filter(isPlayAction),
        activePlayer: msg.activePlayer,
        numPlayers,
        playerNames,
        handHelper,
      };
    }

    case "round_over": {
      const { me, token, name } = identity(phase);
      const rid = roomIdOf(phase);
      const playerNames = msg.playerNames ?? playerNamesOfPhase(phase, []);
      return {
        _tag: "scoring",
        me,
        name: name ?? "",
        myIndex: myIndexOf(phase),
        token,
        roomId: rid,
        gameState: msg.state,
        roundScores: msg.scores,
        matchScores: msg.matchScores,
        roundsPlayed: msg.roundsPlayed,
        numPlayers: numPlayersOf(phase, msg.scores.length),
        playerNames,
      };
    }

    case "match_over": {
      const { me, token, name } = identity(phase);
      const rid = roomIdOf(phase);
      const playerNames = msg.playerNames ?? playerNamesOfPhase(phase, []);
      return {
        _tag: "finished",
        me,
        name: name ?? "",
        myIndex: myIndexOf(phase),
        token,
        roomId: rid,
        winners: msg.winners,
        finalScores: msg.finalScores,
        numPlayers: numPlayersOf(phase, msg.finalScores.length),
        playerNames,
      };
    }

    case "error":
      if (phase._tag === "connecting") return phase;
      if (phase._tag === "browser") return { ...phase, lastError: msg.message };
      return phase;
  }
};

export const useGameReducer = () => {
  const [phase, dispatch] = useReducer(reduce, initialPhase);
  return { phase, dispatch } as const;
};

// ---------------------------------------------------------------------------
// Game log event detection — pure function comparing state transitions
// ---------------------------------------------------------------------------

export interface GameLogEvent {
  readonly kind: "play" | "disgrace" | "round_start" | "round_end";
  readonly turnNumber: number;
  readonly playerName: string;
  readonly playerIndex: number;
  readonly description: string;
}

export const detectLogEvents = (
  prev: ClientPhase,
  next: ClientPhase,
): ReadonlyArray<GameLogEvent> => {
  const events: GameLogEvent[] = [];

  if (prev._tag === "setup" && next._tag === "play") {
    events.push({
      kind: "round_start",
      turnNumber: 0,
      playerName: "",
      playerIndex: -1,
      description: "Round started",
    });
  }

  if ((prev._tag === "play" || prev._tag === "resolving") && next._tag === "play") {
    const prevCourt = prev.gameState.shared.court;
    const nextCourt = next.gameState.shared.court;
    const actingPlayer = prev.activePlayer;
    const playerName = prev.playerNames[actingPlayer] ?? `Player ${actingPlayer}`;

    if (nextCourt.length > prevCourt.length) {
      const newEntry = nextCourt[nextCourt.length - 1];
      if (newEntry) {
        events.push({
          kind: "play",
          turnNumber: prev.gameState.turnCount,
          playerName,
          playerIndex: actingPlayer,
          description: `played ${newEntry.card.kind.name} (${newEntry.card.kind.props.value})`,
        });
      }
    }

    if (
      nextCourt.length === prevCourt.length &&
      nextCourt.length > 0 &&
      prevCourt[prevCourt.length - 1]?.face === "up" &&
      nextCourt[nextCourt.length - 1]?.face === "down"
    ) {
      events.push({
        kind: "disgrace",
        turnNumber: prev.gameState.turnCount,
        playerName,
        playerIndex: actingPlayer,
        description: "disgraced",
      });
    }
  }

  if ((prev._tag === "play" || prev._tag === "resolving") && next._tag === "scoring") {
    const roundsPlayed = next.roundsPlayed;
    events.push({
      kind: "round_end",
      turnNumber: prev.gameState.turnCount,
      playerName: "",
      playerIndex: -1,
      description: `Round ${roundsPlayed} complete`,
    });
  }

  return events;
};
