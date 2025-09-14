import type { CardModule, GameState, CardAbility } from '../types.js';

const wardenAbility: CardAbility = {
  name: 'Exchange with Accused',
  description: 'If there are four or more faceup cards in the Court, you may exchange any card from your hand with the Accused card.',

  canActivate(state: GameState, playerIdx: number): boolean {
    const player = state.players[playerIdx];
    return state.court.length >= 4 && player.hand.length > 0;
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];

    if (state.court.length >= 4) {
      if (player.hand.length > 0) {
        // Bot strategy: exchange a low-value hand card for the accused if accused is higher value
        const accusedValue = getCardBaseValue(state.accused);

        // Find lowest value card in hand
        let lowestIdx = 0;
        let lowestValue = getCardBaseValue(player.hand[0]);

        for (let i = 1; i < player.hand.length; i++) {
          const value = getCardBaseValue(player.hand[i]);
          if (value < lowestValue) {
            lowestValue = value;
            lowestIdx = i;
          }
        }

        if (accusedValue > lowestValue) {
          // Exchange lowest hand card with accused
          const handCard = player.hand[lowestIdx];
          player.hand[lowestIdx] = state.accused;
          state.accused = handCard;

          logger?.log(`Player ${playerIdx + 1}: Warden ability - exchanged ${handCard} from hand with accused ${player.hand[lowestIdx]}`);
        } else {
          logger?.log(`Player ${playerIdx + 1}: Warden ability - chose not to exchange (accused value ${accusedValue} not higher than lowest hand card ${lowestValue})`);
        }
      } else {
        logger?.log(`Player ${playerIdx + 1}: Warden ability - no cards in hand to exchange`);
      }
    } else {
      logger?.log(`Player ${playerIdx + 1}: Warden ability - only ${state.court.length} cards in court, need 4+`);
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

export const wardenCard: CardModule = {
  name: 'Warden',
  baseValue: 7,
  keywords: [],
  abilities: [wardenAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    wardenAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
