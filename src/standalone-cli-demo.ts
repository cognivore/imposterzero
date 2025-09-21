#!/usr/bin/env node

import { GameClient } from './game/client.js';

async function runStandaloneCLIDemo(): Promise<void> {
  console.log('🎮 STANDALONE CLI DEMO - No Server Required');
  console.log('=' .repeat(50));
  console.log('This demo shows the CLI interface working independently.');
  console.log('It will display the DOS-style interface and allow interaction.');
  console.log('');
  console.log('The interface will show:');
  console.log('  • DOS-style box-drawn layout');
  console.log('  • Game board with cards and court');
  console.log('  • Side panel with card information');
  console.log('  • Status bar with navigation instructions');
  console.log('  • Card selection dialogs when you press Enter');
  console.log('');
  console.log('Press Ctrl+C to exit');
  console.log('');

  try {
    // Create client with standalone mode
    const client = new GameClient({
      testMode: false,
      playerNames: ['Alice', 'Bob']
    });

    console.log('🎯 Starting CLI interface...');
    console.log('You should see the DOS-style interface below:');
    console.log('');

    // Start the client
    await client.start();

  } catch (error) {
    console.error('❌ Standalone CLI demo failed:', error);
    console.log('');
    console.log('This might be due to server connection issues.');
    console.log('Try the interactive demo instead:');
    console.log('  pnpm run demo:cli');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Standalone CLI demo ended by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Standalone CLI demo ended by system');
  process.exit(0);
});

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runStandaloneCLIDemo().catch(console.error);
}
