// Central card registry and exports
export type { CardModule, CardAbility, GameState, Player } from './types.js';
export { cardRegistry } from './registry.js';

// Import all card modules
import { baseGameCards } from './base/index.js';
import { signatureCards } from './signature/index.js';
import { cardRegistry } from './registry.js';

// Register all cards
export function initializeCardRegistry(): void {
  // Register base game cards
  baseGameCards.forEach(card => cardRegistry.registerCard(card));

  // Register signature cards
  signatureCards.forEach(card => cardRegistry.registerCard(card));
}

// Re-export all cards for convenience
export * from './base/index.js';
export * from './signature/index.js';

// Helper function to get a card by name
export function getCard(name: string) {
  return cardRegistry.getCard(name as any);
}
