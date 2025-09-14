import type { CardModule, GameState, CardAbility } from '../types.js';

const executionerAbility: CardAbility = {
  name: 'Say Number to Condemn',
  description: 'You may say any number equal or less than the highest base value card in Court. All players must Condemn a card in their hand with that base value.',

  canActivate(state: GameState, playerIdx: number): boolean {
    // Find highest base value card in Court
    let highestValue = 0;
    state.court.forEach(courtCard => {
      const cardValue = getCardBaseValue(courtCard.card);
      if (cardValue > highestValue) {
        highestValue = cardValue;
      }
    });
    return highestValue > 0;
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    // Find highest base value card in Court
    let highestValue = 0;
    state.court.forEach(courtCard => {
      const cardValue = getCardBaseValue(courtCard.card);
      if (cardValue > highestValue) {
        highestValue = cardValue;
      }
    });

    // Bot strategy: choose a number that's likely to hit opponents
    const chosenNumber = Math.min(highestValue, 5); // Target common mid-value cards

    logger?.log(`Player ${playerIdx + 1}: Executioner ability - chose number ${chosenNumber} (highest court value: ${highestValue})`);

    // All players must condemn a card with that base value
    [state.players[playerIdx], state.players[opponentIdx]].forEach((player, idx) => {
      const matchingCards = player.hand.filter(card => getCardBaseValue(card) === chosenNumber);
      if (matchingCards.length > 0) {
        const condemnedCard = matchingCards[0];
        const handIdx = player.hand.indexOf(condemnedCard);
        player.hand.splice(handIdx, 1);
        player.condemned.push(condemnedCard);
        logger?.log(`Player ${idx + 1}: Condemned ${condemnedCard} (value ${chosenNumber}) due to Executioner`);
      } else {
        logger?.log(`Player ${idx + 1}: No cards with value ${chosenNumber} to condemn`);
      }
    });
  }
};

// Helper function - this would come from the rules system
function getCardBaseValue(card: string): number {
  const values: Record<string, number> = {
    'Fool': 1, 'Assassin': 2, 'Elder': 3, 'Zealot': 3, 'Aegis': 3,
    'Inquisitor': 4, 'Ancestor': 4, 'Executioner': 4, 'Bard': 4, 'Nakturn': 4,
    'Soldier': 5, 'Judge': 5, 'Lockshift': 5, 'Arbiter': 5, 'Oracle': 5, 'Herald': 6, 'Oathbound': 6, 'Immortal': 6,
    'Warden': 7, 'Warlord': 7, 'Mystic': 7, 'Spy': 8, 'Sentry': 8, 'Exile': 8,
    'KingsHand': 8, 'Princess': 9, 'Queen': 9
  };
  return values[card] || 0;
}

export const executionerCard: CardModule = {
  name: 'Executioner',
  baseValue: 4,
  keywords: [],
  abilities: [executionerAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    executionerAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
