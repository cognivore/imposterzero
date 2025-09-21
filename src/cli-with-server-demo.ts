#!/usr/bin/env node

import { MinimalGameServer } from './server/minimal-server.js';
import { GameClient } from './game/client.js';
import { Logger } from './utils/logger.js';

async function runCLIWithServerDemo(): Promise<void> {
  console.log('🎮 CLI WITH SERVER DEMO');
  console.log('=' .repeat(50));
  console.log('This demo starts a server and then launches the CLI client.');
  console.log('You should see the DOS-style interface connecting to the server.');
  console.log('');
  console.log('Press Ctrl+C to stop both server and client');
  console.log('');

  const logger = new Logger('cli-server-demo.log');

  try {
    // Start the server first
    const server = new MinimalGameServer(3005);
    await server.start();
    console.log('✅ Server started on port 3005');

    // Wait a moment for server to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create client that connects to our server
    const client = new GameClient({
      testMode: false, // Interactive mode
      playerNames: ['Human Player', 'Bot Opponent']
    });

    // Set the server port to 3005
    client.setServerPort(3005);

    console.log('🎮 Starting CLI client...');
    console.log('The interface should appear below:');
    console.log('');

    // Start the client
    await client.start();

  } catch (error) {
    logger.error('CLI with server demo failed', error as Error);
    console.error('❌ Demo failed:', error);
  } finally {
    logger.close();
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Demo ended by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Demo ended by system');
  process.exit(0);
});

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCLIWithServerDemo().catch(console.error);
}
