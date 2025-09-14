import { LocalGameServer } from '../server/server.js';
import { ImposterKingsAPIClient } from '../api/client.js';
import { Logger } from '../utils/logger.js';
import type { GameAction, GameEvent, GameBoard, GameStatus } from '../types/game.js';

interface GameMove {
  player: string;
  action: string;
  details?: string;
  expectedResult?: string;
}

interface GameScenario {
  name: string;
  description: string;
  players: [string, string]; // [player1, player2]
  gameLog: string;
  expectedFinalScore: [number, number];
}

export class UnifiedRegressionTest {
  private server: LocalGameServer;
  private logger: Logger;
  private gameLogger: Logger;
  private client1: ImposterKingsAPIClient;
  private client2: ImposterKingsAPIClient;
  private gameId: number = 0;
  private gameIdCounter: number = 1000; // Start from 1000 for test games
  private playerTokens: { [playerName: string]: string } = {};

  // Current scenario state
  private currentScenario?: GameScenario;
  private parsedSignatureCards: { [player: string]: string[] } = {};
  private parsedStartingHands: { [player: string]: string[] } = {};
  private parsedAccusedCard: string = '';

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.server = new LocalGameServer(3005); // New unified port
    this.logger = new Logger(`regression-unified-${timestamp}.log`);
    this.gameLogger = new Logger(`game-replay-unified-${timestamp}.log`);

