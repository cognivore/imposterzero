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

export const deal = (
  kinds: ReadonlyArray<IKCardKind>,
  numPlayers: number,
  randomSource?: RandomSource,
): IKState => {
  if (numPlayers < 2 || numPlayers > 4) {
    throw new RangeError(`Imposter Kings supports 2-4 players, received ${numPlayers}`);
  }

  const deck = shuffle(createDeck(kinds), randomSource);
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
  }));

  return {
    players,
    shared: {
      court: [],
      accused,
      forgotten: forgottenCard === null ? null : hidden(forgottenCard),
    },
    activePlayer: 0,
    phase: "setup",
    numPlayers,
    turnCount: 0,
  };
};
