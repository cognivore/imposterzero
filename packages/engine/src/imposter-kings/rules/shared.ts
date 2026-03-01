import type { PlayerId } from "@imposter-zero/types";

import type { IKPlayerZones } from "../zones.js";

export const replacePlayerZones = (
  players: ReadonlyArray<IKPlayerZones>,
  player: PlayerId,
  nextZones: IKPlayerZones,
): ReadonlyArray<IKPlayerZones> =>
  players.map((zones, idx) => (idx === player ? nextZones : zones));
