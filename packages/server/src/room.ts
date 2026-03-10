import type { GameDef, PlayerId, Result, ServerMessage, DraftPhaseView } from "@imposter-zero/types";
import { ok, err, TERMINAL } from "@imposter-zero/types";
import {
  type IKState,
  type IKAction,
  type MatchState,
  type GameConfig,
  type PlayerArmy,
  type CardName,
  type DraftState,
  createMatch,
  createExpansionGame,
  createExpansionRound,
  exhaustArmyCardsPostRound,
  buildPlayerArmies,
  createDraftState,
  selectSignature,
  startTournamentDraft,
  chooseDraftOrder,
  draftPick,
  completeStandardSelection,
  applyRoundResult,
  isMatchOver,
  matchWinners,
  roundScore,
  expansionConfigForPlayers,
  SIGNATURE_CARD_NAMES,
} from "@imposter-zero/engine";
import type { PlayerId as EnginePlayerId } from "@imposter-zero/types";

import {
  type LobbyState,
  type LobbyError,
  createLobby,
  lobbyTransitionSafe,
} from "./lobby.js";
import {
  type GameSession,
  startSession,
  applyPlayerAction,
  applyTimeout,
  type TimeoutPolicy,
} from "./session.js";

export type RoomPhase = "lobby" | "drafting" | "playing" | "scoring" | "finished";

export interface ExpansionState {
  readonly config: GameConfig;
  readonly playerArmies: ReadonlyArray<PlayerArmy>;
}

export interface LobbyRoom {
  readonly phase: "lobby";
  readonly lobby: LobbyState;
  readonly match: MatchState;
  readonly game: GameDef<IKState, IKAction>;
  readonly turnDuration: number;
  readonly targetScore: number;
  readonly expansionState: ExpansionState | null;
  readonly tournament: boolean;
}

export interface PlayingRoom {
  readonly phase: "playing";
  readonly lobby: LobbyState;
  readonly match: MatchState;
  readonly session: GameSession<IKState, IKAction>;
  readonly game: GameDef<IKState, IKAction>;
  readonly turnDuration: number;
  readonly targetScore: number;
  readonly expansionState: ExpansionState | null;
}

export interface ScoringRoom {
  readonly phase: "scoring";
  readonly lobby: LobbyState;
  readonly match: MatchState;
  readonly lastRoundScores: ReadonlyArray<number>;
  readonly lastState: IKState;
  readonly loser: PlayerId;
  readonly game: GameDef<IKState, IKAction>;
  readonly turnDuration: number;
  readonly targetScore: number;
  readonly expansionState: ExpansionState | null;
  readonly readyPlayers: ReadonlySet<string>;
  readonly reviewDeadline: number;
}

export interface DraftingRoom {
  readonly phase: "drafting";
  readonly lobby: LobbyState;
  readonly match: MatchState;
  readonly game: GameDef<IKState, IKAction>;
  readonly turnDuration: number;
  readonly targetScore: number;
  readonly expansionState: ExpansionState;
  readonly draftState: DraftState;
  readonly tournament: boolean;
}

export interface FinishedRoom {
  readonly phase: "finished";
  readonly lobby: LobbyState;
  readonly match: MatchState;
  readonly winners: ReadonlyArray<PlayerId>;
  readonly game: GameDef<IKState, IKAction>;
  readonly turnDuration: number;
  readonly targetScore: number;
  readonly expansionState: ExpansionState | null;
}

export type Room = LobbyRoom | DraftingRoom | PlayingRoom | ScoringRoom | FinishedRoom;

export type RoomAction =
  | { readonly kind: "join"; readonly playerId: string }
  | { readonly kind: "leave"; readonly playerId: string }
  | { readonly kind: "ready"; readonly playerId: string; readonly now: number }
  | { readonly kind: "action"; readonly playerId: string; readonly action: IKAction; readonly now: number }
  | { readonly kind: "timeout"; readonly now: number }
  | { readonly kind: "draft_select"; readonly playerId: string; readonly cards: ReadonlyArray<string>; readonly now: number }
  | { readonly kind: "draft_order"; readonly playerId: string; readonly goFirst: boolean; readonly now: number }
  | { readonly kind: "draft_pick"; readonly playerId: string; readonly card: string; readonly now: number };

