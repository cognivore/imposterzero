import type { PlayerId } from "@imposter-zero/types";

import type { IKSharedZones, IKPlayerZones, CourtEntry } from "./zones.js";
import type { ChoiceOption, ModifierSpec } from "./effects/program.js";

export type IKPhase = "crown" | "mustering" | "setup" | "play" | "resolving" | "end_of_turn";

export type PendingEffectSource =
  | { readonly kind: "cardPlay"; readonly cardId: number }
  | { readonly kind: "disgrace"; readonly throneCardId: number }
  | { readonly kind: "antechamberPlay"; readonly cardId: number };

export interface PendingResolution {
  readonly source: PendingEffectSource;
  readonly effectPlayer: PlayerId;
  readonly choicesMade: ReadonlyArray<number>;
  readonly currentOptions: ReadonlyArray<ChoiceOption>;
  readonly choosingPlayer: PlayerId;
  readonly stateBeforeEffect: IKState;
  readonly isReactionWindow: boolean;
}

export interface ActiveModifier {
  readonly sourceCardId: number;
  readonly spec: ModifierSpec;
  readonly playedBy?: PlayerId;
  readonly sticky?: boolean;
}

export interface IKState {
  readonly players: ReadonlyArray<IKPlayerZones>;
  readonly shared: IKSharedZones;
  readonly activePlayer: PlayerId;
  readonly phase: IKPhase;
  readonly numPlayers: number;
  readonly turnCount: number;
  readonly firstPlayer: PlayerId;
  readonly pendingResolution: PendingResolution | null;
  readonly forcedLoser: PlayerId | null;
  readonly modifiers: ReadonlyArray<ActiveModifier>;
  readonly roundModifiers: ReadonlyArray<ActiveModifier>;
  readonly crystallizedModifiers: ReadonlyArray<ActiveModifier>;
  readonly khPrevented?: boolean;
  readonly publiclyTrackedKH: ReadonlyArray<number>;
  readonly armyRecruitedIds: ReadonlyArray<number>;
  readonly hasExhaustedThisMustering: boolean;
  readonly musteringPlayersDone: number;
  readonly eliminatedPlayers: ReadonlyArray<PlayerId>;
}

export const throne = (state: IKState): CourtEntry | null =>
  state.shared.court.length === 0 ? null : state.shared.court[state.shared.court.length - 1]!;

export const playerZones = (state: IKState, player: PlayerId): IKPlayerZones =>
  state.players[player]!;

export const playerHand = (state: IKState, player: PlayerId): ReadonlyArray<IKPlayerZones["hand"][number]> =>
  playerZones(state, player).hand;

export interface RevealedPlayerZones {
  readonly hand: ReadonlyArray<import("./card.js").IKCard>;
  readonly king: { readonly card: import("./card.js").IKCard; readonly face: "up" };
  readonly successor: { readonly card: import("./card.js").IKCard; readonly face: "up" } | null;
  readonly dungeon: { readonly card: import("./card.js").IKCard; readonly face: "up" } | null;
}

export interface RevealedState {
  readonly players: ReadonlyArray<RevealedPlayerZones>;
  readonly shared: IKSharedZones;
}

export const revealedState = (state: IKState): RevealedState => ({
  players: state.players.map((p) => ({
    hand: p.hand,
    king: { card: p.king.card, face: "up" as const },
    successor: p.successor ? { card: p.successor.card, face: "up" as const } : null,
    dungeon: p.dungeon ? { card: p.dungeon.card, face: "up" as const } : null,
  })),
  shared: state.shared,
});

export const nextPlayer = (state: IKState, from: PlayerId = state.activePlayer): PlayerId => {
  let next = ((from + 1) % state.numPlayers) as PlayerId;
  for (let i = 0; i < state.numPlayers; i++) {
    if (!state.eliminatedPlayers.includes(next)) return next;
    next = ((next + 1) % state.numPlayers) as PlayerId;
  }
  return next;
};
