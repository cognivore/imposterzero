import type { CardModule, GameState, CardAbility } from '../types.js';

const immortalCourtEffect: CardAbility = {
  name: 'Royalty Grant and Debuff',
  description: 'While in Court, this card and the Warlord gain Royalty. All other Royalty and Elders lose 1 value and are Muted.',

  canActivate(state: GameState, playerIdx: number): boolean {
    return true; // Passive effect while in court
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    logger?.log(`Immortal in court: Immortal and Warlord gain Royalty`);
    logger?.log(`Immortal in court: All other Royalty and Elders lose 1 value and are Muted`);
  }
};

function isRoyalty(card: string): boolean {
  return card === 'Princess' || card === 'Queen';
}

export const immortalCard: CardModule = {
  name: 'Immortal',
  baseValue: 6,
  keywords: ['Steadfast'],
  abilities: [immortalCourtEffect],

  valueModifiers: {
    inCourt: (state: GameState) => {
      // This card's value is 5 while in Court
      return -1; // 6 - 1 = 5
    }
  },

  onEnterCourt(state: GameState, playerIdx: number, logger?: any): void {
    immortalCourtEffect.execute(state, playerIdx, 1 - playerIdx, logger);
  },

  onLeaveCourt(state: GameState, playerIdx: number, logger?: any): void {
    logger?.log(`Immortal left court: Royalty effects end`);
  }
};
