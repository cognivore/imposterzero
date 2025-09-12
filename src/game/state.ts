import type {
  GameBoard,
  GameStatus,
  GameAction,
  GameEvent,
  GameMessage,
  CardName,
  HandCard,
} from '../types/game.js';

export class GameState {
  private board: GameBoard | null = null;
  private status: GameStatus | null = null;
  private possibleActions: GameAction[] = [];
  private messages: GameMessage[] = [];
  private events: GameEvent[] = [];
  private playerNames: [string, string] = ['Player 1', 'Player 2'];

  constructor() {}

  setPlayerNames(names: [string, string]): void {
    this.playerNames = names;
  }

  getPlayerNames(): [string, string] {
    return this.playerNames;
  }

  getCurrentBoard(): GameBoard | null {
    return this.board;
  }

  getCurrentStatus(): GameStatus | null {
    return this.status;
  }

  getPossibleActions(): GameAction[] {
    return [...this.possibleActions];
  }

  getMessages(): GameMessage[] {
    return [...this.messages];
  }

  getAllEvents(): GameEvent[] {
    return [...this.events];
  }

  getEventCount(): number {
    return this.events.length;
  }

  processEvent(event: GameEvent): void {
    this.events.push(event);

    switch (event.type) {
      case 'Message':
        this.messages.push(event.message);
        break;

      case 'NewState':
        if (event.reset_ui) {
          this.messages = [];
        }
        this.board = event.board;
        this.status = event.status;
        this.possibleActions = event.actions;
        break;
    }
  }

  processEvents(events: GameEvent[]): void {
    events.forEach(event => this.processEvent(event));
  }

  // Helper methods for game state queries
  isMyTurn(): boolean {
    return this.possibleActions.length > 0;
  }

  getMyPlayerIndex(): number {
    return this.board?.player_idx ?? 0;
  }

  getOpponentPlayerIndex(): number {
    return 1 - this.getMyPlayerIndex();
  }

  getMyHand(): HandCard[] {
    return this.board?.hand ?? [];
  }

  getMyAntechamber(): HandCard[] {
    return this.board?.antechamber ?? [];
  }

  getMyArmy(): any[] {
    const playerIdx = this.getMyPlayerIndex();
    return this.board?.armies[playerIdx] ?? [];
  }

  getOpponentHand(): HandCard[] {
    const opponentIdx = this.getOpponentPlayerIndex();
    return this.board?.hands[opponentIdx] ?? [];
  }

  getCourt(): any[] {
    return this.board?.court ?? [];
  }

  getPoints(): [number, number] {
    return this.board?.points ?? [0, 0];
  }

  getMyPoints(): number {
    const playerIdx = this.getMyPlayerIndex();
    return this.getPoints()[playerIdx];
  }

  getOpponentPoints(): number {
    const opponentIdx = this.getOpponentPlayerIndex();
    return this.getPoints()[opponentIdx];
  }

  isGameOver(): boolean {
    return this.status?.type === 'GameOver';
  }

  getGameOverScore(): [number, number] | null {
    if (this.status?.type === 'GameOver') {
      return this.status.points;
    }
    return null;
  }

  // Action validation helpers
  canChooseSignatureCards(): boolean {
    return this.status?.type === 'SelectSignatureCards';
  }

  getSignatureCardChoices(): { cards: any[]; count: number } | null {
    return this.board?.choose_signature_cards ?? null;
  }

  // Format status for display
  getStatusDescription(): string {
    if (!this.status) return 'Unknown status';

    switch (this.status.type) {
      case 'SelectSignatureCards':
        return 'Choose signature cards';
      case 'NewRound':
        return 'Proceed to the new round';
      case 'Discard':
        return 'Discard a card';
      case 'ChooseWhosFirst':
        return 'Choose who starts';
      case 'Muster':
        return 'Muster';
      case 'Exhaust':
        return 'Exhaust an army card';
      case 'Recall':
        return 'Recall an army card';
      case 'Rally':
        return 'Rally';
      case 'GetRidOfCard':
        return 'Return a card to Army';
      case 'RallyOrTakeDungeon':
        return 'Rally or take a card from the Dungeon';
      case 'PickSuccessor':
        return 'Choose a successor';
      case 'PickSquire':
        return 'Choose a squire';
      case 'RegularMove':
        return 'Make a move';
      case 'PlayCardOfAnyValue':
        return 'Play a card of any value';
      case 'RallyOrTakeSuccessor':
        return 'Rally or take Successor';
      case 'RallyOrTakeSquire':
        return 'Rally or take Squire';
      case 'TakeSuccessorOrSquire':
        return 'Take Successor or Squire';
      case 'ChooseToTakeOneOrTwo':
        return 'Choose to take one or two cards';
      case 'Reaction':
        return 'React (or not)';
      case 'GameOver':
        return `Game over (${this.status.points[0]}:${this.status.points[1]})`;
      case 'Waiting':
        if (this.status.reason === 'Reaction') {
          return 'Waiting for opponent\'s reaction';
        }
        return 'Waiting for opponent';
      case 'PickCardForSwap':
        return 'Pick a card to swap';
      case 'PickForAnte':
        return 'Pick a card to move to the antechamber';
      case 'PickCardsForSentrySwap':
        return 'Pick cards to swap';
      case 'PickCardsToDisgrace':
        return `Pick up to ${this.status.max_count} cards to disgrace`;
      case 'GuessCardPresence':
        return 'Guess';
      case 'CondemnOpponentHandCard':
        return 'Condemn opponent\'s card';
      case 'Observing':
        return 'Observing the game';
      default:
        return 'Unknown status';
    }
  }
}
