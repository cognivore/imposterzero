import type { CardModule, GameState, CardAbility, CardName } from '../types.js';

const inquisitorAbility: CardAbility = {
  name: 'Say Card Name',
  description: 'You may say a card name. Other players with that card in their hand must play one to their Antechamber.',

  canActivate(state: GameState, playerIdx: number): boolean {
    return true; // Can always attempt to name a card
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];
    const opponent = state.players[opponentIdx];

    // Build list of cards the current player can see
    const visibleCards = new Set<string>();

    // Cards visible to current player:
    visibleCards.add(state.accused); // Accused card
    state.court.forEach(c => visibleCards.add(c.card)); // Court cards
    player.hand.forEach(c => visibleCards.add(c)); // Own hand
    player.antechamber.forEach(c => visibleCards.add(c)); // Own antechamber
    if (player.successor) visibleCards.add(player.successor); // Own successor if revealed
    if (player.dungeon) visibleCards.add(player.dungeon); // Own dungeon

    // Bot strategy: guess a high-value card they haven't seen
    const allCards = [
      'Queen', 'Princess', 'KingsHand', 'Spy', 'Sentry', 'Warden', 'Warlord', 'Mystic',
      'Herald', 'Oathbound', 'Soldier', 'Judge', 'Inquisitor', 'Executioner', 'Elder', 'Zealot', 'Assassin', 'Fool'
    ];
    const unseenCards = allCards.filter(card => !visibleCards.has(card));

    // Prefer guessing high-value cards
    const sortedUnseenCards = unseenCards.sort((a, b) => getCardBaseValue(b) - getCardBaseValue(a));

    if (sortedUnseenCards.length > 0) {
      const guessedCard = sortedUnseenCards[0]; // Guess highest value unseen card
      logger?.log(`Player ${playerIdx + 1}: Inquisitor ability - guessing ${guessedCard} (value ${getCardBaseValue(guessedCard)})`);
      logger?.log(`Player ${playerIdx + 1}: Visible cards: ${Array.from(visibleCards).join(', ')}`);

      // Check if opponent has the guessed card in hand
      const opponentHasCard = opponent.hand.includes(guessedCard as CardName);

      if (opponentHasCard) {
        // Move card from opponent's hand to their antechamber
        const cardIdx = opponent.hand.indexOf(guessedCard as CardName);
        const movedCard = opponent.hand.splice(cardIdx, 1)[0];
        opponent.antechamber.push(movedCard);

        logger?.log(`🎯 HIT! Player ${opponentIdx + 1}: Has ${guessedCard}! Moved to antechamber (must play next turn)`);
      } else {
        logger?.log(`❌ MISS! Player ${opponentIdx + 1}: Does not have ${guessedCard}`);
      }
    } else {
      logger?.log(`Player ${playerIdx + 1}: Inquisitor ability - no unseen cards to guess`);
    }
  }
};

// Helper function - this would come from the rules system
function getCardBaseValue(card: string): number {
  const values: Record<string, number> = {
    'Fool': 1, 'Assassin': 2, 'Elder': 3, 'Zealot': 3, 'Inquisitor': 4,
    'Executioner': 4, 'Soldier': 5, 'Judge': 5, 'Herald': 6, 'Oathbound': 6,
    'Warden': 7, 'Warlord': 7, 'Mystic': 7, 'Spy': 8, 'Sentry': 8,
    'KingsHand': 8, 'Princess': 9, 'Queen': 9, 'Oracle': 9
  };
  return values[card] || 0;
}

export const inquisitorCard: CardModule = {
  name: 'Inquisitor',
  baseValue: 4,
  keywords: [],
  abilities: [inquisitorAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    inquisitorAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
