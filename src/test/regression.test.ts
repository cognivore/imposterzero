import { LocalGameServer } from '../server/server.js';
import { ImposterKingsAPIClient } from '../api/client.js';
import { Logger } from '../utils/logger.js';
import type { GameAction, GameEvent, GameBoard, GameStatus } from '../types/game.js';

interface GameMove {
  player: 'Calm' | 'katto';
  action: string;
  details?: string;
  expectedResult?: string;
}

export class RegressionTest {
  private server: LocalGameServer;
  private logger: Logger;
  private gameLogger: Logger;
  private client1: ImposterKingsAPIClient; // Calm
  private client2: ImposterKingsAPIClient; // katto
  private gameId: number = 0;
  private calmToken: string = '';
  private kattoToken: string = '';

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.server = new LocalGameServer(3003);
    this.logger = new Logger(`regression-test-${timestamp}.log`);
    this.gameLogger = new Logger(`game-replay-${timestamp}.log`);

    this.client1 = new ImposterKingsAPIClient('http://localhost:3003');
    this.client2 = new ImposterKingsAPIClient('http://localhost:3003');
  }

  async runRegressionTest(): Promise<void> {
    console.log('🧪 Running Regression Test: Game 2231 (Extended Rules - Phase 4)');
    console.log('=' .repeat(80));

    try {
      // Start server
      await this.server.start();
      console.log('✅ Test server started on port 3003');

      // Setup game with specific players
      await this.setupGame();

      // Parse and execute the game replay
      await this.executeGameReplay();

      console.log('🎉 Regression test completed!');

    } catch (error) {
      this.logger.error('Regression test failed', error as Error);
      console.error('❌ Regression test failed:', error);
    } finally {
      this.server.stop();
      this.logger.close();
      this.gameLogger.close();
    }
  }

  private async setupGame(): Promise<void> {
    this.gameLogger.log('=== GAME SETUP: Game 2231 ===');

    // Create game
    const createResponse = await this.client1.createGame({ player_name: 'Calm' });
    this.gameId = createResponse.game_id;
    const joinToken = createResponse.player_token;

    this.gameLogger.log(`Game created - ID: ${this.gameId}, Join Token: ${joinToken}`);

    // Join players
    const calmJoin = await this.client1.joinGame({
      game_id: this.gameId,
      join_token: joinToken,
      player_name: 'Calm'
    });
    this.calmToken = calmJoin.player_token;

    const kattoJoin = await this.client2.joinGame({
      game_id: this.gameId,
      join_token: joinToken,
      player_name: 'katto'
    });
    this.kattoToken = kattoJoin.player_token;

    this.gameLogger.log(`Players joined - Calm: ${this.calmToken}, katto: ${this.kattoToken}`);
    console.log(`✅ Game setup complete - Calm vs katto`);
  }

  private parsedSignatureCards: { [player: string]: string[] } = {};
  private parsedStartingHands: { [player: string]: string[] } = {};
  private parsedAccusedCard: string = '';

  private async completeSignatureCardSelection(): Promise<void> {
    this.gameLogger.log('=== SIGNATURE CARD SELECTION PHASE ===');

    // Use parsed signature cards if available
    const calmCards = this.parsedSignatureCards['Calm'] || ['FlagBearer', 'Stranger', 'Aegis'];
    const kattoCards = this.parsedSignatureCards['katto'] || ['Ancestor', 'Informant', 'Nakturn'];

    // Convert card names to indices
    const signatureCardList = ['FlagBearer', 'Stranger', 'Aegis', 'Ancestor', 'Informant', 'Nakturn', 'Lockshift', 'Conspiracist', 'Exile'];

    const calmSignatureAction = {
      type: 'ChooseSignatureCards' as const,
      cards: calmCards.map(card => [signatureCardList.indexOf(card), card]) as Array<[number, string]>
    };

    let events = await this.client1.getEvents(this.gameId, this.calmToken, 0);
    await this.client1.sendAction(this.gameId, this.calmToken, events.length, calmSignatureAction);
    this.gameLogger.log(`Calm selected signature cards: ${calmCards.join(', ')}`);

    // Wait for update
    await this.sleep(100);

    const kattoSignatureAction = {
      type: 'ChooseSignatureCards' as const,
      cards: kattoCards.map(card => [signatureCardList.indexOf(card), card]) as Array<[number, string]>
    };

    events = await this.client2.getEvents(this.gameId, this.kattoToken, 0);
    await this.client2.sendAction(this.gameId, this.kattoToken, events.length, kattoSignatureAction);
    this.gameLogger.log(`katto selected signature cards: ${kattoCards.join(', ')}`);

    // Wait for transition to mustering phase
    await this.sleep(200);

    this.gameLogger.log('✅ Signature card selection completed, should be in mustering phase');
  }

  private async executeGameReplay(): Promise<void> {
    this.gameLogger.log('=== EXECUTING GAME REPLAY ===');

    // Parse the complete game log including setup and actions
    const fullGameLog = `
# Game 2231 - Round 1

## Setup
Calm chose the signature cards FlagBearer, Stranger, Aegis.
katto chose the signature cards Ancestor, Informant, Nakturn.

Starting hands:
Calm: Soldier, Soldier, Queen, King's Hand, Immortal, Elder, Oathbound, Assassin, Princess
katto: Elder, Warden, Sentry, Inquisitor, Inquisitor, Warlord, Judge, Mystic, Fool

Accused card: Zealot

## Actions
Calm decided that Calm goes first.

katto recruited Ancestor.
katto selected new King: Charismatic Leader.
katto ended muster.

Calm ended muster.

Calm played Soldier and said card name "Elder".

katto played Sentry with no ability.

Calm played King's Hand with no ability.

katto flipped the king.

Calm reacted with Assassin.

The round is over, Calm got 3 points.
    `;

    // Parse setup information first
    this.parseSetupInformation(fullGameLog);

    // Set up deterministic hands in the game engine
    await this.setupDeterministicGame();

    // Parse and execute actions
    const gameReplay = this.parseGameActions(fullGameLog);

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
    const finalEvents = await this.client1.getEvents(this.gameId, this.calmToken, 0);
    const finalState = finalEvents.filter(e => e.type === 'NewState').pop();

    if (finalState && finalState.type === 'NewState') {
      const finalScore = finalState.board.points;
      this.gameLogger.log(`Final Score: Calm ${finalScore[0]} - katto ${finalScore[1]}`);

      if (finalScore[0] === 3 && finalScore[1] === 0) {
        console.log('✅ Final score matches expected: Calm 3 - katto 0');
      } else {
        throw new Error(`Score mismatch! Expected Calm 3 - katto 0, got Calm ${finalScore[0]} - katto ${finalScore[1]}`);
      }
    }
  }

  private parseGameLog(gameLog: string): GameMove[] {
    const lines = gameLog.trim().split('\n').filter(line => line.trim().length > 0);
    const moves: GameMove[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('Calm ')) {
        const action = trimmed.substring(5);
        moves.push(this.parseMove('Calm', action));
      } else if (trimmed.startsWith('katto ')) {
        const action = trimmed.substring(6);
        moves.push(this.parseMove('katto', action));
      } else if (trimmed.startsWith('The round is over')) {
        const match = trimmed.match(/(\w+) got (\d+) points/);
        if (match) {
          moves.push({
            player: match[1] as 'Calm' | 'katto',
            action: 'round_end',
            expectedResult: `${match[2]} points`
          });
        }
      }
    }

    return moves;
  }

  private parseMove(player: 'Calm' | 'katto', action: string): GameMove {
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
      const card = action.match(/reacted with (\w+)/)?.[1];
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
    }

    return { player, action: 'unknown', details: action };
  }

  private async executeMove(move: GameMove): Promise<void> {
    this.gameLogger.log(`Executing: ${move.player} ${move.action} ${move.details || ''}`);

    // Get current game state
    const events = await this.client1.getEvents(this.gameId, this.calmToken, 0);
    const gameState = events.filter(e => e.type === 'NewState').pop();

    if (!gameState || gameState.type !== 'NewState') {
      throw new Error('No valid game state found');
    }

    const currentPlayer = gameState.board.player_idx === 0 ? 'Calm' : 'katto';
    const client = move.player === 'Calm' ? this.client1 : this.client2;
    const token = move.player === 'Calm' ? this.calmToken : this.kattoToken;

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
          const playerIdx = move.player === 'Calm' ? 0 : 1;

          if (gameState.board.points[playerIdx] >= points) {
            this.gameLogger.log(`✅ Score verification: ${move.player} has ${gameState.board.points[playerIdx]} points (expected ${points})`);
            return; // Skip execution, this was just verification
          } else {
            throw new Error(`Score verification failed: ${move.player} has ${gameState.board.points[playerIdx]} points, expected ${points}`);
          }
        }
        return; // Skip round_end actions
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

      case 'round_end':
        // This is a verification step, not an action to execute
        return null;

      default:
        this.logger.log(`Unknown move action: ${move.action}`);
        return null;
    }
  }

  private async verifyGameState(move: GameMove, moveCount: number): Promise<void> {
    // Get updated game state
    const events = await this.client1.getEvents(this.gameId, this.calmToken, 0);
    const gameState = events.filter(e => e.type === 'NewState').pop();

    if (!gameState || gameState.type !== 'NewState') {
      throw new Error('No game state after move');
    }

    const board = gameState.board;
    const status = gameState.status;

    // Log current state for verification
    this.gameLogger.log(`Post-move state:`);
    this.gameLogger.log(`  Status: ${status.type}`);
    this.gameLogger.log(`  Current Player: ${board.player_idx === 0 ? 'Calm' : 'katto'}`);
    this.gameLogger.log(`  Score: Calm ${board.points[0]} - katto ${board.points[1]}`);

    if (board.court.length > 0) {
      const courtSequence = board.court.map(c => c.card.card).join(' → ');
      this.gameLogger.log(`  Court: ${courtSequence}`);
      this.gameLogger.log(`  Throne: ${board.court[board.court.length - 1].card.card}`);
    }

    this.gameLogger.log(`  Calm Hand: ${board.hands[0].length} cards`);
    this.gameLogger.log(`  katto Hand: ${board.hands[1].length} cards`);

    if (board.antechambers[0].length > 0) {
      this.gameLogger.log(`  Calm Antechamber: ${board.antechambers[0].map(c => typeof c.card === 'object' ? c.card.card : 'hidden').join(', ')}`);
    }
    if (board.antechambers[1].length > 0) {
      this.gameLogger.log(`  katto Antechamber: ${board.antechambers[1].map(c => typeof c.card === 'object' ? c.card.card : 'hidden').join(', ')}`);
    }

    this.gameLogger.log(`  Accused: ${board.accused.length > 0 ? board.accused[0].card.card : 'none'}`);

    // Verify specific expectations based on move type
    if (move.expectedResult) {
      if (move.expectedResult.includes('points')) {
        const points = parseInt(move.expectedResult.match(/(\d+) points/)?.[1] || '0');
        const playerIdx = move.player === 'Calm' ? 0 : 1;

        if (board.points[playerIdx] < points) {
          throw new Error(`Expected ${move.player} to have ${points} points, but has ${board.points[playerIdx]}`);
        }
      }
    }
  }

  private parseGameLog(gameLog: string): GameMove[] {
    const lines = gameLog.trim().split('\n').filter(line => line.trim().length > 0);
    const moves: GameMove[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('Calm ')) {
        const action = trimmed.substring(5);
        moves.push(this.parseMove('Calm', action));
      } else if (trimmed.startsWith('katto ')) {
        const action = trimmed.substring(6);
        moves.push(this.parseMove('katto', action));
      } else if (trimmed.startsWith('The round is over')) {
        const match = trimmed.match(/(\w+) got (\d+) points/);
        if (match) {
          moves.push({
            player: match[1] as 'Calm' | 'katto',
            action: 'round_end',
            expectedResult: `${match[2]} points`
          });
        }
      }
    }

    return moves;
  }

  private parseMove(player: 'Calm' | 'katto', action: string): GameMove {
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
      const card = action.match(/reacted with (\w+)/)?.[1];
      return { player, action: 'react', details: card };
    } else if (action.includes('disgraced')) {
      return { player, action: 'disgrace', details: action };
    } else if (action.includes('moved') && action.includes('antechamber')) {
      const card = action.match(/moved (\w+) to the antechamber/)?.[1];
      return { player, action: 'move_to_antechamber', details: card };
    } else if (action.includes('took the successor')) {
      const card = action.match(/took the successor \((\w+)\)/)?.[1];
      return { player, action: 'take_successor', details: card };
    } else if (action.includes('took the squire')) {
      const card = action.match(/took the squire \((\w+)\)/)?.[1];
      return { player, action: 'take_squire', details: card };
    }

    return { player, action: 'unknown', details: action };
  }

  private parseSetupInformation(gameLog: string): void {
    this.gameLogger.log('=== PARSING SETUP INFORMATION ===');

    const lines = gameLog.split('\n');

    // Parse signature cards
    for (const line of lines) {
      const trimmed = line.trim();

      // Parse signature card selection: "Calm chose the signature cards FlagBearer, Stranger, Aegis."
      const signatureMatch = trimmed.match(/(\w+) chose the signature cards (.+)\./);
      if (signatureMatch) {
        const player = signatureMatch[1];
        const cards = signatureMatch[2].split(', ').map(card => card.trim());
        this.parsedSignatureCards[player] = cards;
        this.gameLogger.log(`Parsed signature cards for ${player}: ${cards.join(', ')}`);
      }

      // Parse starting hands: "Calm: Soldier, Soldier, Queen, King's Hand, Immortal, Elder, Oathbound, Assassin, Princess"
      const handMatch = trimmed.match(/^(\w+): (.+)$/);
      if (handMatch && !trimmed.includes('chose')) {
        const player = handMatch[1];
        const cards = handMatch[2].split(', ').map(card => card.trim().replace(/'/g, '').replace(/ /g, ''));
        this.parsedStartingHands[player] = cards;
        this.gameLogger.log(`Parsed starting hand for ${player}: ${cards.join(', ')}`);
      }

      // Parse accused card: "Accused card: Zealot"
      const accusedMatch = trimmed.match(/Accused card: (\w+)/);
      if (accusedMatch) {
        this.parsedAccusedCard = accusedMatch[1];
        this.gameLogger.log(`Parsed accused card: ${this.parsedAccusedCard}`);
      }
    }
  }

  private async setupDeterministicGame(): Promise<void> {
    // Set global hands for the local service to use
    if (Object.keys(this.parsedStartingHands).length > 0 || this.parsedAccusedCard) {
      (global as any).regressionTestHands = {
        calm: this.parsedStartingHands['Calm'] || ['Soldier', 'Soldier', 'Queen', 'KingsHand', 'Immortal', 'Elder', 'Oathbound', 'Assassin', 'Princess'],
        katto: this.parsedStartingHands['katto'] || ['Elder', 'Warden', 'Sentry', 'Inquisitor', 'Inquisitor', 'Warlord', 'Judge', 'Mystic', 'Fool'],
        accused: this.parsedAccusedCard || 'Zealot'
      };
      this.gameLogger.log('Set global hands for deterministic game');
    }

    await this.completeSignatureCardSelection();
  }

  private parseGameActions(gameLog: string): GameMove[] {
    const lines = gameLog.split('\n');
    const moves: GameMove[] = [];
    let inActionsSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip until we reach the Actions section
      if (trimmed === '## Actions') {
        inActionsSection = true;
        continue;
      }

      if (!inActionsSection || trimmed.length === 0 || trimmed.startsWith('#')) {
        continue;
      }

      // Parse action lines
      if (trimmed.startsWith('Calm ')) {
        const action = trimmed.substring(5);
        moves.push(this.parseMove('Calm', action));
      } else if (trimmed.startsWith('katto ')) {
        const action = trimmed.substring(6);
        moves.push(this.parseMove('katto', action));
      } else if (trimmed.startsWith('The round is over')) {
        const match = trimmed.match(/(\w+) got (\d+) points/);
        if (match) {
          moves.push({
            player: match[1] as 'Calm' | 'katto',
            action: 'round_end',
            expectedResult: `${match[2]} points`
          });
        }
      }
    }

    this.gameLogger.log(`Parsed ${moves.length} game actions`);
    return moves;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run regression test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const test = new RegressionTest();
  test.runRegressionTest().catch(console.error);
}
