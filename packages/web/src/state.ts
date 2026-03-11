import { useReducer } from "react";
import type { PlayerId, DraftPhaseView } from "@imposter-zero/types";
import type { IKState, IKAction, IKCrownAction, IKSetupAction, IKPlayAction, IKEffectChoiceAction, IKMusteringAction } from "@imposter-zero/engine";
import { isMusteringAction as isMusteringActionEngine } from "@imposter-zero/engine";
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
      readonly tournament: boolean;
    }
  | {
      readonly _tag: "drafting";
      readonly me: string;
      readonly name: string;
      readonly myIndex: PlayerId | null;
      readonly token: string;
      readonly roomId: string;
      readonly tournament: boolean;
      readonly playerNames: readonly string[];
      readonly draftPhase: DraftPhaseView;
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
      readonly turnDeadline: number;
    }
  | {
      readonly _tag: "mustering";
      readonly me: string;
      readonly name: string;
      readonly myIndex: PlayerId;
      readonly token: string;
      readonly roomId: string;
      readonly gameState: IKState;
      readonly legalActions: readonly IKMusteringAction[];
      readonly activePlayer: PlayerId;
      readonly numPlayers: number;
      readonly playerNames: readonly string[];
      readonly turnDeadline: number;
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
      readonly turnDeadline: number;
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
      readonly turnDeadline: number;
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
      readonly turnDeadline: number;
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
      readonly readyPlayers: readonly string[];
      readonly reviewDeadline: number;
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
  : phase._tag === "crown" || phase._tag === "mustering" || phase._tag === "setup" || phase._tag === "play" || phase._tag === "resolving" ? phase.myIndex
  : phase._tag === "scoring" || phase._tag === "finished" ? phase.myIndex
  : 0;

const playerNamesOfPhase = (phase: ClientPhase, fallback: readonly string[]): readonly string[] => {
  switch (phase._tag) {
    case "drafting":
    case "crown":
    case "mustering":
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
    case "mustering":
    case "setup":
    case "play":
    case "resolving":
    case "scoring":
    case "finished":
      return phase.numPlayers;
    case "connecting":
    case "drafting":
    case "browser":
    case "lobby":
      return fallback;
  }
};

const handHelperOf = (_phase: ClientPhase): boolean => false;

// ---------------------------------------------------------------------------
// Action type guards — proper narrowing instead of `as` casts
// ---------------------------------------------------------------------------

const isCrownAction = (a: IKAction): a is IKCrownAction => a.kind === "crown";
const isMusteringAction = (a: IKAction): a is IKMusteringAction =>
  isMusteringActionEngine(a);
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
        tournament: true,
      };
    }

    case "room_settings": {
      if (phase._tag === "lobby") {
        return {
          ...phase,
          targetScore: msg.targetScore,
          maxPlayers: msg.maxPlayers,
          hostId: msg.hostId,
          tournament: msg.tournament,
        };
      }
      return phase;
    }

    case "lobby_state": {
      const { me, token, name } = identity(phase);
      const rid = roomIdOf(phase);
      const lobbySettings = phase._tag === "lobby"
        ? { targetScore: phase.targetScore, maxPlayers: phase.maxPlayers, hostId: phase.hostId, tournament: phase.tournament }
        : { targetScore: 7, maxPlayers: 4, hostId: "", tournament: true };
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

    case "draft_state": {
      const { me, token, name } = identity(phase);
      const rid = roomIdOf(phase);
      return {
        _tag: "drafting",
        me,
        name: name ?? "",
        myIndex: phase._tag === "lobby" ? phase.myIndex : (phase._tag === "drafting" ? phase.myIndex : null),
        token,
        roomId: rid,
        tournament: msg.tournament,
        playerNames: msg.playerNames,
        draftPhase: msg.draftPhase,
      };
    }

    case "state": {
      const { me, token, name } = identity(phase);
      const myIndex = myIndexOf(phase);
      const numPlayers = msg.state.numPlayers;
      const rid = roomIdOf(phase);
      const playerNames = msg.playerNames ?? playerNamesOfPhase(phase, []);

      const turnDeadline = msg.turnDeadline;

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
          turnDeadline,
        };
      }

      if (msg.state.phase === "mustering") {
        return {
          _tag: "mustering",
          me,
          name: name ?? "",
          myIndex,
          token,
          roomId: rid,
          gameState: msg.state,
          legalActions: msg.legalActions.filter(isMusteringAction),
          activePlayer: msg.activePlayer,
          numPlayers,
          playerNames,
          turnDeadline,
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
          turnDeadline,
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
          turnDeadline,
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
        turnDeadline,
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
        readyPlayers: [],
        reviewDeadline: msg.reviewDeadline,
      };
    }

    case "scoring_ready": {
      if (phase._tag !== "scoring") return phase;
      return { ...phase, readyPlayers: msg.readyPlayers };
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
  readonly kind: "play" | "disgrace" | "round_start" | "round_end" | "mustering" | "commit" | "draft";
  readonly turnNumber: number;
  readonly playerName: string;
  readonly playerIndex: number;
  readonly description: string;
}

