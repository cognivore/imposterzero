import type { PlayerId } from "@imposter-zero/types";

import type { IKSharedZones, IKPlayerZones, CourtEntry } from "./zones.js";
import type { ChoiceOption, ModifierSpec } from "./effects/program.js";

export type IKPhase = "crown" | "setup" | "play" | "resolving" | "end_of_turn";

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
  readonly khPrevented?: boolean;
  readonly publiclyTrackedKH: ReadonlyArray<number>;
}

export const throne = (state: IKState): CourtEntry | null =>
  state.shared.court.length === 0 ? null : state.shared.court[state.shared.court.length - 1]!;

export const playerZones = (state: IKState, player: PlayerId): IKPlayerZones =>
  state.players[player]!;

export const playerHand = (state: IKState, player: PlayerId): ReadonlyArray<IKPlayerZones["hand"][number]> =>
  playerZones(state, player).hand;

export const nextPlayer = (state: IKState, from: PlayerId = state.activePlayer): PlayerId =>
  ((from + 1) % state.numPlayers) as PlayerId;
