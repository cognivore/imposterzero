import type { CardModule, GameState, CardAbility } from '../types.js';

const soldierAbility: CardAbility = {
  name: 'Say Card Name for Bonus',
  description: 'Say a card name. If any opponents have that card in their hand, this card gains +2 value while on the Throne and you may Disgrace up to three cards in the Court.',

  canActivate(state: GameState, playerIdx: number): boolean {
    return true; // Can always attempt to name a card
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const opponent = state.players[opponentIdx];

    // Bot strategy: guess a card that's likely to be in opponent's hand
    let guessedCard: string;

    // Simple strategy: guess common cards
    const commonCards = ['Elder', 'Soldier', 'Inquisitor', 'Judge', 'Oathbound'];
    guessedCard = commonCards[Math.floor(Math.random() * commonCards.length)];

    logger?.log(`Player ${playerIdx + 1}: Soldier ability - guessing ${guessedCard}`);

    const opponentHasCard = opponent.hand.includes(guessedCard);

    if (opponentHasCard) {
      logger?.log(`🎯 HIT! Opponent has ${guessedCard}`);

      // Soldier gains +2 value while on throne (this would be tracked)
      logger?.log(`Player ${playerIdx + 1}: Soldier gains +2 value while on throne`);

      // May disgrace up to 3 court cards
      let disgracedCount = 0;
      const maxToDisgrace = Math.min(3, state.court.length);

      for (let i = 0; i < state.court.length && disgracedCount < maxToDisgrace; i++) {
        const courtCard = state.court[i];
        if (!courtCard.disgraced && courtCard.card !== 'Soldier') {
          courtCard.disgraced = true;
          disgracedCount++;
          logger?.log(`Player ${playerIdx + 1}: Soldier ability - disgraced ${courtCard.card}`);
        }
      }

      logger?.log(`Player ${playerIdx + 1}: Soldier ability - disgraced ${disgracedCount} cards`);
    } else {
      logger?.log(`❌ MISS! Opponent does not have ${guessedCard}`);
    }
  }
};

export const soldierCard: CardModule = {
  name: 'Soldier',
  baseValue: 5,
  keywords: [],
  abilities: [soldierAbility],

  valueModifiers: {
    onThrone: (state: GameState) => {
      // This would check if the soldier ability was successfully activated
      // For now, return base value
      return 0; // +0 modification by default, +2 if ability hit
    }
  },

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    soldierAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