const kingFacetLabel = (
  facet: import("@imposter-zero/engine").IKPlayerZones["king"]["facet"],
): string => {
  switch (facet) {
    case "charismatic":
      return "Charismatic Leader";
    case "masterTactician":
      return "Master Tactician";
    default:
      return "King";
  }
};

const describeSetupCommit = (
  zones: import("@imposter-zero/engine").IKPlayerZones,
  revealCards: boolean,
): string => {
  if (revealCards) {
    const roles = [
      zones.successor ? `${zones.successor.card.kind.name} as Successor` : null,
      zones.dungeon ? `${zones.dungeon.card.kind.name} as Dungeon` : null,
      zones.squire ? `${zones.squire.card.kind.name} as Squire` : null,
    ].filter((role): role is string => role !== null);
    return `committed setup: ${roles.join(", ")}`;
  }

  return zones.squire !== null
    ? "committed setup: chose a Successor, a Dungeon, and a Squire"
    : "committed setup: chose a Successor and a Dungeon";
};

const draftEvent = (description: string, playerName = "", playerIndex = -1): GameLogEvent => ({
  kind: "draft",
  turnNumber: 0,
  playerName,
  playerIndex,
  description,
});

export const detectLogEvents = (
  prev: ClientPhase,
  next: ClientPhase,
): ReadonlyArray<GameLogEvent> => {
  const events: GameLogEvent[] = [];

  // ── Draft phase transitions ──
  if (prev._tag === "drafting" && next._tag === "drafting") {
    const prevDp = prev.draftPhase;
    const nextDp = next.draftPhase;
    const names = next.playerNames;

    if (prevDp.tag === "selection" && nextDp.tag === "selection") {
      if (!prevDp.allSubmitted && nextDp.allSubmitted) {
        events.push(draftEvent("All players submitted their picks"));
      } else if (!prevDp.submitted && nextDp.submitted) {
        events.push(draftEvent("You submitted your pick"));
      } else if (prevDp.allSubmitted === nextDp.allSubmitted && prevDp.submitted === nextDp.submitted) {
        // no visible change
      } else {
        events.push(draftEvent("Opponent submitted their pick"));
      }
    }

    if (prevDp.tag === "selection" && nextDp.tag === "draft_order") {
      for (let i = 0; i < nextDp.playerSelections.length; i++) {
        const sigs = nextDp.playerSelections[i];
        if (sigs && sigs.length > 0) {
          const name = names[i] ?? `Player ${i}`;
          events.push(draftEvent(`selected ${sigs.join(", ")}`, name, i));
        }
      }
      events.push(draftEvent("Signatures revealed — choosing draft order"));
    }

    if (prevDp.tag === "selection" && nextDp.tag === "reveal") {
      for (let i = 0; i < nextDp.playerSelections.length; i++) {
        const sigs = nextDp.playerSelections[i];
        if (sigs && sigs.length > 0) {
          const name = names[i] ?? `Player ${i}`;
          events.push(draftEvent(`selected ${sigs.join(", ")}`, name, i));
        }
      }
    }

    if (prevDp.tag === "reveal" && nextDp.tag === "draft_order") {
      events.push(draftEvent("Signatures revealed — choosing draft order"));
    }

    if (prevDp.tag === "selection" && nextDp.tag === "complete") {
      if (nextDp.playerSignatures) {
        const lines = nextDp.playerSignatures.map((sigs, i) =>
          `${names[i] ?? `Player ${i}`}: ${sigs.join(", ")}`,
        );
        events.push(draftEvent(`Signatures selected\n${lines.join("\n")}`));
      }
    }

    if (prevDp.tag === "draft_order" && nextDp.tag === "drafting") {
      const chooserIdx = prevDp.chooser;
      const chooserName = names[chooserIdx] ?? `Player ${chooserIdx}`;
      const wentFirst = nextDp.currentPicker === chooserIdx;
      events.push(draftEvent(
        `chose to pick ${wentFirst ? "first" : "second"}`,
        chooserName,
        chooserIdx,
      ));
    }

    if (prevDp.tag === "drafting" && (nextDp.tag === "drafting" || nextDp.tag === "complete")) {
      const prevFaceUp = new Set(prevDp.faceUp);
      const nextFaceUp = new Set(nextDp.tag === "drafting" ? nextDp.faceUp : []);
      const picked = [...prevFaceUp].filter((c) => !nextFaceUp.has(c));
      if (picked.length > 0) {
        const pickerIdx = prevDp.currentPicker;
        const pickerName = names[pickerIdx] ?? `Player ${pickerIdx}`;
        for (const card of picked) {
          events.push(draftEvent(`drafted ${card}`, pickerName, pickerIdx));
        }
      }
    }

    if (prevDp.tag !== "complete" && nextDp.tag === "complete") {
      const lines = nextDp.playerSignatures.map((sigs, i) =>
        `${names[i] ?? `Player ${i}`}: ${sigs.join(", ")}`,
      );
      events.push(draftEvent(`Armies assembled\n${lines.join("\n")}`));
    }
  }

  if (prev._tag === "drafting" && next._tag !== "drafting") {
    events.push(draftEvent("Draft complete — match begins"));
  }

  if (prev._tag === "lobby" && next._tag === "drafting") {
    const mode = next.tournament ? "Tournament" : "Standard";
    events.push(draftEvent(`${mode} Draft started`));
  }

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

  if (prev._tag === "mustering" && next._tag === "mustering") {
    const prevState = prev.gameState;
    const nextState = next.gameState;
    const actor = prev.activePlayer;
    const actorName = prev.playerNames[actor] ?? `Player ${actor}`;
    const prevZones = prevState.players[actor];
    const nextZones = nextState.players[actor];

    if (prevZones && nextZones) {
      if (nextState.musteringPlayersDone > prevState.musteringPlayersDone) {
        events.push({
          kind: "mustering",
          turnNumber: 0,
          playerName: actorName,
          playerIndex: actor,
          description: "finished mustering",
        });
      } else if (prevZones.king.facet !== nextZones.king.facet && nextZones.king.facet !== "default") {
        events.push({
          kind: "mustering",
          turnNumber: 0,
          playerName: actorName,
          playerIndex: actor,
          description: `selected ${kingFacetLabel(nextZones.king.facet)}`,
        });
      } else if (nextZones.recruitDiscard.length > prevZones.recruitDiscard.length) {
        const discarded = nextZones.recruitDiscard.find((c) => !prevZones.recruitDiscard.some((pc) => pc.id === c.id));
        events.push({
          kind: "mustering",
          turnNumber: 0,
          playerName: actorName,
          playerIndex: actor,
          description: `discarded ${discarded?.kind.name ?? "a card"} to recruit`,
        });
      } else {
        const recovered = nextZones.army.find((c) => !prevZones.army.some((pc) => pc.id === c.id));
        const newlyExhausted = nextZones.exhausted.filter((c) => !prevZones.exhausted.some((pc) => pc.id === c.id));

        if (recovered !== undefined && newlyExhausted.length >= 2) {
          const exhaustedNames = newlyExhausted.map((c) => c.kind.name).join(" + ");
          events.push({
            kind: "mustering",
            turnNumber: 0,
            playerName: actorName,
            playerIndex: actor,
            description: `recommissioned: recovered ${recovered.kind.name}, exhausted ${exhaustedNames}`,
          });
        } else if (recovered === undefined && newlyExhausted.length === 1) {
          events.push({
            kind: "mustering",
            turnNumber: 0,
            playerName: actorName,
            playerIndex: actor,
            description: `exhausted ${newlyExhausted[0]!.kind.name} to begin recruiting`,
          });
        }
      }
    }
  }

  if (prev._tag === "setup" && next._tag === "setup") {
    const actor = prev.activePlayer;
    const actorName = prev.playerNames[actor] ?? `Player ${actor}`;
    const prevZones = prev.gameState.players[actor];
    const nextZones = next.gameState.players[actor];

    if (
      prevZones &&
      nextZones &&
      prevZones.successor === null &&
      prevZones.dungeon === null &&
      nextZones.successor !== null &&
      nextZones.dungeon !== null
    ) {
      events.push({
        kind: "commit",
        turnNumber: prev.gameState.turnCount,
        playerName: actorName,
        playerIndex: actor,
        description: describeSetupCommit(nextZones, actor === next.myIndex),
      });
    }
  }

  if (prev._tag === "mustering" && next._tag !== "mustering" && next._tag === "setup") {
    events.push({
      kind: "mustering",
      turnNumber: 0,
      playerName: "",
      playerIndex: -1,
      description: "Mustering complete",
    });
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
