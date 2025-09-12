import inquirer from 'inquirer';
import type { GameAction, CardName } from '../types/game.js';

export class GamePrompts {
  async promptMainMenu(): Promise<'create' | 'join' | 'quit'> {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Create a new game', value: 'create' },
          { name: 'Join an existing game', value: 'join' },
          { name: 'Quit', value: 'quit' },
        ],
      },
    ]);
    return action;
  }

  async promptPlayerName(): Promise<string> {
    const { name } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Enter your player name:',
        validate: (input: string) => {
          if (input.trim().length === 0) {
            return 'Player name cannot be empty';
          }
          if (input.trim().length > 20) {
            return 'Player name must be 20 characters or less';
          }
          return true;
        },
      },
    ]);
    return name.trim();
  }

  async promptGameId(): Promise<number> {
    const { gameId } = await inquirer.prompt([
      {
        type: 'input',
        name: 'gameId',
        message: 'Enter the game ID:',
        validate: (input: string) => {
          const num = parseInt(input);
          if (isNaN(num) || num <= 0) {
            return 'Please enter a valid game ID (positive number)';
          }
          return true;
        },
      },
    ]);
    return parseInt(gameId);
  }

  async promptJoinToken(): Promise<string> {
    const { token } = await inquirer.prompt([
      {
        type: 'input',
        name: 'token',
        message: 'Enter the join token:',
        validate: (input: string) => {
          if (input.trim().length === 0) {
            return 'Join token cannot be empty';
          }
          return true;
        },
      },
    ]);
    return token.trim();
  }

  async promptAddBot(): Promise<boolean> {
    const { addBot } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'addBot',
        message: 'Would you like to add a bot to fill the remaining slot?',
        default: false,
      },
    ]);
    return addBot;
  }

  async promptAction(actions: GameAction[]): Promise<number> {
    if (actions.length === 0) {
      throw new Error('No actions available');
    }

    if (actions.length === 1) {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Perform action: ${this.formatActionForPrompt(actions[0])}?`,
          default: true,
        },
      ]);
      return confirm ? 0 : -1;
    }

    const { actionIndex } = await inquirer.prompt([
      {
        type: 'list',
        name: 'actionIndex',
        message: 'Choose an action:',
        choices: actions.map((action, index) => ({
          name: this.formatActionForPrompt(action),
          value: index,
        })),
      },
    ]);
    return actionIndex;
  }

  async promptSignatureCardSelection(
    cards: Array<{ card: CardName; flavor: number }>,
    count: number
  ): Promise<number[]> {
    const { selectedIndices } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedIndices',
        message: `Choose ${count} signature cards:`,
        choices: cards.map((card, index) => ({
          name: this.getDisplayName(card.card),
          value: index,
        })),
        validate: (input: number[]) => {
          if (input.length !== count) {
            return `Please select exactly ${count} cards`;
          }
          return true;
        },
      },
    ]);
    return selectedIndices;
  }

  async promptCardSelection(cards: Array<{ name: string; value: any }>): Promise<any> {
    if (cards.length === 0) {
      throw new Error('No cards available to select');
    }

    const { selection } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selection',
        message: 'Choose a card:',
        choices: cards,
      },
    ]);
    return selection;
  }

  async promptConfirmation(message: string): Promise<boolean> {
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message,
        default: false,
      },
    ]);
    return confirmed;
  }

  async promptContinue(): Promise<void> {
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: 'Press Enter to continue...',
      },
    ]);
  }

  async promptRetry(): Promise<boolean> {
    const { retry } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'retry',
        message: 'Would you like to try again?',
        default: true,
      },
    ]);
    return retry;
  }

  private formatActionForPrompt(action: GameAction): string {
    switch (action.type) {
      case 'ChooseSignatureCards':
        const cardNames = action.cards.map(([, card]) => this.getDisplayName(card)).join(', ');
        return `Choose signature cards: ${cardNames}`;

      case 'StartNewRound':
        return 'Start new round';

      case 'Discard':
        return `Discard ${this.getDisplayName(action.card)}`;

      case 'PlayCard':
        return `Play ${this.getDisplayName(action.card)}`;

      case 'EndMuster':
        return 'End muster phase';

      case 'Rally':
        return `Rally ${this.getDisplayName(action.army_card)}`;

      case 'Recruit':
        return `Recruit ${this.getDisplayName(action.army_card)}`;

      case 'Exhaust':
        return `Exhaust ${this.getDisplayName(action.army_card)}`;

      case 'Unexhaust':
        return `Recall ${this.getDisplayName(action.army_card)}`;

      case 'ChooseWhosFirst':
        return `Choose player ${action.player_idx + 1} to go first`;

      case 'FlipKing':
        return 'Flip King';

      case 'TakeSuccessor':
        return 'Take Successor';

      case 'TakeSquire':
        return 'Take Squire';

      case 'NoReaction':
        return 'No reaction';

      case 'Reaction':
        return `React with ${this.getDisplayName(action.card)}`;

      default:
        return action.type;
    }
  }

  private getDisplayName(cardName: CardName): string {
    const nameMap: Record<CardName, string> = {
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
      'Immortal': 'Immortal',
      'Oathbound': 'Oathbound',
      'Conspiracist': 'Conspiracist',
      'Mystic': 'Mystic',
      'Warlord': 'Warlord',
      'Warden': 'Warden',
      'Sentry': 'Sentry',
      'KingsHand': "King's Hand",
      'Exile': 'Exile',
      'Princess': 'Princess',
      'Queen': 'Queen',
    };

    return nameMap[cardName] || cardName;
  }
}
