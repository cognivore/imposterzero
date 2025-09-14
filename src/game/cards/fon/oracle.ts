import type { CardModule, GameState, CardAbility } from '../types.js';

const oracleAbility: CardAbility = {
  name: 'Reveal and Force to Antechamber',
  description: 'You may make all opponents reveal two cards from their hand simultaneously (reveal one if they only have one). For each opponent, you may put one of their revealed cards in their Antechamber.',

  canActivate(state: GameState, playerIdx: number): boolean {
    const opponent = state.players[1 - playerIdx];
    return opponent.hand.length > 0;
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const opponent = state.players[opponentIdx];

    if (opponent.hand.length > 0) {
      const cardsToReveal = Math.min(2, opponent.hand.length);
      const revealedCards = opponent.hand.slice(0, cardsToReveal);

      logger?.log(`Player ${playerIdx + 1}: Oracle ability - opponent reveals ${revealedCards.join(', ')}`);

      // May put one revealed card in opponent's antechamber
      if (revealedCards.length > 0) {
        // Bot: put the highest value revealed card in antechamber
        const highestValueCard = revealedCards.reduce((highest, card) =>
          getCardBaseValue(card) > getCardBaseValue(highest) ? card : highest
        );

        const handIdx = opponent.hand.indexOf(highestValueCard);
        const movedCard = opponent.hand.splice(handIdx, 1)[0];
        opponent.antechamber.push(movedCard);

        logger?.log(`Player ${playerIdx + 1}: Oracle ability - put opponent's ${movedCard} in their antechamber`);
      }
    } else {
      logger?.log(`Player ${playerIdx + 1}: Oracle ability - opponent has no cards to reveal`);
    }
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

export const oracleCard: CardModule = {
  name: 'Oracle',
  baseValue: 5, // Fixed: Oracle base value is 5, not 9
  keywords: [],
  abilities: [oracleAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    oracleAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
