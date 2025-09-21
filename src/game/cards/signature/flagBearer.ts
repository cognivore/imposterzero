import type { CardModule, GameState, CardAbility, CardName } from '../types.js';

const flagBearerAbility: CardAbility = {
  name: 'Disgrace for Army Actions',
  description: 'If there is a Disgraced card in Court, you may Disgrace this card to Recall once, then Rally twice. Reveal Rallied cards, then return one secretly to the Army.',

  canActivate(state: GameState, playerIdx: number): boolean {
    return state.court.some(card => card.disgraced);
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];

    if (state.court.some(card => card.disgraced)) {
      // Find Flag Bearer in court and disgrace it
      const flagBearerInCourt = state.court.find(c => c.card === 'FlagBearer');
      if (flagBearerInCourt) {
        flagBearerInCourt.disgraced = true;
        logger?.log(`Player ${playerIdx + 1}: Flag Bearer ability - disgraced Flag Bearer in court`);

        // Recall once
        if (player.exhaustedArmy.length > 0) {
          const recalledCard = player.exhaustedArmy.pop();
          if (recalledCard) {
            player.army.push(recalledCard);
            logger?.log(`Player ${playerIdx + 1}: Recalled ${recalledCard} from exhausted army`);
          }
        }

        // Rally twice
        const ralliedCards: string[] = [];
        for (let i = 0; i < 2 && player.army.length > 0; i++) {
          const ralliedCard = player.army.pop();
          if (ralliedCard) {
            player.hand.push(ralliedCard);
            ralliedCards.push(ralliedCard);
            logger?.log(`Player ${playerIdx + 1}: Rallied ${ralliedCard} to hand`);
          }
        }

        // Reveal rallied cards, then return one secretly to the Army
        if (ralliedCards.length > 0) {
          logger?.log(`Player ${playerIdx + 1}: Flag Bearer - revealed rallied cards: ${ralliedCards.join(', ')}`);

          // Return one card back to army
          const returnedCard = ralliedCards[Math.floor(Math.random() * ralliedCards.length)];
          const handIdx = player.hand.indexOf(returnedCard as CardName);
          if (handIdx >= 0) {
            player.hand.splice(handIdx, 1);
            player.army.push(returnedCard as CardName);
            logger?.log(`Player ${playerIdx + 1}: Flag Bearer - secretly returned ${returnedCard} to army`);
          }
        }
      }
    } else {
      logger?.log(`Player ${playerIdx + 1}: Flag Bearer ability - no disgraced cards in court, cannot use ability`);
    }
  }
};

export const flagBearerCard: CardModule = {
  name: 'FlagBearer',
  baseValue: 1,
  keywords: [],
  abilities: [flagBearerAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    flagBearerAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
