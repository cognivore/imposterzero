#!/usr/bin/env node

import { LocalGameServer } from '../server/server.js';
import { ImposterKingsAPIClient } from '../api/client.js';
import { ModernBot } from '../ai/modernBot.js';
import { Logger } from '../utils/logger.js';
import { GameDisplay } from '../ui/display.js';
import { GamePrompts } from '../ui/prompts.js';
import { GameState } from '../game/state.js';
import type { GameAction, GameEvent, GameBoard, GameStatus } from '../types/game.js';

export class HumanVsBotTest {
  private server: LocalGameServer;
  private logger: Logger;
  private gameLogger: Logger;
  private humanClient: ImposterKingsAPIClient;
  private botClient: ImposterKingsAPIClient;
  private bot: ModernBot;
  private gameId: number = 0;
  private humanToken: string = '';
  private botToken: string = '';
  private humanPlayerName: string = '';
  private display: GameDisplay;
  private prompts: GamePrompts;
  private gameState: GameState;
  private isRunning: boolean = false;

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.server = new LocalGameServer(3003); // Different port for human vs bot testing
    this.logger = new Logger(`human-vs-bot-${timestamp}.log`);
    this.gameLogger = new Logger(`human-vs-bot-game-${timestamp}.log`);

    this.humanClient = new ImposterKingsAPIClient('http://localhost:3003');
    this.botClient = new ImposterKingsAPIClient('http://localhost:3003');

