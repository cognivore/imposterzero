import type { CardModule, GameState, CardAbility } from '../types.js';

const strangerReactionAbility: CardAbility = {
  name: 'Copy Reaction from Court',
  description: '**Reaction:** While in your hand, the Stranger may copy any Reaction card in Court that is not on the Throne.',

  canActivate(state: GameState, playerIdx: number): boolean {
    const player = state.players[playerIdx];
    // Can activate if Stranger is in hand and there are reaction cards in court (not throne)
    const nonThroneCourt = state.court.slice(0, -1); // All but throne card
    const hasReactionCard = nonThroneCourt.some(card => hasReactionAbility(card.card));
    return player.hand.includes('Stranger') && hasReactionCard;
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    const player = state.players[playerIdx];

    // Find reaction cards in court (not throne) that can be copied
    const nonThroneCourt = state.court.slice(0, -1);
    const reactionCards = nonThroneCourt.filter(c => hasReactionAbility(c.card));

    if (reactionCards.length > 0) {
      // Bot: copy the first available reaction card
      const copiedCard = reactionCards[0].card;
      logger?.log(`Player ${playerIdx + 1}: Stranger copying ${copiedCard} reaction ability from court`);

      // The actual reaction execution would happen through the universal reaction system
      // This just logs that Stranger is copying the ability
    }
  }
};

const strangerPlayAbility: CardAbility = {
  name: 'Copy Court Card',
  description: 'When played, it may copy the ability text and name of any card in Court. Remove copied card from the round.',

  canActivate(state: GameState, playerIdx: number): boolean {
    return state.court.length > 0;
  },

  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    if (state.court.length > 0) {
      // Bot strategy: copy highest value card ability
      const eligibleCards = state.court.filter(c => c.card !== 'Stranger');

      if (eligibleCards.length > 0) {
        const targetCard = eligibleCards.reduce((highest, card) => {
          return getCardBaseValue(card.card) > getCardBaseValue(highest.card) ? card : highest;
        });

        // Remove copied card from the round
        const courtIdx = state.court.indexOf(targetCard);
        if (courtIdx >= 0) {
          state.court.splice(courtIdx, 1);
          logger?.log(`Player ${playerIdx + 1}: Stranger ability - copied ${targetCard.card} and removed it from the round`);
          logger?.log(`Player ${playerIdx + 1}: Stranger now has the ability of ${targetCard.card}`);
        }
      }
    }
  }
};

function hasReactionAbility(card: string): boolean {
  // Cards with reaction abilities
  return ['Assassin', 'KingsHand', 'Arbiter', 'Impersonator'].includes(card);
}

// Helper function - this would come from the rules system
function getCardBaseValue(card: string): number {
  const values: Record<string, number> = {
    'Fool': 1, 'Assassin': 2, 'Stranger': 2, 'Elder': 3, 'Zealot': 3, 'Aegis': 3,
    'Inquisitor': 4, 'Ancestor': 4, 'Executioner': 4, 'Bard': 4, 'Nakturn': 4,
    'Soldier': 5, 'Judge': 5, 'Lockshift': 5, 'Herald': 6, 'Oathbound': 6,
    'Warden': 7, 'Warlord': 7, 'Mystic': 7, 'Spy': 8, 'Sentry': 8, 'Exile': 8,
    'KingsHand': 8, 'Princess': 9, 'Queen': 9, 'Oracle': 9
  };
  return values[card] || 0;
}

export const strangerCard: CardModule = {
  name: 'Stranger',
  baseValue: 2,
  keywords: ['Immune to King\'s Hand'],
  abilities: [strangerReactionAbility, strangerPlayAbility],

  onPlay(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void {
    strangerPlayAbility.execute(state, playerIdx, opponentIdx, logger);
  }
};
