import type { CardModule, GameState, CardAbility } from '../types.js';

const exileAbility: CardAbility = {
  name: 'Mute All Cards',
  description: 'When played, all cards are Muted until the start of your next turn.',

  canActivate(state: GameState, playerIdx: number): boolean {
    return true; // Always triggers when played
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    logger?.log(`Player ${playerIdx + 1}: Exile ability - all cards are Muted until start of next turn`);
    // This would need to be tracked in the game state
  }
};

export const exileCard: CardModule = {
  name: 'Exile',
  baseValue: 8,
  keywords: ['Steadfast'],
  abilities: [exileAbility],

  valueModifiers: {
    onThrone: (state: GameState) => {
      // This card loses 1 value on the Throne for each card in Court with a base value 7 or higher
      const highValueCards = state.court.filter(card => getCardBaseValue(card.card) >= 7);
      const penalty = highValueCards.length;
      return -penalty;
    }
  },

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    exileAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};

// Helper function - this would come from the rules system
function getCardBaseValue(card: string): number {
  const values: Record<string, number> = {
    'Fool': 1, 'Assassin': 2, 'Elder': 3, 'Zealot': 3, 'Aegis': 3,
    'Inquisitor': 4, 'Ancestor': 4, 'Executioner': 4, 'Bard': 4, 'Soldier': 5, 'Judge': 5, 'Herald': 6, 'Oathbound': 6,
    'Warden': 7, 'Warlord': 7, 'Mystic': 7, 'Spy': 8, 'Sentry': 8, 'Exile': 8,
    'KingsHand': 8, 'Princess': 9, 'Queen': 9, 'Oracle': 9
  };
  return values[card] || 0;
}
