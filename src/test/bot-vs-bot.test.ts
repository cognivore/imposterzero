import { LocalGameServer } from '../server/server.js';
import { ImposterKingsAPIClient } from '../api/client.js';
import { SimpleBot } from '../ai/bot.js';
import { Logger } from '../utils/logger.js';
import type { GameAction, GameEvent, GameBoard, GameStatus } from '../types/game.js';

export class BotVsBotTest {
  private server: LocalGameServer;
  private logger: Logger;
  private gameLogger: Logger;
  private client1: ImposterKingsAPIClient;
  private client2: ImposterKingsAPIClient;
  private bot1: SimpleBot;
  private bot2: SimpleBot;
  private gameId: number = 0;
  private player1Token: string = '';
  private player2Token: string = '';

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.server = new LocalGameServer(3002); // Different port for bot testing
    this.logger = new Logger(`bot-test-${timestamp}.log`);
    this.gameLogger = new Logger(`game-flow-${timestamp}.log`);

    this.client1 = new ImposterKingsAPIClient('http://localhost:3002');
    this.client2 = new ImposterKingsAPIClient('http://localhost:3002');

    this.bot1 = new SimpleBot('Bot1');
    this.bot2 = new SimpleBot('Bot2');
  }

  async runBotVsBotTest(): Promise<void> {
    console.log('🤖 Starting Bot vs Bot Test');
    console.log('🎯 Testing complete round with scoring validation');
    console.log('=' .repeat(60));

    try {
      // Start server
      await this.server.start();
      console.log('✅ Test server started on port 3002');

      // Setup game
      await this.setupGame();

      // Play complete round
      await this.playCompleteRound();

      console.log('🎉 Bot vs Bot test completed successfully!');

    } catch (error) {
      this.logger.error('Bot vs Bot test failed', error as Error);
      console.error('❌ Bot vs Bot test failed:', error);
    } finally {
      this.server.stop();
      this.logger.close();
      this.gameLogger.close();
    }
  }

  private async setupGame(): Promise<void> {
    this.gameLogger.log('=== GAME SETUP ===');

    // Create game
    const createResponse = await this.client1.createGame({ player_name: 'Bot1' });
    this.gameId = createResponse.game_id;
    const joinToken = createResponse.player_token;

    this.gameLogger.log(`Game created - ID: ${this.gameId}, Join Token: ${joinToken}`);

    // Join players
    const join1Response = await this.client1.joinGame({
      game_id: this.gameId,
      join_token: joinToken,
      player_name: 'Bot1'
    });
    this.player1Token = join1Response.player_token;

    const join2Response = await this.client2.joinGame({
      game_id: this.gameId,
      join_token: joinToken,
      player_name: 'Bot2'
    });
    this.player2Token = join2Response.player_token;

    this.gameLogger.log(`Players joined - Bot1: ${this.player1Token}, Bot2: ${this.player2Token}`);
    console.log(`✅ Game setup complete - ID: ${this.gameId}`);
  }

  private async playCompleteRound(): Promise<void> {
    this.gameLogger.log('=== PLAYING COMPLETE ROUND ===');

    let roundComplete = false;
    let turnCount = 0;
    const maxTurns = 100; // Safety limit

    while (!roundComplete && turnCount < maxTurns) {
      turnCount++;

      // Get current game state
      const events1 = await this.client1.getEvents(this.gameId, this.player1Token, 0);
      const events2 = await this.client2.getEvents(this.gameId, this.player2Token, 0);

      const latestState1 = events1.filter(e => e.type === 'NewState').pop();
      const latestState2 = events2.filter(e => e.type === 'NewState').pop();

      if (!latestState1 || latestState1.type !== 'NewState') {
        this.logger.error('No valid game state found');
        break;
      }

      const board = latestState1.board;
      const status = latestState1.status;
      const actions = latestState1.actions;

      this.gameLogger.log(`\n--- TURN ${turnCount} ---`);
      this.gameLogger.log(`Status: ${status.type}`);
      this.gameLogger.log(`Current Player: ${board.player_idx === 0 ? 'Bot1' : 'Bot2'}`);
      this.gameLogger.log(`Available Actions: ${actions.length}`);
      this.gameLogger.log(`Score: Bot1=${board.points[0]}, Bot2=${board.points[1]}`);

      if (board.hand.length > 0) {
        this.gameLogger.log(`Hand: ${board.hand.map(c => c.card.card).join(', ')}`);
      }

      if (board.antechamber.length > 0) {
        this.gameLogger.log(`Antechamber: ${board.antechamber.map(c => c.card.card).join(', ')}`);
      }

      if (board.court.length > 0) {
        const courtSequence = board.court.map(c => c.card.card).join(' → ');
        const throneCard = board.court[board.court.length - 1];
        this.gameLogger.log(`Court: ${courtSequence}`);
        this.gameLogger.log(`Throne: ${throneCard.card.card}`);
      }

      // Log accused card
      this.gameLogger.log(`Accused: ${board.accused.length > 0 ? board.accused[0].card.card : 'none'}`);

      // Log opponent info
      const opponentIdx = 1 - board.player_idx;
      const opponentHand = board.hands[opponentIdx];
      const opponentAntechamber = board.antechambers[opponentIdx];
      this.gameLogger.log(`Opponent Hand: ${opponentHand.length} cards`);
      if (opponentAntechamber.length > 0) {
        this.gameLogger.log(`Opponent Antechamber: ${opponentAntechamber.map(c => typeof c.card === 'object' ? c.card.card : 'hidden').join(', ')}`);
      }

      // Check for game over
      if (status.type === 'GameOver') {
        this.gameLogger.log('=== GAME OVER ===');
        this.validateGameEnd(board, status);
        roundComplete = true;
        break;
      }

      // Get bot action
      const currentBot = board.player_idx === 0 ? this.bot1 : this.bot2;
      const currentClient = board.player_idx === 0 ? this.client1 : this.client2;
      const currentToken = board.player_idx === 0 ? this.player1Token : this.player2Token;

      const chosenAction = currentBot.chooseAction(board, status, actions);

      if (!chosenAction) {
        this.logger.error(`Bot ${board.player_idx === 0 ? 'Bot1' : 'Bot2'} returned no action`);
        break;
      }

      this.gameLogger.log(`Action: ${JSON.stringify(chosenAction)}`);

      // Send action
      try {
        await currentClient.sendAction(this.gameId, currentToken, events1.length, chosenAction);
        this.gameLogger.log(`✅ Action sent successfully`);
      } catch (error) {
        this.logger.error(`Failed to send action`, error as Error);
        break;
      }

      // Wait for update
      await this.sleep(50);
    }

    if (turnCount >= maxTurns) {
      this.logger.error(`Game exceeded maximum turns (${maxTurns})`);
    }
  }

  private validateGameEnd(board: GameBoard, status: GameStatus): void {
    this.gameLogger.log('=== VALIDATING GAME END ===');

    if (status.type === 'GameOver') {
      const [score1, score2] = status.points;
      this.gameLogger.log(`Final Score: Bot1=${score1}, Bot2=${score2}`);

      // Validate scoring rules
      const winner = score1 > score2 ? 0 : 1;
      const loser = 1 - winner;
      const winnerScore = winner === 0 ? score1 : score2;

      this.gameLogger.log(`Winner: Bot${winner + 1} with ${winnerScore} points`);

      // Check if scoring follows 1+1+1 system
      if (winnerScore >= 1 && winnerScore <= 3) {
        this.gameLogger.log('✅ Score within valid range (1-3 points per round)');
        console.log(`✅ Game completed successfully! Bot${winner + 1} won with ${winnerScore} points`);
      } else {
        this.gameLogger.log(`❌ Invalid score: ${winnerScore} (should be 1-3 per round)`);
        console.log(`❌ Invalid scoring detected: ${winnerScore} points`);
      }

      // Log final game state
      this.gameLogger.log('=== FINAL GAME STATE ===');
      this.gameLogger.log(`Court: ${board.court.map(c => c.card.card).join(' → ')}`);
      this.gameLogger.log(`Bot1 Hand: ${board.hands[0].length} cards`);
      this.gameLogger.log(`Bot2 Hand: ${board.hands[1].length} cards`);
      this.gameLogger.log(`Bot1 King Flipped: ${board.kings_flipped[0]}`);
      this.gameLogger.log(`Bot2 King Flipped: ${board.kings_flipped[1]}`);

    } else {
      this.gameLogger.log(`❌ Game ended with unexpected status: ${status.type}`);
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run bot test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const test = new BotVsBotTest();
  test.runBotVsBotTest().catch(console.error);
}
