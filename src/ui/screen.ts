import chalk from 'chalk';
import type { GameBoard, HandCard, CourtCard, ArmyCard, CardName } from '../types/game.js';

export interface ScreenArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectableItem {
  id: string;
  text: string;
  description?: string;
  enabled: boolean;
  data?: any;
}

export class ScreenManager {
  private width: number;
  private height: number;
  private buffer: string[][];
  private selectedIndex: number = 0;
  private selectableItems: SelectableItem[] = [];
  private showDialog: boolean = false;
  private dialogContent: string[] = [];
  private dialogTitle: string = '';
  private introspectionMode: boolean = false;
  private currentStatus: string = '';
  private currentPlayerIndex: number = 0;

  // Screen areas
  private readonly MAIN_AREA: ScreenArea = { x: 0, y: 0, width: 60, height: 35 };
  private readonly SIDE_PANE: ScreenArea = { x: 60, y: 0, width: 40, height: 35 };
  private readonly STATUS_BAR: ScreenArea = { x: 0, y: 35, width: 100, height: 3 };
  private readonly DIALOG_AREA: ScreenArea = { x: 20, y: 10, width: 60, height: 15 };

  constructor(width: number = 100, height: number = 38) {
    this.width = width;
    this.height = height;
    this.buffer = this.createEmptyBuffer();

    // Enable raw mode for key capture
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
    }
  }

  private createEmptyBuffer(): string[][] {
    return Array(this.height).fill(null).map(() => Array(this.width).fill(' '));
  }

  clear(): void {
    this.buffer = this.createEmptyBuffer();
  }

  render(): void {
    // Clear terminal and move cursor to top-left
    process.stdout.write('\x1B[2J\x1B[0;0H');

    // Render buffer to screen
    for (let y = 0; y < this.height; y++) {
      const line = this.buffer[y].join('');
      process.stdout.write(line + '\n');
    }
  }

  drawBox(area: ScreenArea, title?: string, style: 'single' | 'double' = 'single'): void {
    const chars = style === 'double' ?
      { h: '═', v: '║', tl: '╔', tr: '╗', bl: '╚', br: '╝' } :
      { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘' };

    // Draw horizontal lines
    for (let x = area.x; x < area.x + area.width; x++) {
      if (area.y >= 0 && area.y < this.height && x >= 0 && x < this.width) {
        this.buffer[area.y][x] = chars.h;
      }
      if (area.y + area.height - 1 >= 0 && area.y + area.height - 1 < this.height && x >= 0 && x < this.width) {
        this.buffer[area.y + area.height - 1][x] = chars.h;
      }
    }

    // Draw vertical lines
    for (let y = area.y; y < area.y + area.height; y++) {
      if (y >= 0 && y < this.height) {
        if (area.x >= 0 && area.x < this.width) {
          this.buffer[y][area.x] = chars.v;
        }
        if (area.x + area.width - 1 >= 0 && area.x + area.width - 1 < this.width) {
          this.buffer[y][area.x + area.width - 1] = chars.v;
        }
      }
    }

    // Draw corners
    if (area.y >= 0 && area.y < this.height) {
      if (area.x >= 0 && area.x < this.width) {
        this.buffer[area.y][area.x] = chars.tl;
      }
      if (area.x + area.width - 1 >= 0 && area.x + area.width - 1 < this.width) {
        this.buffer[area.y][area.x + area.width - 1] = chars.tr;
      }
    }
    if (area.y + area.height - 1 >= 0 && area.y + area.height - 1 < this.height) {
      if (area.x >= 0 && area.x < this.width) {
        this.buffer[area.y + area.height - 1][area.x] = chars.bl;
      }
      if (area.x + area.width - 1 >= 0 && area.x + area.width - 1 < this.width) {
        this.buffer[area.y + area.height - 1][area.x + area.width - 1] = chars.br;
      }
    }

    // Draw title if provided
    if (title) {
      const titleText = ` ${title} `;
      const titleX = area.x + Math.floor((area.width - titleText.length) / 2);
      this.writeText(titleX, area.y, titleText);
    }
  }

  writeText(x: number, y: number, text: string, color?: string): void {
    for (let i = 0; i < text.length; i++) {
      if (x + i >= 0 && x + i < this.width && y >= 0 && y < this.height) {
        this.buffer[y][x + i] = text[i];
      }
    }
  }

  writeTextInArea(area: ScreenArea, x: number, y: number, text: string, color?: string): void {
    const actualX = area.x + 1 + x; // +1 to account for border
    const actualY = area.y + 1 + y; // +1 to account for border

    // Ensure we don't write outside the area
    const maxWidth = area.width - 2; // -2 for borders
    const truncatedText = text.length > maxWidth ? text.substring(0, maxWidth) : text;

    this.writeText(actualX, actualY, truncatedText, color);
  }

  setSelectableItems(items: SelectableItem[]): void {
    this.selectableItems = items;
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, items.length - 1));
  }

  getSelectedItem(): SelectableItem | null {
    return this.selectableItems[this.selectedIndex] || null;
  }

  moveSelection(direction: 'up' | 'down'): void {
    if (this.selectableItems.length === 0) return;

    if (direction === 'up') {
      this.selectedIndex = (this.selectedIndex - 1 + this.selectableItems.length) % this.selectableItems.length;
    } else {
      this.selectedIndex = (this.selectedIndex + 1) % this.selectableItems.length;
    }
  }

  showCardDialog(title: string, card: CardName, description: string, actions: string[] = []): void {
    this.showDialog = true;
    this.dialogTitle = title;
    this.dialogContent = [
      `Card: ${this.getDisplayName(card)}`,
      `Value: ${this.getCardBaseValue(card)}`,
      '',
      description,
      '',
      ...actions.map((action, idx) => `${idx + 1}. ${action}`)
    ];
  }

  hideDialog(): void {
    this.showDialog = false;
    this.dialogContent = [];
    this.dialogTitle = '';
  }

  drawGameScreen(board: GameBoard, playerIdx: number, playerNames: [string, string]): void {
    this.clear();

    // Draw main areas
    this.drawBox(this.MAIN_AREA, 'Game Board');
    this.drawBox(this.SIDE_PANE, 'Information');
    this.drawBox(this.STATUS_BAR, 'Status');

    // Draw game content
    this.drawGameBoard(board, playerIdx, playerNames);
    this.drawSidePane(board, playerIdx, playerNames);
    this.drawStatusBar(board, playerIdx);

    // Draw dialog if shown
    if (this.showDialog) {
      this.drawDialog();
    }

    this.render();
  }

  private drawGameBoard(board: GameBoard, playerIdx: number, playerNames: [string, string]): void {
    let yOffset = 0;

    // Score
    this.writeTextInArea(this.MAIN_AREA, 0, yOffset++, `Score: ${playerNames[0]} ${board.points[0]} - ${board.points[1]} ${playerNames[1]}`);
    yOffset++;

    // Current player
    const currentPlayerName = board.player_idx === 0 ? playerNames[0] : playerNames[1];
    this.writeTextInArea(this.MAIN_AREA, 0, yOffset++, `Current Turn: ${currentPlayerName}`);
    yOffset++;

    // Court
    if (board.court.length > 0) {
      this.writeTextInArea(this.MAIN_AREA, 0, yOffset++, 'Court:');
      board.court.forEach((card, idx) => {
        const isThrone = idx === board.court.length - 1;
        const prefix = isThrone ? '👑 ' : '   ';
        const status = card.disgraced ? ' [DISGRACED]' : '';
        const cardText = `${prefix}${this.getDisplayName(card.card.card)}${status}`;
        this.writeTextInArea(this.MAIN_AREA, 0, yOffset++, cardText);
      });
      yOffset++;
    }

    // Your hand
    if (board.hands[playerIdx].length > 0) {
      this.writeTextInArea(this.MAIN_AREA, 0, yOffset++, 'Your Hand:');
      board.hands[playerIdx].forEach((card, idx) => {
        const isSelected = this.selectedIndex === idx && this.selectableItems.some(item => item.id === `hand_${idx}`);
        const prefix = isSelected ? '> ' : '  ';
        const cardName = typeof card.card === 'object' ? card.card.card : 'Hidden';
        this.writeTextInArea(this.MAIN_AREA, 0, yOffset++, `${prefix}[${idx}] ${this.getDisplayName(cardName as CardName)}`);
      });
    }
  }

  private drawSidePane(board: GameBoard, playerIdx: number, playerNames: [string, string]): void {
    let yOffset = 0;

    // Selected item details
    const selected = this.getSelectedItem();
    if (selected) {
      this.writeTextInArea(this.SIDE_PANE, 0, yOffset++, 'Selected:');
      this.writeTextInArea(this.SIDE_PANE, 0, yOffset++, selected.text);
      if (selected.description) {
        yOffset++;
        const lines = selected.description.split('\n');
        lines.forEach(line => {
          this.writeTextInArea(this.SIDE_PANE, 0, yOffset++, line);
        });
      }
    }

    yOffset += 2;

    // Army information
    if (board.armies && board.armies[playerIdx] && board.armies[playerIdx].length > 0) {
      this.writeTextInArea(this.SIDE_PANE, 0, yOffset++, 'Your Army:');
      board.armies[playerIdx].forEach(card => {
        const status = card.state === 'Available' ? '✓' : card.state === 'Exhausted' ? '✗' : '?';
        this.writeTextInArea(this.SIDE_PANE, 0, yOffset++, `${status} ${this.getDisplayName(card.card.card)}`);
      });
    }
  }

  private drawStatusBar(board: GameBoard, playerIdx: number): void {
    this.writeTextInArea(this.STATUS_BAR, 0, 0, 'Press ENTER to select • ↑↓ to navigate • ESC to cancel');
  }

  private drawDialog(): void {
    this.drawBox(this.DIALOG_AREA, this.dialogTitle, 'double');

    this.dialogContent.forEach((line, idx) => {
      if (idx < this.DIALOG_AREA.height - 2) {
        this.writeTextInArea(this.DIALOG_AREA, 0, idx, line);
      }
    });
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

  private getCardBaseValue(cardName: CardName): number {
    const baseValues: Record<string, number> = {
      'Fool': 1, 'FlagBearer': 1, 'Assassin': 2, 'Stranger': 2, 'Elder': 3, 'Zealot': 3, 'Aegis': 3,
      'Inquisitor': 4, 'Ancestor': 4, 'Informant': 4, 'Nakturn': 4, 'Soldier': 5, 'Judge': 5, 'Lockshift': 5,
      'Immortal': 6, 'Oathbound': 6, 'Conspiracist': 6, 'Mystic': 7, 'Warlord': 7, 'Warden': 7,
      'Sentry': 8, 'KingsHand': 8, 'Exile': 8, 'Princess': 9, 'Queen': 9
    };
    return baseValues[cardName] || 0;
  }

  // Enable introspection mode for testing
  enableIntrospection(): void {
    this.introspectionMode = true;
  }

  // Get selectable items for introspection
  getSelectableItems(): SelectableItem[] {
    return this.selectableItems;
  }

  // Get current status for introspection
  getCurrentStatus(): string {
    return this.currentStatus;
  }

  // Get current player index for introspection
  getCurrentPlayerIndex(): number {
    return this.currentPlayerIndex;
  }

  // Get current selection index for introspection
  getCurrentSelectionIndex(): number {
    return this.selectedIndex;
  }
}
