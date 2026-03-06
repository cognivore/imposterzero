import type { PlayerId } from "@imposter-zero/types";

import { KING_CARD_KIND, type IKCard, type IKCardKind } from "./card.js";
import type { IKState } from "./state.js";
import type { HiddenCard, IKPlayerZones } from "./zones.js";

export type RandomSource = () => number;

const hidden = (card: IKCard): HiddenCard => ({ card, face: "down" });

const reserveCount = (numPlayers: number): number => (numPlayers === 4 ? 1 : 2);

export const createDeck = (kinds: ReadonlyArray<IKCardKind>): ReadonlyArray<IKCard> =>
  kinds.map((kind, id) => ({ id, kind }));

export const shuffle = <T>(
  items: ReadonlyArray<T>,
  randomSource: RandomSource = Math.random,
): ReadonlyArray<T> => {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomSource() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
};

const createKingCard = (baseId: number, player: PlayerId): IKCard => ({
  id: baseId + player,
  kind: KING_CARD_KIND,
});

const dealHands = (
  deck: ReadonlyArray<IKCard>,
  numPlayers: number,
): ReadonlyArray<ReadonlyArray<IKCard>> => {
  const hands = Array.from({ length: numPlayers }, () => [] as IKCard[]);
  deck.forEach((card, index) => {
    hands[index % numPlayers]!.push(card);
  });
  return hands;
};

/**
 * Deal from a pre-ordered deck (no shuffle). Cards are dealt round-robin
 * from index 0, so deck[0] goes to player 0, deck[1] to player 1, etc.
 * Last 1-2 cards become accused/forgotten per the normal reserve policy.
 */
export const dealWithDeck = (
  orderedDeck: ReadonlyArray<IKCard>,
  numPlayers: number,
  trueKing: PlayerId = 0,
): IKState => {
  if (numPlayers < 2 || numPlayers > 4) {
    throw new RangeError(`Imposter Kings supports 2-4 players, received ${numPlayers}`);
  }
  const reserved = reserveCount(numPlayers);
  if (orderedDeck.length <= reserved) {
    throw new Error("Deck does not contain enough cards for shared zones and player hands");
  }

  const accused =
    numPlayers === 4 ? orderedDeck[orderedDeck.length - 1]! : orderedDeck[orderedDeck.length - 2]!;
  const forgottenCard = numPlayers === 4 ? null : orderedDeck[orderedDeck.length - 1]!;
  const playableDeck = orderedDeck.slice(0, orderedDeck.length - reserved);
  const hands = dealHands(playableDeck, numPlayers);

  if (hands.some((hand) => hand.length < 2)) {
    throw new Error("Each player must be dealt at least two cards for setup commitments");
  }

  const kingIdBase = orderedDeck.length;
  const players: ReadonlyArray<IKPlayerZones> = hands.map((hand, player) => ({
    hand,
    king: { card: createKingCard(kingIdBase, player), face: "up" },
    successor: null,
    dungeon: null,
    antechamber: [],
    parting: [],
  }));

  return {
    players,
    shared: {
      court: [],
      accused,
      forgotten: forgottenCard === null ? null : hidden(forgottenCard),
      army: [],
      condemned: [],
    },
    activePlayer: trueKing,
    phase: "crown",
    numPlayers,
    turnCount: 0,
    firstPlayer: trueKing,
    pendingResolution: null,
    forcedLoser: null,
    modifiers: [],
    roundModifiers: [],
    publiclyTrackedKH: [],
  };
};

export const deal = (
  kinds: ReadonlyArray<IKCardKind>,
  numPlayers: number,
  randomSource?: RandomSource,
  trueKing?: PlayerId,
): IKState => {
  if (numPlayers < 2 || numPlayers > 4) {
    throw new RangeError(`Imposter Kings supports 2-4 players, received ${numPlayers}`);
  }

  const rng = randomSource ?? Math.random;
  const tk: PlayerId = trueKing ?? (Math.floor(rng() * numPlayers) as PlayerId);

  const deck = shuffle(createDeck(kinds), rng);
  const reserved = reserveCount(numPlayers);
  if (deck.length <= reserved) {
    throw new Error("Deck does not contain enough cards for shared zones and player hands");
  }

  const accused =
    numPlayers === 4 ? deck[deck.length - 1]! : deck[deck.length - 2]!;
  const forgottenCard = numPlayers === 4 ? null : deck[deck.length - 1]!;
  const playableDeck = deck.slice(0, deck.length - reserved);
  const hands = dealHands(playableDeck, numPlayers);

  if (hands.some((hand) => hand.length < 2)) {
    throw new Error("Each player must be dealt at least two cards for setup commitments");
  }

  const kingIdBase = deck.length;
  const players: ReadonlyArray<IKPlayerZones> = hands.map((hand, player) => ({
    hand,
    king: {
      card: createKingCard(kingIdBase, player),
      face: "up",
    },
    successor: null,
    dungeon: null,
    antechamber: [],
    parting: [],
  }));

  return {
    players,
    shared: {
      court: [],
      accused,
      forgotten: forgottenCard === null ? null : hidden(forgottenCard),
      army: [],
      condemned: [],
    },
    activePlayer: tk,
    phase: "crown",
    numPlayers,
    turnCount: 0,
    firstPlayer: tk,
    pendingResolution: null,
    forcedLoser: null,
    modifiers: [],
    roundModifiers: [],
    publiclyTrackedKH: [],
  };
};