    this.bot = new ModernBot('Bot');
    this.display = new GameDisplay();
    this.prompts = new GamePrompts();
    this.gameState = new GameState();
  }

  async runHumanVsBotTest(): Promise<void> {
    console.log('🎮 Starting Human vs Bot Game');
    console.log('🤖 You will play against a bot using the full CLI interface');
    console.log('=' .repeat(60));

    try {
      // Start server
      await this.server.start();
      console.log('✅ Game server started on port 3003');

      // Get player name
      this.humanPlayerName = await this.prompts.promptPlayerName();
      this.display.clear();
      this.display.displayTitle();
      this.display.displayInfo(`Welcome ${this.humanPlayerName}! Setting up game against Bot...`);

      // Setup game
      await this.setupGame();

      // Play the game
      await this.playGame();

      console.log('🎉 Game completed!');

    } catch (error) {
      this.logger.error('Human vs Bot test failed', error as Error);
      console.error('❌ Game failed:', error);
    } finally {
      this.isRunning = false;
      this.server.stop();
      this.logger.close();
      this.gameLogger.close();
    }
  }

  private async setupGame(): Promise<void> {
    this.gameLogger.log('=== GAME SETUP ===');

    // Create game
    const createResponse = await this.humanClient.createGame({ player_name: this.humanPlayerName });
    this.gameId = createResponse.game_id;
    const joinToken = createResponse.player_token;

    this.gameLogger.log(`Game created - ID: ${this.gameId}, Join Token: ${joinToken}`);

    // Join bot player first to make it Player 0
    const botJoinResponse = await this.botClient.joinGame({
      game_id: this.gameId,
      join_token: joinToken,
      player_name: 'Bot'
    });
    this.botToken = botJoinResponse.player_token;

    // Join human player second to make it Player 1
    const humanJoinResponse = await this.humanClient.joinGame({
      game_id: this.gameId,
      join_token: joinToken,
      player_name: this.humanPlayerName
    });
    this.humanToken = humanJoinResponse.player_token;

    this.gameLogger.log(`Players joined - ${this.humanPlayerName}: ${this.humanToken}, Bot: ${this.botToken}`);

    // Set player names for display (bot is player 0, human is player 1)
    this.gameState.setPlayerNames(['Bot', this.humanPlayerName]);
    this.display.setPlayerNames(['Bot', this.humanPlayerName]);

    this.display.displaySuccess(`✅ Game setup complete - ID: ${this.gameId}`);
    this.display.displayInfo('🎯 Game starting... You are playing against a bot!');
  }

  private async playGame(): Promise<void> {
    this.gameLogger.log('=== STARTING GAME ===');
    this.isRunning = true;

    let turnCount = 0;
    const maxTurns = 200; // Safety limit

    while (this.isRunning && turnCount < maxTurns) {
      turnCount++;

      try {
        // Get current game state for human player
        const humanEvents = await this.humanClient.getEvents(this.gameId, this.humanToken, 0);

        if (!humanEvents || humanEvents.length === 0) {
          await this.sleep(100);
          continue;
        }

        // Process all events to get latest game state
        this.gameState.processEvents(humanEvents);

        const board = this.gameState.getCurrentBoard();
        const status = this.gameState.getCurrentStatus();
        const actions = this.gameState.getPossibleActions();

        if (!board || !status) {
          await this.sleep(100);
          continue;
        }

        // Log current state
        this.gameLogger.log(`Turn ${turnCount}: Player ${board.player_idx}, Status: ${status.type}, Actions: ${actions.length}`);

        // Check for game over
        if (status.type === 'GameOver') {
          this.display.clear();
          this.display.displayGameState(board, status, actions, humanEvents);
          this.display.displaySuccess('🎉 Game Over!');

          // Determine winner (bot is player 0, human is player 1)
          const scores = board.points;
          if (scores[1] > scores[0]) {
            this.display.displaySuccess(`🏆 ${this.humanPlayerName} wins with ${scores[1]} points!`);
          } else if (scores[0] > scores[1]) {
            this.display.displayInfo(`🤖 Bot wins with ${scores[0]} points!`);
          } else {
            this.display.displayInfo(`🤝 It's a tie! Both players have ${scores[0]} points.`);
          }

          this.gameLogger.log(`Game Over - Final scores: Bot: ${scores[0]}, ${this.humanPlayerName}: ${scores[1]}`);
          break;
        }

        // Determine whose turn it is based on board.player_idx
        // In our setup: bot joins first = player 0, human joins second = player 1
        // So: board.player_idx=0 → bot's turn, board.player_idx=1 → human's turn
        const isHumanTurn = board.player_idx === 1;

        // Log whose turn it is for debugging
        this.gameLogger.log(`Turn check: board.player_idx=${board.player_idx}, status=${status.type}, true_king_idx=${board.true_king_idx}`);
        this.gameLogger.log(`Token mapping: human=${this.humanToken}, bot=${this.botToken}`);

        // For "Choose who goes first", only the True King can decide
        if (status.type === 'ChooseWhosFirst' || (status as any).type === 'ChooseWhosFirst') {
          this.gameLogger.log(`ChooseWhosFirst: True King is player ${board.true_king_idx}, current turn is player ${board.player_idx}`);
          if (board.true_king_idx !== board.player_idx) {
            this.gameLogger.log(`ERROR: Wrong player trying to choose first! True King is ${board.true_king_idx}, but current player is ${board.player_idx}`);
          }
        }

        if (isHumanTurn) {
          // Human player's turn
          await this.handleHumanTurn(board, status, actions, humanEvents);
        } else {
          // Bot's turn
          await this.handleBotTurn(board, status, actions);
        }

        // Small delay to prevent overwhelming the server
        await this.sleep(50);

      } catch (error) {
        this.logger.error(`Error during turn ${turnCount}`, error as Error);
        this.display.displayError(`Error during game: ${error instanceof Error ? error.message : 'Unknown error'}`);
        await this.sleep(1000);
      }
    }

    if (turnCount >= maxTurns) {
      this.logger.error(`Game exceeded maximum turns (${maxTurns})`);
      this.display.displayError('Game exceeded maximum turns - ending game');
    }
  }

  private async handleHumanTurn(board: GameBoard, status: GameStatus, actions: GameAction[], events: GameEvent[]): Promise<void> {
    // Update display
    this.updateDisplay();

    if (actions.length === 0) {
      this.display.displayInfo('⏳ Waiting for game to continue...');
      return;
    }

    // Get human player's action choice
    const actionIndex = await this.prompts.promptAction(actions);

    if (actionIndex < 0 || actionIndex >= actions.length) {
      this.display.displayError('Invalid action selected');
      return;
    }

    const chosenAction = actions[actionIndex];

    this.gameLogger.log(`Human action: ${JSON.stringify(chosenAction)}`);

    try {
      // Get fresh event count to avoid sync issues
      const freshEvents = await this.humanClient.getEvents(this.gameId, this.humanToken, 0);
      const eventCount = freshEvents?.length || 0;

      // Send the human's action
      await this.humanClient.sendAction(this.gameId, this.humanToken, eventCount, chosenAction);

      this.display.displaySuccess('✅ Action sent successfully');
      this.gameLogger.log('✅ Human action sent successfully');
    } catch (error) {
      this.logger.error('Failed to send human action', error as Error);
      this.display.displayError(`Failed to send action: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleBotTurn(board: GameBoard, status: GameStatus, actions: GameAction[]): Promise<void> {
    this.display.displayInfo('🤖 Bot is thinking...');

    if (actions.length === 0) {
      this.display.displayInfo('⏳ Bot waiting for game to continue...');
      return;
    }

    // Get bot's action choice
    const chosenAction = this.bot.chooseAction(board, status, actions);

    if (!chosenAction) {
      this.logger.error('Bot returned no action');
      this.display.displayError('Bot failed to choose an action');
      return;
    }

    this.gameLogger.log(`Bot action: ${JSON.stringify(chosenAction)}`);
    this.display.displayInfo(`🤖 Bot chose: ${this.formatActionForDisplay(chosenAction)}`);

    try {
      // Send the bot's action
      const botEvents = await this.botClient.getEvents(this.gameId, this.botToken, 0);
      await this.botClient.sendAction(this.gameId, this.botToken, botEvents?.length || 0, chosenAction);

      this.gameLogger.log('✅ Bot action sent successfully');

      // Give human player a moment to see what the bot did
      await this.sleep(1500);
    } catch (error) {
      this.logger.error('Failed to send bot action', error as Error);
      this.display.displayError(`Bot failed to send action: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private formatActionForDisplay(action: GameAction): string {
    switch (action.type) {
      case 'PlayCard':
        return `Play ${action.card}`;
      case 'ChooseSignatureCards':
        return `Choose signature cards: ${action.cards.map(([_, card]) => card).join(', ')}`;
      case 'StartNewRound':
        return 'Start new round';
      case 'ChooseWhosFirst':
        return `Choose player ${action.player_idx + 1} to go first`;
      case 'Recruit':
        return `Recruit ${action.army_card}`;
      case 'Rally':
        return `Rally ${action.army_card}`;
      case 'Exhaust':
        return `Exhaust ${action.army_card}`;
      case 'Unexhaust':
        return `Recall ${action.army_card}`;
      default:
        return JSON.stringify(action);
    }
  }

  private updateDisplay(): void {
    this.display.clear();
    this.display.displayTitle();
    this.display.displayGameInfo(this.gameId, this.gameState.getMyPlayerIndex());

    const board = this.gameState.getCurrentBoard();
    const status = this.gameState.getCurrentStatus();
    const messages = this.gameState.getMessages();

    if (status) {
      this.display.displayStatus(this.gameState.getStatusDescription());
    }

    if (messages.length > 0) {
      this.display.displayMessages(messages);
    }

    if (board) {
      this.display.displayGameBoard(board);
    }

    const actions = this.gameState.getPossibleActions();
    if (actions.length > 0) {
      this.display.displayActions(actions);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop(): void {
    this.isRunning = false;
  }
}

// Main execution
async function main(): Promise<void> {
  const test = new HumanVsBotTest();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    test.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down gracefully...');
    test.stop();
    process.exit(0);
  });

  await test.runHumanVsBotTest();
}

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
