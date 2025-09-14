import type { CardModule, GameState, CardAbility } from '../types.js';

const oathboundAbility: CardAbility = {
  name: 'Disgrace Higher Value',
  description: 'Immune to King\'s Hand. You may play this on a higher value card to Disgrace that card, then you must play another card of any value. That card is Immune to King\'s Hand.',

  canActivate(state: GameState, playerIdx: number): boolean {
    // This is checked when targeting a higher value card
    return true;
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];
    const throneCard = state.court[state.court.length - 2]; // Previous card (before Oathbound)

    if (throneCard) {
      // Get the throne value
      const throneValue = getCardBaseValue(throneCard.card);
      const oathboundValue = getCardBaseValue('Oathbound');

      logger?.log(`Player ${playerIdx + 1}: Oathbound ability check - Oathbound value: ${oathboundValue}, throne value: ${throneValue} (${throneCard.card})`);

      if (oathboundValue < throneValue) {
        // Played on higher value card - trigger ability
        throneCard.disgraced = true;
        logger?.log(`Player ${playerIdx + 1}: Oathbound ability - disgraced ${throneCard.card} (higher value)`);

        // Must play another card of any value (immune to King's Hand)
        if (player.hand.length > 0) {
          // Bot: play lowest value card
          const lowestIdx = player.hand.reduce((lowestIdx, card, idx) => {
            return getCardBaseValue(card) < getCardBaseValue(player.hand[lowestIdx]) ? idx : lowestIdx;
          }, 0);

          const playedCard = player.hand.splice(lowestIdx, 1)[0];
          state.court.push({
            card: playedCard,
            playerIdx: playerIdx,
            disgraced: false
          });

          logger?.log(`Player ${playerIdx + 1}: Oathbound ability - must play another card: ${playedCard} (Immune to King's Hand)`);
        } else {
          logger?.log(`Player ${playerIdx + 1}: Oathbound ability - no cards in hand to play`);
        }
      } else {
        logger?.log(`Player ${playerIdx + 1}: Oathbound ability - not played on higher value card (${oathboundValue} not < ${throneValue})`);
      }
    }
  }
};

// Helper function - this would come from the rules system
function getCardBaseValue(card: string): number {
  const values: Record<string, number> = {
    'Fool': 1, 'Assassin': 2, 'Elder': 3, 'Zealot': 3, 'Inquisitor': 4,
    'Executioner': 4, 'Soldier': 5, 'Judge': 5, 'Herald': 6, 'Oathbound': 6,
    'Warden': 7, 'Warlord': 7, 'Mystic': 7, 'Spy': 8, 'Sentry': 8,
    'KingsHand': 8, 'Princess': 9, 'Queen': 9, 'Oracle': 9
  };
  return values[card] || 0;
}

export const oathboundCard: CardModule = {
  name: 'Oathbound',
  baseValue: 6,
  keywords: ['Immune to King\'s Hand'],
  abilities: [oathboundAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    oathboundAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