export type OutboundMessage = ServerMessage<IKState, IKAction, LobbyState>;

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
  maxPlayers?: number,
  targetScore: number = 7,
  turnDuration: number = 30_000,
  expansionState: ExpansionState | null = null,
  tournament: boolean = true,
): LobbyRoom => {
  const max = maxPlayers ?? game.gameType.maxPlayers;
  return {
    phase: "lobby",
    lobby: createLobby(game.gameType.minPlayers, max),
    match: createMatch(game.gameType.minPlayers, targetScore),
    game,
    turnDuration,
    targetScore,
    expansionState,
    tournament,
  };
};

const longTimeout = (turnDuration: number): number =>
  Math.max(120_000, turnDuration * 4);

const phaseDuration = (state: IKState, turnDuration: number): number =>
  state.phase === "mustering" ? longTimeout(turnDuration) : turnDuration;

const adjustDeadline = (
  session: GameSession<IKState, IKAction>,
  turnDuration: number,
  now: number,
): GameSession<IKState, IKAction> => {
  const pd = phaseDuration(session.state, turnDuration);
  if (pd === turnDuration) return session;
  return { ...session, turnDeadline: now + pd };
};

const buildPlayerMapping = (lobby: LobbyState): ReadonlyMap<string, PlayerId> =>
  new Map(lobby.players.map((p, i) => [p.id, i as PlayerId]));

const playerNamesOf = (room: { readonly lobby: LobbyState }): ReadonlyArray<string> =>
  room.lobby.players.map((p) => p.id);

// ---------------------------------------------------------------------------
// Draft state → per-player message projection
// ---------------------------------------------------------------------------

export const draftStateToView = (
  ds: DraftState,
  playerIdx: PlayerId,
  tournament: boolean,
): DraftPhaseView => {
  const pool = ds.config.signaturePool.map((k) => k.name);
  switch (ds.phase.tag) {
    case "selection": {
      const mySel = ds.playerSelections[playerIdx] ?? [];
      const selectionsNeeded = tournament ? 1 : ds.config.signaturesPerPlayer;
      const submitted = mySel.length >= selectionsNeeded;
      const allSubmitted = ds.playerSelections.every((s) => s.length >= selectionsNeeded);
      return { tag: "selection", pool, selectionsNeeded, mySelection: mySel, submitted, allSubmitted };
    }
    case "reveal":
      return { tag: "reveal", playerSelections: ds.phase.selections };
    case "draft_order": {
      const nonTrueKing = ((ds.trueKing + 1) % ds.numPlayers) as PlayerId;
      return { tag: "draft_order", faceUp: ds.phase.faceUp, chooser: nonTrueKing, amChooser: playerIdx === nonTrueKing };
    }
    case "drafting":
      return {
        tag: "drafting",
        faceUp: ds.phase.faceUp,
        currentPicker: ds.phase.pickerOrder[ds.phase.currentPickerIdx]!,
        amCurrentPicker: ds.phase.pickerOrder[ds.phase.currentPickerIdx] === playerIdx,
        mySignatures: ds.playerSelections[playerIdx] ?? [],
        picksRemaining: [...ds.phase.picksRemaining],
      };
    case "complete":
      return { tag: "complete", playerSignatures: ds.phase.playerSignatures };
  }
};

// ---------------------------------------------------------------------------
// Round start
// ---------------------------------------------------------------------------

const startNewRound = (
  room: LobbyRoom | ScoringRoom,
  now: number,
): RoomTransitionResult => {
  const numPlayers = room.lobby.players.length;
  const playerMapping = buildPlayerMapping(room.lobby);
  const trueKing = room.phase === "scoring" ? room.loser as EnginePlayerId : undefined;

  let activeGame = room.game;
  let initialState: IKState | undefined;

  const expansion = room.expansionState!;
  const tk: PlayerId = trueKing ?? (0 as PlayerId);
  activeGame = createExpansionGame(
    expansion.config,
    expansion.playerArmies,
    tk,
  );
  initialState = createExpansionRound(
    expansion.config,
    expansion.playerArmies,
    tk,
  );

  const rawSession = startSession(activeGame, numPlayers, playerMapping, room.turnDuration, now, initialState);
  const session = adjustDeadline(rawSession, room.turnDuration, now);
  const legalActions = activeGame.legalActions(session.state);
  const activePlayer = activeGame.currentPlayer(session.state) as PlayerId;

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
    game: activeGame,
    turnDuration: room.turnDuration,
    targetScore: room.targetScore,
    expansionState: room.expansionState,
  };

  const playerNames = playerNamesOf(room);
  return {
    room: playingRoom,
    messages: [
      { type: "game_start", numPlayers },
      { type: "state", state: session.state, legalActions, activePlayer, playerNames, turnDeadline: session.turnDeadline },
    ],
  };
};

