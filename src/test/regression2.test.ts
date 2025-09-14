import { LocalGameServer } from '../server/server.js';
import { ImposterKingsAPIClient } from '../api/client.js';
import { Logger } from '../utils/logger.js';
import type { GameAction, GameEvent, GameBoard, GameStatus } from '../types/game.js';

interface GameMove {
  player: 'Calm' | 'melissa';
  action: string;
  details?: string;
  expectedResult?: string;
}

export class RegressionTest2 {
  private server: LocalGameServer;
  private logger: Logger;
  private gameLogger: Logger;
  private client1: ImposterKingsAPIClient; // Calm
  private client2: ImposterKingsAPIClient; // melissa
  private gameId: number = 0;
  private calmToken: string = '';
  private melissaToken: string = '';

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.server = new LocalGameServer(3004);
    this.logger = new Logger(`regression-test2-${timestamp}.log`);
    this.gameLogger = new Logger(`game-replay2-${timestamp}.log`);

    this.client1 = new ImposterKingsAPIClient('http://localhost:3004');
    this.client2 = new ImposterKingsAPIClient('http://localhost:3004');
  }

  async runRegressionTest(): Promise<void> {
    console.log('🧪 Running Regression Test 2: Calm vs melissa (Multi-round Game)');
    console.log('=' .repeat(80));

    try {
      // Start server
      await this.server.start();
      console.log('✅ Test server started on port 3004');

      // Parse the game log first to get the hands
      this.parseSetupInformation(this.getFullGameLog());
      this.setGlobalHands();

      // Setup game with specific players
      await this.setupGame();

      // Parse and execute the game replay
      await this.executeGameReplay();

      console.log('🎉 Regression test 2 completed!');

    } catch (error) {
      this.logger.error('Regression test 2 failed', error as Error);
      console.error('❌ Regression test 2 failed:', error);
    } finally {
      this.server.stop();
      this.logger.close();
      this.gameLogger.close();
    }
  }

  private async setupGame(): Promise<void> {
    this.gameLogger.log('=== GAME SETUP: Calm vs melissa ===');

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

    const melissaJoin = await this.client2.joinGame({
      game_id: this.gameId,
      join_token: joinToken,
      player_name: 'melissa'
    });
    this.melissaToken = melissaJoin.player_token;

    this.gameLogger.log(`Players joined - Calm: ${this.calmToken}, melissa: ${this.melissaToken}`);
    console.log(`✅ Game setup complete - Calm vs melissa`);
  }

  private parsedSignatureCards: { [player: string]: string[] } = {};
  private parsedStartingHands: { [player: string]: string[] } = {};
  private parsedAccusedCard: string = '';

  private async completeSignatureCardSelection(): Promise<void> {
    this.gameLogger.log('=== SIGNATURE CARD SELECTION PHASE ===');

    // Use parsed signature cards
    const calmCards = this.parsedSignatureCards['Calm'] || ['Aegis', 'Ancestor', 'Exile'];
    const melissaCards = this.parsedSignatureCards['melissa'] || ['Stranger', 'Ancestor', 'Conspiracist'];

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

    const melissaSignatureAction = {
      type: 'ChooseSignatureCards' as const,
      cards: melissaCards.map(card => [signatureCardList.indexOf(card), card]) as Array<[number, string]>
    };

    events = await this.client2.getEvents(this.gameId, this.melissaToken, 0);
    await this.client2.sendAction(this.gameId, this.melissaToken, events.length, melissaSignatureAction);
    this.gameLogger.log(`melissa selected signature cards: ${melissaCards.join(', ')}`);

    // Wait for transition to mustering phase
    await this.sleep(200);

    this.gameLogger.log('✅ Signature card selection completed, should be in mustering phase');
  }

  private getFullGameLog(): string {
    return `
# Calm vs melissa Multi-round Game

## Setup
Calm chose the signature cards Aegis, Ancestor, Exile.
melissa chose the signature cards Stranger, Ancestor, Conspiracist.

## Round 1

Starting hands:
melissa: Judge, Immortal, KingsHand, Warden, Zealot, Oathbound, Queen, Inquisitor, Sentry
Calm: Soldier, Fool, Princess, Mystic, Elder, Oathbound, Inquisitor, Soldier, Warlord

Accused: Assassin
Dealt Out: Elder

## Actions
melissa decided that Calm goes first.

melissa recruited Conspiracist.
melissa discarded Judge.
melissa exhausted Soldier.
melissa ended muster.

Calm ended muster.

Calm discarded Soldier.
Calm picked Inquisitor as successor.

melissa discarded Zealot.
melissa picked Oathbound as successor.

Calm played Soldier and said card name "Queen".
Calm disgraced 0 cards.

melissa chose no reaction.

melissa played Warden with no ability.

Calm played Mystic with no ability.

melissa chose no reaction.

melissa played Queen with ability.

Calm played Elder with ability.

melissa played Immortal with ability.

Calm played Warlord with ability.

melissa flipped the king.
melissa took the successor (Oathbound).

Calm played Fool with ability.
Calm picked Queen from the court.

melissa reacted with KingsHand.
Calm condemned.
Fool condemned.

Calm played Oathbound with no ability.

melissa played Conspiracist with ability.

Calm flipped the king.
Calm took the successor (Inquisitor).

melissa played Sentry with no ability.

The round is over, melissa got 2 points.

## Round 2

Starting hands:
melissa: Warden, Mystic, Oathbound, Inquisitor, Soldier, Fool, Oathbound, Zealot, Soldier
Calm: Judge, Inquisitor, Assassin, Elder, Sentry, Princess, Elder, Queen, Warlord

Accused: KingsHand
Dealt Out: Immortal

## Actions
Calm decided that Calm goes first.

melissa recruited Stranger.
melissa discarded Zealot.
melissa exhausted Judge.
melissa selected new King: Charismatic Leader.
melissa ended muster.

Calm ended muster.

Calm discarded Judge.
Calm picked Elder as successor.

melissa discarded Soldier.
melissa picked Oathbound as successor.

Calm played Inquisitor and said card name "KingsHand".
Nothing happened.

melissa played Inquisitor and said card name "Assassin".
Calm moved Assassin to the antechamber.

Calm played Assassin with no ability.

melissa played Warden with ability.
melissa swapped accused KingsHand with Oathbound.

Calm played Warlord with no ability.

melissa played Mystic with no ability.

Calm played Sentry with no ability.

melissa played KingsHand with no ability.

Calm flipped the king.

melissa reacted with Stranger (copying Assassin).

The round is over, melissa got 3 points.

## Round 3

Starting hands:
melissa: Princess, Warlord, Sentry, Mystic, Flood, Elder, Zealot, Judge, Oathbound
Calm: KingsHand, Immortal, Assassin, Inquisitor, Warden, Oathbound, Inquisitor, Soldier, Queen

Accused: Soldier
Dealt Out: Elder

## Actions
Calm decided that Calm goes first.

melissa recruited Inquisitor.
melissa discarded Judge.
melissa exhausted Elder.
melissa selected new King: Master Tactician.
melissa ended muster.

Calm ended muster.

melissa discarded Zealot.

Calm discarded Soldier.
Calm picked Immortal as successor.

melissa picked Oathbound as successor.
melissa picked Fool as squire.

Calm played Inquisitor and said card name "Elder".
melissa moved Elder to the antechamber.

melissa played Elder with no ability.

Calm played Inquisitor and said card name "Princess".
melissa moved Princess to the antechamber.

melissa played Princess with ability.
melissa swapped Mystic with Warden.

Calm played Oathbound with ability.

Calm played Mystic and said number 1.

melissa played Inquisitor and said card name "Assassin".

Calm reacted with KingsHand.

melissa played Sentry and picked Oathbound from the court.
melissa swapped Warden with Oathbound.

Calm played Queen with ability.

melissa played Oathbound with ability.

melissa played Warlord with no ability.

Calm flipped the king.
Calm took the successor (Immortal).

melissa flipped the king.

Calm reacted with Assassin.

The round is over, Calm got 2 points.

## Round 4

Starting hands:
melissa: Zealot, Elder, Soldier, Assassin, Inquisitor, Soldier, Oathbound, Oathbound, Warlord
Calm: Fool, Warden, Mystic, Elder, Inquisitor, Judge, Sentry, KingsHand, Immortal

Accused: Queen
Dealt Out: Princess

## Actions
melissa decided that melissa goes first.

Calm recruited Aegis.
Calm discarded Judge.
Calm exhausted Judge.
Calm selected new King: Charismatic Leader.
Calm ended muster.

melissa recruited Ancestor.
melissa discarded Oathbound.
melissa exhausted Oathbound.
melissa ended muster.

melissa discarded Soldier.
melissa picked Zealot as successor.

Calm discarded Elder.
Calm picked Immortal as successor.

melissa played Inquisitor and said card name "Immortal".
Nothing happened.

Calm played Inquisitor and said card name "Princess".
Nothing happened.

melissa played Soldier and said card name "KingsHand".
melissa disgraced Inquisitor, Inquisitor.

Calm played Mystic with no ability.

melissa played Oathbound with ability.

melissa played Ancestor with no ability.

Calm played Warden with ability.
Calm swapped accused Queen with Fool.

melissa played Warlord with no ability.

Calm played Sentry with no ability.

melissa flipped the king.
melissa took the successor (Zealot).

Calm played KingsHand with no ability.

melissa played Zealot with ability.

Calm played Queen with ability.

melissa played Elder with ability.

Calm played Aegis with ability.
Calm disgraced Queen.

The round is over, Calm got 3 points.

## Round 5

Starting hands:
melissa: Oathbound, Inquisitor, Mystic, Soldier, Elder, Elder, Sentry, Oathbound, Judge
Calm: Immortal, Assassin, KingsHand, Inquisitor, Warden, Fool, Zealot, Warlord, Soldier

Accused: Princess
Dealt Out: Queen

## Actions
melissa decided that melissa goes first.

Calm recruited Ancestor.
Calm discarded Inquisitor.
Calm exhausted Soldier.
Calm recruited Elder.
Calm discarded Zealot.
Calm recruited Oathbound.
Calm discarded Soldier.
Calm ended muster.

melissa ended muster.

Calm discarded Immortal.
Calm picked Warlord as successor.

melissa discarded Oathbound.
melissa picked Elder as successor.

melissa played Inquisitor and said card name "Queen".
Nothing happened.

Calm played KingsHand with no ability.

melissa played Sentry and picked KingsHand from the court.
melissa swapped Judge with KingsHand.

Calm flipped the king.
Calm took the successor (Warlord).

melissa played Mystic and said number 4.

Calm played Ancestor with no ability.

melissa played Soldier and said card name "Warden".
melissa disgraced Inquisitor, Judge, Ancestor.

Calm played Warlord with no ability.

melissa played Oathbound with ability.

melissa played Elder with no ability.

Calm played Warden with ability.
Calm swapped accused Princess with Elder.

melissa flipped the king.

Calm reacted with Assassin.

melissa reacted with KingsHand.

melissa took the successor (Elder).

Calm played Princess with ability.
Calm swapped Fool with Elder.

The round is over, Calm got 2 points.

The game is over with score 7:5.
    `;
  }

  private async executeGameReplay(): Promise<void> {
    this.gameLogger.log('=== EXECUTING GAME REPLAY ===');

    const fullGameLog = this.getFullGameLog();

    // Set up deterministic hands in the game engine
    await this.setupDeterministicGame();

    // Parse and execute actions
    const gameReplay = this.parseGameActions(fullGameLog);

    let moveCount = 0;

    for (const move of gameReplay) {
      moveCount++;
      this.gameLogger.log(`\n--- MOVE ${moveCount}: ${move.player} ${move.action} ${move.details || ''} ---`);

      try {
        await this.executeMove(move, moveCount);

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
      this.gameLogger.log(`Final Score: Calm ${finalScore[0]} - melissa ${finalScore[1]}`);

      if (finalScore[0] === 7 && finalScore[1] === 5) {
        console.log('✅ Final score matches expected: Calm 7 - melissa 5');
      } else {
        throw new Error(`Score mismatch! Expected Calm 7 - melissa 5, got Calm ${finalScore[0]} - melissa ${finalScore[1]}`);
      }
    }
  }

  private parseMove(player: 'Calm' | 'melissa', action: string): GameMove {
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
      const match = action.match(/reacted with (.+?)(?:\s*\(|\.|\s*$)/);
      const card = match?.[1]?.replace(/'/g, '').replace(/ /g, '').replace(/\.$/, '');
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
    } else if (action.includes('chose no reaction')) {
      return { player, action: 'no_reaction' };
    } else if (action.includes('condemned')) {
      return { player, action: 'condemned', details: action };
    } else if (action === 'Nothing happened.') {
      return { player, action: 'nothing_happened' };
    }

    return { player, action: 'unknown', details: action };
  }

  private async executeMove(move: GameMove, moveCount: number): Promise<void> {
    this.gameLogger.log(`Executing: ${move.player} ${move.action} ${move.details || ''}`);

    // Use the correct client and token for the player making the move
    const client = move.player === 'Calm' ? this.client1 : this.client2;
    const token = move.player === 'Calm' ? this.calmToken : this.melissaToken;

    // Get current game state using the acting player's client
    const events = await client.getEvents(this.gameId, token, 0);
    const gameState = events.filter(e => e.type === 'NewState').pop();

    if (!gameState || gameState.type !== 'NewState') {
      throw new Error('No valid game state found');
    }

    const currentPlayer = gameState.board.player_idx === 0 ? 'Calm' : 'melissa';

    // Log current game state for debugging
    this.gameLogger.log(`Current game status: ${gameState.status.type}`);
    this.gameLogger.log(`Available actions: ${gameState.actions.length}`);
    gameState.actions.forEach((action, idx) => {
      this.gameLogger.log(`  [${idx}] ${action.type} ${JSON.stringify(action).substring(0, 100)}...`);
    });

    // DEBUG: Log detailed hand state for current player
    if (move.player === 'melissa' && moveCount >= 20) {
      const melissaHandDetailed = gameState.board.hands[1].map((c, idx) =>
        `${idx}:${typeof c.card === 'object' ? c.card.card : 'hidden'}`
      ).join(', ');
      this.gameLogger.log(`  DEBUG melissa detailed hand: [${melissaHandDetailed}]`);

      // Also log available actions to see if Conspiracist is there
      const conspiracistActions = gameState.actions.filter(a =>
        a.type === 'PlayCard' && a.card === 'Conspiracist'
      );
      this.gameLogger.log(`  DEBUG Conspiracist actions available: ${conspiracistActions.length}`);
      if (conspiracistActions.length > 0) {
        this.gameLogger.log(`  DEBUG Conspiracist action: ${JSON.stringify(conspiracistActions[0])}`);
      }
    }

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

      if (move.action === 'choose_first_player' || move.action === 'nothing_happened' || move.action === 'swap' || move.action === 'pick_from_court' ||
          move.action === 'result_description' || move.action === 'disgrace' ||
          move.action === 'take_successor' || move.action === 'condemned') {
        // These are result descriptions, not actions to execute in the current implementation
        this.gameLogger.log(`Skipping result description: ${move.action}`);
        return;
      }

      this.gameLogger.log(`Failed to find action for: ${move.action} with details: ${move.details}`);
      throw new Error(`Could not convert move to action: ${move.action}`);
    }

    this.gameLogger.log(`Converted to action: ${JSON.stringify(action)}`);
    this.gameLogger.log(`Event count: ${events.length}`);

    // Execute the action
    await client.sendAction(this.gameId, token, events.length, action);

    // Wait for update
    await this.sleep(100);
  }

  private convertMoveToAction(move: GameMove, board: GameBoard, availableActions: GameAction[]): GameAction | null {
    switch (move.action) {
      case 'choose_first_player':
        // During first round, this is ChooseWhosFirst
        // During later rounds, this might be a different action or already handled
        const chooseAction = availableActions.find(a => a.type === 'ChooseWhosFirst');
        if (chooseAction) {
          return chooseAction;
        }
        // If not available, this might be a descriptive line that we should skip
        return null;

      case 'recruit':
        return availableActions.find(a =>
          a.type === 'Recruit' && a.army_card === move.details
        ) || null;

      case 'discard':
        // Player chooses which hand card to discard during recruitment
        return availableActions.find(a =>
          a.type === 'Discard' && a.card === move.details
        ) || null;

      case 'exhaust':
        // Player chooses which army card to exhaust during recruitment
        return availableActions.find(a =>
          a.type === 'Exhaust' && a.army_card === move.details
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

      case 'pick_successor':
        // Player chooses successor during successor selection phase
        return availableActions.find(a =>
          a.type === 'ChooseSuccessor' && a.card === move.details
        ) || null;

      case 'pick_squire':
        return availableActions.find(a =>
          a.type === 'PickSquire' && a.card === move.details
        ) || null;

      case 'play_no_ability':
      case 'play_with_ability':
        // Create PlayCard action with correct ability parameter based on move type
        const cardName = move.details;
        const foundAction = availableActions.find(a =>
          a.type === 'PlayCard' && a.card === cardName
        );

        if (foundAction) {
          return {
            ...foundAction,
            ability: move.action === 'play_with_ability' ? {} : null // Use empty object for with_ability, null for no_ability
          };
        }
        return null;

      case 'play_with_name':
      case 'play_with_number':
        const [card, param] = (move.details || '').split(':');
        return availableActions.find(a =>
          a.type === 'PlayCard' && a.card === card
        ) || null;

      case 'flip_king':
        return availableActions.find(a => a.type === 'FlipKing') || null;

      case 'react':
        // Player reacts with a specific card (King's Hand or Assassin)
        return availableActions.find(a =>
          a.type === 'Reaction' && a.card === move.details
        ) || null;

      case 'no_reaction':
        // Player chooses not to react
        return availableActions.find(a => a.type === 'NoReaction') || null;

      case 'take_successor':
        // Taking successor happens automatically when flipping the king
        // This is a result description, not a separate action
        return null;

      case 'take_squire':
        return availableActions.find(a => a.type === 'TakeSquire') || null;

      case 'round_end':
      case 'nothing_happened':
      case 'swap':
      case 'pick_from_court':
      case 'move_to_antechamber':
      case 'disgrace':
      case 'take_successor':
      case 'result_description':
        // These are result descriptions, not actions to execute in the current implementation
        return null;

      default:
        this.logger.log(`Unknown move action: ${move.action}`);
        return null;
    }
  }

  private async verifyGameState(move: GameMove, moveCount: number): Promise<void> {
    // Get updated game state using any client (they should have the same view)
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
    this.gameLogger.log(`  Current Player: ${board.player_idx === 0 ? 'Calm' : 'melissa'}`);
    this.gameLogger.log(`  Score: Calm ${board.points[0]} - melissa ${board.points[1]}`);

    if (board.court.length > 0) {
      const courtSequence = board.court.map(c => {
        const cardName = c.card.card;
        const isDisgraced = c.disgraced;
        const hasSoldierBonus = (c as any).soldierBonus === 2;
        const hasConspiracistBonus = (c as any).conspiracistBonus === 1;

        // Calculate final value (base + bonuses, minimum 1 if disgraced)
        let baseValue = this.getCardBaseValue(cardName);
        if (hasSoldierBonus) baseValue += 2;
        if (hasConspiracistBonus) baseValue += 1;
        const finalValue = isDisgraced ? 1 : baseValue;

        let displayName = cardName;
        if (isDisgraced) displayName += '[D]';
        if (hasSoldierBonus) displayName += '[+2]';
        if (hasConspiracistBonus) displayName += '[+1]';
        displayName += ` (${finalValue})`;

        return displayName;
      }).join(' → ');
      this.gameLogger.log(`  Court: ${courtSequence}`);

      const throneCard = board.court[board.court.length - 1];
      const throneCardName = throneCard.card.card;
      const throneIsDisgraced = throneCard.disgraced;
      const throneHasSoldierBonus = (throneCard as any).soldierBonus === 2;
      const throneHasConspiracistBonus = (throneCard as any).conspiracistBonus === 1;

      let throneBaseValue = this.getCardBaseValue(throneCardName);
      if (throneHasSoldierBonus) throneBaseValue += 2;
      if (throneHasConspiracistBonus) throneBaseValue += 1;
      const throneFinalValue = throneIsDisgraced ? 1 : throneBaseValue;

      let throneDisplay = throneCardName;
      if (throneIsDisgraced) throneDisplay += '[D]';
      if (throneHasSoldierBonus) throneDisplay += '[+2]';
      if (throneHasConspiracistBonus) throneDisplay += '[+1]';
      throneDisplay += ` (${throneFinalValue})`;

      this.gameLogger.log(`  Throne: ${throneDisplay}`);
    }

    // DETAILED HAND STATE DEBUGGING
    const calmHand = board.hands[0].map(c => typeof c.card === 'object' ? c.card.card : 'hidden').join(', ');
    const melissaHand = board.hands[1].map(c => typeof c.card === 'object' ? c.card.card : 'hidden').join(', ');
    this.gameLogger.log(`  Calm Hand (${board.hands[0].length}): ${calmHand}`);
    this.gameLogger.log(`  melissa Hand (${board.hands[1].length}): ${melissaHand}`);

    if (board.antechambers[0].length > 0) {
      this.gameLogger.log(`  Calm Antechamber: ${board.antechambers[0].map(c => typeof c.card === 'object' ? c.card.card : 'hidden').join(', ')}`);
    }
    if (board.antechambers[1].length > 0) {
      this.gameLogger.log(`  melissa Antechamber: ${board.antechambers[1].map(c => typeof c.card === 'object' ? c.card.card : 'hidden').join(', ')}`);
    }

    this.gameLogger.log(`  Accused: ${board.accused.length > 0 ? board.accused[0].card.card : 'none'}`);

    // Show condemned cards if any
    if (board.condemned && board.condemned.length > 0) {
      const condemnedCards = board.condemned.map(c => typeof c === 'object' ? c.card : c).join(', ');
      this.gameLogger.log(`  Condemned: ${condemnedCards}`);
    }

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
    // Set global hands for the local service to use - only for Round 1
    if (Object.keys(this.parsedStartingHands).length > 0 || this.parsedAccusedCard) {
      (global as any).regressionTestHands = {
        calm: this.parsedStartingHands['Calm'] || ['Soldier', 'Fool', 'Princess', 'Mystic', 'Elder', 'Oathbound', 'Inquisitor', 'Soldier', 'Warlord'],
        katto: this.parsedStartingHands['melissa'] || ['Judge', 'Immortal', 'KingsHand', 'Warden', 'Zealot', 'Oathbound', 'Queen', 'Inquisitor', 'Sentry'],
        accused: this.parsedAccusedCard || 'Assassin'
      };
      this.gameLogger.log('Set global hands for deterministic game (Round 1 only)');
    }
    
    // Clear deterministic hands after Round 1 to allow natural card draw for subsequent rounds
    // The army recruitment should be handled naturally by the game
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

      // Parse action lines
      if (trimmed.startsWith('Calm ')) {
        const action = trimmed.substring(5);
        moves.push(this.parseMove('Calm', action));
      } else if (trimmed.startsWith('melissa ')) {
        const action = trimmed.substring(8);
        moves.push(this.parseMove('melissa', action));
      } else if (trimmed.startsWith('The round is over')) {
        const match = trimmed.match(/(\w+) got (\d+) points/);
        if (match) {
          moves.push({
            player: match[1] as 'Calm' | 'melissa',
            action: 'round_end',
            expectedResult: `${match[2]} points`
          });
        }
      } else if (trimmed.startsWith('The game is over')) {
        // Final score verification
        const scoreMatch = trimmed.match(/with score (\d+):(\d+)/);
        if (scoreMatch) {
          moves.push({
            player: 'Calm', // Doesn't matter which player for final verification
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

  private getCardBaseValue(cardName: string): number {
    const baseValues: Record<string, number> = {
      'Fool': 1, 'FlagBearer': 1, 'Assassin': 2, 'Stranger': 2, 'Elder': 3, 'Zealot': 3, 'Aegis': 3,
      'Inquisitor': 4, 'Ancestor': 4, 'Informant': 4, 'Nakturn': 4, 'Soldier': 5, 'Judge': 5, 'Lockshift': 5,
      'Immortal': 6, 'Oathbound': 6, 'Conspiracist': 6, 'Mystic': 7, 'Warlord': 7, 'Warden': 7,
      'Sentry': 8, 'KingsHand': 8, 'Exile': 8, 'Princess': 9, 'Queen': 9
    };
    return baseValues[cardName] || 0;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run regression test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const test = new RegressionTest2();
  test.runRegressionTest().catch(console.error);
}
