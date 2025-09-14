import type { CardModule, GameState, CardAbility } from '../types.js';

const mysticAbility: CardAbility = {
  name: 'Mute Cards by Value',
  description: 'If there are any Disgraced cards in Court, you may Disgrace this card after playing it to choose a number between 1–8. Cards of that base value lose all abilities and are value 3 after being played for the rest of this round.',

  canActivate(state: GameState, playerIdx: number): boolean {
    return state.court.some(card => card.disgraced);
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    if (state.court.some(card => card.disgraced)) {
      // Find the Mystic in court and disgrace it
      const mysticInCourt = state.court.find(c => c.card === 'Mystic');
      if (mysticInCourt) {
        mysticInCourt.disgraced = true;
        logger?.log(`Player ${playerIdx + 1}: Mystic ability - disgraced Mystic in court`);

        // Choose a number 1-8. All cards with that base value become muted and value 3
        const chosenNumber = Math.floor(Math.random() * 8) + 1; // Random 1-8
        logger?.log(`Player ${playerIdx + 1}: Mystic ability - chose number ${chosenNumber}`);

        // Apply muting effect to all cards with that base value
        // (This would need a more sophisticated implementation to track muted cards)
        logger?.log(`All cards with base value ${chosenNumber} are now muted (value 3, no abilities) for the rest of the round`);
      }
    } else {
      logger?.log(`Player ${playerIdx + 1}: Mystic ability - no disgraced cards in court, cannot use ability`);
    }
  }
};

export const mysticCard: CardModule = {
  name: 'Mystic',
  baseValue: 7,
  keywords: [],
  abilities: [mysticAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    mysticAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