// ---------------------------------------------------------------------------
// Game action + timeout handlers (unchanged)
// ---------------------------------------------------------------------------

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

  const newSession = adjustDeadline(result.value, room.turnDuration, now);

  if (room.game.isTerminal(newSession.state)) {
    const scores = roundScore(newSession.state);
    const newMatch = applyRoundResult(room.match, scores);

    const playerNames = playerNamesOf(room);

    const terminalState = newSession.state;

    const updatedExpansion = room.expansionState
      ? {
          ...room.expansionState,
          playerArmies: exhaustArmyCardsPostRound(terminalState, room.expansionState.playerArmies),
        }
      : null;

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
        expansionState: updatedExpansion,
      };
      const reviewDeadline = now + longTimeout(room.turnDuration);
      return ok({
        room: finishedRoom,
        messages: [
          { type: "round_over", state: terminalState, scores, matchScores: [...newMatch.scores], roundsPlayed: newMatch.roundsPlayed, playerNames, reviewDeadline },
          { type: "match_over", winners, finalScores: [...newMatch.scores], playerNames },
        ],
      });
    }

    const reviewDeadline = now + longTimeout(room.turnDuration);
    const scoringRoom: ScoringRoom = {
      phase: "scoring",
      lobby: room.lobby,
      match: newMatch,
      lastRoundScores: scores,
      lastState: terminalState,
      loser: terminalState.forcedLoser ?? terminalState.activePlayer,
      game: room.game,
      turnDuration: room.turnDuration,
      targetScore: room.targetScore,
      expansionState: updatedExpansion,
      readyPlayers: new Set(),
      reviewDeadline,
    };
    return ok({
      room: scoringRoom,
      messages: [
        { type: "round_over", state: terminalState, scores, matchScores: [...newMatch.scores], roundsPlayed: newMatch.roundsPlayed, playerNames, reviewDeadline },
      ],
    });
  }

  const legalActions = room.game.legalActions(newSession.state);
  const activePlayer = room.game.currentPlayer(newSession.state) as PlayerId;
  const playerNames = playerNamesOf(room);

  return ok({
    room: { ...room, session: newSession },
    messages: [
      { type: "state", state: newSession.state, legalActions, activePlayer, playerNames, turnDeadline: newSession.turnDeadline },
    ],
  });
};

const handleTimeout = (
  room: PlayingRoom,
  now: number,
): RoomTransitionResult => {
  const rawTimeout = applyTimeout(room.session, now, "pass");
  const newSession = rawTimeout === room.session ? rawTimeout : adjustDeadline(rawTimeout, room.turnDuration, now);

  if (newSession === room.session) {
    return { room, messages: [] };
  }

  const playerNames = playerNamesOf(room);

  if (room.game.isTerminal(newSession.state)) {
    const terminalState = newSession.state;
    const scores = roundScore(terminalState);
    const newMatch = applyRoundResult(room.match, scores);

    const updatedExpansion = room.expansionState
      ? {
          ...room.expansionState,
          playerArmies: exhaustArmyCardsPostRound(terminalState, room.expansionState.playerArmies),
        }
      : null;

    const rd = now + longTimeout(room.turnDuration);

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
          expansionState: updatedExpansion,
        },
        messages: [
          { type: "round_over", state: terminalState, scores, matchScores: [...newMatch.scores], roundsPlayed: newMatch.roundsPlayed, playerNames, reviewDeadline: rd },
          { type: "match_over", winners, finalScores: [...newMatch.scores], playerNames },
        ],
      };
    }

    return {
      room: {
        phase: "scoring",
        lobby: room.lobby,
        match: newMatch,
        lastRoundScores: scores,
        lastState: terminalState,
        loser: terminalState.forcedLoser ?? terminalState.activePlayer,
        game: room.game,
        turnDuration: room.turnDuration,
        targetScore: room.targetScore,
        expansionState: updatedExpansion,
        readyPlayers: new Set(),
        reviewDeadline: rd,
      },
      messages: [
        { type: "round_over", state: terminalState, scores, matchScores: [...newMatch.scores], roundsPlayed: newMatch.roundsPlayed, playerNames, reviewDeadline: rd },
      ],
    };
  }

  const legalActions = room.game.legalActions(newSession.state);
  const activePlayer = room.game.currentPlayer(newSession.state) as PlayerId;

  return {
    room: { ...room, session: newSession },
    messages: [
      { type: "state", state: newSession.state, legalActions, activePlayer, playerNames, turnDeadline: newSession.turnDeadline },
    ],
  };
};

