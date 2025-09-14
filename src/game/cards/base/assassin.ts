import type { CardModule, GameState, CardAbility } from '../types.js';

const assassinReactionAbility: CardAbility = {
  name: 'Prevent King Flip',
  description: '**Reaction:** If another player flips their King, you may reveal this card from your hand to prevent their King\'s power and cause them to lose this round.',

  canActivate(state: GameState, playerIdx: number): boolean {
    // This would be checked when opponent tries to flip king
    const player = state.players[playerIdx];
    return player.hand.includes('Assassin');
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    // This is handled in the king flip logic
    logger?.log(`Player ${playerIdx + 1}: Assassin reaction - preventing King flip`);
  }
};

export const assassinCard: CardModule = {
  name: 'Assassin',
  baseValue: 2,
  keywords: [],
  abilities: [assassinReactionAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    // Assassin: When played normally (not as reaction), no special effect
    // The reaction ability is handled in flipKing method
    logger?.log(`Player ${playerIdx + 1}: Assassin played (reaction ability available for king flips)`);
  }
};
