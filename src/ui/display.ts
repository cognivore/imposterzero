import chalk from 'chalk';
import type {
  GameBoard,
  GameStatus,
  GameMessage,
  HandCard,
  CardName,
  CourtCard,
  ArmyCard,
} from '../types/game.js';

export class GameDisplay {
  private playerNames: [string, string];

  constructor(playerNames: [string, string] = ['Player 1', 'Player 2']) {
    this.playerNames = playerNames;
  }

  setPlayerNames(names: [string, string]): void {
    this.playerNames = names;
  }

  clear(): void {
    console.clear();
  }

  displayTitle(): void {
    console.log(chalk.bold.blue('='.repeat(60)));
    console.log(chalk.bold.blue('           THE IMPOSTER KINGS - CLI'));
    console.log(chalk.bold.blue('='.repeat(60)));
    console.log();
  }

  displayGameInfo(gameId: number, playerIdx: number): void {
    console.log(chalk.cyan(`Game ID: ${gameId}`));
    console.log(chalk.cyan(`You are: ${this.playerNames[playerIdx]}`));
    console.log();
  }

  displayPoints(points: [number, number], playerIdx: number): void {
    const myPoints = points[playerIdx];
    const opponentPoints = points[1 - playerIdx];

    console.log(chalk.bold('SCORE:'));
    console.log(`  ${this.playerNames[playerIdx]}: ${chalk.green(myPoints)}`);
    console.log(`  ${this.playerNames[1 - playerIdx]}: ${chalk.red(opponentPoints)}`);
    console.log();
  }

  displayStatus(status: string): void {
    console.log(chalk.bold.yellow(`STATUS: ${status}`));
    console.log();
  }

  displayMessages(messages: GameMessage[]): void {
    if (messages.length === 0) return;

    console.log(chalk.bold('RECENT MESSAGES:'));
    const recentMessages = messages.slice(-5); // Show last 5 messages

    recentMessages.forEach(message => {
      console.log(`  ${chalk.gray('•')} ${this.formatMessage(message)}`);
    });
    console.log();
  }

  displayHand(hand: HandCard[]): void {
    if (hand.length === 0) return;

    console.log(chalk.bold('YOUR HAND:'));
    hand.forEach((card, index) => {
      const cardName = this.formatCardName(card.card.card);
      const modifiers = this.formatModifiers(card.modifiers);
      console.log(`  ${chalk.cyan(`[${index}]`)} ${cardName}${modifiers}`);
    });
    console.log();
  }

  displayAntechamber(antechamber: HandCard[]): void {
    if (antechamber.length === 0) return;

    console.log(chalk.bold('YOUR ANTECHAMBER:'));
    antechamber.forEach((card, index) => {
      const cardName = this.formatCardName(card.card.card);
      const modifiers = this.formatModifiers(card.modifiers);
      console.log(`  ${chalk.cyan(`[${index}]`)} ${cardName}${modifiers}`);
    });
    console.log();
  }

  displayCourt(court: CourtCard[]): void {
    if (court.length === 0) return;

    console.log(chalk.bold('COURT:'));
    court.forEach((card, index) => {
      const cardName = this.formatCardName(card.card.card);
      const modifiers = this.formatModifiers(card.modifiers);
      const status = card.disgraced ? chalk.red(' (DISGRACED)') : '';
      const throne = index === court.length - 1 ? chalk.yellow(' (THRONE)') : '';
      console.log(`  ${chalk.cyan(`[${index}]`)} ${cardName}${modifiers}${status}${throne}`);
    });
    console.log();
  }

  displayArmy(army: ArmyCard[], playerIdx: number): void {
    if (army.length === 0) return;

    const isMyArmy = true; // Assume this is called for player's army
    console.log(chalk.bold(isMyArmy ? 'YOUR ARMY:' : 'OPPONENT ARMY:'));

    army.forEach((card, index) => {
      const cardName = this.formatCardName(card.card.card);
      const stateColor = card.state === 'Available' ? chalk.green :
                        card.state === 'Exhausted' ? chalk.red : chalk.yellow;
      const state = stateColor(`(${card.state})`);
      console.log(`  ${chalk.cyan(`[${index}]`)} ${cardName} ${state}`);
    });
    console.log();
  }

  displayOpponentInfo(board: GameBoard): void {
    const opponentIdx = 1 - board.player_idx;
    const opponentHand = board.hands[opponentIdx];
    const opponentAntechamber = board.antechambers[opponentIdx];

    console.log(chalk.bold(`${this.playerNames[opponentIdx].toUpperCase()}:`));
    console.log(`  Hand: ${opponentHand.length} cards`);
    if (opponentAntechamber.length > 0) {
      console.log(`  Antechamber: ${opponentAntechamber.length} cards`);
    }

    // Show known cards in opponent's hand
    const knownCards = opponentHand.filter(card => typeof card.card === 'object');
    if (knownCards.length > 0) {
      console.log('  Known cards:');
      knownCards.forEach(card => {
        if (typeof card.card === 'object') {
          console.log(`    ${this.formatCardName(card.card.card)}`);
        }
      });
    }
    console.log();
  }

  displayGameBoard(board: GameBoard): void {
    this.displayPoints(board.points, board.player_idx);
    this.displayHand(board.hand);
    this.displayAntechamber(board.antechamber);
    this.displayCourt(board.court);
    this.displayArmy(board.armies[board.player_idx], board.player_idx);
    this.displayOpponentInfo(board);
  }

