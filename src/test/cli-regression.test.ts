import { TestableGameClient, createRegressionTestConfig } from '../ui/testable.js';
import { Logger } from '../utils/logger.js';

export class CLIRegressionTest {
  private logger: Logger;
  private gameLogger: Logger;

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logger = new Logger(`cli-regression-${timestamp}.log`);
    this.gameLogger = new Logger(`cli-game-replay-${timestamp}.log`);
  }

  async runCLIRegressionTest(): Promise<void> {
    console.log('🧪 Running CLI Regression Test: Calm vs melissa (Multi-round Game)');
    console.log('=' .repeat(80));

    try {
      // Parse the deterministic hands from the game log
      const deterministicHands = this.parseSetupInformation();

      // Convert the game actions to key inputs
      const testInputs = this.convertGameActionsToKeyInputs();

      // Create testable UI config
      const config = createRegressionTestConfig(
        ['Calm', 'melissa'],
        testInputs,
        deterministicHands
      );

      // Create and run testable client
      const testClient = new TestableGameClient(config);
      await testClient.runTest();

      console.log('🎉 CLI Regression test completed!');

    } catch (error) {
      this.logger.error('CLI Regression test failed', error as Error);
      console.error('❌ CLI Regression test failed:', error);
    } finally {
      this.logger.close();
      this.gameLogger.close();
    }
  }

  private parseSetupInformation(): any {
    // This mirrors the logic from regression2.test.ts but simplified
    const deterministicHands = {
      // Round 1
      calm: ['Soldier', 'Fool', 'Princess', 'Mystic', 'Elder', 'Oathbound', 'Inquisitor', 'Soldier', 'Warlord'],
      katto: ['Judge', 'Immortal', 'KingsHand', 'Warden', 'Zealot', 'Oathbound', 'Queen', 'Inquisitor', 'Sentry'],
      accused: 'Assassin',

      // Round 2
      round2Calm: ['Judge', 'Inquisitor', 'Assassin', 'Elder', 'Sentry', 'Princess', 'Elder', 'Queen', 'Warlord'],
      round2Melissa: ['Warden', 'Mystic', 'Oathbound', 'Inquisitor', 'Soldier', 'Fool', 'Oathbound', 'Zealot', 'Soldier'],
      round2Accused: 'KingsHand',

      // Round 3
      round3Calm: ['KingsHand', 'Immortal', 'Assassin', 'Inquisitor', 'Warden', 'Oathbound', 'Inquisitor', 'Soldier', 'Queen'],
      round3Melissa: ['Princess', 'Warlord', 'Sentry', 'Mystic', 'Fool', 'Elder', 'Zealot', 'Judge', 'Oathbound'],
      round3Accused: 'Soldier',

      // Round 4
      round4Calm: ['Fool', 'Warden', 'Mystic', 'Elder', 'Inquisitor', 'Judge', 'Sentry', 'KingsHand', 'Immortal'],
      round4Melissa: ['Zealot', 'Elder', 'Soldier', 'Assassin', 'Inquisitor', 'Soldier', 'Oathbound', 'Oathbound', 'Warlord'],
      round4Accused: 'Queen',

      // Round 5
      round5Calm: ['Immortal', 'Assassin', 'KingsHand', 'Inquisitor', 'Warden', 'Fool', 'Zealot', 'Warlord', 'Soldier'],
      round5Melissa: ['Oathbound', 'Inquisitor', 'Mystic', 'Soldier', 'Elder', 'Elder', 'Sentry', 'Oathbound', 'Judge'],
      round5Accused: 'Princess',
    };

    this.gameLogger.log('Set up deterministic hands for CLI test');
    return deterministicHands;
  }

  private convertGameActionsToKeyInputs(): string[] {
    // This is a simplified version that converts the game actions to key inputs
    // In a full implementation, this would parse the entire game log and convert each action
    const inputs: string[] = [];

    // Signature card selection phase
    // Calm chooses Aegis, Ancestor, Exile
    inputs.push('return'); // Select first signature card option

    // melissa chooses Stranger, Ancestor, Conspiracist
    inputs.push('return'); // Select first signature card option

    // Muster phase actions
    inputs.push('return'); // End muster for melissa
    inputs.push('return'); // End muster for Calm

    // Discard phase
    inputs.push('return'); // Calm discards first card
    inputs.push('return'); // Calm picks successor
    inputs.push('return'); // melissa discards first card
    inputs.push('return'); // melissa picks successor

    // Regular play phase - simplified to just pressing enter for each action
    for (let i = 0; i < 50; i++) {
      inputs.push('return'); // Generic action selection
    }

    this.gameLogger.log(`Generated ${inputs.length} test inputs`);
    return inputs;
  }

  // Method to run a stepped test for debugging
  async runSteppedCLITest(): Promise<void> {
    console.log('🔍 Running Stepped CLI Test for Debugging');

    try {
      const deterministicHands = this.parseSetupInformation();
      const config = createRegressionTestConfig(
        ['Calm', 'melissa'],
        [], // No pre-defined inputs for stepped test
        deterministicHands
      );

      const testClient = new TestableGameClient(config);

      // Define specific steps to test
      const debugSteps = [
        'return', // Select signature cards
        'return', // End muster
        'return', // Discard
        'return', // Play first card
      ];

      await testClient.runSteppedTest(debugSteps);

      console.log('🎉 Stepped CLI test completed!');

    } catch (error) {
      this.logger.error('Stepped CLI test failed', error as Error);
      console.error('❌ Stepped CLI test failed:', error);
    }
  }
}

// Run CLI regression test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const test = new CLIRegressionTest();

  // Check if stepped test is requested
  if (process.argv.includes('--stepped')) {
    test.runSteppedCLITest().catch(console.error);
  } else {
    test.runCLIRegressionTest().catch(console.error);
  }
}
