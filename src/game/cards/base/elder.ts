import type { CardModule, GameState } from '../types.js';

export const elderCard: CardModule = {
  name: 'Elder',
  baseValue: 3,
  keywords: ['Immune to King\'s Hand'],
  abilities: [],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    // Elder: Immune to King's Hand, You may play this card on any Royalty
    logger?.log(`Player ${playerIdx + 1}: Elder - Immune to King's Hand, can be played on any Royalty`);
    // Note: The "may play on any Royalty" effect is a placement rule, not a triggered ability
    // This would be handled in the card placement/targeting system
  }
};
