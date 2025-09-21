import { ScreenManager, SelectableItem } from './screen.js';
import { InputManager, KeyEvent } from './input.js';
import type { GameBoard, GameAction, CardName, HandCard } from '../types/game.js';

export interface GameUIConfig {
  testMode?: boolean;
  testInputs?: string[];
  playerNames?: [string, string];
  introspectionMode?: boolean; // Enable detailed state introspection for testing
}

export class GameUI {
  private screen: ScreenManager;
  private input: InputManager;
  private playerNames: [string, string];
  private isRunning: boolean = false;

  constructor(config: GameUIConfig = {}) {
    this.screen = new ScreenManager();
    this.input = new InputManager();
    this.playerNames = config.playerNames || ['Player 1', 'Player 2'];

    if (config.testMode && config.testInputs) {
      this.input.enableTestMode(config.testInputs);
    }

    // Enable introspection mode if requested
    if (config.introspectionMode) {
      this.screen.enableIntrospection();
    }

    // Handle graceful shutdown
    this.input.on('keypress', (key: KeyEvent) => {
      if (key.ctrl && key.name === 'c') {
        this.shutdown();
        process.exit(0);
      }
    });
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.input.startListening();
  }

  shutdown(): void {
    this.isRunning = false;
    this.input.stopListening();
    this.input.disableTestMode();

    // Restore terminal
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    console.clear();
  }

  setPlayerNames(names: [string, string]): void {
    this.playerNames = names;
  }

  // Main game display and interaction
  async displayGameAndWaitForAction(
    board: GameBoard,
    availableActions: GameAction[],
    playerIdx: number
  ): Promise<GameAction | null> {
    // Convert actions to selectable items
    const selectableItems = this.createSelectableItems(board, availableActions, playerIdx);
    this.screen.setSelectableItems(selectableItems);

    // Initial render
    this.screen.drawGameScreen(board, playerIdx, this.playerNames);

    // Handle input loop
    while (this.isRunning) {
      const key = await this.input.waitForNavigation();

      switch (key) {
        case 'up':
          this.screen.moveSelection('up');
          this.screen.drawGameScreen(board, playerIdx, this.playerNames);
          break;

        case 'down':
          this.screen.moveSelection('down');
          this.screen.drawGameScreen(board, playerIdx, this.playerNames);
          break;

        case 'enter':
          const selected = this.screen.getSelectedItem();
          if (selected && selected.enabled) {
            // Show card preview dialog if it's a card
            if (selected.id.startsWith('hand_') || selected.id.startsWith('court_')) {
              const result = await this.showCardPreviewDialog(selected, board, availableActions);
              if (result) {
                return result;
              }
            } else if (selected.data && selected.data.action) {
              return selected.data.action;
            }
          }
          this.screen.drawGameScreen(board, playerIdx, this.playerNames);
          break;

        case 'escape':
          return null;
      }
    }

    return null;
  }

  // Render current state even if there are no actions (for visual mode)
  renderBoard(board: GameBoard, playerIdx: number): void {
    this.screen.setSelectableItems([]);
    this.screen.drawGameScreen(board, playerIdx, this.playerNames);
  }

  private createSelectableItems(
    board: GameBoard,
    availableActions: GameAction[],
    playerIdx: number
  ): SelectableItem[] {
    const items: SelectableItem[] = [];

    // Add hand cards as selectable items
    board.hands[playerIdx].forEach((card, idx) => {
      const cardName = typeof card.card === 'object' ? card.card.card : 'Hidden';
      const playActions = availableActions.filter(action =>
        action.type === 'PlayCard' && action.card === cardName
      );

      items.push({
        id: `hand_${idx}`,
        text: `${this.getDisplayName(cardName as CardName)}`,
        description: this.getCardDescription(cardName as CardName, playActions.length > 0),
        enabled: playActions.length > 0 || cardName !== 'Hidden',
        data: { cardIndex: idx, card: cardName, playActions }
      });
    });

    // Add other available actions
    availableActions.forEach((action, idx) => {
      if (action.type !== 'PlayCard') {
        items.push({
          id: `action_${idx}`,
          text: this.formatActionText(action),
          description: this.getActionDescription(action),
          enabled: true,
          data: { action }
        });
      }
    });

    return items;
  }

