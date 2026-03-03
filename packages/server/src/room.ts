import type { GameDef, PlayerId, Result } from "@imposter-zero/types";
import { ok, err, TERMINAL } from "@imposter-zero/types";
import {
  type IKState,
  type IKAction,
  type MatchState,
  createMatch,
  applyRoundResult,
  isMatchOver,
  matchWinners,
  roundScore,
} from "@imposter-zero/engine";

import {
  type LobbyState,
  type LobbyError,
  createLobbyForGame,
  lobbyTransitionSafe,
} from "./lobby.js";
import {
  type GameSession,
  startSession,
  applyPlayerAction,
  applyTimeout,
  type TimeoutPolicy,
} from "./session.js";

export type RoomPhase = "lobby" | "playing" | "scoring" | "finished";

export interface LobbyRoom {
  readonly phase: "lobby";
  readonly lobby: LobbyState;
  readonly match: MatchState;
  readonly game: GameDef<IKState, IKAction>;
  readonly turnDuration: number;
  readonly targetScore: number;
}

export interface PlayingRoom {
  readonly phase: "playing";
  readonly lobby: LobbyState;
  readonly match: MatchState;
  readonly session: GameSession<IKState, IKAction>;
  readonly game: GameDef<IKState, IKAction>;
  readonly turnDuration: number;
  readonly targetScore: number;
}

export interface ScoringRoom {
  readonly phase: "scoring";
  readonly lobby: LobbyState;
  readonly match: MatchState;
  readonly lastRoundScores: ReadonlyArray<number>;
  readonly game: GameDef<IKState, IKAction>;
  readonly turnDuration: number;
  readonly targetScore: number;
}

export interface FinishedRoom {
  readonly phase: "finished";
  readonly lobby: LobbyState;
  readonly match: MatchState;
  readonly winners: ReadonlyArray<PlayerId>;
  readonly game: GameDef<IKState, IKAction>;
  readonly turnDuration: number;
  readonly targetScore: number;
}

export type Room = LobbyRoom | PlayingRoom | ScoringRoom | FinishedRoom;

export type RoomAction =
  | { readonly kind: "join"; readonly playerId: string }
  | { readonly kind: "leave"; readonly playerId: string }
  | { readonly kind: "ready"; readonly playerId: string; readonly now: number }
  | { readonly kind: "action"; readonly playerId: string; readonly action: IKAction; readonly now: number }
  | { readonly kind: "timeout"; readonly now: number };

export type OutboundMessage =
  | { readonly type: "welcome"; readonly token: string; readonly playerId: string }
  | { readonly type: "lobby_state"; readonly lobby: LobbyState }
  | { readonly type: "game_start"; readonly numPlayers: number }
  | { readonly type: "state"; readonly state: IKState; readonly legalActions: ReadonlyArray<IKAction>; readonly activePlayer: PlayerId }
  | { readonly type: "round_over"; readonly scores: ReadonlyArray<number>; readonly matchScores: ReadonlyArray<number>; readonly roundsPlayed: number }
  | { readonly type: "match_over"; readonly winners: ReadonlyArray<PlayerId>; readonly finalScores: ReadonlyArray<number> }
  | { readonly type: "error"; readonly message: string };

export type RoomError =
  | { readonly kind: "lobby_error"; readonly lobbyError: LobbyError }
  | { readonly kind: "not_in_game" }
  | { readonly kind: "unknown_player"; readonly playerId: string }
  | { readonly kind: "action_error"; readonly message: string };

export interface RoomTransitionResult {
  readonly room: Room;
  readonly messages: ReadonlyArray<OutboundMessage>;
}

export const createRoom = (
  game: GameDef<IKState, IKAction>,
  targetScore: number = 7,
  turnDuration: number = 30_000,
): LobbyRoom => ({
  phase: "lobby",
  lobby: createLobbyForGame(game),
  match: createMatch(game.gameType.minPlayers, targetScore),
  game,
  turnDuration,
  targetScore,
});

const buildPlayerMapping = (lobby: LobbyState): ReadonlyMap<string, PlayerId> =>
  new Map(lobby.players.map((p, i) => [p.id, i as PlayerId]));

const startNewRound = (
  room: LobbyRoom | ScoringRoom,
  now: number,
): RoomTransitionResult => {
  const numPlayers = room.lobby.players.length;
  const playerMapping = buildPlayerMapping(room.lobby);
  const session = startSession(room.game, numPlayers, playerMapping, room.turnDuration, now);
  const legalActions = room.game.legalActions(session.state);
  const activePlayer = room.game.currentPlayer(session.state) as PlayerId;

  const lobbyResult = lobbyTransitionSafe(room.lobby, {
    kind: "start",
    gameId: `round-${room.match.roundsPlayed + 1}`,
    now,
  });

  const lobby = lobbyResult.ok ? lobbyResult.value : room.lobby;

  const playingRoom: PlayingRoom = {
    phase: "playing",
    lobby,
    match: room.match,
    session,
    game: room.game,
    turnDuration: room.turnDuration,
    targetScore: room.targetScore,
  };

  return {
    room: playingRoom,
    messages: [
      { type: "game_start", numPlayers },
      { type: "state", state: session.state, legalActions, activePlayer },
    ],
  };
};

