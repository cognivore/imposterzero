import type { PlayerId } from "@imposter-zero/types";

import { throne, playerZones, type IKState } from "./state.js";

export const throneValue = (state: IKState): number => {
  const top = throne(state);
  if (top === null) return 0;
  return top.face === "down" ? 1 : top.card.kind.props.value;
};

export const isKingFaceUp = (state: IKState, player: PlayerId): boolean =>
  playerZones(state, player).king.face === "up";

export const hasCommittedSetup = (state: IKState, player: PlayerId): boolean => {
  const zones = playerZones(state, player);
  return zones.successor !== null && zones.dungeon !== null;
};

export const allPlayersCommittedSetup = (state: IKState): boolean =>
  state.players.every((_, player) => hasCommittedSetup(state, player));
