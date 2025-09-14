import type { CardModule, GameState, CardAbility } from '../types.js';

const informantAbility: CardAbility = {
  name: 'Guess Dungeon Card',
  description: 'Guess the card name in an opponent\'s Dungeon. If correct, they must reveal it, then you may either add that card into your hand or Rally.',

  canActivate(state: GameState, playerIdx: number): boolean {
    const opponent = state.players[1 - playerIdx];
    return opponent.dungeon !== null;
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];
    const opponent = state.players[opponentIdx];

    if (opponent.dungeon) {
      // Bot strategy: guess a common card
      const commonCards = ['Elder', 'Soldier', 'Inquisitor', 'Judge', 'Oathbound', 'Fool', 'Assassin'];
      const guessedCard = commonCards[Math.floor(Math.random() * commonCards.length)];

      logger?.log(`Player ${playerIdx + 1}: Informant ability - guessing opponent's dungeon is ${guessedCard}`);

      if (opponent.dungeon === guessedCard) {
        logger?.log(`🎯 HIT! Opponent's dungeon is ${guessedCard}`);
        logger?.log(`Player ${opponentIdx + 1}: Must reveal dungeon card ${guessedCard}`);

        // May either add card to hand or Rally
        const choice = Math.random() < 0.5 ? 'hand' : 'rally';

        if (choice === 'hand') {
          // Add dungeon card to hand
          player.hand.push(opponent.dungeon);
          opponent.dungeon = null;
          logger?.log(`Player ${playerIdx + 1}: Informant ability - took ${guessedCard} from opponent's dungeon to hand`);
        } else {
          // Rally instead
          if (player.army.length > 0) {
            const ralliedCard = player.army.pop();
            if (ralliedCard) {
              player.hand.push(ralliedCard);
              logger?.log(`Player ${playerIdx + 1}: Informant ability - chose to Rally ${ralliedCard} instead of taking dungeon`);
            }
          }
        }
      } else {
        logger?.log(`❌ MISS! Opponent's dungeon is not ${guessedCard}`);
      }
    } else {
      logger?.log(`Player ${playerIdx + 1}: Informant ability - opponent has no dungeon card`);
    }
  }
};

export const informantCard: CardModule = {
  name: 'Informant',
  baseValue: 4,
  keywords: ['Immune to King\'s Hand'],
  abilities: [informantAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    informantAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
