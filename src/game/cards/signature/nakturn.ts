import type { CardModule, GameState, CardAbility, CardName } from '../types.js';

const nakturnAbility: CardAbility = {
  name: 'Mind Game with Opponent',
  description: 'If there are any Disgraced cards in Court, you may say a card name. Choose an opponent to guess whether you have that card in your hand. If they are wrong, look at their hand and Condemn a card.',

  canActivate(state: GameState, playerIdx: number): boolean {
    return state.court.some(card => card.disgraced);
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];
    const opponent = state.players[opponentIdx];

    if (state.court.some(card => card.disgraced)) {
      // Say a card name
      const cardNames = ['Elder', 'Soldier', 'Inquisitor', 'Judge', 'Oathbound', 'Princess', 'Queen'];
      const namedCard = cardNames[Math.floor(Math.random() * cardNames.length)];

      logger?.log(`Player ${playerIdx + 1}: Nakturn ability - says card name "${namedCard}"`);

      // Opponent guesses whether player has that card
      const playerActuallyHasCard = player.hand.includes(namedCard as CardName);
      const opponentGuess = Math.random() < 0.5; // Random guess for bot

      logger?.log(`Player ${opponentIdx + 1}: Guesses player ${playerActuallyHasCard ? 'has' : 'does not have'} ${namedCard} (actual: ${playerActuallyHasCard ? 'has' : 'does not have'})`);

      const opponentGuessCorrect = (opponentGuess && playerActuallyHasCard) || (!opponentGuess && !playerActuallyHasCard);

      if (!opponentGuessCorrect) {
        logger?.log(`❌ Opponent guessed wrong!`);

        // Look at opponent's hand and condemn a card
        if (opponent.hand.length > 0) {
          logger?.log(`Player ${playerIdx + 1}: Nakturn ability - looking at opponent's hand: ${opponent.hand.join(', ')}`);

          // Condemn highest value card
          const highestIdx = opponent.hand.reduce((highestIdx, card, idx) => {
            return getCardBaseValue(card) > getCardBaseValue(opponent.hand[highestIdx]) ? idx : highestIdx;
          }, 0);

          const condemnedCard = opponent.hand.splice(highestIdx, 1)[0];
          opponent.condemned.push(condemnedCard);

          logger?.log(`Player ${playerIdx + 1}: Nakturn ability - condemned opponent's ${condemnedCard}`);
        }
      } else {
        logger?.log(`✓ Opponent guessed correctly`);
      }
    } else {
      logger?.log(`Player ${playerIdx + 1}: Nakturn ability - no disgraced cards in court, cannot use ability`);
    }
  }
};

// Helper function - this would come from the rules system
function getCardBaseValue(card: string): number {
  const values: Record<string, number> = {
    'Fool': 1, 'Assassin': 2, 'Elder': 3, 'Zealot': 3, 'Aegis': 3,
    'Inquisitor': 4, 'Ancestor': 4, 'Executioner': 4, 'Bard': 4, 'Nakturn': 4,
    'Soldier': 5, 'Judge': 5, 'Lockshift': 5, 'Herald': 6, 'Oathbound': 6,
    'Warden': 7, 'Warlord': 7, 'Mystic': 7, 'Spy': 8, 'Sentry': 8, 'Exile': 8,
    'KingsHand': 8, 'Princess': 9, 'Queen': 9, 'Oracle': 9
  };
  return values[card] || 0;
}

export const nakturnCard: CardModule = {
  name: 'Nakturn',
  baseValue: 4,
  keywords: [],
  abilities: [nakturnAbility],

  valueModifiers: {
    inCourt: (state: GameState) => {
      // This card's value is 2 while in Court
      return -2; // 4 - 2 = 2
    }
  },

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    nakturnAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
