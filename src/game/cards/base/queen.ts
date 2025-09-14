import type { CardModule, GameState, CardAbility } from '../types.js';

const queenAbility: CardAbility = {
  name: 'Disgrace All',
  description: 'You must Disgrace all other cards in the Court.',

  canActivate(state: GameState, playerIdx: number): boolean {
    return true; // Always mandatory when played
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    let disgracedCount = 0;

    state.court.forEach(courtCard => {
      if (courtCard.card !== 'Queen' && !courtCard.disgraced) {
        courtCard.disgraced = true;
        disgracedCount++;
        logger?.log(`Player ${playerIdx + 1}: Queen ability - disgraced ${courtCard.card}`);
      }
    });

    logger?.log(`Player ${playerIdx + 1}: Queen ability - disgraced ${disgracedCount} cards (mandatory, unstoppable)`);
  }
};

export const queenCard: CardModule = {
  name: 'Queen',
  baseValue: 9,
  keywords: ['Royalty'],
  abilities: [queenAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    queenAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