  private async showCardPreviewDialog(
    selectedItem: SelectableItem,
    board: GameBoard,
    availableActions: GameAction[]
  ): Promise<GameAction | null> {
    const cardName = selectedItem.data.card as CardName;
    const playActions = selectedItem.data.playActions as GameAction[];

    if (cardName === 'Hidden' as any) {
      this.screen.showCardDialog('Hidden Card', cardName, 'This card is hidden from view.', []);
      await this.input.waitForKey(['escape', 'return']);
      this.screen.hideDialog();
      return null;
    }

    // Create dialog options
    const dialogActions: string[] = [];
    if (playActions.length > 0) {
      dialogActions.push('Play with ability');
      dialogActions.push('Play without ability');
    } else {
      dialogActions.push('Card not playable');
    }
    dialogActions.push('Cancel');

    this.screen.showCardDialog(
      'Card Preview',
      cardName,
      this.getCardDescription(cardName, playActions.length > 0),
      dialogActions
    );

    // Wait for dialog input
    while (true) {
      const key = await this.input.waitForKey(['1', '2', '3', 'escape', 'return']);

      if (key.name === 'escape' || key.name === 'return') {
        this.screen.hideDialog();
        return null;
      }

      if (key.name === '1' && playActions.length > 0) {
        // Play with ability
        this.screen.hideDialog();
        const action = playActions[0];
        if (action.type === 'PlayCard') {
          return { ...action, ability: { type: 'Simple' } as any };
        }
        return action;
      }

      if (key.name === '2' && playActions.length > 0) {
        // Play without ability
        this.screen.hideDialog();
        const action = playActions[0];
        if (action.type === 'PlayCard') {
          return { ...action, ability: null };
        }
        return action;
      }

      if (key.name === '3' || (key.name === '1' && playActions.length === 0)) {
        // Cancel
        this.screen.hideDialog();
        return null;
      }
    }
  }

  private getDisplayName(cardName: CardName | string): string {
    const nameMap: Partial<Record<CardName, string>> = {
      'Fool': 'Fool',
      'FlagBearer': 'Flag Bearer',
      'Assassin': 'Assassin',
      'Stranger': 'Stranger',
      'Elder': 'Elder',
      'Zealot': 'Zealot',
      'Aegis': 'Aegis',
      'Inquisitor': 'Inquisitor',
      'Ancestor': 'Ancestor',
      'Informant': 'Informant',
      'Nakturn': 'Nakturn',
      'Soldier': 'Soldier',
      'Judge': 'Judge',
      'Lockshift': 'Lockshift',
      'Herald': 'Herald',
      'Executioner': 'Executioner',
      'Immortal': 'Immortal',
      'Oathbound': 'Oathbound',
      'Conspiracist': 'Conspiracist',
      'Mystic': 'Mystic',
      'Warlord': 'Warlord',
      'Warden': 'Warden',
      'Sentry': 'Sentry',
      'Spy': 'Spy',
      'KingsHand': "King's Hand",
      'Exile': 'Exile',
      'Princess': 'Princess',
      'Queen': 'Queen',
      'Oracle': 'Oracle',
      'Impersonator': 'Impersonator',
      'Elocutionist': 'Elocutionist',
      'Arbiter': 'Arbiter',
      'Bard': 'Bard',
    };

    return nameMap[cardName as CardName] || cardName;
  }

  private getCardDescription(cardName: CardName, canPlay: boolean): string {
    const baseValue = this.getCardBaseValue(cardName);
    const ability = this.getCardAbilityDescription(cardName);

    let description = `Base Value: ${baseValue}\n`;
    if (ability) {
      description += `Ability: ${ability}\n`;
    }
    description += canPlay ? 'Can be played this turn' : 'Cannot be played this turn';

    return description;
  }

  private getCardBaseValue(cardName: CardName): number {
    const baseValues: Record<string, number> = {
      'Fool': 1, 'FlagBearer': 1, 'Assassin': 2, 'Stranger': 2, 'Elder': 3, 'Zealot': 3, 'Aegis': 3,
      'Inquisitor': 4, 'Ancestor': 4, 'Informant': 4, 'Nakturn': 4, 'Soldier': 5, 'Judge': 5, 'Lockshift': 5,
      'Immortal': 6, 'Oathbound': 6, 'Conspiracist': 6, 'Mystic': 7, 'Warlord': 7, 'Warden': 7,
      'Sentry': 8, 'KingsHand': 8, 'Exile': 8, 'Princess': 9, 'Queen': 9
    };
    return baseValues[cardName] || 0;
  }

