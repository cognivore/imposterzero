import { LocalGameEngine, type LocalGameState } from './engine.js';
import { Logger } from '../utils/logger.js';
import type { GameAction, GameEvent, GameMessage } from '../types/game.js';

export interface LocalGame {
  id: number;
  joinToken: string;
  players: Array<{ name: string; token: string } | null>;
  engine: LocalGameEngine;
  events: GameEvent[];
  started: boolean;
}

export class LocalGameService {
  private games: Map<number, LocalGame> = new Map();
  private nextGameId: number = 1000;
  private nextToken: number = 100000000;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('local-service.log');
  }

  createGame(): { gameId: number; joinToken: string } {
    const gameId = this.nextGameId++;
    const joinToken = (this.nextToken++).toString();

    this.logger.log(`Creating local game - ID: ${gameId}, JoinToken: ${joinToken}`);

    const game: LocalGame = {
      id: gameId,
      joinToken,
      players: [null, null],
      engine: new LocalGameEngine('', ''), // Will be set when players join
      events: [],
      started: false,
    };

    this.games.set(gameId, game);
    this.logger.log(`Game ${gameId} created and stored`);

    return { gameId, joinToken };
  }

  joinGame(gameId: number, joinToken: string, playerName: string): string | null {
    this.logger.log(`Attempting to join game ${gameId} with token ${joinToken} as ${playerName}`);

    const game = this.games.get(gameId);
    if (!game) {
      this.logger.error(`Game ${gameId} not found`);
      return null;
    }

    if (game.joinToken !== joinToken) {
      this.logger.error(`Invalid join token for game ${gameId}. Expected: ${game.joinToken}, Got: ${joinToken}`);
      return null;
    }

    // Find empty slot
    const emptySlotIdx = game.players.findIndex(p => p === null);
    if (emptySlotIdx === -1) {
      this.logger.error(`Game ${gameId} is full`);
      return null; // Game is full
    }

    const playerToken = (this.nextToken++).toString();
    game.players[emptySlotIdx] = {
      name: playerName,
      token: playerToken,
    };

    this.logger.log(`Player ${playerName} joined game ${gameId} in slot ${emptySlotIdx} with token ${playerToken}`);

    // If this is the first player, create the engine
    if (emptySlotIdx === 0) {
      this.logger.log(`First player joined, creating initial engine`);
      const engineLogger = new Logger(`game-${gameId}-engine.log`);
      game.engine = new LocalGameEngine(playerName, '', engineLogger);
    } else {
      // Second player joined, update engine and start game
      const player1Name = game.players[0]?.name || 'Player 1';
      this.logger.log(`Second player joined, creating full engine with players: ${player1Name}, ${playerName}`);
      const engineLogger = new Logger(`game-${gameId}-engine.log`);
      game.engine = new LocalGameEngine(player1Name, playerName, engineLogger);

      // Set deterministic hands for regression testing if this is a test game
      if (gameId >= 1000) { // Test games have ID >= 1000
        // Check if there are custom hands set (will be set by regression test)
        const customHands = (global as any).regressionTestHands;
        if (customHands) {
          game.engine.setDeterministicHands(1, customHands.calm, customHands.katto, customHands.accused);
          this.logger.log(`Set custom deterministic hands for regression test game ${gameId}`);
        } else {
          // Default hands for backward compatibility
          const round1Hands = {
            calm: ['Soldier', 'Soldier', 'Queen', 'KingsHand', 'Immortal', 'Elder', 'Oathbound', 'Assassin', 'Princess'] as any[],
            katto: ['Elder', 'Warden', 'Sentry', 'Inquisitor', 'Inquisitor', 'Warlord', 'Judge', 'Mystic', 'Fool'] as any[],
            accused: 'Zealot' as any
          };

          game.engine.setDeterministicHands(1, round1Hands.calm, round1Hands.katto, round1Hands.accused);
          this.logger.log(`Set default deterministic hands for regression test game ${gameId}`);
        }
      }

      game.started = true;

      // Add initial game state event
      this.addGameStateEvent(game);
      this.logger.log(`Game ${gameId} started with ${game.events.length} events`);
    }

    return playerToken;
  }

  getGameStatus(gameId: number, playerToken: string): any | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    const player = game.players.find(p => p?.token === playerToken);
    if (!player) return null;

    return {
      players: game.players.map(p => p ? { type: 'Human', name: p.name } : null),
      started: game.started,
      version_number: game.events.length,
      join_token: game.joinToken,
    };
  }

  getEvents(gameId: number, playerToken: string, startIndex: number): GameEvent[] {
    const game = this.games.get(gameId);
    if (!game) return [];

    const player = game.players.find(p => p?.token === playerToken);
    if (!player) return [];

    const events = game.events.slice(startIndex);

    // Regenerate board and actions from viewer's perspective for all phases
    const viewerIdx = this.getPlayerIndex(gameId, playerToken);
    if (viewerIdx !== null) {
      return events.map(event => {
        if (event.type === 'NewState') {
          // Always regenerate board and actions from this viewer's perspective
          const viewerBoard = game.engine.toGameBoard(viewerIdx);
          const viewerActions = game.engine.getPossibleActionsForViewer(viewerIdx);

          return {
            ...event,
            board: viewerBoard,
            actions: viewerActions
          };
        }
        return event;
      });
    }

    return events;
  }

  getPlayerIndex(gameId: number, playerToken: string): number | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    for (let i = 0; i < game.players.length; i++) {
      if (game.players[i]?.token === playerToken) {
        return i;
      }
    }
    return null;
  }

  sendAction(gameId: number, playerToken: string, eventCount: number, action: GameAction): boolean {
    const game = this.games.get(gameId);
    if (!game || !game.started) return false;

    const playerIdx = game.players.findIndex(p => p?.token === playerToken);
    if (playerIdx === -1) return false;

    // Validate event count matches
    if (eventCount !== game.events.length) {
      this.logger.error(`Action rejected: event count mismatch`, new Error(JSON.stringify({
        expected: game.events.length,
        got: eventCount,
        action,
      })));
      return false; // Out of sync
    }

    // Execute action in game engine with correct player context
    const success = game.engine.executeAction(action, playerIdx);
    if (!success) {
      // Capture rich debug information when engine rejects the action
      const debug = this.getDebugInfo(game);
      this.logger.error(`Engine rejected action`, new Error(JSON.stringify({ action, debug })));
      return false;
    }

    // Add action message
    this.addActionMessage(game, playerIdx, action);

    // Add new game state
    this.addGameStateEvent(game);

    return true;
  }

  // Get the actual current player index from the engine
  getCurrentPlayerIndex(gameId: number): number | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    const engineState: any = (game.engine as any).state;
    return engineState?.currentPlayerIdx ?? null;
  }

  // Rich debug snapshot to include in error responses/logs
  getDebugInfo(game: LocalGame) {
    const engineState: any = (game.engine as any).state;
    return {
      game_id: game.id,
      started: game.started,
      currentPlayerIdx: engineState?.currentPlayerIdx,
      phase: engineState?.phase,
      firstPlayerIdx: engineState?.firstPlayerIdx,
      players: game.players,
      hands: engineState?.players?.map((p: any) => ({
        hand: p?.hand,
        successor: p?.successor,
        squire: p?.squire,
        kingFacet: p?.kingFacet,
        kingFlipped: p?.kingFlipped,
      })),
      court: engineState?.court,
      accused: engineState?.accused,
      possible_actions: game.engine.getPossibleActions?.() ?? [],
    };
  }

  private addActionMessage(game: LocalGame, playerIdx: number, action: GameAction): void {
    const playerName = game.players[playerIdx]?.name || `Player ${playerIdx + 1}`;

    let message: GameMessage;

    switch (action.type) {
      case 'ChooseSignatureCards':
        message = {
          type: 'KnownSignatureCardsChosen',
          player_idx: playerIdx,
          cards: action.cards.map(([, card]) => card),
        };
        break;

      case 'ChangeKingFacet':
        message = {
          type: 'ChangedKingFacet',
          player_idx: playerIdx,
          facet: action.facet,
        };
        break;

      case 'PlayCard':
        message = {
          type: 'CardPlayed',
          player_idx: playerIdx,
          card: action.card,
          ability: action.ability,
        };
        break;

      case 'FlipKing':
        message = {
          type: 'KingFlipped',
          player_idx: playerIdx,
        };
        break;

      default:
        message = {
          type: 'NothingHappened',
        };
    }

    game.events.push({
      type: 'Message',
      message,
    });
  }

  private addGameStateEvent(game: LocalGame): void {
    const currentPlayerIdx = game.engine.getGameState().currentPlayerIdx;
    const gameBoard = game.engine.toGameBoard(currentPlayerIdx);
    const gameStatus = game.engine.toGameStatus();
    const possibleActions = game.engine.getPossibleActions();

    game.events.push({
      type: 'NewState',
      board: gameBoard,
      status: gameStatus,
      actions: possibleActions,
      reset_ui: false,
    });
  }

  addBot(gameId: number, playerToken: string): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;

    const player = game.players.find(p => p?.token === playerToken);
    if (!player) return false;

    // Find empty slot
    const emptySlotIdx = game.players.findIndex(p => p === null);
    if (emptySlotIdx === -1) return false;

    const botToken = (this.nextToken++).toString();
    game.players[emptySlotIdx] = {
      name: 'Bot',
      token: botToken,
    };

    // Start game if both slots filled
    if (game.players.every(p => p !== null)) {
      const player1Name = game.players[0]?.name || 'Player 1';
      const player2Name = game.players[1]?.name || 'Player 2';
      game.engine = new LocalGameEngine(player1Name, player2Name, this.logger);
      game.started = true;

      this.addGameStateEvent(game);
    }

    return true;
  }

  // Get all games (for debugging)
  getAllGames(): LocalGame[] {
    return Array.from(this.games.values());
  }
}
