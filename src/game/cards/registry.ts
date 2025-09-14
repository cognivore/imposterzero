import type { CardName } from '../../types/game.js';
import type { CardModule, CardRegistry } from './types.js';

class CardRegistryImpl implements CardRegistry {
  private cards: Map<CardName, CardModule> = new Map();

  registerCard(card: CardModule): void {
    this.cards.set(card.name, card);
  }

  getCard(name: CardName): CardModule | undefined {
    return this.cards.get(name);
  }

  getAllCards(): CardModule[] {
    return Array.from(this.cards.values());
  }

  hasCard(name: CardName): boolean {
    return this.cards.has(name);
  }
}

export const cardRegistry = new CardRegistryImpl();
