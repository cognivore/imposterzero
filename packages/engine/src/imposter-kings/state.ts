import type { PlayerId } from "@imposter-zero/types";

import type { IKSharedZones, IKPlayerZones, CourtEntry } from "./zones.js";

export type IKPhase = "crown" | "setup" | "play";

export interface IKState {
  readonly players: ReadonlyArray<IKPlayerZones>;
  readonly shared: IKSharedZones;
  readonly activePlayer: PlayerId;
  readonly phase: IKPhase;
  readonly numPlayers: number;
  readonly turnCount: number;
  readonly firstPlayer: PlayerId;
}

export const throne = (state: IKState): CourtEntry | null =>
  state.shared.court.length === 0 ? null : state.shared.court[state.shared.court.length - 1]!;

export const playerZones = (state: IKState, player: PlayerId): IKPlayerZones =>
  state.players[player]!;

export const playerHand = (state: IKState, player: PlayerId): ReadonlyArray<IKPlayerZones["hand"][number]> =>
  playerZones(state, player).hand;

export const nextPlayer = (state: IKState, from: PlayerId = state.activePlayer): PlayerId =>
  ((from + 1) % state.numPlayers) as PlayerId;
