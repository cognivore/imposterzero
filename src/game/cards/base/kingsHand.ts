import type { CardModule, GameState, CardAbility } from '../types.js';

const kingsHandReactionAbility: CardAbility = {
  name: 'Prevent Ability',
  description: '**Reaction:** When another player chooses to use a card\'s ability, play this card immediately after they choose their target to prevent that ability. Condemn both this and the played card.',

  canActivate(state: GameState, playerIdx: number): boolean {
    // This checks if the player actually has King's Hand in their hand
    const player = state.players[playerIdx];
    return player.hand.includes('KingsHand');
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];

    // Remove King's Hand from player's hand
    const kingsHandIdx = player.hand.indexOf('KingsHand');
    if (kingsHandIdx >= 0) {
      const kingsHand = player.hand.splice(kingsHandIdx, 1)[0];
      state.condemned.push(kingsHand);
      logger?.log(`Player ${playerIdx + 1}: King's Hand - preventing ability and condemning King's Hand`);

      // The target card would also be condemned (handled by calling code)
      logger?.log(`Player ${playerIdx + 1}: King's Hand reaction - both cards condemned`);
    } else {
      logger?.log(`Player ${playerIdx + 1}: Tried to use King's Hand but doesn't have it in hand`);
    }
  }
};

export const kingsHandCard: CardModule = {
  name: 'KingsHand',
  baseValue: 8,
  keywords: ['Immune to King\'s Hand'],
  abilities: [kingsHandReactionAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    // King's Hand doesn't have a normal play ability - it's purely reactive
    logger?.log(`Player ${playerIdx + 1}: King's Hand - Immune to King's Hand, reaction ability available to prevent other abilities`);
  }
};
