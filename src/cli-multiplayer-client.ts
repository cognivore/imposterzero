#!/usr/bin/env node

import { GameClient } from './game/client.js';
import { Logger } from './utils/logger.js';

class MultiplayerCLIClient {
  private client: GameClient;
  private logger: Logger;
  private playerName: string;
  private isRunning: boolean = false;

  constructor(serverPort: number, gameId: number, playerToken: string, playerName: string) {
    this.playerName = playerName;
    this.logger = new Logger(`cli-client-${playerName}-${Date.now()}.log`);

    // Create client with introspection enabled
    this.client = new GameClient({
      testMode: false, // We'll control inputs programmatically
      introspectionMode: true,
      playerNames: ['Calm', 'melissa']
    });

    // Set up the connection
    this.client.setServerPort(serverPort);

    // Override the game ID and token for this specific game
    (this.client as any).gameId = gameId;
    (this.client as any).playerToken = playerToken;

    this.logger.log(`Created multiplayer CLI client for ${playerName}`);
  }

  async start(): Promise<void> {
    this.logger.log(`Starting ${this.playerName} client`);
    this.isRunning = true;

    try {
      // Start the client (this will run the game loop)
      await this.client.start();

      this.logger.log(`${this.playerName} client completed successfully`);

    } catch (error) {
      this.logger.error(`${this.playerName} client failed`, error as Error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  // Method to receive external input (for tmux testing)
  async receiveInput(input: string): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.log(`Received input for ${this.playerName}: ${input}`);
    this.client.simulateInput(input);
  }

  // Method to get current game state for introspection
  getGameState() {
    return this.client.getIntrospectionState();
  }

  // Method to check if client is ready for input
  isReady(): boolean {
    const state = this.getGameState();
    return state.availableActions.length > 0;
  }

  // Method to stop the client
  stop(): void {
    this.isRunning = false;
    this.client.stop();
    this.logger.close();
  }
}

// CLI entry point for multiplayer testing
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.error('Usage: cli-multiplayer-client.js <serverPort> <gameId> <playerToken> <playerName>');
    process.exit(1);
  }

  const [serverPort, gameId, playerToken, playerName] = args;
  const port = parseInt(serverPort);
  const game = parseInt(gameId);

  if (isNaN(port) || isNaN(game)) {
    console.error('Invalid port or game ID');
    process.exit(1);
  }

  console.log(`🎮 Starting ${playerName} CLI client...`);
  console.log(`   Server: localhost:${port}`);
  console.log(`   Game: ${game}`);
  console.log(`   Token: ${playerToken.substring(0, 10)}...`);
  console.log('');

  const client = new MultiplayerCLIClient(port, game, playerToken, playerName);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n🛑 Shutting down ${playerName} client...`);
    client.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log(`\n🛑 Shutting down ${playerName} client...`);
    client.stop();
    process.exit(0);
  });

  try {
    await client.start();
    console.log(`\n✅ ${playerName} client finished successfully!`);
  } catch (error) {
    console.error(`❌ ${playerName} client failed:`, error);
    process.exit(1);
  }
}

// Export for use in other modules
export { MultiplayerCLIClient };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
