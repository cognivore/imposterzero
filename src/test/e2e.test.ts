import { LocalGameServer } from '../server/server.js';
import { ImposterKingsAPIClient } from '../api/client.js';
import { Logger } from '../utils/logger.js';
import type { GameAction, GameEvent } from '../types/game.js';

interface TestResult {
  passed: boolean;
  message: string;
  details?: any;
}

export class E2ETestRunner {
  private server: LocalGameServer;
  private logger: Logger;
  private client1: ImposterKingsAPIClient;
  private client2: ImposterKingsAPIClient;
  private gameId: number = 0;
  private player1Token: string = '';
  private player2Token: string = '';
  private joinToken: string = '';

  constructor() {
    this.server = new LocalGameServer(3001); // Use different port for testing
    this.logger = new Logger('e2e-test.log');
    this.client1 = new ImposterKingsAPIClient('http://localhost:3001');
    this.client2 = new ImposterKingsAPIClient('http://localhost:3001');
  }

  async runAllTests(): Promise<void> {
    console.log('🧪 Starting End-to-End Tests for Fragments of Nersetti');
    console.log('=' .repeat(60));

    try {
      // Start the server
      await this.server.start();
      console.log('✅ Server started on port 3001');

      const results: TestResult[] = [];

      // Run tests in sequence
      results.push(await this.testGameCreation());
      results.push(await this.testPlayerJoining());
      results.push(await this.testSignatureCardSelection());
      results.push(await this.testMusteringPhase());

      // Report results
      this.reportResults(results);

    } catch (error) {
      this.logger.error('Test suite failed', error as Error);
      console.error('❌ Test suite failed:', error);
    } finally {
      this.server.stop();
      this.logger.close();
    }
  }

  private async testGameCreation(): Promise<TestResult> {
    console.log('\n📝 Test 1: Game Creation');

    try {
      const response = await this.client1.createGame({ player_name: 'TestPlayer1' });
      this.gameId = response.game_id;
      this.joinToken = response.player_token; // In our implementation, this is the join token

      this.logger.log(`Game created - ID: ${this.gameId}, Join Token: ${this.joinToken}`);

      if (this.gameId > 0 && this.joinToken) {
        console.log(`   ✅ Game created successfully - ID: ${this.gameId}`);
        return { passed: true, message: 'Game creation successful' };
      } else {
        return { passed: false, message: 'Invalid game creation response' };
      }
    } catch (error) {
      this.logger.error('Game creation failed', error as Error);
      return { passed: false, message: `Game creation failed: ${error}` };
    }
  }

  private async testPlayerJoining(): Promise<TestResult> {
    console.log('\n👥 Test 2: Player Joining');

    try {
      // Player 1 joins (creator)
      const player1Response = await this.client1.joinGame({
        game_id: this.gameId,
        join_token: this.joinToken,
        player_name: 'TestPlayer1'
      });
      this.player1Token = player1Response.player_token;

      // Player 2 joins
      const player2Response = await this.client2.joinGame({
        game_id: this.gameId,
        join_token: this.joinToken,
        player_name: 'TestPlayer2'
      });
      this.player2Token = player2Response.player_token;

      this.logger.log(`Players joined - P1: ${this.player1Token}, P2: ${this.player2Token}`);

      // Check game status
      const status = await this.client1.getGameStatus(this.gameId, this.player1Token);

      if (status && status.started && status.players.length === 2) {
        console.log('   ✅ Both players joined successfully');
        console.log(`   📊 Players: ${status.players.map(p => p?.name || 'null').join(', ')}`);
        return { passed: true, message: 'Player joining successful' };
      } else {
        return { passed: false, message: 'Game status indicates issues', details: status };
      }
    } catch (error) {
      this.logger.error('Player joining failed', error as Error);
      return { passed: false, message: `Player joining failed: ${error}` };
    }
  }

