import type { CardModule, GameState, CardAbility } from '../types.js';

const ancestorAbility: CardAbility = {
  name: 'Play on Royalty for Recall and Rally',
  description: 'You may play this card on any Royalty. If you do, Recall. Then, you may reveal and remove a card from your hand to Rally.',

  canActivate(state: GameState, playerIdx: number): boolean {
    // Can play on any Royalty in court
    return state.court.some(card => isRoyalty(card.card));
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];

    // Check if played on Royalty (this would be determined by targeting)
    const royaltyInCourt = state.court.filter(card => isRoyalty(card.card));

    if (royaltyInCourt.length > 0) {
      logger?.log(`Player ${playerIdx + 1}: Ancestor ability - played on Royalty, triggering Recall`);

      // Recall (bring back an army card)
      if (player.exhaustedArmy.length > 0) {
        const recalledCard = player.exhaustedArmy.pop();
        if (recalledCard) {
          player.army.push(recalledCard);
          logger?.log(`Player ${playerIdx + 1}: Recalled ${recalledCard} from exhausted army`);
        }
      }

      // Then, may reveal and remove a card from hand to Rally
      if (player.hand.length > 0) {
        // Bot: sacrifice lowest value card to Rally
        const lowestIdx = player.hand.reduce((lowestIdx, card, idx) => {
          return getCardBaseValue(card) < getCardBaseValue(player.hand[lowestIdx]) ? idx : lowestIdx;
        }, 0);

        const sacrificedCard = player.hand.splice(lowestIdx, 1)[0];

        // Rally (add a card from army to hand)
        if (player.army.length > 0) {
          const ralliedCard = player.army.pop();
          if (ralliedCard) {
            player.hand.push(ralliedCard);
            logger?.log(`Player ${playerIdx + 1}: Ancestor ability - sacrificed ${sacrificedCard} to Rally ${ralliedCard}`);
          }
        }
      }
    }
  }
};

const ancestorCourtEffect: CardAbility = {
  name: 'Elder Enhancement',
  description: 'While this card is in Court, Elders gain Steadfast and +3 value.',

  canActivate(state: GameState, playerIdx: number): boolean {
    return true; // Passive effect while in court
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    // This would be handled by the game engine checking for Ancestor in court
    logger?.log(`Ancestor in court: All Elders gain Steadfast and +3 value`);
  }
};

function isRoyalty(card: string): boolean {
  return card === 'Princess' || card === 'Queen';
}

// Helper function - this would come from the rules system
function getCardBaseValue(card: string): number {
  const values: Record<string, number> = {
    'Fool': 1, 'Assassin': 2, 'Elder': 3, 'Zealot': 3, 'Aegis': 3,
    'Inquisitor': 4, 'Ancestor': 4, 'Executioner': 4, 'Soldier': 5, 'Judge': 5, 'Herald': 6, 'Oathbound': 6,
    'Warden': 7, 'Warlord': 7, 'Mystic': 7, 'Spy': 8, 'Sentry': 8,
    'KingsHand': 8, 'Princess': 9, 'Queen': 9, 'Oracle': 9
  };
  return values[card] || 0;
}

export const ancestorCard: CardModule = {
  name: 'Ancestor',
  baseValue: 4,
  keywords: ['Immune to King\'s Hand'],
  abilities: [ancestorAbility, ancestorCourtEffect],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    ancestorAbility.execute(state, playerIdx, opponentIdx, logger);
  },

  onEnterCourt(state: GameState, playerIdx: number, logger?: any): void {
    ancestorCourtEffect.execute(state, playerIdx, 1 - playerIdx, logger);
  }
};
