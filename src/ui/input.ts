import { EventEmitter } from 'events';

export type KeyEvent = {
  name: string;
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};

export class InputManager extends EventEmitter {
  private isListening: boolean = false;
  private testMode: boolean = false;
  private testInputs: string[] = [];
  private testInputIndex: number = 0;

  constructor() {
    super();
  }

  startListening(): void {
    if (this.isListening || this.testMode) return;

    this.isListening = true;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
    }

    process.stdin.on('data', this.handleKeypress.bind(this));
  }

  stopListening(): void {
    if (!this.isListening && !this.testMode) return;

    this.isListening = false;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }

    process.stdin.removeListener('data', this.handleKeypress.bind(this));
  }

  // For testing: enable test mode with predetermined inputs
  enableTestMode(inputs: string[]): void {
    this.testMode = true;
    this.testInputs = inputs;
    this.testInputIndex = 0;
  }

  disableTestMode(): void {
    this.testMode = false;
    this.testInputs = [];
    this.testInputIndex = 0;
  }

  // For testing: simulate key press
  simulateKeypress(input: string): void {
    if (this.testMode) {
      this.handleKeypress(input);
    }
  }

  // For testing: get next test input
  getNextTestInput(): string | null {
    if (!this.testMode || this.testInputIndex >= this.testInputs.length) {
      return null;
    }
    return this.testInputs[this.testInputIndex++];
  }

  private handleKeypress(input: string | Buffer): void {
    const key = this.parseKeypress(input);
    this.emit('keypress', key);
  }

  private parseKeypress(input: string | Buffer): KeyEvent {
    const inputStr = typeof input === 'string' ? input : input.toString();
    const code = inputStr.charCodeAt(0);

    // Special keys
    if (code === 27) { // ESC sequence
      if (inputStr.length === 1) {
        return { name: 'escape', key: inputStr, ctrl: false, meta: false, shift: false };
      }

      // Arrow keys
      if (inputStr === '\x1b[A') {
        return { name: 'up', key: inputStr, ctrl: false, meta: false, shift: false };
      }
      if (inputStr === '\x1b[B') {
        return { name: 'down', key: inputStr, ctrl: false, meta: false, shift: false };
      }
      if (inputStr === '\x1b[C') {
        return { name: 'right', key: inputStr, ctrl: false, meta: false, shift: false };
      }
      if (inputStr === '\x1b[D') {
        return { name: 'left', key: inputStr, ctrl: false, meta: false, shift: false };
      }
    }

    // Control keys
    if (code === 3) { // Ctrl+C
      return { name: 'c', key: inputStr, ctrl: true, meta: false, shift: false };
    }
    if (code === 13 || code === 10) { // Enter
      return { name: 'return', key: inputStr, ctrl: false, meta: false, shift: false };
    }
    if (code === 32) { // Space
      return { name: 'space', key: inputStr, ctrl: false, meta: false, shift: false };
    }
    if (code === 127 || code === 8) { // Backspace/Delete
      return { name: 'backspace', key: inputStr, ctrl: false, meta: false, shift: false };
    }

    // Regular characters
    return {
      name: inputStr.toLowerCase(),
      key: inputStr,
      ctrl: false,
      meta: false,
      shift: inputStr !== inputStr.toLowerCase()
    };
  }

  // Wait for a specific key press (for testing and interactive use)
  async waitForKey(expectedKeys?: string[]): Promise<KeyEvent> {
    return new Promise((resolve) => {
      const handler = (key: KeyEvent) => {
        if (!expectedKeys || expectedKeys.includes(key.name)) {
          this.removeListener('keypress', handler);
          resolve(key);
        }
      };
      this.on('keypress', handler);

      // In test mode, automatically provide the next input
      if (this.testMode) {
        const nextInput = this.getNextTestInput();
        if (nextInput) {
          setTimeout(() => this.simulateKeypress(nextInput), 10);
        }
      }
    });
  }

  // Wait for Enter key specifically
  async waitForEnter(): Promise<void> {
    await this.waitForKey(['return']);
  }

  // Wait for navigation keys
  async waitForNavigation(): Promise<'up' | 'down' | 'enter' | 'escape'> {
    const key = await this.waitForKey(['up', 'down', 'return', 'escape']);
    return key.name as 'up' | 'down' | 'enter' | 'escape';
  }
}
