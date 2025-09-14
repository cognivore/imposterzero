import { LocalGameEngine, type LocalGameState, type Player } from '../game/engine.js';
import { GAME_CONFIG } from '../game/rules.js';
import { Logger } from '../utils/logger.js';
import type { CardName } from '../types/game.js';

// Deterministic engine for regression testing with specific hands
export class DeterministicGameEngine extends LocalGameEngine {
  private predefinedHands: {
    round1: {
      calm: CardName[];
      katto: CardName[];
      accused: CardName;
    };
    round2: {
      calm: CardName[];
      katto: CardName[];
      accused: CardName;
    };
    round3: {
      calm: CardName[];
      katto: CardName[];
      accused: CardName;
    };
  };

  constructor(player1Name: string, player2Name: string, logger?: Logger) {
    super(player1Name, player2Name, logger);

    // Define the exact hands from the regression test
    this.predefinedHands = {
      round1: {
        calm: ['Soldier', 'Soldier', 'Queen', 'KingsHand', 'Immortal', 'Elder', 'Oathbound', 'Assassin', 'Princess'],
        katto: ['Elder', 'Warden', 'Sentry', 'Inquisitor', 'Inquisitor', 'Warlord', 'Judge', 'Mystic', 'Fool'],
        accused: 'Zealot' // Assumed since it's not in either hand
      },
      round2: {
        calm: ['Sentry', 'Elder', 'Zealot', 'Oathbound', 'Inquisitor', 'Soldier', 'Queen', 'Mystic', 'Princess'],
        katto: ['Fool', 'Oathbound', 'Assassin', 'Warlord', 'Elder', 'Warden', 'Soldier', 'Inquisitor', 'KingsHand'],
        accused: 'Judge' // Assumed
      },
      round3: {
        calm: ['Mystic', 'Princess', 'Oathbound', 'Judge', 'Warlord', 'Queen', 'Elder', 'Inquisitor', 'Warden'],
        katto: ['Soldier', 'Immortal', 'KingsHand', 'Soldier', 'Zealot', 'Assassin', 'Sentry', 'Elder', 'Oathbound'],
        accused: 'Fool' // Assumed
      }
    };
  }

  // Override the dealing method to use predefined hands
  protected dealCardsForRound(round: number): void {
    const state = this.getGameState();
    const roundData = round === 1 ? this.predefinedHands.round1 :
                      round === 2 ? this.predefinedHands.round2 :
                      this.predefinedHands.round3;

    // Set accused card
    this.setAccusedCard(roundData.accused);

    // Set player hands
    state.players[0].hand = [...roundData.calm];
    state.players[1].hand = [...roundData.katto];

    this.logger?.log(`Round ${round} - Deterministic dealing:`);
    this.logger?.log(`Calm hand: ${roundData.calm.join(', ')}`);
    this.logger?.log(`katto hand: ${roundData.katto.join(', ')}`);
    this.logger?.log(`Accused: ${roundData.accused}`);
  }

  // Method to set accused card
  private setAccusedCard(accused: CardName): void {
    const state = this.getGameState();
    state.accused = accused;
  }

  // Override startNewRound to use deterministic dealing
  startNewRound(): void {
    const state = this.getGameState();

    if (state.phase === 'signature_selection' && this.canStartMatch()) {
      state.phase = 'mustering';
    }

    // Use deterministic dealing instead of random
    this.dealCardsForRound(state.round);

    // Set up Successor and Dungeon
    this.setupSuccessorAndDungeon();

    // True King must choose who goes first
    if (state.firstPlayerIdx === null) {
      state.currentPlayerIdx = state.trueKingIdx;
      state.phase = 'choose_first_player';
      this.logger?.log(`True King (Player ${state.trueKingIdx + 1}) must choose who goes first`);
      return;
    }

    // After first player is chosen, start mustering
    this.startMusteringPhase();
  }
}
