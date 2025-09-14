import type { CardModule, GameState, CardAbility } from '../types.js';

const judgeAbility: CardAbility = {
  name: 'Guess Hand Card',
  description: 'Guess a card name in an opponent\'s hand. If correct, you may play a card to your Antechamber with a base value of 2 or more.',

  canActivate(state: GameState, playerIdx: number): boolean {
    const opponent = state.players[1 - playerIdx];
    return opponent.hand.length > 0;
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];
    const opponent = state.players[opponentIdx];

    // Bot strategy: guess a common card
    const commonCards = ['Elder', 'Soldier', 'Inquisitor', 'Judge', 'Oathbound'];
    const guessedCard = commonCards[Math.floor(Math.random() * commonCards.length)];

    logger?.log(`Player ${playerIdx + 1}: Judge ability - guessing opponent has ${guessedCard}`);

    const opponentHasCard = opponent.hand.includes(guessedCard);

    if (opponentHasCard) {
      logger?.log(`🎯 HIT! Judge guess correct`);

      // May play a card with base value ≥ 2 to antechamber
      const eligibleCards = player.hand.filter(card => getCardBaseValue(card) >= 2);

      if (eligibleCards.length > 0) {
        // Bot: put lowest value eligible card in antechamber
        const sortedCards = eligibleCards.sort((a, b) => getCardBaseValue(a) - getCardBaseValue(b));
        const chosenCard = sortedCards[0];
        const handIdx = player.hand.indexOf(chosenCard);

        const movedCard = player.hand.splice(handIdx, 1)[0];
        player.antechamber.push(movedCard);

        logger?.log(`Player ${playerIdx + 1}: Judge ability - moved ${movedCard} to antechamber`);
      }
    } else {
      logger?.log(`❌ MISS! Judge guess incorrect`);
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

export const judgeCard: CardModule = {
  name: 'Judge',
  baseValue: 5,
  keywords: [],
  abilities: [judgeAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    judgeAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
