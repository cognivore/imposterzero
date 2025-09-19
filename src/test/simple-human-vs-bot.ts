#!/usr/bin/env node

import { LocalGameServer } from '../server/server.js';
import { GameClient } from '../game/client.js';
import { ModernBot } from '../ai/modernBot.js';
import { ImposterKingsAPIClient } from '../api/client.js';
import { Logger } from '../utils/logger.js';
import type { GameAction, GameEvent, GameBoard, GameStatus } from '../types/game.js';

/**
 * Simple human vs bot test using the existing GameClient for the human player
 * and a separate bot client for the bot player.
 */
export class SimpleHumanVsBotTest {
  private server: LocalGameServer;
  private logger: Logger;
  private botClient: ImposterKingsAPIClient;
  private bot: ModernBot;
  private gameId: number = 0;
  private botToken: string = '';
  private joinToken: string = '';

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.server = new LocalGameServer(3004); // Different port
    this.logger = new Logger(`simple-human-vs-bot-${timestamp}.log`);

    this.botClient = new ImposterKingsAPIClient('http://localhost:3004');
    this.bot = new ModernBot('Bot');
  }

  async run(): Promise<void> {
    console.log('🎮 Starting Simple Human vs Bot Game');
    console.log('🤖 You will use the regular CLI, bot will join automatically');
    console.log('=' .repeat(60));

    try {
      // Start server
      await this.server.start();
      console.log('✅ Game server started on port 3004');

      // Create a game
      const createResponse = await this.botClient.createGame({ player_name: 'Bot' });
      this.gameId = createResponse.game_id;
      this.joinToken = createResponse.player_token;

      console.log(`✅ Game created - ID: ${this.gameId}`);
      console.log(`🔗 Join token: ${this.joinToken}`);

      // Join bot to the game
      const botJoinResponse = await this.botClient.joinGame({
        game_id: this.gameId,
        join_token: this.joinToken,
        player_name: 'Bot'
      });
      this.botToken = botJoinResponse.player_token;

      console.log('✅ Bot joined the game');
      console.log('');
      console.log('🎯 Now run this command in another terminal to join as human:');
      console.log('');
      console.log(`    pnpm start`);
      console.log('');
      console.log('    Then choose "Connect to localhost server"');
      console.log(`    Use join token: ${this.joinToken}`);
      console.log('');
      console.log('🤖 Bot will play automatically once you join...');
      console.log('');

      // Start bot loop
      await this.runBotLoop();

    } catch (error) {
      this.logger.error('Simple human vs bot test failed', error as Error);
      console.error('❌ Test failed:', error);
    } finally {
      this.server.stop();
      this.logger.close();
    }
  }

  private async runBotLoop(): Promise<void> {
    let eventIndex = 0;
    let turnCount = 0;
    const maxTurns = 500;

    while (turnCount < maxTurns) {
      turnCount++;

      try {
        // Get events for bot
        const events = await this.botClient.getEvents(this.gameId, this.botToken, eventIndex);

        if (events.length === 0) {
          await this.sleep(500);
          continue;
        }

        // Process new events
        eventIndex += events.length;

        // Find latest game state
        const latestState = events.filter(e => e.type === 'NewState').pop();
        if (!latestState || latestState.type !== 'NewState') {
          await this.sleep(100);
          continue;
        }

        const board = latestState.board;
        const status = latestState.status;
        const actions = latestState.actions;

        // Check if game is over
        if (status.type === 'GameOver') {
          console.log('🎉 Game Over!');
          console.log(`Final Score: Player 1: ${status.points[0]}, Player 2: ${status.points[1]}`);
          break;
        }

        // Check if it's bot's turn
        // Bot is the player with this token, need to check if actions are available
        if (actions.length === 0) {
          await this.sleep(100);
          continue;
        }

        this.logger.log(`Turn ${turnCount}: Status=${status.type}, Actions=${actions.length}, Player=${board.player_idx}`);

        // Get bot action
        const chosenAction = this.bot.chooseAction(board, status, actions);

        if (!chosenAction) {
          this.logger.log(`Bot returned no action, waiting...`);
          await this.sleep(500);
          continue;
        }

        this.logger.log(`Bot action: ${JSON.stringify(chosenAction)}`);

        // Send bot action
        try {
          await this.botClient.sendAction(this.gameId, this.botToken, eventIndex, chosenAction);
          this.logger.log('✅ Bot action sent successfully');
        } catch (error) {
          this.logger.error('Failed to send bot action', error as Error);
          await this.sleep(1000);
        }

        await this.sleep(100);

      } catch (error) {
        this.logger.error(`Error in bot loop turn ${turnCount}`, error as Error);
        await this.sleep(1000);
      }
    }

    if (turnCount >= maxTurns) {
      console.log('⚠️  Bot loop reached maximum turns');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop(): void {
    this.server.stop();
  }
}

// Main execution
async function main(): Promise<void> {
  const test = new SimpleHumanVsBotTest();

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

  await test.run();
}

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