// ---------------------------------------------------------------------------
// Draft phase handlers — driven by engine DraftState
// ---------------------------------------------------------------------------

export const perPlayerDraftMessages = (room: DraftingRoom): ReadonlyArray<OutboundMessage> => {
  const playerNames = playerNamesOf(room);
  return room.lobby.players.map((_, i) => ({
    type: "draft_state" as const,
    tournament: room.tournament,
    playerNames,
    draftPhase: draftStateToView(room.draftState, i as PlayerId, room.tournament),
  }));
};

const finishDraft = (
  room: DraftingRoom,
  ds: DraftState,
  now: number,
): RoomTransitionResult => {
  if (ds.phase.tag !== "complete") {
    throw new Error("finishDraft called on non-complete draft");
  }
  const armies = buildPlayerArmies(
    room.expansionState.config,
    ds.phase.playerSignatures as ReadonlyArray<ReadonlyArray<CardName>>,
  );
  const updatedExpansion: ExpansionState = {
    ...room.expansionState,
    playerArmies: armies,
  };

  const lobbyRoom: LobbyRoom = {
    phase: "lobby",
    lobby: room.lobby,
    match: room.match,
    game: room.game,
    turnDuration: room.turnDuration,
    targetScore: room.targetScore,
    expansionState: updatedExpansion,
    tournament: room.tournament,
  };

  const roundResult = startNewRound(lobbyRoom, now);

  return {
    room: roundResult.room,
    messages: roundResult.messages,
  };
};

export const startDraftPhase = (
  room: LobbyRoom,
  tournament: boolean,
  now: number,
): RoomTransitionResult => {
  const numPlayers = room.lobby.players.length;
  const effectiveTournament = tournament && numPlayers === 2;
  const newMatch = createMatch(numPlayers, room.targetScore);
  const expansion = {
    ...room.expansionState!,
    config: expansionConfigForPlayers(numPlayers),
  };

  const ds = createDraftState(expansion.config, numPlayers, 0 as PlayerId);

  const draftingRoom: DraftingRoom = {
    phase: "drafting",
    lobby: room.lobby,
    match: newMatch,
    game: room.game,
    turnDuration: room.turnDuration,
    targetScore: room.targetScore,
    expansionState: expansion,
    draftState: ds,
    tournament: effectiveTournament,
  };

  const playerNames = playerNamesOf(room);

  return {
    room: draftingRoom,
    messages: [
      { type: "lobby_state", lobby: room.lobby },
    ],
  };
};

const handleDraftSelect = (
  room: DraftingRoom,
  playerId: string,
  cards: ReadonlyArray<string>,
  now: number,
): Result<RoomError, RoomTransitionResult> => {
  if (room.draftState.phase.tag !== "selection") {
    return err({ kind: "action_error", message: "Not in selection phase" });
  }

  const playerMapping = buildPlayerMapping(room.lobby);
  const playerIdx = playerMapping.get(playerId);
  if (playerIdx === undefined) {
    return err({ kind: "unknown_player", playerId });
  }

  const needed = room.tournament ? 1 : room.draftState.config.signaturesPerPlayer;
  if (cards.length !== needed) {
    return err({ kind: "action_error", message: `Must select exactly ${needed} card(s)` });
  }

  const validNames = new Set<string>(room.draftState.config.signaturePool.map((k) => k.name));
  for (const card of cards) {
    if (!validNames.has(card)) {
      return err({ kind: "action_error", message: `Invalid signature card: ${card}` });
    }
  }

  let ds = selectSignature(room.draftState, playerIdx, cards as unknown as ReadonlyArray<CardName>);

  const allSubmitted = ds.playerSelections.every((s) => s.length >= needed);
  const playerNames = playerNamesOf(room);

  if (allSubmitted) {
    if (room.tournament) {
      ds = startTournamentDraft(ds);
    } else {
      ds = completeStandardSelection(ds);
    }
  }

  if (ds.phase.tag === "complete") {
    return ok(finishDraft({ ...room, draftState: ds }, ds, now));
  }

  const updatedRoom: DraftingRoom = { ...room, draftState: ds };

  return ok({
    room: updatedRoom,
    messages: [],
  });
};