const handleGameAction = (
  room: PlayingRoom,
  playerId: string,
  action: IKAction,
  now: number,
): Result<RoomError, RoomTransitionResult> => {
  const playerIdx = room.session.playerMapping.get(playerId);
  if (playerIdx === undefined) {
    return err({ kind: "unknown_player", playerId });
  }

  const result = applyPlayerAction(room.session, playerIdx, action, now);
  if (!result.ok) {
    return err({ kind: "action_error", message: result.error.kind });
  }

  const newSession = result.value;

  if (room.game.isTerminal(newSession.state)) {
    const scores = roundScore(newSession.state);
    const newMatch = applyRoundResult(room.match, scores);

    if (isMatchOver(newMatch)) {
      const winners = matchWinners(newMatch);
      const finishedRoom: FinishedRoom = {
        phase: "finished",
        lobby: room.lobby,
        match: newMatch,
        winners,
        game: room.game,
        turnDuration: room.turnDuration,
        targetScore: room.targetScore,
      };
      return ok({
        room: finishedRoom,
        messages: [
          { type: "round_over", scores, matchScores: [...newMatch.scores], roundsPlayed: newMatch.roundsPlayed },
          { type: "match_over", winners, finalScores: [...newMatch.scores] },
        ],
      });
    }

    const scoringRoom: ScoringRoom = {
      phase: "scoring",
      lobby: room.lobby,
      match: newMatch,
      lastRoundScores: scores,
      game: room.game,
      turnDuration: room.turnDuration,
      targetScore: room.targetScore,
    };
    return ok({
      room: scoringRoom,
      messages: [
        { type: "round_over", scores, matchScores: [...newMatch.scores], roundsPlayed: newMatch.roundsPlayed },
      ],
    });
  }

  const legalActions = room.game.legalActions(newSession.state);
  const activePlayer = room.game.currentPlayer(newSession.state) as PlayerId;

  return ok({
    room: { ...room, session: newSession },
    messages: [
      { type: "state", state: newSession.state, legalActions, activePlayer },
    ],
  });
};

const handleTimeout = (
  room: PlayingRoom,
  now: number,
): RoomTransitionResult => {
  const newSession = applyTimeout(room.session, now, "pass");

  if (newSession === room.session) {
    return { room, messages: [] };
  }

  if (room.game.isTerminal(newSession.state)) {
    const scores = roundScore(newSession.state);
    const newMatch = applyRoundResult(room.match, scores);

    if (isMatchOver(newMatch)) {
      const winners = matchWinners(newMatch);
      return {
        room: {
          phase: "finished",
          lobby: room.lobby,
          match: newMatch,
          winners,
          game: room.game,
          turnDuration: room.turnDuration,
          targetScore: room.targetScore,
        },
        messages: [
          { type: "round_over", scores, matchScores: [...newMatch.scores], roundsPlayed: newMatch.roundsPlayed },
          { type: "match_over", winners, finalScores: [...newMatch.scores] },
        ],
      };
    }

    return {
      room: {
        phase: "scoring",
        lobby: room.lobby,
        match: newMatch,
        lastRoundScores: scores,
        game: room.game,
        turnDuration: room.turnDuration,
        targetScore: room.targetScore,
      },
      messages: [
        { type: "round_over", scores, matchScores: [...newMatch.scores], roundsPlayed: newMatch.roundsPlayed },
      ],
    };
  }

  const legalActions = room.game.legalActions(newSession.state);
  const activePlayer = room.game.currentPlayer(newSession.state) as PlayerId;

  return {
    room: { ...room, session: newSession },
    messages: [
      { type: "state", state: newSession.state, legalActions, activePlayer },
    ],
  };
};

export const roomTransition = (
  room: Room,
  action: RoomAction,
  now: number,
): Result<RoomError, RoomTransitionResult> => {
  if (action.kind === "timeout") {
    if (room.phase !== "playing") {
      return ok({ room, messages: [] });
    }
    return ok(handleTimeout(room, now));
  }

  if (action.kind === "action") {
    if (room.phase !== "playing") {
      return err({ kind: "not_in_game" });
    }
    return handleGameAction(room, action.playerId, action.action, now);
  }

  if (room.phase === "scoring") {
    return ok(startNewRound(room, now));
  }

  if (room.phase !== "lobby") {
    if (action.kind === "join") {
      return err({ kind: "lobby_error", lobbyError: { kind: "join_during_game" } });
    }
    if (action.kind === "leave") {
      return err({ kind: "lobby_error", lobbyError: { kind: "leave_during_game" } });
    }
    if (action.kind === "ready") {
      return err({ kind: "lobby_error", lobbyError: { kind: "ready_during_game" } });
    }
  }

  const lobbyAction =
    action.kind === "join" ? { kind: "join" as const, playerId: action.playerId }
    : action.kind === "leave" ? { kind: "leave" as const, playerId: action.playerId }
    : { kind: "ready" as const, playerId: action.playerId, ready: true, now };

  const lobbyResult = lobbyTransitionSafe(room.lobby, lobbyAction);
  if (!lobbyResult.ok) {
    return err({ kind: "lobby_error", lobbyError: lobbyResult.error });
  }

  const newLobby = lobbyResult.value;

  if (newLobby.kind === "starting") {
    const numPlayers = newLobby.players.length;
    const newMatch = createMatch(numPlayers, room.targetScore);
    const lobbyRoom: LobbyRoom = {
      ...room as LobbyRoom,
      lobby: newLobby,
      match: newMatch,
    };
    const result = startNewRound(lobbyRoom, now);
    return ok({
      room: result.room,
      messages: [{ type: "lobby_state", lobby: newLobby }, ...result.messages],
    });
  }

  return ok({
    room: { ...room as LobbyRoom, lobby: newLobby },
    messages: [{ type: "lobby_state", lobby: newLobby }],
  });
};

export const continueAfterScoring = (
  room: ScoringRoom,
  now: number,
): RoomTransitionResult => startNewRound(room, now);
