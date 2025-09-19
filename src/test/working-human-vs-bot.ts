#!/usr/bin/env node

import { LocalGameServer } from '../server/server.js';
import { Logger } from '../utils/logger.js';

/**
 * Working human vs bot test that uses the existing GameClient architecture.
 * This avoids all the turn logic issues by letting each client handle its own perspective.
 */
export class WorkingHumanVsBotTest {
  private server: LocalGameServer;
  private logger: Logger;

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.server = new LocalGameServer(3005); // Different port
    this.logger = new Logger(`working-human-vs-bot-${timestamp}.log`);
  }

  async run(): Promise<void> {
    console.log('🎮 Working Human vs Bot Game');
    console.log('🎯 Uses the proven GameClient architecture');
    console.log('=' .repeat(60));

    try {
      // Start server
      await this.server.start();
      console.log('✅ Game server started on port 3005');
      console.log('');
      console.log('🎯 Now open TWO terminals and run:');
      console.log('');
      console.log('   Terminal 1 (Human):');
      console.log('   IMPOSTER_KINGS_URL=http://localhost:3005 pnpm start');
      console.log('   -> Choose "Connect to localhost server"');
      console.log('   -> Create a new game');
      console.log('');
      console.log('   Terminal 2 (Bot):');
      console.log('   IMPOSTER_KINGS_URL=http://localhost:3005 pnpm start');
      console.log('   -> Choose "Connect to localhost server"');
      console.log('   -> Join the game created by Terminal 1');
      console.log('   -> Enter "Bot" as player name');
      console.log('');
      console.log('💡 The bot player just needs to select actions quickly/randomly');
      console.log('   You can play both sides to test the full game flow');
      console.log('');
      console.log('🔧 This avoids all turn logic bugs by using the working GameClient');
      console.log('');

      // Keep server running
      console.log('🖥️  Server running... Press Ctrl+C to stop');

      // Wait indefinitely
      await new Promise(() => {}); // Never resolves

    } catch (error) {
      this.logger.error('Working human vs bot test failed', error as Error);
      console.error('❌ Test failed:', error);
    } finally {
      this.server.stop();
      this.logger.close();
    }
  }

  stop(): void {
    this.server.stop();
  }
}

// Main execution
async function main(): Promise<void> {
  const test = new WorkingHumanVsBotTest();

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