const handleDraftOrderChoice = (
  room: DraftingRoom,
  playerId: string,
  goFirst: boolean,
  now: number,
): Result<RoomError, RoomTransitionResult> => {
  if (room.draftState.phase.tag !== "draft_order") {
    return err({ kind: "action_error", message: "Not in draft_order phase" });
  }

  const playerMapping = buildPlayerMapping(room.lobby);
  const playerIdx = playerMapping.get(playerId);
  if (playerIdx === undefined) {
    return err({ kind: "unknown_player", playerId });
  }

  const nonTrueKing = ((room.draftState.trueKing + 1) % room.draftState.numPlayers) as PlayerId;
  if (playerIdx !== nonTrueKing) {
    return err({ kind: "action_error", message: "Only the non-True King chooses draft order" });
  }

  const ds = chooseDraftOrder(room.draftState, goFirst);
  const updatedRoom: DraftingRoom = { ...room, draftState: ds };

  return ok({
    room: updatedRoom,
    messages: [],
  });
};

const handleDraftPick = (
  room: DraftingRoom,
  playerId: string,
  card: string,
  now: number,
): Result<RoomError, RoomTransitionResult> => {
  if (room.draftState.phase.tag !== "drafting") {
    return err({ kind: "action_error", message: "Not in drafting phase" });
  }

  const playerMapping = buildPlayerMapping(room.lobby);
  const playerIdx = playerMapping.get(playerId);
  if (playerIdx === undefined) {
    return err({ kind: "unknown_player", playerId });
  }

  const currentPicker = room.draftState.phase.pickerOrder[room.draftState.phase.currentPickerIdx]!;
  if (playerIdx !== currentPicker) {
    return err({ kind: "action_error", message: "Not your turn to pick" });
  }

  if (!room.draftState.phase.faceUp.includes(card as CardName)) {
    return err({ kind: "action_error", message: `Card ${card} is not in the face-up pool` });
  }

  const ds = draftPick(room.draftState, card as CardName);
  const playerNames = playerNamesOf(room);

  if (ds.phase.tag === "complete") {
    return ok(finishDraft({ ...room, draftState: ds }, ds, now));
  }

  const updatedRoom: DraftingRoom = { ...room, draftState: ds };

  return ok({
    room: updatedRoom,
    messages: [],
  });
};

// ---------------------------------------------------------------------------
// Main room transition dispatcher
// ---------------------------------------------------------------------------

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

  if (action.kind === "draft_select") {
    if (room.phase !== "drafting") {
      return err({ kind: "not_in_game" });
    }
    return handleDraftSelect(room, action.playerId, action.cards, now);
  }

  if (action.kind === "draft_order") {
    if (room.phase !== "drafting") {
      return err({ kind: "not_in_game" });
    }
    return handleDraftOrderChoice(room, action.playerId, action.goFirst, now);
  }

  if (action.kind === "draft_pick") {
    if (room.phase !== "drafting") {
      return err({ kind: "not_in_game" });
    }
    return handleDraftPick(room, action.playerId, action.card, now);
  }

  if (action.kind === "action") {
    if (room.phase !== "playing") {
      return err({ kind: "not_in_game" });
    }
    return handleGameAction(room, action.playerId, action.action, now);
  }

  if (room.phase === "scoring") {
    const scoring = room as ScoringRoom;
    const newReady = new Set(scoring.readyPlayers);
    newReady.add(action.playerId);
    const allPlayerIds = scoring.lobby.players.map((p) => p.id);
    if (allPlayerIds.every((pid) => newReady.has(pid))) {
      return ok(startNewRound({ ...scoring, readyPlayers: newReady }, now));
    }
    const updated: ScoringRoom = { ...scoring, readyPlayers: newReady };
    return ok({
      room: updated,
      messages: [{ type: "scoring_ready", readyPlayers: [...newReady] }],
    });
  }

  if (room.phase === "drafting") {
    return ok({ room, messages: [] });
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
    const lobbyRoom: LobbyRoom = {
      ...(room as LobbyRoom),
      lobby: newLobby,
      expansionState: (room as LobbyRoom).expansionState,
    };

    if (lobbyRoom.expansionState) {
      const draftResult = startDraftPhase(lobbyRoom, lobbyRoom.tournament, now);
      return ok({
        room: draftResult.room,
        messages: [{ type: "lobby_state", lobby: newLobby }, ...draftResult.messages],
      });
    }

    const numPlayers = newLobby.players.length;
    const newMatch = createMatch(numPlayers, room.targetScore);
    const matchLobbyRoom: LobbyRoom = {
      ...lobbyRoom,
      match: newMatch,
    };
    const result = startNewRound(matchLobbyRoom, now);
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
