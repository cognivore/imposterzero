import { GameClient } from '../game/client.js';
import { MinimalGameServer } from '../server/minimal-server.js';
import { Logger } from '../utils/logger.js';
import type { GameAction, GameEvent } from '../types/game.js';

export interface TestableUIConfig {
  testInputs: string[];
  playerNames: [string, string];
  deterministicHands?: any;
  port?: number;
  introspectionMode?: boolean;
  gameScenario?: GameAction[]; // For scenario-based testing
}

export class TestableGameClient {
  private client: GameClient;
  private server: MinimalGameServer;
  private logger: Logger;
  private config: TestableUIConfig;

  constructor(config: TestableUIConfig) {
    this.config = config;
    this.logger = new Logger(`testable-cli-${Date.now()}.log`);

    // Create server on specified port
    const port = config.port || 3003;
    this.server = new MinimalGameServer(port);

    // Create client with test mode enabled
    this.client = new GameClient({
      testMode: true,
      testInputs: config.testInputs,
      playerNames: config.playerNames,
      introspectionMode: config.introspectionMode || false
    });

    // Set up deterministic hands if provided
    if (config.deterministicHands) {
      this.client.enableDeterministicMode(config.deterministicHands);
    }
  }

  async runTest(): Promise<void> {
    this.logger.log('Starting testable UI client');

    try {
      // Start server
      await this.server.start();
      this.logger.log(`Test server started on port ${this.config.port || 3003}`);

      // Get the actual port the server is running on
      const serverPort = this.server.getPort();

      // Create test game with the actual server port
      this.client.setServerPort(serverPort);
      await this.client.createTestGame(
        this.config.playerNames[0],
        this.config.playerNames[1],
        serverPort
      );

      // Start the client (this will run the game with test inputs)
      await this.client.start();

      this.logger.log('Test completed successfully');

    } catch (error) {
      this.logger.error('Test failed', error as Error);
      throw error;
    } finally {
      this.server.stop();
      this.client.stop();
      this.logger.close();
    }
  }

  // For visual testing: run with delays to show CLI flashing
  async runVisualTest(): Promise<void> {
    this.logger.log('Starting visual test with delays');

    try {
      await this.server.start();
      this.logger.log(`Visual test server started on port ${this.config.port || 3003}`);

      // Wait for server to be fully ready
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Get the actual port the server is running on
      const serverPort = this.server.getPort();

      // Create test game with the actual server port
      this.client.setServerPort(serverPort);
      await this.client.createTestGame(
        this.config.playerNames[0],
        this.config.playerNames[1],
        serverPort
      );

      console.log('🎮 Starting CLI client...');
      console.log('You should see the DOS-style interface appear below:');
      console.log('');

      // Start the client - this will show the UI
      await this.client.start();

      console.log('');
      console.log('✅ CLI test completed successfully!');
      console.log('The interface should have been visible above during the test.');

    } catch (error) {
      this.logger.error('Visual test failed', error as Error);
      throw error;
    } finally {
      this.server.stop();
      this.client.stop();
      this.logger.close();
    }
  }

  // For advanced testing: step through actions one by one
  async runSteppedTest(actions: string[]): Promise<void> {
    this.logger.log('Starting stepped test');

    try {
      await this.server.start();
      await this.client.createTestGame(
        this.config.playerNames[0],
        this.config.playerNames[1]
      );

      // Enable test mode with empty inputs initially
      this.client.enableTestMode([]);

      // Simulate actions one by one
      for (const action of actions) {
        this.logger.log(`Simulating action: ${action}`);
        this.client.simulateInput(action);

        // Small delay to let the UI process
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      this.logger.log('Stepped test completed');

    } catch (error) {
      this.logger.error('Stepped test failed', error as Error);
      throw error;
    } finally {
      this.server.stop();
      this.client.stop();
      this.logger.close();
    }
  }

  // Get test results and logs
  getTestResults(): {
    success: boolean;
    logs: string[];
    errors: string[];
  } {
    // This would be implemented to extract results from the logger
    return {
      success: true,
      logs: [],
      errors: []
    };
  }

  // For advanced testing: generate intelligent inputs based on game state
  async generateIntelligentInputs(scenario?: GameAction[]): Promise<string[]> {
    const inputs: string[] = [];

    try {
      // Wait for client to start and get initial state
      await new Promise(resolve => setTimeout(resolve, 1000));

      let gameComplete = false;
      let moveCount = 0;

      while (!gameComplete && moveCount < 100) { // Prevent infinite loops
        moveCount++;

        // Get current introspection state
        const state = this.client.getIntrospectionState();

        if (state.currentStatus.includes('GameOver')) {
          gameComplete = true;
          this.logger.log('Game completed successfully');
          break;
        }

        // Get available actions
        const availableActions = this.client.getAvailableActions();

        if (availableActions.length === 0) {
          // No actions available, wait a bit
          await new Promise(resolve => setTimeout(resolve, 200));
          continue;
        }

        // Choose an action (for now, just pick the first one)
        const chosenAction = scenario && scenario.length > 0 ?
          scenario.shift()! : availableActions[0];

        // Generate inputs for this action
        const actionInputs = this.client.getKeyInputsForAction(chosenAction);

        if (actionInputs.length > 0) {
          inputs.push(...actionInputs);
          this.logger.log(`Generated inputs for action: ${chosenAction.type}`);
        } else {
          // If no specific inputs needed, add a generic selection
          inputs.push('return');
        }

        // Small delay between actions
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      this.logger.log(`Generated ${inputs.length} intelligent inputs`);
      return inputs;

    } catch (error) {
      this.logger.error('Failed to generate intelligent inputs', error as Error);
      return [];
    }
  }

  // For testing: get current game state introspection
  getGameState(): {
    availableActions: GameAction[];
    currentStatus: string;
    playerIndex: number;
  } {
    return this.client.getIntrospectionState();
  }

  // For testing: execute a specific scenario
  async executeScenario(scenario: GameAction[]): Promise<boolean> {
    this.logger.log('Starting scenario execution');

    try {
      const inputs = await this.generateIntelligentInputs(scenario);

      // Enable test mode with generated inputs
      this.client.enableTestMode(inputs);

      // Start the client
      await this.client.start();

      return true;
    } catch (error) {
      this.logger.error('Scenario execution failed', error as Error);
      return false;
    }
  }
}

// Helper function to create common test scenarios
export function createRegressionTestConfig(
  playerNames: [string, string],
  testInputs: string[],
  deterministicHands: any
): TestableUIConfig {
  return {
    testInputs,
    playerNames,
    deterministicHands,
    port: 3004 // Use different port for regression tests
  };
}