  private async testSignatureCardSelection(): Promise<TestResult> {
    console.log('\n🃏 Test 3: Signature Card Selection');

    try {
      // Get initial events
      let events1 = await this.client1.getEvents(this.gameId, this.player1Token, 0);
      let events2 = await this.client2.getEvents(this.gameId, this.player2Token, 0);

      this.logger.log(`Initial events - P1: ${events1.length}, P2: ${events2.length}`);

      // Find the NewState event with signature card selection
      const gameState = events1.find(e => e.type === 'NewState' && e.status.type === 'SelectSignatureCards');
      if (!gameState || gameState.type !== 'NewState') {
        return { passed: false, message: 'No signature card selection state found' };
      }

      console.log('   🎯 Found signature card selection phase');
      console.log(`   📋 Available actions: ${gameState.actions.length}`);

      // Player 1 selects signature cards (first 3 options: Flag Bearer, Stranger, Aegis)
      const player1Action: GameAction = {
        type: 'ChooseSignatureCards',
        cards: [[0, 'FlagBearer'], [1, 'Stranger'], [2, 'Aegis']]
      };

      await this.client1.sendAction(this.gameId, this.player1Token, events1.length, player1Action);
      console.log('   ✅ Player 1 selected: Flag Bearer, Stranger, Aegis');

      // Wait for update and get new events
      await this.sleep(100);
      events1 = await this.client1.getEvents(this.gameId, this.player1Token, 0);
      events2 = await this.client2.getEvents(this.gameId, this.player2Token, 0);

      // Player 2 selects signature cards (different combination)
      const player2Action: GameAction = {
        type: 'ChooseSignatureCards',
        cards: [[3, 'Ancestor'], [4, 'Informant'], [5, 'Nakturn']]
      };

      await this.client2.sendAction(this.gameId, this.player2Token, events2.length, player2Action);
      console.log('   ✅ Player 2 selected: Ancestor, Informant, Nakturn');

      // Wait for update
      await this.sleep(100);
      events1 = await this.client1.getEvents(this.gameId, this.player1Token, 0);

      // Check if we moved to mustering phase
      const finalState = events1.filter(e => e.type === 'NewState').pop();
      if (finalState && finalState.type === 'NewState' && finalState.status.type === 'Muster') {
        console.log('   ✅ Successfully transitioned to Mustering phase');
        return { passed: true, message: 'Signature card selection completed successfully' };
      } else {
        return {
          passed: false,
          message: 'Did not transition to mustering phase',
          details: finalState?.status
        };
      }

    } catch (error) {
      this.logger.error('Signature card selection failed', error as Error);
      return { passed: false, message: `Signature card selection failed: ${error}` };
    }
  }

