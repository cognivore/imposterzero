import type { CardModule, GameState, CardAbility } from '../types.js';

const foolAbility: CardAbility = {
  name: 'Choose Court Card',
  description: 'You may choose any other card from the Court that is not Disgraced, then put the chosen card into your hand.',

  canActivate(state: GameState, playerIdx: number): boolean {
    const availableCards = state.court.filter(c => !c.disgraced && c.card !== 'Fool');
    return availableCards.length > 0;
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];
    const availableCards = state.court.filter(c => !c.disgraced);

    if (availableCards.length > 1) { // Must be other cards (not just the Fool itself)
      // Bot strategy: take highest value card
      const sortedCards = availableCards
        .filter(c => c.card !== 'Fool') // Can't take itself
        .sort((a, b) => getCardBaseValue(b.card) - getCardBaseValue(a.card));

      if (sortedCards.length > 0) {
        const chosenCard = sortedCards[0];
        const courtIdx = state.court.indexOf(chosenCard);

        // Remove from court and add to hand
        state.court.splice(courtIdx, 1);
        player.hand.push(chosenCard.card);

        logger?.log(`Player ${playerIdx + 1}: Fool ability - took ${chosenCard.card} from court to hand`);
      }
    } else {
      logger?.log(`Player ${playerIdx + 1}: Fool ability - no other cards in court to take`);
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

export const foolCard: CardModule = {
  name: 'Fool',
  baseValue: 1,
  keywords: [],
  abilities: [foolAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    foolAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
