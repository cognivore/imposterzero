import type { CardModule, GameState, CardAbility } from '../types.js';

const lockshiftAbility: CardAbility = {
  name: 'Look at Dungeons and Release',
  description: 'You may look at all Dungeon cards. If you do, all players then put their Dungeon card in their hand.',

  canActivate(state: GameState, playerIdx: number): boolean {
    // Can activate if any player has a dungeon card
    return state.players.some(player => player.dungeon !== null);
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    // Look at all dungeon cards
    const dungeonCards: string[] = [];
    state.players.forEach((player, idx) => {
      if (player.dungeon) {
        dungeonCards.push(`Player ${idx + 1}: ${player.dungeon}`);
      }
    });

    if (dungeonCards.length > 0) {
      logger?.log(`Player ${playerIdx + 1}: Lockshift ability - looking at all dungeons: ${dungeonCards.join(', ')}`);

      // All players put their dungeon card in their hand
      state.players.forEach((player, idx) => {
        if (player.dungeon) {
          const dungeonCard = player.dungeon;
          player.hand.push(dungeonCard);
          player.dungeon = null;
          logger?.log(`Player ${idx + 1}: Moved dungeon ${dungeonCard} to hand`);
        }
      });
    } else {
      logger?.log(`Player ${playerIdx + 1}: Lockshift ability - no dungeon cards to look at`);
    }
  }
};

export const lockshiftCard: CardModule = {
  name: 'Lockshift',
  baseValue: 5,
  keywords: [],
  abilities: [lockshiftAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    lockshiftAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