  private getCardAbilityDescription(cardName: CardName): string {
    const abilities: Partial<Record<CardName, string>> = {
      'Fool': 'Choose a court card and take it',
      'Assassin': 'React to flip king attempts',
      'Stranger': 'Copy another court card\'s ability',
      'Elder': 'Gain +1 value for each Elder in court',
      'Zealot': 'Remove a disgraced card from court',
      'Aegis': 'Disgrace the throne card',
      'Inquisitor': 'Name a card; opponent moves it to antechamber',
      'Ancestor': 'All your cards gain +1 value this round',
      'Soldier': 'Name a card; disgrace all copies in court',
      'Judge': 'Swap two cards in opponent\'s hand',
      'Immortal': 'Cannot be disgraced',
      'Oathbound': 'Play an additional card this turn',
      'Conspiracist': 'All your cards gain +1 value permanently',
      'Mystic': 'Guess number of cards in opponent\'s hand',
      'Warlord': 'Gain +1 value for each card you\'ve played',
      'Warden': 'Swap accused card with a hand card',
      'Sentry': 'Choose a court card and swap it with a hand card',
      'KingsHand': 'React to condemn cards',
      'Exile': 'Remove target card from the game',
      'Princess': 'Swap a card between hands',
      'Queen': 'Draw a card from the deck',
      'FlagBearer': 'Special scoring conditions',
      'Informant': 'Look at opponent\'s hand',
      'Nakturn': 'Play during opponent\'s turn',
      'Lockshift': 'Lock card values'
    };

    return abilities[cardName] || 'No special ability';
  }

  private formatActionText(action: GameAction): string {
    switch (action.type) {
      case 'EndMuster':
        return 'End Muster Phase';
      case 'FlipKing':
        return 'Flip King';
      case 'NoReaction':
        return 'No Reaction';
      case 'Reaction':
        return `React with ${this.getDisplayName(action.card)}`;
      case 'ChooseWhosFirst':
        return `Choose Player ${action.player_idx + 1} to go first`;
      case 'Discard':
        return `Discard ${this.getDisplayName(action.card)}`;
      case 'Recruit':
        return `Recruit ${this.getDisplayName(action.army_card)}`;
      default:
        return action.type;
    }
  }

  private getActionDescription(action: GameAction): string {
    switch (action.type) {
      case 'EndMuster':
        return 'End the muster phase and begin regular play';
      case 'FlipKing':
        return 'Flip your king to end the round';
      case 'NoReaction':
        return 'Choose not to react to the opponent\'s action';
      case 'Reaction':
        return `Use ${this.getDisplayName(action.card)} as a reaction`;
      default:
        return 'Perform this action';
    }
  }

  // For testing: enable test mode
  enableTestMode(inputs: string[]): void {
    this.input.enableTestMode(inputs);
  }

  // For testing: simulate input
  simulateInput(input: string): void {
    this.input.simulateKeypress(input);
  }

  // For testing: get current introspection state
  getIntrospectionState(): {
    selectableItems: SelectableItem[];
    currentStatus: string;
    playerIndex: number;
  } {
    const items = this.screen.getSelectableItems();
    return {
      selectableItems: items,
      currentStatus: this.screen.getCurrentStatus(),
      playerIndex: this.screen.getCurrentPlayerIndex()
    };
  }

  // For testing: get available actions from current state
  getAvailableActions(): GameAction[] {
    const state = this.getIntrospectionState();
    return state.selectableItems
      .filter(item => item.data && item.data.action)
      .map(item => item.data.action);
  }

  // For testing: determine what key inputs are needed for a specific action
  getKeyInputsForAction(action: GameAction): string[] {
    const state = this.getIntrospectionState();
    const items = state.selectableItems;

    // Find the selectable item for this action
    const targetItem = items.find(item => {
      if (item.data && item.data.action) {
        return this.actionsEqual(item.data.action, action);
      }
      return false;
    });

    if (!targetItem) {
      return [];
    }

    // Determine the navigation needed to reach this item
    const currentIndex = this.screen.getCurrentSelectionIndex();
    const targetIndex = items.indexOf(targetItem);

    const inputs: string[] = [];

    // Navigate to the target item
    if (targetIndex > currentIndex) {
      for (let i = currentIndex; i < targetIndex; i++) {
        inputs.push('down');
      }
    } else if (targetIndex < currentIndex) {
      for (let i = currentIndex; i > targetIndex; i--) {
        inputs.push('up');
      }
    }

    // Select the item
    inputs.push('return');

    return inputs;
  }

  // Helper method to compare actions (simplified)
  private actionsEqual(a1: GameAction, a2: GameAction): boolean {
    return JSON.stringify(a1) === JSON.stringify(a2);
  }

  // For testing: get card selection inputs (for card preview dialogs)
  getCardSelectionInputs(cardName: CardName, useAbility: boolean = true): string[] {
    // This would handle the card preview dialog interactions
    const inputs: string[] = [];

    // Number keys for dialog options
    if (useAbility) {
      inputs.push('1'); // Play with ability
    } else {
      inputs.push('2'); // Play without ability
    }

    return inputs;
  }
}
