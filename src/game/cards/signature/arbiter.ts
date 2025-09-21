import type { CardModule, GameState, CardAbility, CardName } from '../types.js';

const arbiterReactionAbility: CardAbility = {
  name: 'Say Card Name at Turn Start',
  description: '**Reaction:** At start of any other player\'s turn you may reveal this card to say a card name. If your Ally has that card they must reveal it, and you must exchange a card with the revealed card. Then play this card to your Antechamber.',

  canActivate(state: GameState, playerIdx: number): boolean {
    // Can be used at start of opponent's turn if in hand
    const player = state.players[playerIdx];
    return player.hand.includes('Arbiter');
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];
    const ally = state.players[opponentIdx]; // In 2-player, "ally" would be the opponent

    // Say a card name
    const commonCards = ['Elder', 'Soldier', 'Inquisitor', 'Judge', 'Oathbound'];
    const guessedCard = commonCards[Math.floor(Math.random() * commonCards.length)];

    logger?.log(`Player ${playerIdx + 1}: Arbiter reaction - guessing ally has ${guessedCard}`);

    if (ally.hand.includes(guessedCard as CardName)) {
      logger?.log(`🎯 HIT! Ally has ${guessedCard}`);

      // Must exchange a card with the revealed card
      if (player.hand.length > 0) {
        const playerCardIdx = Math.floor(Math.random() * player.hand.length);
        const allyCardIdx = ally.hand.indexOf(guessedCard as CardName);

        const playerCard = player.hand[playerCardIdx];
        const allyCard = ally.hand[allyCardIdx];

        // Exchange cards
        player.hand[playerCardIdx] = allyCard;
        ally.hand[allyCardIdx] = playerCard;

        logger?.log(`Player ${playerIdx + 1}: Arbiter - exchanged ${playerCard} with ally's ${allyCard}`);
      }

      // Play Arbiter to Antechamber
      const arbiterIdx = player.hand.indexOf('Arbiter');
      if (arbiterIdx >= 0) {
        const arbiter = player.hand.splice(arbiterIdx, 1)[0];
        player.antechamber.push(arbiter);
        logger?.log(`Player ${playerIdx + 1}: Arbiter moved to Antechamber`);
      }
    } else {
      logger?.log(`❌ MISS! Ally does not have ${guessedCard}`);
    }
  }
};

const arbiterAnteAbility: CardAbility = {
  name: 'Disgrace When Played from Antechamber',
  description: 'If played from your Antechamber, Disgrace this card.',

  canActivate(state: GameState, playerIdx: number): boolean {
    // This would be checked when playing from antechamber
    return true;
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    // Find Arbiter in court and disgrace it
    const arbiterInCourt = state.court.find(c => c.card === 'Arbiter');
    if (arbiterInCourt) {
      arbiterInCourt.disgraced = true;
      logger?.log(`Player ${playerIdx + 1}: Arbiter played from Antechamber - disgraced`);
    }
  }
};

export const arbiterCard: CardModule = {
  name: 'Arbiter',
  baseValue: 5,
  keywords: [],
  abilities: [arbiterReactionAbility, arbiterAnteAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    // Check if played from Antechamber (this would need to be tracked)
    const player = state.players[playerIdx];
    const playedFromAnte = player.antechamber.includes('Arbiter');

    if (playedFromAnte) {
      arbiterAnteAbility.execute(state, playerIdx, opponentIdx, logger);
    }
  }
};
