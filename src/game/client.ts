import { ImposterKingsAPIClient } from '../api/client.js';
import { GameState } from './state.js';
import { GameUI, GameUIConfig } from '../ui/gameui.js';
import { Logger } from '../utils/logger.js';
import type { GameAction, GameEvent, CardName } from '../types/game.js';

export class GameClient {
  private api: ImposterKingsAPIClient | undefined;
  private state: GameState;
  private ui: GameUI;
  private logger: Logger;
  private gameId: number = 0;
  private playerToken: string = '';
  private joinToken: string = '';
  private isRunning: boolean = false;
  private isLocalMode: boolean = false;
  private serverPort: number = 3003;
  private introspectionState: {
    availableActions: GameAction[];
    currentStatus: string;
    playerIndex: number;
  } | null = null;

  constructor(config: GameUIConfig = {}) {
    this.state = new GameState();
    this.ui = new GameUI(config);
    this.logger = new Logger();
  }

  async start(): Promise<void> {
    await this.ui.start();

    try {
      // For now, just connect to localhost in test mode
      await this.connectToLocalhost();

      if (this.gameId && this.playerToken) {
        await this.runGameLoop();
      }
    } catch (error) {
      this.logger.error('Failed to start game client', error as Error);
      throw error; // Re-throw so the test can handle it properly
    } finally {
      this.ui.shutdown();
    }
  }

  stop(): void {
    this.isRunning = false;
    this.ui.shutdown();
  }

  setServerPort(port: number): void {
    this.serverPort = port;
    // Create the API client with the correct port
    this.api = new ImposterKingsAPIClient(`http://localhost:${port}`);
  }

  private ensureApiClient(): ImposterKingsAPIClient {
    if (!this.api) {
      this.api = new ImposterKingsAPIClient(`http://localhost:${this.serverPort}`);
    }
    return this.api;
  }

  private async connectToLocalhost(): Promise<void> {
    // Ensure API client is created with correct port
    const api = this.ensureApiClient();
    this.isLocalMode = true;

    // For testing, create a game with predetermined settings
    const playerName = 'Human Player';

    const createResponse = await api.createGame({ player_name: playerName });
    this.gameId = createResponse.game_id;
    this.joinToken = createResponse.player_token;

    const joinResponse = await api.joinGame({
      game_id: this.gameId,
      join_token: this.joinToken,
      player_name: playerName
    });
    this.playerToken = joinResponse.player_token;

    // Set player names for UI
    this.ui.setPlayerNames([playerName, 'Bot Player']);

    this.logger.log(`Connected to localhost game ${this.gameId}`);
  }

  // Create a game with specific player names for testing
  async createTestGame(player1Name: string, player2Name: string, port?: number): Promise<void> {
    if (port !== undefined) {
      this.serverPort = port;
    }
    // Ensure API client is created with correct port
    const api = this.ensureApiClient();
    this.isLocalMode = true;

    const createResponse = await api.createGame({ player_name: player1Name });
    this.gameId = createResponse.game_id;
    this.joinToken = createResponse.player_token;

    const joinResponse = await api.joinGame({
      game_id: this.gameId,
      join_token: this.joinToken,
      player_name: player1Name
    });
    this.playerToken = joinResponse.player_token;

    // Set player names for UI
    this.ui.setPlayerNames([player1Name, player2Name]);

    this.logger.log(`Created test game ${this.gameId} with players ${player1Name} vs ${player2Name}`);
  }

  private async runGameLoop(): Promise<void> {
    this.isRunning = true;
    let lastEventCount = 0;

    while (this.isRunning) {
      try {
        // Get latest events
        const events = await this.api.getEvents(this.gameId, this.playerToken, lastEventCount);

        if (events.length > lastEventCount) {
          // Process new events
          for (let i = lastEventCount; i < events.length; i++) {
            await this.processEvent(events[i]);
          }
          lastEventCount = events.length;
        }

        // Check if it's our turn and we have actions
        const gameState = events.filter(e => e.type === 'NewState').pop();
        if (gameState && gameState.type === 'NewState') {
          // Update our internal state (simplified for now)
          // this.state.updateFromBoard(gameState.board, gameState.status, gameState.actions);

          // If we have available actions, show the UI and wait for player input
          if (gameState.actions.length > 0) {
            const selectedAction = await this.ui.displayGameAndWaitForAction(
              gameState.board,
              gameState.actions,
              gameState.board.player_idx
            );

            if (selectedAction) {
              await this.api.sendAction(this.gameId, this.playerToken, events.length, selectedAction);
            }
          }
        }

        // Check for game over - look in messages or status
        const gameOverMessage = events.find(e =>
          e.type === 'Message' && e.message.type === 'GameOver'
        );
        const gameOverStatus = events.find(e =>
          e.type === 'NewState' && e.status.type === 'GameOver'
        );

        if (gameOverMessage || gameOverStatus) {
          this.isRunning = false;
          break;
        }

        // Small delay to prevent busy waiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        this.logger.error('Error in game loop', error as Error);
        console.error('Game loop error:', error);
        break;
      }
    }
  }

  private async processEvent(event: GameEvent): Promise<void> {
    this.logger.log(`Processing event: ${event.type}`);

    switch (event.type) {
      case 'NewState':
        // Update our internal state (simplified for now)
        // this.state.updateFromBoard(event.board, event.status, event.actions);
        break;

      case 'Message':
        if (event.message.type === 'GameOver') {
          this.logger.log(`Game over! Final score: ${event.message.points.join('-')}`);
        }
        break;

      default:
        // Handle other event types as needed
        break;
    }
  }

  // For testing: enable deterministic mode
  enableDeterministicMode(hands: any): void {
    (global as any).regressionTestHands = hands;
  }

  // For testing: enable test mode with predetermined inputs
  enableTestMode(inputs: string[]): void {
    this.ui.enableTestMode(inputs);
  }

  // For testing: simulate input
  simulateInput(input: string): void {
    this.ui.simulateInput(input);
  }

  // For testing: get introspection state
  getIntrospectionState(): {
    availableActions: GameAction[];
    currentStatus: string;
    playerIndex: number;
  } {
    const uiState = this.ui.getIntrospectionState();

    return {
      availableActions: this.ui.getAvailableActions(),
      currentStatus: uiState.currentStatus,
      playerIndex: uiState.playerIndex
    };
  }

  // For testing: get available actions
  getAvailableActions(): GameAction[] {
    return this.ui.getAvailableActions();
  }

  // For testing: get key inputs for action
  getKeyInputsForAction(action: GameAction): string[] {
    return this.ui.getKeyInputsForAction(action);
  }
}
