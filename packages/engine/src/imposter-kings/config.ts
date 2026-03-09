import type { CardName, IKCardKind } from "./card.js";
import { regulationDeck, SIGNATURE_CARD_KINDS, BASE_ARMY_KINDS } from "./card.js";

export interface GameConfig {
  readonly deck: ReadonlyArray<IKCardKind>;
  readonly baseArmy: ReadonlyArray<IKCardKind>;
  readonly signaturePool: ReadonlyArray<IKCardKind>;
  readonly signaturesPerPlayer: number;
  readonly useMustering: boolean;
  readonly useMulligans: boolean;
}

export const SIGNATURE_CARD_NAMES: ReadonlyArray<CardName> = [
  "Flagbearer",
  "Stranger",
  "Aegis",
  "Nakturn",
  "Ancestor",
  "Informant",
  "Lockshift",
  "Conspiracist",
  "Exile",
];

export const BASE_ARMY_NAMES: ReadonlyArray<CardName> = [
  "Elder",
  "Inquisitor",
  "Soldier",
  "Judge",
  "Oathbound",
];

export const REGULATION_2P_BASE: GameConfig = {
  deck: regulationDeck(2),
  baseArmy: [],
  signaturePool: [],
  signaturesPerPlayer: 0,
  useMustering: false,
  useMulligans: true,
};

export const REGULATION_2P_EXPANSION: GameConfig = {
  deck: regulationDeck(2),
  baseArmy: BASE_ARMY_KINDS,
  signaturePool: SIGNATURE_CARD_KINDS,
  signaturesPerPlayer: 3,
  useMustering: true,
  useMulligans: false,
};

export const expansionConfigForPlayers = (numPlayers: number): GameConfig => ({
  ...REGULATION_2P_EXPANSION,
  deck: regulationDeck(numPlayers),
});
