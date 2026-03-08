import type { PlayerId } from "@imposter-zero/types";
import type { IKState, CardName } from "@imposter-zero/engine";

/**
 * Multiset operations for card name bags.
 * Uses Map<CardName, number> where count > 0.
 */
type CardBag = Map<CardName, number>;

const emptyBag = (): CardBag => new Map();

const addToBag = (bag: CardBag, name: CardName, count: number = 1): void => {
  bag.set(name, (bag.get(name) ?? 0) + count);
};

const subtractBags = (from: CardBag, what: CardBag): CardBag => {
  const result = new Map(from);
  for (const [name, count] of what) {
    const remaining = (result.get(name) ?? 0) - count;
    if (remaining <= 0) {
      result.delete(name);
    } else {
      result.set(name, remaining);
    }
  }
  return result;
};

/**
 * Builds the full deck composition as a multiset of card names
 * for a given player count. Mirrors regulationDeck(numPlayers)
 * but only tracks names and counts — no card kind objects needed.
 */
const deckComposition = (numPlayers: number): CardBag => {
  const bag = emptyBag();

  addToBag(bag, "Fool", 2);
  addToBag(bag, "Assassin", 2);
  addToBag(bag, "Elder", 3);
  addToBag(bag, "Zealot", 2);
  addToBag(bag, "Inquisitor", 2);
  addToBag(bag, "Soldier", 2);
  addToBag(bag, "Judge", 1);
  addToBag(bag, "Oathbound", 2);
  addToBag(bag, "Immortal", 1);
  addToBag(bag, "Warlord", 1);
  addToBag(bag, "Mystic", 1);
  addToBag(bag, "Warden", 1);
  addToBag(bag, "Sentry", 1);
  addToBag(bag, "King's Hand", 1);
  addToBag(bag, "Princess", 1);
  addToBag(bag, "Queen", 1);

  if (numPlayers >= 3) {
    addToBag(bag, "Executioner", 1);
    addToBag(bag, "Bard", 2);
    addToBag(bag, "Herald", 1);
    addToBag(bag, "Spy", 1);
  }

  if (numPlayers >= 4) {
    addToBag(bag, "Fool", 1);
    addToBag(bag, "Assassin", 1);
    addToBag(bag, "Executioner", 1);
    addToBag(bag, "Arbiter", 1);
  }

  return bag;
};

/**
 * Computes, for each opponent, the set of CardName values that
 * could theoretically be in their hand, based on publicly observable
 * information from the perspective of `myIndex`.
 *
 * Pure function. O(deck size) per call — well under 1ms for any game.
 */
export const computePossibleHand = (
  gameState: IKState,
  myIndex: PlayerId,
  numPlayers: number,
  disgracedCards: ReadonlyMap<number, CardName>,
  seenCards: ReadonlyMap<number, CardName>,
): Map<PlayerId, readonly CardName[]> => {
  const knownBag = emptyBag();

  const addCard = (name: CardName) => addToBag(knownBag, name);

  const myZones = gameState.players[myIndex];
  if (myZones) {
    for (const c of myZones.hand) addCard(c.kind.name);
    if (myZones.successor) addCard(myZones.successor.card.kind.name);
    if (myZones.dungeon) addCard(myZones.dungeon.card.kind.name);
  }

  for (const entry of gameState.shared.court) {
    if (entry.face === "up") {
      addCard(entry.card.kind.name);
    } else {
      const disgracedName = disgracedCards.get(entry.card.id);
      if (disgracedName) addCard(disgracedName);
    }
  }

  if (gameState.shared.accused) addCard(gameState.shared.accused.kind.name);

  for (const entry of gameState.shared.condemned) {
    if (entry.knownBy.includes(myIndex)) addCard(entry.card.kind.name);
  }


  for (const [, name] of seenCards) {
    addCard(name);
  }

  const fullDeck = deckComposition(numPlayers);
  const unknownPool = subtractBags(fullDeck, knownBag);

  const result = new Map<PlayerId, readonly CardName[]>();

  for (let i = 0; i < numPlayers; i++) {
    if (i === myIndex) continue;
    result.set(i as PlayerId, Array.from(unknownPool.keys()).sort());
  }

  return result;
};