  displayActions(actions: any[]): void {
    if (actions.length === 0) {
      console.log(chalk.yellow('Waiting for your turn...'));
      return;
    }

    console.log(chalk.bold('AVAILABLE ACTIONS:'));
    actions.forEach((action, index) => {
      console.log(`  ${chalk.green(`[${index}]`)} ${this.formatAction(action)}`);
    });
    console.log();
  }

  displayError(error: string): void {
    console.log(chalk.red(`ERROR: ${error}`));
    console.log();
  }

  displaySuccess(message: string): void {
    console.log(chalk.green(`SUCCESS: ${message}`));
    console.log();
  }

  displayInfo(message: string): void {
    console.log(chalk.blue(`INFO: ${message}`));
    console.log();
  }

  displayWaiting(): void {
    console.log(chalk.yellow('Waiting for game events...'));
  }

  displayGameOver(points: [number, number], playerIdx: number): void {
    const myPoints = points[playerIdx];
    const opponentPoints = points[1 - playerIdx];

    console.log(chalk.bold.red('GAME OVER!'));
    console.log();
    console.log(chalk.bold('FINAL SCORE:'));
    console.log(`  ${this.playerNames[playerIdx]}: ${chalk.green(myPoints)}`);
    console.log(`  ${this.playerNames[1 - playerIdx]}: ${chalk.red(opponentPoints)}`);

    if (myPoints > opponentPoints) {
      console.log(chalk.bold.green('🎉 YOU WIN! 🎉'));
    } else if (opponentPoints > myPoints) {
      console.log(chalk.bold.red('💀 YOU LOSE 💀'));
    } else {
      console.log(chalk.bold.yellow('🤝 TIE GAME 🤝'));
    }
    console.log();
  }

  private formatCardName(cardName: CardName): string {
    // Add color coding for different card types
    const colorMap: Record<string, any> = {
      'Fool': chalk.magenta,
      'FlagBearer': chalk.magenta,
      'Assassin': chalk.blue,
      'Stranger': chalk.blue,
      'Elder': chalk.blue,
      'Zealot': chalk.blue,
      'Aegis': chalk.blue,
      'Inquisitor': chalk.blue,
      'Ancestor': chalk.blue,
      'Informant': chalk.blue,
      'Nakturn': chalk.blue,
      'Soldier': chalk.green,
      'Judge': chalk.green,
      'Lockshift': chalk.green,
      'Immortal': chalk.yellow,
      'Oathbound': chalk.yellow,
      'Conspiracist': chalk.yellow,
      'Mystic': chalk.yellow,
      'Warlord': chalk.yellow,
      'Warden': chalk.yellow,
      'Sentry': chalk.red,
      'KingsHand': chalk.red,
      'Exile': chalk.red,
      'Princess': chalk.red,
      'Queen': chalk.red,
    };

    const colorFn = colorMap[cardName] || chalk.white;
    return colorFn(this.getDisplayName(cardName));
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

  private formatModifiers(modifiers: any): string {
    const parts: string[] = [];

    if (modifiers.value) {
      if (modifiers.value.type === 'Override') {
        parts.push(chalk.cyan(`[${modifiers.value.value}]`));
      } else if (modifiers.value.type === 'Delta') {
        const sign = modifiers.value.delta >= 0 ? '+' : '';
        parts.push(chalk.cyan(`[${sign}${modifiers.value.delta}]`));
      }
    }

    if (modifiers.royalty) {
      parts.push(chalk.green('[ROYAL]'));
    }

    if (modifiers.muted) {
      parts.push(chalk.red('[MUTED]'));
    }

    if (modifiers.steadfast) {
      parts.push(chalk.green('[STEADFAST]'));
    }

    return parts.length > 0 ? ' ' + parts.join(' ') : '';
  }

  private formatMessage(message: GameMessage): string {
    const playerName = (idx: number) => this.playerNames[idx];

    switch (message.type) {
      case 'KnownSignatureCardsChosen':
        return `${playerName(message.player_idx)} chose signature cards: ${message.cards.map(c => this.getDisplayName(c)).join(', ')}`;

      case 'UnknownSignatureCardsChosen':
        return `${playerName(message.player_idx)} chose ${message.count} signature cards`;

      case 'NewRoundStarted':
        return chalk.bold('--- NEW ROUND STARTED ---');

      case 'FirstPlayerChosen':
        return `${playerName(message.player_idx)} decided that ${playerName(message.first_player_idx)} goes first`;

      case 'Mulligan':
        return message.free ?
          `${playerName(message.player_idx)} mulliganed for free` :
          `${playerName(message.player_idx)} mulliganed and gave the opponent 2 points`;

      case 'CardPlayed':
        return `${playerName(message.player_idx)} played ${this.getDisplayName(message.card)}`;

      case 'GameOver':
        return chalk.bold.red(`Game over! Final score: ${message.points[0]}-${message.points[1]}`);

      default:
        return `${message.type} event occurred`;
    }
  }

  private formatAction(action: any): string {
    switch (action.type) {
      case 'ChooseSignatureCards':
        return `Choose signature cards: ${action.cards.map(([idx, card]: [number, string]) => this.getDisplayName(card as CardName)).join(', ')}`;

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

      default:
        return action.type;
    }
  }
}
