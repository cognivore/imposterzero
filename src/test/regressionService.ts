import { LocalGameService, type LocalGame } from '../game/localService.js';
import { DeterministicGameEngine } from './deterministicEngine.js';
import { Logger } from '../utils/logger.js';
import type { CardName } from '../types/game.js';

export class RegressionGameService extends LocalGameService {
  private deterministicHands = {
    round1: {
      calm: ['Soldier', 'Soldier', 'Queen', 'KingsHand', 'Immortal', 'Elder', 'Oathbound', 'Assassin', 'Princess'] as CardName[],
      katto: ['Elder', 'Warden', 'Sentry', 'Inquisitor', 'Inquisitor', 'Warlord', 'Judge', 'Mystic', 'Fool'] as CardName[],
      accused: 'Zealot' as CardName
    }
  };

  constructor() {
    super();
  }

  // Override joinGame to use deterministic engine
  joinGame(gameId: number, joinToken: string, playerName: string): string | null {
    const logger = (this as any).logger as Logger;
    logger.log(`Attempting to join game ${gameId} with token ${joinToken} as ${playerName}`);

    const games = (this as any).games as Map<number, LocalGame>;
    const game = games.get(gameId);
    if (!game) {
      logger.error(`Game ${gameId} not found`);
      return null;
    }

    if (game.joinToken !== joinToken) {
      logger.error(`Invalid join token for game ${gameId}. Expected: ${game.joinToken}, Got: ${joinToken}`);
      return null;
    }

    // Find empty slot
    const emptySlotIdx = game.players.findIndex(p => p === null);
    if (emptySlotIdx === -1) {
      logger.error(`Game ${gameId} is full`);
      return null;
    }

    const nextToken = (this as any).nextToken++;
    const playerToken = nextToken.toString();
    game.players[emptySlotIdx] = {
      name: playerName,
      token: playerToken,
    };

    logger.log(`Player ${playerName} joined game ${gameId} in slot ${emptySlotIdx} with token ${playerToken}`);

    // If this is the first player, create the engine
    if (emptySlotIdx === 0) {
      logger.log(`First player joined, creating initial deterministic engine`);
      game.engine = new DeterministicGameEngine(playerName, '', logger);
    } else {
      // Second player joined, update engine and start game
      const player1Name = game.players[0]?.name || 'Player 1';
      logger.log(`Second player joined, creating full deterministic engine with players: ${player1Name}, ${playerName}`);

      // Create deterministic engine and set specific hands
      const engine = new DeterministicGameEngine(player1Name, playerName, logger);
      this.setDeterministicHands(engine, 1); // Round 1 hands
      game.engine = engine;
      game.started = true;

      // Add initial game state event
      this.addGameStateEvent(game);
      logger.log(`Game ${gameId} started with ${game.events.length} events`);
    }

    return playerToken;
  }

  private setDeterministicHands(engine: DeterministicGameEngine, round: number): void {
    // This would need access to engine internals to set specific hands
    // For now, we'll implement this in a different way
  }
}
