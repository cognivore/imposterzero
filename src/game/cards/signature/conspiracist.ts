import type { CardModule, GameState, CardAbility } from '../types.js';

const conspiracistAbility: CardAbility = {
  name: 'Grant Steadfast and +1 Value',
  description: 'Until the end of your next turn, all cards in your hand or Antechamber have Steadfast and +1 value. Cards played during this time keep this effect while they are in Court.',

  canActivate(state: GameState, playerIdx: number): boolean {
    return true; // Always available when played
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];

    // Activate Conspiracist effect (lasts until end of next turn = 2 turns)
    player.conspiracistEffect.active = true;
    player.conspiracistEffect.turnsRemaining = 2;
    player.conspiracistEffect.playedCards.clear();

    const handCount = player.hand.length;
    const antechamberCount = player.antechamber.length;

    logger?.log(`Player ${playerIdx + 1}: Conspiracist ability - giving +1 value and Steadfast to ${handCount} hand cards and ${antechamberCount} antechamber cards until end of next turn`);
  }
};

export const conspiracistCard: CardModule = {
  name: 'Conspiracist',
  baseValue: 6,
  keywords: ['Steadfast'],
  abilities: [conspiracistAbility],

  valueModifiers: {
    onThrone: (state: GameState) => {
      // This card loses 1 value while on the Throne
      return -1;
    }
  },

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    conspiracistAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
