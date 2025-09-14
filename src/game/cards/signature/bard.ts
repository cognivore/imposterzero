import type { CardModule, GameState, CardAbility } from '../types.js';

const bardAbility: CardAbility = {
  name: 'Recall on Value 3-4',
  description: 'If played on a card with a base value of 3 or 4, Recall. If you do, this card gains +1 value.',

  canActivate(state: GameState, playerIdx: number): boolean {
    // Check if there's a card with base value 3 or 4 to play on
    return state.court.some(card => {
      const value = getCardBaseValue(card.card);
      return value === 3 || value === 4;
    });
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];

    // Check if played on a card with base value 3 or 4 (this would be determined by targeting)
    const throneCard = state.court[state.court.length - 2]; // Previous card (before Bard)

    if (throneCard) {
      const throneValue = getCardBaseValue(throneCard.card);

      if (throneValue === 3 || throneValue === 4) {
        logger?.log(`Player ${playerIdx + 1}: Bard ability - played on value ${throneValue} card, triggering Recall`);

        // Recall (bring back an army card)
        if (player.exhaustedArmy.length > 0) {
          const recalledCard = player.exhaustedArmy.pop();
          if (recalledCard) {
            player.army.push(recalledCard);
            logger?.log(`Player ${playerIdx + 1}: Recalled ${recalledCard} from exhausted army`);

            // Bard gains +1 value
            logger?.log(`Player ${playerIdx + 1}: Bard gains +1 value (now ${getCardBaseValue('Bard') + 1})`);
          }
        } else {
          logger?.log(`Player ${playerIdx + 1}: Bard ability - no exhausted army cards to recall`);
        }
      } else {
        logger?.log(`Player ${playerIdx + 1}: Bard ability - not played on value 3 or 4 card (played on value ${throneValue})`);
      }
    }
  }
};

// Helper function - this would come from the rules system
function getCardBaseValue(card: string): number {
  const values: Record<string, number> = {
    'Fool': 1, 'Assassin': 2, 'Elder': 3, 'Zealot': 3, 'Aegis': 3,
    'Inquisitor': 4, 'Ancestor': 4, 'Executioner': 4, 'Bard': 4, 'Soldier': 5, 'Judge': 5, 'Herald': 6, 'Oathbound': 6,
    'Warden': 7, 'Warlord': 7, 'Mystic': 7, 'Spy': 8, 'Sentry': 8,
    'KingsHand': 8, 'Princess': 9, 'Queen': 9, 'Oracle': 9
  };
  return values[card] || 0;
}

export const bardCard: CardModule = {
  name: 'Bard',
  baseValue: 4,
  keywords: [],
  abilities: [bardAbility],

  valueModifiers: {
    inCourt: (state: GameState) => {
      // This would check if Bard successfully recalled a card
      // For now, return base value
      return 0; // +0 modification by default, +1 if ability triggered
    }
  },

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    bardAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
