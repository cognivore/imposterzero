import type { CardInstance, CardKind } from "@imposter-zero/types";

export interface CardOps<C> {
  readonly value: (card: C) => number;
  readonly name: (card: C) => string;
}

export type CardName =
  | "Fool"
  | "Assassin"
  | "Elder"
  | "Zealot"
  | "Inquisitor"
  | "Soldier"
  | "Judge"
  | "Oathbound"
  | "Immortal"
  | "Warlord"
  | "Mystic"
  | "Warden"
  | "Sentry"
  | "King's Hand"
  | "Princess"
  | "Queen"
  | "Executioner"
  | "Bard"
  | "Herald"
  | "Spy"
  | "Arbiter"
  | "King";

export interface IKCardProps extends Record<string, unknown> {
  readonly value: number;
}

export type IKCardKind = CardKind<IKCardProps> & { readonly name: CardName };
export type IKCard = CardInstance<IKCardProps> & { readonly kind: IKCardKind };

export const ikCardOps: CardOps<IKCard> = {
  value: (card) => card.kind.props.value,
  name: (card) => card.kind.name,
};

export const KING_CARD_KIND: IKCardKind = {
  name: "King",
  props: { value: 0 },
};

const copies = (
  name: Exclude<CardName, "King">,
  value: number,
  count: number,
): ReadonlyArray<IKCardKind> =>
  Array.from({ length: count }, () => ({
    name,
    props: { value },
  }));

const baseDefinitions: ReadonlyArray<IKCardKind> = [
  ...copies("Fool", 1, 1),
  ...copies("Assassin", 2, 1),
  ...copies("Elder", 3, 2),
  ...copies("Zealot", 3, 1),
  ...copies("Inquisitor", 4, 2),
  ...copies("Soldier", 5, 2),
  ...copies("Judge", 5, 1),
  ...copies("Oathbound", 6, 2),
  ...copies("Immortal", 6, 1),
  ...copies("Warlord", 7, 1),
  ...copies("Mystic", 7, 1),
  ...copies("Warden", 7, 1),
  ...copies("Sentry", 8, 1),
  ...copies("King's Hand", 8, 1),
  ...copies("Princess", 9, 1),
  ...copies("Queen", 9, 1),
];

const threePlayerExtras: ReadonlyArray<IKCardKind> = [
  ...copies("Executioner", 4, 1),
  ...copies("Bard", 4, 2),
  ...copies("Herald", 6, 1),
  ...copies("Spy", 8, 1),
];

const fourPlayerExtras: ReadonlyArray<IKCardKind> = [
  ...copies("Fool", 1, 1),
  ...copies("Assassin", 2, 1),
  ...copies("Executioner", 4, 1),
  ...copies("Arbiter", 5, 1),
];

export const BASE_DECK: ReadonlyArray<IKCardKind> = baseDefinitions;
export const THREE_PLAYER_EXTRAS: ReadonlyArray<IKCardKind> = threePlayerExtras;
export const FOUR_PLAYER_EXTRAS: ReadonlyArray<IKCardKind> = fourPlayerExtras;

export const regulationDeck = (numPlayers: number): ReadonlyArray<IKCardKind> => {
  if (numPlayers < 2 || numPlayers > 4) {
    throw new RangeError(`Regulation deck supports 2-4 players, received ${numPlayers}`);
  }

  if (numPlayers === 2) {
    return [...BASE_DECK];
  }

  if (numPlayers === 3) {
    return [...BASE_DECK, ...THREE_PLAYER_EXTRAS];
  }

  return [...BASE_DECK, ...THREE_PLAYER_EXTRAS, ...FOUR_PLAYER_EXTRAS];
};
