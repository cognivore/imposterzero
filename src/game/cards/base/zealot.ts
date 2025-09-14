import type { CardModule, GameState } from '../types.js';

export const zealotCard: CardModule = {
  name: 'Zealot',
  baseValue: 3,
  keywords: ['Immune to King\'s Hand'],
  abilities: [],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    // Zealot: Immune to King's Hand, If your King is flipped, you may play this card on any non-Royalty card
    const player = state.players[playerIdx];

    if (player.kingFlipped) {
      logger?.log(`Player ${playerIdx + 1}: Zealot - King is flipped, can be played on any non-Royalty card`);
      // Note: The "may play on any non-Royalty" effect is a placement rule, not a triggered ability
      // This would be handled in the card placement/targeting system
    } else {
      logger?.log(`Player ${playerIdx + 1}: Zealot - Immune to King's Hand`);
    }
  }
};
