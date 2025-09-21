#!/usr/bin/env node

import { GameClient } from './game/client.js';

async function main(): Promise<void> {
  // Create client with default configuration
  const client = new GameClient({
    playerNames: ['Human Player', 'Bot Player']
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    client.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down gracefully...');
    client.stop();
    process.exit(0);
  });

  try {
    await client.start();
  } catch (error) {
    console.error('Fatal error:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
