import type { PlayerId } from "@imposter-zero/types";

import type { IKCard } from "./card.js";

export type FaceState = "up" | "down";

export interface HiddenCard {
  readonly card: IKCard;
  readonly face: "down";
}

export interface CourtEntry {
  readonly card: IKCard;
  readonly face: FaceState;
  readonly playedBy: PlayerId;
  readonly copiedName?: import("./card.js").CardName;
}

export interface KingZone {
  readonly card: IKCard;
  readonly face: FaceState;
}

export interface IKPlayerZones {
  readonly hand: ReadonlyArray<IKCard>;
  readonly king: KingZone;
  readonly successor: HiddenCard | null;
  readonly dungeon: HiddenCard | null;
  readonly antechamber: ReadonlyArray<IKCard>;
  readonly parting: ReadonlyArray<IKCard>;
  readonly army: ReadonlyArray<IKCard>;
  readonly exhausted: ReadonlyArray<IKCard>;
  readonly recruitDiscard: ReadonlyArray<IKCard>;
}

export interface CondemnedEntry {
  readonly card: IKCard;
  readonly face: "down";
  readonly knownBy: ReadonlyArray<import("@imposter-zero/types").PlayerId>;
}

export interface IKSharedZones {
  readonly court: ReadonlyArray<CourtEntry>;
  readonly accused: IKCard | null;
  readonly forgotten: HiddenCard | null;
  readonly condemned: ReadonlyArray<CondemnedEntry>;
}