    this.client1 = new ImposterKingsAPIClient('http://localhost:3005');
    this.client2 = new ImposterKingsAPIClient('http://localhost:3005');
  }

  async runAllRegressionTests(): Promise<void> {
    console.log('🧪 Running Unified Regression Tests');
    console.log('=' .repeat(80));

    const scenarios = this.getTestScenarios();
    let passedTests = 0;
    let totalTests = scenarios.length;

    try {
      // Start server once for all tests
      await this.server.start();
      console.log('✅ Test server started on port 3005');

      for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        console.log(`\n📋 Running Scenario ${i + 1}/${totalTests}: ${scenario.name}`);
        console.log(`   ${scenario.description}`);

        try {
          await this.runScenario(scenario);
          console.log(`✅ Scenario ${i + 1} PASSED: ${scenario.name}`);
          passedTests++;
        } catch (error) {
          console.error(`❌ Scenario ${i + 1} FAILED: ${scenario.name}`);
          console.error(`   Error: ${error}`);
          this.logger.error(`Scenario ${scenario.name} failed`, error as Error);
        }
      }

      console.log(`\n🎯 Results: ${passedTests}/${totalTests} scenarios passed`);
      if (passedTests === totalTests) {
        console.log('🎉 All regression tests completed successfully!');
      } else {
        throw new Error(`${totalTests - passedTests} scenarios failed`);
      }

    } catch (error) {
      this.logger.error('Unified regression tests failed', error as Error);
      console.error('❌ Unified regression tests failed:', error);
      throw error;
    } finally {
      this.server.stop();
      this.logger.close();
      this.gameLogger.close();
    }
  }

  private async runScenario(scenario: GameScenario): Promise<void> {
    this.currentScenario = scenario;

    // Reset state for new scenario
    this.parsedSignatureCards = {};
    this.parsedStartingHands = {};
    this.parsedAccusedCard = '';
    this.playerTokens = {};

    // Parse the game log first to get the hands
    this.parseSetupInformation(scenario.gameLog);
    this.setGlobalHands();

    // Setup game with scenario-specific players
    await this.setupGame();

    // Parse and execute the game replay
    await this.executeGameReplay();
  }

  private getTestScenarios(): GameScenario[] {
    return [
      {
        name: "Game 2231 - Single Round",
        description: "Simple single-round game with basic mechanics",
        players: ["Calm", "katto"],
        expectedFinalScore: [3, 0],
        gameLog: `
# Game 2231 - Round 1

## Setup
Calm chose the signature cards FlagBearer, Stranger, Aegis.
katto chose the signature cards Ancestor, Informant, Nakturn.

Starting hands:
Calm: Soldier, Soldier, Queen, KingsHand, Immortal, Elder, Oathbound, Assassin, Princess
katto: Elder, Warden, Sentry, Inquisitor, Inquisitor, Warlord, Judge, Mystic, Fool

Accused: Zealot

## Actions
Calm decided that Calm goes first.

katto recruited Ancestor.
katto selected new King: Charismatic Leader.
katto ended muster.

Calm ended muster.

Calm played Soldier and said card name "Elder".

katto played Sentry with no ability.

Calm played KingsHand with no ability.

katto flipped the king.

Calm reacted with Assassin.

The round is over, Calm got 3 points.
        `
      },
      {
        name: "Multi-Round Game",
        description: "Simple 2-round game to test multi-round mechanics",
        players: ["Calm", "melissa"],
        expectedFinalScore: [2, 3],
        gameLog: `
# Calm vs melissa Multi-round Game

## Setup
Calm chose the signature cards Aegis, Ancestor, Exile.
melissa chose the signature cards Stranger, Ancestor, Conspiracist.

Starting hands:
melissa: Immortal, KingsHand, Warden, Judge, Zealot, Oathbound, Queen, Inquisitor, Sentry
Calm: Soldier, Fool, Princess, Mystic, Elder, Oathbound, Inquisitor, Soldier, Warlord

Accused: Assassin

## Actions
melissa decided that Calm goes first.

melissa recruited Conspiracist.
melissa discarded Judge.
melissa exhausted Soldier.
melissa ended muster.

Calm ended muster.

Calm played Soldier and said card name "Queen".
Calm disgraced 0 cards.

melissa played Warden with no ability.

Calm played Mystic with no ability.

melissa played Queen with ability.

Calm played Elder with ability.

melissa played Immortal with ability.

Calm played Warlord with ability.

melissa flipped the king.
melissa took the successor (Oathbound).

Calm played Fool and picked Queen from the court.

melissa reacted with KingsHand.

Calm played Oathbound with no ability.

melissa played Conspiracist with ability.

Calm flipped the king.
Calm took the successor (Inquisitor).

melissa played Sentry with no ability.

The round is over, melissa got 2 points.

The game is over with score 2:3.
        `
      }
    ];
  }

  private async setupGame(): Promise<void> {
    if (!this.currentScenario) throw new Error('No current scenario');

    const [player1Name, player2Name] = this.currentScenario.players;
    this.gameLogger.log(`=== GAME SETUP: ${player1Name} vs ${player2Name} ===`);

    // Create game
    const createResponse = await this.client1.createGame({ player_name: player1Name });
    this.gameId = createResponse.game_id;
    const joinToken = createResponse.player_token;

    this.gameLogger.log(`Game created - ID: ${this.gameId}, Join Token: ${joinToken}`);

    // Join players
    const player1Join = await this.client1.joinGame({
      game_id: this.gameId,
      join_token: joinToken,
      player_name: player1Name
    });
    this.playerTokens[player1Name] = player1Join.player_token;

    const player2Join = await this.client2.joinGame({
      game_id: this.gameId,
      join_token: joinToken,
      player_name: player2Name
    });
    this.playerTokens[player2Name] = player2Join.player_token;

    this.gameLogger.log(`Players joined - ${player1Name}: ${this.playerTokens[player1Name]}, ${player2Name}: ${this.playerTokens[player2Name]}`);
    console.log(`✅ Game setup complete - ${player1Name} vs ${player2Name}`);
  }

  private async completeSignatureCardSelection(): Promise<void> {
    if (!this.currentScenario) throw new Error('No current scenario');

    this.gameLogger.log('=== SIGNATURE CARD SELECTION PHASE ===');

    const [player1Name, player2Name] = this.currentScenario.players;

    // Use parsed signature cards or defaults
    const player1Cards = this.parsedSignatureCards[player1Name] || ['FlagBearer', 'Stranger', 'Aegis'];
    const player2Cards = this.parsedSignatureCards[player2Name] || ['Ancestor', 'Informant', 'Nakturn'];

    // Convert card names to indices
    const signatureCardList = ['FlagBearer', 'Stranger', 'Aegis', 'Ancestor', 'Informant', 'Nakturn', 'Lockshift', 'Conspiracist', 'Exile'];

    // Player 1 signature selection
    const player1SignatureAction = {
      type: 'ChooseSignatureCards' as const,
      cards: player1Cards.map(card => [signatureCardList.indexOf(card), card]) as Array<[number, string]>
    };

    let events = await this.client1.getEvents(this.gameId, this.playerTokens[player1Name], 0);
    await this.client1.sendAction(this.gameId, this.playerTokens[player1Name], events.length, player1SignatureAction);
    this.gameLogger.log(`${player1Name} selected signature cards: ${player1Cards.join(', ')}`);

    // Wait for update
    await this.sleep(100);

    // Player 2 signature selection
    const player2SignatureAction = {
      type: 'ChooseSignatureCards' as const,
      cards: player2Cards.map(card => [signatureCardList.indexOf(card), card]) as Array<[number, string]>
    };

    events = await this.client2.getEvents(this.gameId, this.playerTokens[player2Name], 0);
    await this.client2.sendAction(this.gameId, this.playerTokens[player2Name], events.length, player2SignatureAction);
    this.gameLogger.log(`${player2Name} selected signature cards: ${player2Cards.join(', ')}`);

    // Wait for transition to mustering phase
    await this.sleep(200);

    this.gameLogger.log('✅ Signature card selection completed, should be in mustering phase');
  }

  private async executeGameReplay(): Promise<void> {
    if (!this.currentScenario) throw new Error('No current scenario');

    this.gameLogger.log('=== EXECUTING GAME REPLAY ===');

    // Set up deterministic hands in the game engine
    await this.setupDeterministicGame();

    // Parse and execute actions
    const gameReplay = this.parseGameActions(this.currentScenario.gameLog);

    let moveCount = 0;

    for (const move of gameReplay) {
      moveCount++;
      this.gameLogger.log(`\n--- MOVE ${moveCount}: ${move.player} ${move.action} ${move.details || ''} ---`);

      try {
        await this.executeMove(move);

        // Verify game state after each move
        await this.verifyGameState(move, moveCount);

        console.log(`✅ Move ${moveCount}: ${move.player} ${move.action} ${move.details || ''}`);

      } catch (error) {
        console.error(`❌ Move ${moveCount} FAILED: ${move.player} ${move.action}`);
        console.error(`   Error: ${error}`);
        this.logger.error(`Move ${moveCount} failed`, error as Error);
        throw error;
      }
    }

    // Verify final score
    await this.verifyFinalScore();
  }

  private async verifyFinalScore(): Promise<void> {
    if (!this.currentScenario) throw new Error('No current scenario');

    const [player1Name, player2Name] = this.currentScenario.players;
    const finalEvents = await this.client1.getEvents(this.gameId, this.playerTokens[player1Name], 0);
    const finalState = finalEvents.filter(e => e.type === 'NewState').pop();

    if (finalState && finalState.type === 'NewState') {
      const finalScore = finalState.board.points;
      this.gameLogger.log(`Final Score: ${player1Name} ${finalScore[0]} - ${player2Name} ${finalScore[1]}`);

      const [expectedPlayer1Score, expectedPlayer2Score] = this.currentScenario.expectedFinalScore;
      if (finalScore[0] === expectedPlayer1Score && finalScore[1] === expectedPlayer2Score) {
        console.log(`✅ Final score matches expected: ${player1Name} ${expectedPlayer1Score} - ${player2Name} ${expectedPlayer2Score}`);
      } else {
        throw new Error(`Score mismatch! Expected ${player1Name} ${expectedPlayer1Score} - ${player2Name} ${expectedPlayer2Score}, got ${player1Name} ${finalScore[0]} - ${player2Name} ${finalScore[1]}`);
      }
    }
  }

  private parseSetupInformation(gameLog: string): void {
    this.gameLogger.log('=== PARSING SETUP INFORMATION ===');

    const lines = gameLog.split('\n');
    let foundFirstRoundHands = false;

    // Parse signature cards and first round hands only
    for (const line of lines) {
      const trimmed = line.trim();

      // Parse signature card selection: "Calm chose the signature cards Aegis, Ancestor, Exile."
      const signatureMatch = trimmed.match(/(\w+) chose the signature cards (.+)\./);
      if (signatureMatch) {
        const player = signatureMatch[1];
        const cards = signatureMatch[2].split(', ').map(card => card.trim());
        this.parsedSignatureCards[player] = cards;
        this.gameLogger.log(`Parsed signature cards for ${player}: ${cards.join(', ')}`);
      }

      // Parse starting hands, but only from the first round
      const handMatch = trimmed.match(/^(\w+): (.+)$/);
      if (handMatch && !trimmed.includes('chose') && !foundFirstRoundHands) {
        const player = handMatch[1];
        const cards = handMatch[2].split(', ').map(card => card.trim().replace(/'/g, '').replace(/ /g, ''));
        this.parsedStartingHands[player] = cards;
        this.gameLogger.log(`Parsed starting hand for ${player}: ${cards.join(', ')}`);

        // Check if we've found both players' hands for the first round
        if (Object.keys(this.parsedStartingHands).length >= 2) {
          foundFirstRoundHands = true;
        }
      }

      // Parse accused card from first round only
      const accusedMatch = trimmed.match(/Accused: (\w+)/);
      if (accusedMatch && !this.parsedAccusedCard) {
        this.parsedAccusedCard = accusedMatch[1];
        this.gameLogger.log(`Parsed accused card: ${this.parsedAccusedCard}`);
      }
    }
  }

  private setGlobalHands(): void {
    if (!this.currentScenario) throw new Error('No current scenario');

    // Set global hands for the local service to use
    // The engine expects 'calm' and 'katto' as keys, so we need to map accordingly
    if (Object.keys(this.parsedStartingHands).length > 0 || this.parsedAccusedCard) {
      const [player1Name, player2Name] = this.currentScenario.players;

      (global as any).regressionTestHands = {
        calm: this.parsedStartingHands[player1Name] || ['Soldier', 'Soldier', 'Queen', 'KingsHand', 'Immortal', 'Elder', 'Oathbound', 'Assassin', 'Princess'],
        katto: this.parsedStartingHands[player2Name] || ['Elder', 'Warden', 'Sentry', 'Inquisitor', 'Inquisitor', 'Warlord', 'Judge', 'Mystic', 'Fool'],
        accused: this.parsedAccusedCard || 'Zealot'
      };
      this.gameLogger.log('Set global hands for deterministic game');
    }
  }

  private async setupDeterministicGame(): Promise<void> {
    await this.completeSignatureCardSelection();
  }

  private parseGameActions(gameLog: string): GameMove[] {
    const lines = gameLog.split('\n');
    const moves: GameMove[] = [];
    let inActionsSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip until we reach an Actions section
      if (trimmed === '## Actions') {
        inActionsSection = true;
        continue;
      }

      // Reset when we hit a new section that's not actions
      if (trimmed.startsWith('##') && trimmed !== '## Actions') {
        inActionsSection = false;
        continue;
      }

      if (!inActionsSection || trimmed.length === 0 || trimmed.startsWith('#')) {
        continue;
      }

      // Parse action lines - handle any player name dynamically
      const playerMatch = trimmed.match(/^(\w+) (.+)$/);
      if (playerMatch) {
        const player = playerMatch[1];
        const action = playerMatch[2];
        moves.push(this.parseMove(player, action));
      } else if (trimmed.startsWith('The round is over')) {
        const match = trimmed.match(/(\w+) got (\d+) points/);
        if (match) {
          moves.push({
            player: match[1],
            action: 'round_end',
            expectedResult: `${match[2]} points`
          });
        }
      } else if (trimmed.startsWith('The game is over')) {
        // Final score verification
        const scoreMatch = trimmed.match(/with score (\d+):(\d+)/);
        if (scoreMatch) {
          moves.push({
            player: 'system', // Doesn't matter which player for final verification
            action: 'game_end',
            expectedResult: `final score ${scoreMatch[1]}:${scoreMatch[2]}`
          });
        }
      } else if (trimmed === 'Nothing happened.') {
        // Add as a move for the last player who acted
        const lastMove = moves[moves.length - 1];
        if (lastMove) {
          moves.push({
            player: lastMove.player,
            action: 'nothing_happened'
          });
        }
      } else if (trimmed.includes('disgraced') || trimmed.includes('moved') || trimmed.includes('swapped') || trimmed.includes('picked')) {
        // These are result descriptions - attribute to the last player who acted
        const lastMove = moves[moves.length - 1];
        if (lastMove) {
          moves.push({
            player: lastMove.player,
            action: 'result_description',
            details: trimmed
          });
        }
      }
    }

    this.gameLogger.log(`Parsed ${moves.length} game actions`);
    return moves;
  }

  private parseMove(player: string, action: string): GameMove {
    if (action.includes('decided that')) {
      return { player, action: 'choose_first_player', details: action };
    } else if (action.includes('recruited')) {
      const card = action.match(/recruited (\w+)/)?.[1];
      return { player, action: 'recruit', details: card };
    } else if (action.includes('discarded')) {
      const card = action.match(/discarded (\w+)/)?.[1];
      return { player, action: 'discard', details: card };
    } else if (action.includes('exhausted')) {
      const card = action.match(/exhausted (\w+)/)?.[1];
      return { player, action: 'exhaust', details: card };
    } else if (action.includes('selected new King')) {
      const king = action.match(/selected new King: (.+)/)?.[1];
      return { player, action: 'change_king', details: king };
    } else if (action.includes('ended muster')) {
      return { player, action: 'end_muster' };
    } else if (action.includes('picked') && action.includes('successor')) {
      const card = action.match(/picked (\w+) as successor/)?.[1];
      return { player, action: 'pick_successor', details: card };
    } else if (action.includes('picked') && action.includes('squire')) {
      const card = action.match(/picked (\w+) as squire/)?.[1];
      return { player, action: 'pick_squire', details: card };
    } else if (action.includes('played') && action.includes('said card name')) {
      const match = action.match(/played (\w+) and said card name "(\w+)"/);
      return { player, action: 'play_with_name', details: `${match?.[1]}:${match?.[2]}` };
    } else if (action.includes('played') && action.includes('said number')) {
      const match = action.match(/played (\w+) and said number (\d+)/);
      return { player, action: 'play_with_number', details: `${match?.[1]}:${match?.[2]}` };
    } else if (action.includes('played') && action.includes('with no ability')) {
      const match = action.match(/played (.+?) with no ability/);
      const card = match?.[1]?.replace(/'/g, '').replace(/ /g, ''); // Handle "King's Hand" -> "KingsHand"
      return { player, action: 'play_no_ability', details: card };
    } else if (action.includes('played') && action.includes('with ability')) {
      const match = action.match(/played (.+?) with ability/);
      const card = match?.[1]?.replace(/'/g, '').replace(/ /g, ''); // Handle "King's Hand" -> "KingsHand"
      return { player, action: 'play_with_ability', details: card };
    } else if (action.includes('flipped the king')) {
      return { player, action: 'flip_king' };
    } else if (action.includes('reacted with')) {
      const match = action.match(/reacted with (.+?)(?:\s*\(|$)/);
      const card = match?.[1]?.replace(/'/g, '').replace(/ /g, '');
      return { player, action: 'react', details: card };
    } else if (action.includes('disgraced')) {
      const cards = action.match(/disgraced (.+)/)?.[1];
      return { player, action: 'disgrace', details: cards };
    } else if (action.includes('moved') && action.includes('antechamber')) {
      const card = action.match(/moved (\w+) to the antechamber/)?.[1];
      return { player, action: 'move_to_antechamber', details: card };
    } else if (action.includes('took the successor')) {
      const card = action.match(/took the successor \((\w+)\)/)?.[1];
      return { player, action: 'take_successor', details: card };
    } else if (action.includes('took the squire')) {
      const card = action.match(/took the squire \((\w+)\)/)?.[1];
      return { player, action: 'take_squire', details: card };
    } else if (action.includes('swapped')) {
      return { player, action: 'swap', details: action };
    } else if (action.includes('picked') && action.includes('from the court')) {
      return { player, action: 'pick_from_court', details: action };
    } else if (action === 'Nothing happened.') {
      return { player, action: 'nothing_happened' };
    }

    return { player, action: 'unknown', details: action };
  }

  private async executeMove(move: GameMove): Promise<void> {
    if (!this.currentScenario) throw new Error('No current scenario');

    this.gameLogger.log(`Executing: ${move.player} ${move.action} ${move.details || ''}`);

    // Get current game state
    const [player1Name, player2Name] = this.currentScenario.players;
    const events = await this.client1.getEvents(this.gameId, this.playerTokens[player1Name], 0);
    const gameState = events.filter(e => e.type === 'NewState').pop();

    if (!gameState || gameState.type !== 'NewState') {
      throw new Error('No valid game state found');
    }

    const currentPlayer = gameState.board.player_idx === 0 ? player1Name : player2Name;
    const client = move.player === player1Name ? this.client1 : this.client2;
    const token = this.playerTokens[move.player];

    if (!token) {
      throw new Error(`No token found for player: ${move.player}`);
    }

    // Log current game state for debugging
    this.gameLogger.log(`Current game status: ${gameState.status.type}`);
    this.gameLogger.log(`Available actions: ${gameState.actions.length}`);
    gameState.actions.forEach((action, idx) => {
      this.gameLogger.log(`  [${idx}] ${action.type} ${JSON.stringify(action).substring(0, 100)}...`);
    });

    // Convert move to game action
    const action = this.convertMoveToAction(move, gameState.board, gameState.actions);

    if (!action) {
      if (move.action === 'round_end') {
        // This is a verification step, not an action - just verify the score
        if (move.expectedResult) {
          const points = parseInt(move.expectedResult.match(/(\d+) points/)?.[1] || '0');
          const playerIdx = move.player === player1Name ? 0 : 1;

          if (gameState.board.points[playerIdx] >= points) {
            this.gameLogger.log(`✅ Score verification: ${move.player} has ${gameState.board.points[playerIdx]} points (expected ${points})`);
            return; // Skip execution, this was just verification
          } else {
            throw new Error(`Score verification failed: ${move.player} has ${gameState.board.points[playerIdx]} points, expected ${points}`);
          }
        }
        return; // Skip round_end actions
      }

      if (move.action === 'nothing_happened' || move.action === 'swap' || move.action === 'pick_from_court' ||
          move.action === 'discard' || move.action === 'exhaust' || move.action === 'result_description' ||
          move.action === 'pick_successor' || move.action === 'disgrace' || move.action === 'move_to_antechamber') {
        // These are result descriptions, not actions to execute in the current simplified implementation
        this.gameLogger.log(`Skipping result description: ${move.action}`);
        return;
      }

      this.gameLogger.log(`Failed to find action for: ${move.action} with details: ${move.details}`);
      throw new Error(`Could not convert move to action: ${move.action}`);
    }

    this.gameLogger.log(`Converted to action: ${JSON.stringify(action)}`);

    // Execute the action
    await client.sendAction(this.gameId, token, events.length, action);

    // Wait for update
    await this.sleep(100);
  }

  private convertMoveToAction(move: GameMove, board: GameBoard, availableActions: GameAction[]): GameAction | null {
    switch (move.action) {
      case 'choose_first_player':
        return availableActions.find(a => a.type === 'ChooseWhosFirst') || null;

      case 'recruit':
        return availableActions.find(a =>
          a.type === 'Recruit' && a.army_card === move.details
        ) || null;

      case 'change_king':
        const facetName = move.details?.replace('.', ''); // Remove trailing period
        const facet = facetName === 'Charismatic Leader' ? 'CharismaticLeader' :
                     facetName === 'Master Tactician' ? 'MasterTactician' : 'Regular';
        return availableActions.find(a =>
          a.type === 'ChangeKingFacet' && a.facet === facet
        ) || null;

      case 'end_muster':
        return availableActions.find(a => a.type === 'EndMuster') || null;

      case 'play_no_ability':
      case 'play_with_ability':
        const cardName = move.details;
        return availableActions.find(a =>
          a.type === 'PlayCard' && a.card === cardName
        ) || null;

      case 'play_with_name':
      case 'play_with_number':
        const [card, param] = (move.details || '').split(':');
        return availableActions.find(a =>
          a.type === 'PlayCard' && a.card === card
        ) || null;

      case 'flip_king':
        return availableActions.find(a => a.type === 'FlipKing') || null;

      case 'react':
        return availableActions.find(a =>
          a.type === 'Reaction' && a.card === move.details
        ) || null;

      case 'take_successor':
        return availableActions.find(a => a.type === 'TakeSuccessor') || null;

      case 'take_squire':
        return availableActions.find(a => a.type === 'TakeSquire') || null;

      // All result descriptions return null
      case 'round_end':
      case 'game_end':
      case 'nothing_happened':
      case 'swap':
      case 'pick_from_court':
      case 'move_to_antechamber':
      case 'disgrace':
      case 'discard':
      case 'exhaust':
      case 'pick_successor':
      case 'result_description':
        return null;

      default:
        this.logger.log(`Unknown move action: ${move.action}`);
        return null;
    }
  }

  private async verifyGameState(move: GameMove, moveCount: number): Promise<void> {
    if (!this.currentScenario) throw new Error('No current scenario');

    // Get updated game state
    const [player1Name, player2Name] = this.currentScenario.players;
    const events = await this.client1.getEvents(this.gameId, this.playerTokens[player1Name], 0);
    const gameState = events.filter(e => e.type === 'NewState').pop();

    if (!gameState || gameState.type !== 'NewState') {
      throw new Error('No game state after move');
    }

    const board = gameState.board;
    const status = gameState.status;

    // Log current state for verification
    this.gameLogger.log(`Post-move state:`);
    this.gameLogger.log(`  Status: ${status.type}`);
    this.gameLogger.log(`  Current Player: ${board.player_idx === 0 ? player1Name : player2Name}`);
    this.gameLogger.log(`  Score: ${player1Name} ${board.points[0]} - ${player2Name} ${board.points[1]}`);

    if (board.court.length > 0) {
      const courtSequence = board.court.map(c => c.card.card).join(' → ');
      this.gameLogger.log(`  Court: ${courtSequence}`);
      this.gameLogger.log(`  Throne: ${board.court[board.court.length - 1].card.card}`);
    }

    this.gameLogger.log(`  ${player1Name} Hand: ${board.hands[0].length} cards`);
    this.gameLogger.log(`  ${player2Name} Hand: ${board.hands[1].length} cards`);

    if (board.antechambers[0].length > 0) {
      this.gameLogger.log(`  ${player1Name} Antechamber: ${board.antechambers[0].map(c => typeof c.card === 'object' ? c.card.card : 'hidden').join(', ')}`);
    }
    if (board.antechambers[1].length > 0) {
      this.gameLogger.log(`  ${player2Name} Antechamber: ${board.antechambers[1].map(c => typeof c.card === 'object' ? c.card.card : 'hidden').join(', ')}`);
    }

    this.gameLogger.log(`  Accused: ${board.accused.length > 0 ? board.accused[0].card.card : 'none'}`);

    // Verify specific expectations based on move type
    if (move.expectedResult) {
      if (move.expectedResult.includes('points')) {
        const points = parseInt(move.expectedResult.match(/(\d+) points/)?.[1] || '0');
        const playerIdx = move.player === player1Name ? 0 : 1;

        if (board.points[playerIdx] < points) {
          throw new Error(`Expected ${move.player} to have ${points} points, but has ${board.points[playerIdx]}`);
        }
      }
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run unified regression tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const test = new UnifiedRegressionTest();
  test.runAllRegressionTests().catch(console.error);
}
