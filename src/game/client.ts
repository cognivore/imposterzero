import { ImposterKingsAPIClient } from '../api/client.js';
import { GameState } from './state.js';
import { GameDisplay } from '../ui/display.js';
import { GamePrompts } from '../ui/prompts.js';
import type { GameAction, GameEvent, CardName } from '../types/game.js';

export class GameClient {
  private api: ImposterKingsAPIClient;
  private state: GameState;
  private display: GameDisplay;
  private prompts: GamePrompts;
  private gameId: number = 0;
  private playerToken: string = '';
  private isRunning: boolean = false;

  constructor() {
    this.api = new ImposterKingsAPIClient();
    this.state = new GameState();
    this.display = new GameDisplay();
    this.prompts = new GamePrompts();
  }

  async start(): Promise<void> {
    this.display.clear();
    this.display.displayTitle();

    try {
      const action = await this.prompts.promptMainMenu();

      switch (action) {
        case 'create':
          await this.createGame();
          break;
        case 'join':
          await this.joinGame();
          break;
        case 'quit':
          console.log('Goodbye!');
          return;
      }

      if (this.gameId && this.playerToken) {
        await this.runGameLoop();
      }
    } catch (error) {
      this.display.displayError(`Failed to start: ${error instanceof Error ? error.message : 'Unknown error'}`);

      if (await this.prompts.promptRetry()) {
        await this.start();
      }
    }
  }

  private async createGame(): Promise<void> {
    const playerName = await this.prompts.promptPlayerName();

    this.display.displayInfo('Creating game...');
    const response = await this.api.createGame({ player_name: playerName });

    this.gameId = response.game_id;
    this.playerToken = response.player_token;

    this.display.displaySuccess(`Game created! Game ID: ${this.gameId}`);
    this.display.displayInfo(`Share this with your opponent:`);
    this.display.displayInfo(`  Game ID: ${this.gameId}`);
    this.display.displayInfo(`  Join Token: ${this.playerToken}`);
    this.display.displayInfo('Waiting for opponent to join...');

    // Wait for game to start
    await this.waitForGameStart();
  }

  private async joinGame(): Promise<void> {
    const gameId = await this.prompts.promptGameId();
    const joinToken = await this.prompts.promptJoinToken();
    const playerName = await this.prompts.promptPlayerName();

    this.display.displayInfo('Joining game...');
    const response = await this.api.joinGame({
      game_id: gameId,
      join_token: joinToken,
      player_name: playerName,
    });

    this.gameId = gameId;
    this.playerToken = response.player_token;

    this.display.displaySuccess(`Joined game ${gameId}!`);

    // Wait for game to start
    await this.waitForGameStart();
  }

  private async waitForGameStart(): Promise<void> {
    let gameStatus = await this.api.getGameStatus(this.gameId, this.playerToken);

    if (!gameStatus) {
      throw new Error('Failed to get game status');
    }

    // Set player names
    const playerNames: [string, string] = ['Player 1', 'Player 2'];
    gameStatus.players.forEach((player, index) => {
      if (player && player.type === 'Human') {
        playerNames[index] = player.name;
      } else if (player && player.type === 'Bot') {
        playerNames[index] = 'Bot';
      }
    });

    this.state.setPlayerNames(playerNames);
    this.display.setPlayerNames(playerNames);

    // If there's an empty slot, offer to add a bot
    const emptySlots = gameStatus.players.filter(p => p === null).length;
    if (emptySlots > 0) {
      const addBot = await this.prompts.promptAddBot();
      if (addBot) {
        try {
          await this.api.addBot(this.gameId, this.playerToken);
          this.display.displaySuccess('Bot added to the game!');
        } catch (error) {
          this.display.displayError(`Failed to add bot: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // Poll for game start
    while (!gameStatus.started) {
      this.display.displayWaiting();
      await this.sleep(2000);

      const newStatus = await this.api.getGameStatus(this.gameId, this.playerToken, gameStatus.version_number);
      if (newStatus) {
        gameStatus = newStatus;
      }
    }

    this.display.displaySuccess('Game started!');
  }

  private async runGameLoop(): Promise<void> {
    this.isRunning = true;
    let eventIndex = 0;

    try {
      while (this.isRunning) {
        // Get new events
        const events = await this.api.getEvents(this.gameId, this.playerToken, eventIndex);

        if (events.length > 0) {
          // Process events
          this.state.processEvents(events);
          eventIndex += events.length;

          // Update display
          this.updateDisplay();

          // Check if game is over
          if (this.state.isGameOver()) {
            const score = this.state.getGameOverScore();
            if (score) {
              this.display.displayGameOver(score, this.state.getMyPlayerIndex());
            }
            break;
          }

          // Handle player actions if it's their turn
          if (this.state.isMyTurn()) {
            await this.handlePlayerTurn();
          }
        } else {
          // No new events, wait a bit
          await this.sleep(1000);
        }
      }
    } catch (error) {
      this.display.displayError(`Game loop error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    this.display.displayInfo('Game ended. Thanks for playing!');
  }

  private async handlePlayerTurn(): Promise<void> {
    const actions = this.state.getPossibleActions();

    if (actions.length === 0) {
      return;
    }

    try {
      // Special handling for signature card selection
      if (this.state.canChooseSignatureCards()) {
        await this.handleSignatureCardSelection();
        return;
      }

      // General action selection
      const actionIndex = await this.prompts.promptAction(actions);

      if (actionIndex >= 0 && actionIndex < actions.length) {
        const selectedAction = actions[actionIndex];
        await this.api.sendAction(this.gameId, this.playerToken, this.state.getEventCount(), selectedAction);
        this.display.displaySuccess(`Action sent: ${selectedAction.type}`);
      }
    } catch (error) {
      this.display.displayError(`Failed to send action: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleSignatureCardSelection(): Promise<void> {
    const choices = this.state.getSignatureCardChoices();
    if (!choices) return;

    const selectedIndices = await this.prompts.promptSignatureCardSelection(choices.cards, choices.count);

    const action: GameAction = {
      type: 'ChooseSignatureCards',
      cards: selectedIndices.map(idx => [idx, choices.cards[idx].card]),
    };

    await this.api.sendAction(this.gameId, this.playerToken, this.state.getEventCount(), action);
    this.display.displaySuccess('Signature cards selected!');
  }

  private updateDisplay(): void {
    this.display.clear();
    this.display.displayTitle();
    this.display.displayGameInfo(this.gameId, this.state.getMyPlayerIndex());

    const board = this.state.getCurrentBoard();
    const status = this.state.getCurrentStatus();
    const messages = this.state.getMessages();

    if (status) {
      this.display.displayStatus(this.state.getStatusDescription());
    }

    if (messages.length > 0) {
      this.display.displayMessages(messages);
    }

    if (board) {
      this.display.displayGameBoard(board);
    }

    const actions = this.state.getPossibleActions();
    if (actions.length > 0) {
      this.display.displayActions(actions);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop(): void {
    this.isRunning = false;
  }
}