  private async testMusteringPhase(): Promise<TestResult> {
    console.log('\n⚔️ Test 4: Mustering Phase');

    try {
      // Get current events
      let events1 = await this.client1.getEvents(this.gameId, this.player1Token, 0);
      let events2 = await this.client2.getEvents(this.gameId, this.player2Token, 0);

      // Find current mustering state
      const musterState = events1.filter(e => e.type === 'NewState').pop();
      if (!musterState || musterState.type !== 'NewState' || musterState.status.type !== 'Muster') {
        return { passed: false, message: 'Not in mustering phase' };
      }

      console.log('   🏰 In mustering phase');
      console.log(`   🎯 Available actions: ${musterState.actions.length}`);
      console.log(`   👤 Current player: ${musterState.board.player_idx === 0 ? 'Player 1' : 'Player 2'}`);

      // Test that only unique army cards can be recruited
      const recruitActions = musterState.actions.filter(a => a.type === 'Recruit');
      const recruitedCards = recruitActions.map(a => a.type === 'Recruit' ? a.army_card : '');
      const uniqueRecruitedCards = new Set(recruitedCards);

      if (recruitedCards.length !== uniqueRecruitedCards.size) {
        return {
          passed: false,
          message: 'Duplicate recruitment actions found',
          details: { recruitActions: recruitedCards }
        };
      }

      console.log('   ✅ Army recruitment shows only unique cards');
      console.log(`   📦 Available for recruitment: ${Array.from(uniqueRecruitedCards).join(', ')}`);

      // Test mustering order: second player musters first
      const secondPlayerIdx = 1 - (musterState.board.first_player_idx || 0);
      const currentPlayerIdx = musterState.board.player_idx;

      if (currentPlayerIdx !== secondPlayerIdx) {
        return {
          passed: false,
          message: `Wrong mustering order. Expected player ${secondPlayerIdx} (second player) to muster first, but current player is ${currentPlayerIdx}`,
          details: { firstPlayerIdx: musterState.board.first_player_idx, currentPlayerIdx }
        };
      }

      console.log(`   ✅ Correct mustering order: Player ${currentPlayerIdx + 1} (second player) musters first`);

      // Simulate first player's mustering
      const currentPlayerToken = currentPlayerIdx === 0 ? this.player1Token : this.player2Token;
      const currentClient = currentPlayerIdx === 0 ? this.client1 : this.client2;

      // End mustering for current player
      const endMusterAction: GameAction = { type: 'EndMuster' };
      await currentClient.sendAction(this.gameId, currentPlayerToken, events1.length, endMusterAction);
      console.log(`   ✅ Player ${currentPlayerIdx + 1} ended mustering`);

      // Wait and check if it switched to the other player
      await this.sleep(100);
      events1 = await this.client1.getEvents(this.gameId, this.player1Token, 0);

      const nextMusterState = events1.filter(e => e.type === 'NewState').pop();
      if (nextMusterState && nextMusterState.type === 'NewState') {
        const nextPlayerIdx = nextMusterState.board.player_idx;
        const expectedNextPlayer = 1 - currentPlayerIdx;

        if (nextPlayerIdx === expectedNextPlayer && nextMusterState.status.type === 'Muster') {
          console.log(`   ✅ Correctly switched to Player ${nextPlayerIdx + 1} for mustering`);

          // End mustering for second player
          const nextPlayerToken = nextPlayerIdx === 0 ? this.player1Token : this.player2Token;
          const nextClient = nextPlayerIdx === 0 ? this.client1 : this.client2;

          await nextClient.sendAction(this.gameId, nextPlayerToken, events1.length, endMusterAction);
          console.log(`   ✅ Player ${nextPlayerIdx + 1} ended mustering`);

          // Check if we moved to play phase
          await this.sleep(100);
          events1 = await this.client1.getEvents(this.gameId, this.player1Token, 0);

          const playState = events1.filter(e => e.type === 'NewState').pop();
          if (playState && playState.type === 'NewState' && playState.status.type === 'RegularMove') {
            console.log('   ✅ Successfully transitioned to Play phase');
            console.log(`   🎮 First player to play: Player ${playState.board.player_idx + 1}`);
            return { passed: true, message: 'Mustering phase completed successfully' };
          } else {
            return {
              passed: false,
              message: 'Did not transition to play phase',
              details: playState?.status
            };
          }
        } else {
          return {
            passed: false,
            message: `Wrong player switch. Expected Player ${expectedNextPlayer + 1}, got Player ${nextPlayerIdx + 1}`,
            details: { expected: expectedNextPlayer, actual: nextPlayerIdx }
          };
        }
      } else {
        return { passed: false, message: 'No mustering state after first player ended' };
      }

    } catch (error) {
      this.logger.error('Mustering phase test failed', error as Error);
      return { passed: false, message: `Mustering phase failed: ${error}` };
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private reportResults(results: TestResult[]): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS');
    console.log('='.repeat(60));

    const passed = results.filter(r => r.passed).length;
    const total = results.length;

    results.forEach((result, index) => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} Test ${index + 1}: ${result.message}`);

      if (!result.passed && result.details) {
        console.log(`   📋 Details: ${JSON.stringify(result.details, null, 2)}`);
      }
    });

    console.log('\n' + '='.repeat(60));
    console.log(`🎯 SUMMARY: ${passed}/${total} tests passed`);

    if (passed === total) {
      console.log('🎉 ALL TESTS PASSED! The game engine is working correctly.');
    } else {
      console.log('⚠️  Some tests failed. Check the details above and fix the issues.');
    }
    console.log('='.repeat(60));
  }

  // Helper method to wait for specific game state
  private async waitForGameState(
    client: ImposterKingsAPIClient,
    gameId: number,
    playerToken: string,
    predicate: (state: any) => boolean,
    maxAttempts: number = 10
  ): Promise<any> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const events = await client.getEvents(gameId, playerToken, 0);
      const gameState = events.filter(e => e.type === 'NewState').pop();

      if (gameState && gameState.type === 'NewState' && predicate(gameState)) {
        return gameState;
      }

      await this.sleep(100);
    }

    throw new Error('Timeout waiting for game state');
  }

  // Helper to get all available actions of a specific type
  private getActionsOfType(events: GameEvent[], actionType: string): GameAction[] {
    const latestState = events.filter(e => e.type === 'NewState').pop();
    if (latestState && latestState.type === 'NewState') {
      return latestState.actions.filter(a => a.type === actionType);
    }
    return [];
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new E2ETestRunner();
  runner.runAllTests().catch(console.error);
}
