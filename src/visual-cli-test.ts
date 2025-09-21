#!/usr/bin/env node

import { TestableGameClient, createRegressionTestConfig } from './ui/testable.js';

async function runVisualCLITest(): Promise<void> {
  console.log('🎬 Visual CLI Test - Watch the CLI Flash and Update!');
  console.log('=' .repeat(60));
  console.log('This will show the CLI being automatically manipulated by test inputs');
  console.log('You should see the screen flash and update as actions are performed');
  console.log('');

  try {
    // Create test configuration with visual delays
    const config = createRegressionTestConfig(
      ['Alice', 'Bob'],
      [
        'return', // Select signature cards
        'return', // Confirm signature selection
        'down',   // Navigate down
        'return', // Select next card
        'down',   // Navigate down again
        'return', // Select another card
        '1',      // Play with ability
        'down',   // Navigate
        'return', // Select action
        'down',   // Navigate
        'return', // Flip king
      ],
      {
        // Simple deterministic hands for visual test
        calm: ['Fool', 'Princess', 'Mystic', 'Elder'],
        katto: ['Warden', 'Sentry', 'Immortal', 'Judge'],
        accused: 'Assassin'
      }
    );

    console.log('🚀 Starting visual test...');
    console.log('Watch the CLI update in real-time!');
    console.log('');

    const testClient = new TestableGameClient(config);

    // Add visual delays to make the flashing more apparent
    await testClient.runVisualTest();

    console.log('');
    console.log('🎉 Visual CLI test completed!');
    console.log('✅ CLI successfully flashed and updated during automated manipulation');

  } catch (error) {
    console.error('❌ Visual CLI test failed:', error);
    console.log('');
    console.log('This might be expected if the server connection failed,');
    console.log('but the CLI framework itself should be working.');
  }
}

// Run visual test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runVisualCLITest().catch(console.error);
}
