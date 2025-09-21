#!/usr/bin/env node

/**
 * CLI UI Regression Test - Full Implementation
 *
 * This test demonstrates the complete CLI UI testing system with:
 * 1. Tmux session management with multiple windows
 * 2. Server and client coordination
 * 3. Exact scenario playback from regression2.test.ts
 * 4. Real-time game state monitoring
 * 5. Final score verification
 *
 * Problem: Create a comprehensive CLI UI test that plays out the exact scenario
 * from regression2.test.ts using testable CLI and tmux coordination.
 *
 * Solution:
 * - Start tmux session with server, Calm, and melissa windows
 * - Launch appropriate software in each window
 * - Play out the exact game scenario
 * - Verify server computes correct point win (7:5 Calm:melissa)
 */

import { CLIRegressionTmuxTest } from './test/cli-regression-tmux.test.js';
import { Logger } from './utils/logger.js';

class CLIFullRegressionTest {
  private logger: Logger;
  private tmuxTest: CLIRegressionTmuxTest;

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logger = new Logger(`cli-full-regression-${timestamp}.log`);
    this.tmuxTest = new CLIRegressionTmuxTest();
  }

  async runFullTest(): Promise<void> {
    console.log('🚀 CLI UI Full Regression Test');
    console.log('=' .repeat(80));
    console.log('This test will:');
    console.log('1. 🎯 Start a tmux session with 3 windows (server, Calm, melissa)');
    console.log('2. 🖥️ Launch appropriate software in each window');
    console.log('3. 🎮 Play out the EXACT scenario from regression2.test.ts');
    console.log('4. ✅ Verify the server computes correct final score (7:5)');
    console.log('');
    console.log('Press Ctrl+C at any time to stop the test gracefully.');
    console.log('=' .repeat(80));

    try {
      await this.tmuxTest.runRegressionTest();

      console.log('');
      console.log('🎉 SUCCESS: CLI UI regression test completed!');
      console.log('   - All tmux windows created and managed');
      console.log('   - Server started and game created');
      console.log('   - CLI clients launched and coordinated');
      console.log('   - Exact scenario executed successfully');
      console.log('   - Final score verified: Calm 7 - melissa 5');

    } catch (error) {
      console.log('');
      console.error('❌ FAILURE: CLI UI regression test failed');
      console.error('   Error:', error);
      this.logger.error('Full test failed', error as Error);
      process.exitCode = 1;
    } finally {
      this.logger.close();
    }
  }

  async runWithVisualization(): Promise<void> {
    console.log('🎬 CLI UI Regression Test with Visualization');
    console.log('=' .repeat(80));
    console.log('This will show you the CLI interfaces in real-time!');
    console.log('');

    console.log('📋 Test Setup:');
    console.log('   • Server window: Game server running');
    console.log('   • Calm window: First player CLI interface');
    console.log('   • melissa window: Second player CLI interface');
    console.log('');
    console.log('🎯 You should see DOS-style interfaces appearing in tmux windows');
    console.log('💡 Watch as inputs are sent to coordinate the exact game scenario');
    console.log('');

    // Add visual delay to show the interfaces
    await new Promise(resolve => setTimeout(resolve, 3000));

    await this.runFullTest();
  }

  async runDebugMode(): Promise<void> {
    console.log('🔍 CLI UI Regression Test - Debug Mode');
    console.log('=' .repeat(80));
    console.log('This mode will pause between major steps for inspection.');
    console.log('');

    try {
      // Create tmux session
      console.log('Step 1: Creating tmux session...');
      await this.tmuxTest['createTmuxSession']();
      console.log('✅ Tmux session created');
      await this.waitForKey();

      // Start server
      console.log('Step 2: Starting server...');
      await this.tmuxTest['startServer']();
      await this.waitForKey();

      // Wait for server
      console.log('Step 3: Waiting for server to be ready...');
      await this.tmuxTest['waitForServer'](5000);
      console.log('✅ Server ready');
      await this.waitForKey();

      // Setup game
      console.log('Step 4: Setting up game...');
      await this.tmuxTest['setupGame']();
      console.log('✅ Game setup complete');
      await this.waitForKey();

      // Start CLI clients
      console.log('Step 5: Starting CLI clients...');
      await this.tmuxTest['startCLIClients']();
      console.log('✅ CLI clients started');
      await this.waitForKey();

      // Execute scenario
      console.log('Step 6: Executing game scenario...');
      await this.tmuxTest['executeExactScenario']();
      console.log('✅ Scenario executed');
      await this.waitForKey();

      // Verify score
      console.log('Step 7: Verifying final score...');
      await this.tmuxTest['verifyFinalScore']();
      console.log('✅ Score verified');
      await this.waitForKey();

      console.log('🎉 Debug test completed successfully!');

    } catch (error) {
      console.error('❌ Debug test failed:', error);
    } finally {
      await this.tmuxTest['cleanup']();
    }
  }

  private async waitForKey(): Promise<void> {
    console.log('Press Enter to continue...');
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);

  console.log('🎮 Imposter Kings - CLI UI Regression Test Suite');
  console.log('=' .repeat(80));

  if (args.includes('--debug')) {
    console.log('Mode: Debug (step-by-step with pauses)');
    const test = new CLIFullRegressionTest();
    await test.runDebugMode();
  } else if (args.includes('--visual')) {
    console.log('Mode: Visual (watch interfaces in real-time)');
    const test = new CLIFullRegressionTest();
    await test.runWithVisualization();
  } else {
    console.log('Mode: Standard (automated execution)');
    const test = new CLIFullRegressionTest();
    await test.runFullTest();
  }

  console.log('');
  console.log('💡 Tips:');
  console.log('   • Use --debug to step through the test manually');
  console.log('   • Use --visual to see CLI interfaces in real-time');
  console.log('   • Check log files in the root directory for details');
  console.log('   • All tmux sessions are automatically cleaned up');
}

// Export for use in other modules
export { CLIFullRegressionTest };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
