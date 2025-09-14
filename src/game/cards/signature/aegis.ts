import type { CardModule, GameState, CardAbility } from '../types.js';

const aegisAbility: CardAbility = {
  name: 'Play on Any Card and Disgrace',
  description: 'You may play this on any card then may Disgrace any card in Court.',

  canActivate(state: GameState, playerIdx: number): boolean {
    return state.court.length > 0; // Can play on any court card
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    // May disgrace any card in court
    if (state.court.length > 0) {
      // Bot strategy: disgrace highest value non-disgraced card
      const eligibleCards = state.court.filter(c => !c.disgraced);

      if (eligibleCards.length > 0) {
        const highestValueCard = eligibleCards.reduce((highest, card) => {
          return getCardBaseValue(card.card) > getCardBaseValue(highest.card) ? card : highest;
        });

        highestValueCard.disgraced = true;
        logger?.log(`Player ${playerIdx + 1}: Aegis ability - disgraced ${highestValueCard.card} in court`);
      } else {
        logger?.log(`Player ${playerIdx + 1}: Aegis ability - no eligible cards to disgrace`);
      }
    }
  }
};

// Helper function - this would come from the rules system
function getCardBaseValue(card: string): number {
  const values: Record<string, number> = {
    'Fool': 1, 'Assassin': 2, 'Elder': 3, 'Zealot': 3, 'Aegis': 3,
    'Inquisitor': 4, 'Executioner': 4, 'Soldier': 5, 'Judge': 5, 'Herald': 6, 'Oathbound': 6,
    'Warden': 7, 'Warlord': 7, 'Mystic': 7, 'Spy': 8, 'Sentry': 8,
    'KingsHand': 8, 'Princess': 9, 'Queen': 9, 'Oracle': 9
  };
  return values[card] || 0;
}

export const aegisCard: CardModule = {
  name: 'Aegis',
  baseValue: 3,
  keywords: ['Immune to King\'s Hand', 'Steadfast'],
  abilities: [aegisAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    aegisAbility.execute(state, playerIdx, opponentIdx, logger);
  },

  onKingFlip(state: GameState, playerIdx: number, logger?: any): void {
    // When your King is flipped, this card loses Steadfast
    logger?.log(`Player ${playerIdx + 1}: Aegis loses Steadfast when King is flipped`);
  }
};
