import type { CardName } from '../types/game.js';
import { cardRegistry, initializeCardRegistry, getCard } from './cards/index.js';
import type { Logger } from '../utils/logger.js';

// Initialize the card registry when this module is first imported
initializeCardRegistry();

// Enhanced player interface that includes card state
interface Player {
  name: string;
  hand: CardName[];
  antechamber: CardName[];
  condemned: CardName[];
  army: CardName[];
  exhaustedArmy: CardName[];
  successor: CardName | null;
  squire: CardName | null;
  dungeon: CardName | null;
  kingFacet: string;
  kingFlipped: boolean;
  points: number;
  successorPlayableFromHand: boolean;
  successorBonus: number;
  conspiracistEffect: {
    active: boolean;
    turnsRemaining: number;
    playedCards: Set<CardName>;
  };
}

interface GameState {
  players: [Player, Player];
  currentPlayerIdx: number;
  court: Array<{ card: CardName; playerIdx: number; disgraced: boolean }>;
  accused: CardName;
  condemned: CardName[];
}

/**
 * Enhanced card ability trigger system using the modular card system
 */
export class CardAbilityManager {
  private logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  /**
   * Trigger a card's ability using the modular system with King's Hand reaction checks
   */
  triggerCardAbility(cardName: CardName, state: GameState, playerIdx: number, withAbility: boolean = true): boolean {
    if (!withAbility) {
      this.logger?.log(`Player ${playerIdx + 1}: Played ${cardName} without ability`);
      return true; // Ability completed (no ability to trigger)
    }

    const cardModule = getCard(cardName);
    if (!cardModule) {
      this.logger?.log(`No card module found for ${cardName}`);
      return true;
    }

    // Check if this is a MAY ability that can be prevented by reactions
    const isMayAbility = this.isMayAbility(cardName);

    if (isMayAbility) {
      // Check for ALL possible reactions from all opponents
      const opponentIdx = 1 - playerIdx;
      const reactionUsed = this.checkUniversalReactions(state, opponentIdx, playerIdx, 'ability', cardName);

      if (reactionUsed) {
        this.logger?.log(`${cardName} ability prevented by reaction!`);
        return false; // Ability was prevented
      }
    }

    this.logger?.log(`Triggering ability for ${cardName}`);

    // Trigger the card's onPlay ability
    const opponentIdx = 1 - playerIdx;
    if (cardModule.onPlay) {
      cardModule.onPlay(state, playerIdx, opponentIdx, this.logger);
    }

    return true; // Ability completed successfully
  }

  /**
   * Handle King flip with universal reaction checking
   * WARNING: This method should NOT be used directly - it bypasses proper flip invariants.
   * Use the engine's executeKingFlip method instead.
   */
  handleKingFlip(state: GameState, playerIdx: number): boolean {
    this.logger?.log(`ERROR: cardIntegration.handleKingFlip called - this bypasses proper flip logic!`);
    this.logger?.log(`Use engine.executeKingFlip() instead to maintain state invariants`);

    // DO NOT set kingFlipped here - this would create invariant violations
    // The proper engine method handles successor clearing and all state management
    return false; // Reject this call
  }

  /**
   * Check if a card has a MAY ability that can be prevented
   */
  private isMayAbility(cardName: CardName): boolean {
    // Cards with MAY abilities that can be prevented by King's Hand
    const mayAbilityCards = [
      'Fool', 'Inquisitor', 'Judge', 'Soldier', 'Warden', 'Mystic', 'Sentry',
      'Princess', 'Spy', 'Oracle', 'Aegis', 'Ancestor', 'Bard', 'Conspiracist',
      'Exile', 'FlagBearer', 'Informant', 'Lockshift', 'Nakturn', 'Stranger'
    ];

    // Cards with mandatory abilities that CANNOT be prevented
    const mandatoryAbilityCards = ['Queen', 'Assassin', 'Elder', 'Zealot'];

    return mayAbilityCards.includes(cardName);
  }

  /**
   * Check for ALL possible reactions - ALWAYS ask, regardless of whether they have the cards
   * This maintains hidden information by not revealing which reaction cards players have
   */
  private checkKingsHandReaction(state: GameState, reactingPlayerIdx: number, activePlayerIdx: number, targetCard: CardName): boolean {
    return this.checkUniversalReactions(state, reactingPlayerIdx, activePlayerIdx, 'ability', targetCard);
  }

  /**
   * Universal reaction system - handles ALL reaction cards with hidden information protection
   */
  private checkUniversalReactions(state: GameState, reactingPlayerIdx: number, activePlayerIdx: number, trigger: 'ability' | 'kingFlip', targetCard?: CardName): boolean {
    const reactingPlayer = state.players[reactingPlayerIdx];

    // Get all reaction cards that could theoretically be in the player's hand
    const possibleReactions = this.getPossibleReactionCards(state, reactingPlayerIdx, trigger);

    if (possibleReactions.length === 0) {
      return false; // No possible reactions
    }

    // CRITICAL: Always ask about each possible reaction, regardless of whether they have it
    for (const reactionCard of possibleReactions) {
      const couldHaveCard = this.couldPlayerHaveCard(state, reactingPlayerIdx, reactionCard);

      if (couldHaveCard) {
        this.logger?.log(`Player ${reactingPlayerIdx + 1}: Do you want to use ${reactionCard} reaction? (You will be asked regardless of whether you have it)`);

        const wantsToUseReaction = this.shouldBotUseReaction(state, reactingPlayerIdx, reactionCard, trigger, targetCard);

        if (wantsToUseReaction) {
          const reactionUsed = this.executeReaction(state, reactingPlayerIdx, activePlayerIdx, reactionCard, trigger, targetCard);

          if (reactionUsed) {
            return true; // Reaction was successfully used
          } else {
            // They tried to use it but don't have it - illegal move
            this.logger?.log(`Player ${reactingPlayerIdx + 1}: Tried to use ${reactionCard} but doesn't have it! Illegal move.`);
            // In a real game, this might result in a penalty
          }
        } else {
          this.logger?.log(`Player ${reactingPlayerIdx + 1}: Chose not to use ${reactionCard}`);
        }
      }
    }

    return false; // No reactions were used
  }

  /**
   * Get all reaction cards that could be relevant for the given trigger
   */
  private getPossibleReactionCards(state: GameState, playerIdx: number, trigger: 'ability' | 'kingFlip'): CardName[] {
    const allReactionCards: Array<{card: CardName, triggers: string[]}> = [
      { card: 'KingsHand', triggers: ['ability'] },
      { card: 'Assassin', triggers: ['kingFlip'] },
      { card: 'Stranger', triggers: ['ability', 'kingFlip'] }, // Can copy other reactions
      { card: 'Arbiter', triggers: ['turnStart'] }, // Different trigger, handled separately
      { card: 'Impersonator', triggers: ['turnStart'] } // Different trigger, handled separately
    ];

    return allReactionCards
      .filter(r => r.triggers.includes(trigger))
      .map(r => r.card);
  }

  /**
   * Check if a player could theoretically have a card (not in visible zones)
   */
  private couldPlayerHaveCard(state: GameState, playerIdx: number, cardName: CardName): boolean {
    const player = state.players[playerIdx];
    const opponent = state.players[1 - playerIdx];

    // Visible zones where we can see the card definitely isn't in their hand:
    const visibleZones = [
      // Own visible areas (opponent can see these)
      ...player.antechamber,
      ...player.condemned,
      // Court cards
      ...state.court.map(c => c.card),
      // Accused card
      state.accused,
      // Condemned pile
      ...state.condemned,
      // Exhausted army (if visible)
      ...player.exhaustedArmy
      // NOTE: We don't include player.hand or player.army as those are hidden
    ];

    // If the card is in any visible zone, they definitely don't have it in hand
    const definitelyNotInHand = visibleZones.includes(cardName);

    if (definitelyNotInHand) {
      return false;
    }

    // Special case for Stranger: if there are no reaction cards in court to copy,
    // Stranger can't react even if they have it
    if (cardName === 'Stranger') {
      const courtReactions = state.court.filter(c => this.hasReactionAbility(c.card) && c !== state.court[state.court.length - 1]); // Not throne
      return courtReactions.length > 0;
    }

    return true; // Could theoretically have it
  }

  /**
   * Check if a card has reaction abilities
   */
  private hasReactionAbility(cardName: CardName): boolean {
    const reactionCards = ['Assassin', 'KingsHand', 'Arbiter', 'Impersonator', 'Stranger'];
    return reactionCards.includes(cardName);
  }

  /**
   * Bot decision logic for whether to claim having any reaction card
   */
  private shouldBotUseReaction(state: GameState, playerIdx: number, reactionCard: CardName, trigger: string, targetCard?: CardName): boolean {
    const player = state.players[playerIdx];
    const hasCard = player.hand.includes(reactionCard);

    if (!hasCard) {
      // Sometimes bluff that you have the reaction card to confuse opponent
      const bluffChance = reactionCard === 'KingsHand' ? 0.1 : 0.05; // Less likely to bluff with other cards
      return Math.random() < bluffChance;
    } else {
      // Decide whether to actually use the reaction
      if (reactionCard === 'KingsHand' && targetCard) {
        // More likely to use against high-value card abilities
        const targetValue = this.getBaseCardValue(targetCard);
        const useChance = Math.min(0.8, targetValue / 10);
        return Math.random() < useChance;
      } else if (reactionCard === 'Assassin' && trigger === 'kingFlip') {
        // Usually use Assassin to prevent king flips
        return Math.random() < 0.7;
      } else if (reactionCard === 'Stranger') {
        // Stranger logic depends on what it's copying
        return Math.random() < 0.4;
      }
    }

    return false;
  }

  /**
   * Execute a reaction card's ability
   */
  private executeReaction(state: GameState, reactingPlayerIdx: number, activePlayerIdx: number, reactionCard: CardName, trigger: string, targetCard?: CardName): boolean {
    const cardModule = getCard(reactionCard);
    if (!cardModule) {
      return false;
    }

    // Find the appropriate reaction ability
    const reactionAbility = cardModule.abilities.find(ability =>
      ability.description.includes('**Reaction:**') || ability.description.includes('Reaction:')
    );

    if (!reactionAbility) {
      return false;
    }

    // Check if they can actually activate it
    if (!reactionAbility.canActivate(state, reactingPlayerIdx)) {
      return false; // They don't actually have the card
    }

    // Execute the reaction
    reactionAbility.execute(state, reactingPlayerIdx, activePlayerIdx, this.logger);

    // Handle specific post-reaction effects
    if (reactionCard === 'KingsHand' && targetCard) {
      this.condemnCardFromPlay(state, targetCard, this.logger);
    }

    return true;
  }

  /**
   * Condemn a card that was prevented by King's Hand
   */
  private condemnCardFromPlay(state: GameState, cardName: CardName, logger?: any): void {
    // Find and condemn the card that was being played
    // In the actual implementation, this would remove it from court and add to condemned pile
    state.condemned.push(cardName);
    logger?.log(`${cardName} condemned by King's Hand reaction`);
  }

  /**
   * Handle card entering court
   */
  handleCardEnterCourt(cardName: CardName, state: GameState, playerIdx: number): void {
    const cardModule = getCard(cardName);
    if (cardModule?.onEnterCourt) {
      cardModule.onEnterCourt(state, playerIdx, this.logger);
    }
  }

  /**
   * Handle card leaving court
   */
  handleCardLeaveCourt(cardName: CardName, state: GameState, playerIdx: number): void {
    const cardModule = getCard(cardName);
    if (cardModule?.onLeaveCourt) {
      cardModule.onLeaveCourt(state, playerIdx, this.logger);
    }
  }

  /**
   * Handle king flip effects on cards
   */
  handleKingFlip(cardName: CardName, state: GameState, playerIdx: number): void {
    const cardModule = getCard(cardName);
    if (cardModule?.onKingFlip) {
      cardModule.onKingFlip(state, playerIdx, this.logger);
    }
  }

  /**
   * Get modified card value based on context
   */
  getModifiedCardValue(cardName: CardName, state: GameState, context: 'hand' | 'court' | 'throne', playerIdx?: number): number {
    const cardModule = getCard(cardName);
    if (!cardModule) {
      return this.getBaseCardValue(cardName); // Fallback to base value
    }

    let baseValue = cardModule.baseValue;
    let modifier = 0;

    // Apply value modifiers from the card module
    if (cardModule.valueModifiers) {
      switch (context) {
        case 'hand':
          if (cardModule.valueModifiers.inHand && playerIdx !== undefined) {
            modifier = cardModule.valueModifiers.inHand(state, playerIdx);
          }
          break;
        case 'court':
          if (cardModule.valueModifiers.inCourt) {
            modifier = cardModule.valueModifiers.inCourt(state);
          }
          break;
        case 'throne':
          if (cardModule.valueModifiers.onThrone) {
            modifier = cardModule.valueModifiers.onThrone(state);
          }
          break;
      }
    }

    return Math.max(1, baseValue + modifier); // Minimum value of 1
  }

  /**
   * Check if a card has specific keywords
   */
  hasKeyword(cardName: CardName, keyword: string): boolean {
    const cardModule = getCard(cardName);
    return cardModule?.keywords.includes(keyword) ?? false;
  }

  /**
   * Fallback method for base card values
   */
  private getBaseCardValue(cardName: CardName): number {
    const baseValues: Record<string, number> = {
      'Fool': 1, 'Assassin': 2, 'Elder': 3, 'Zealot': 3, 'Aegis': 3,
      'Inquisitor': 4, 'Ancestor': 4, 'Executioner': 4, 'Bard': 4, 'Nakturn': 4,
      'Soldier': 5, 'Judge': 5, 'Lockshift': 5, 'Arbiter': 5, 'Oracle': 5, 'Herald': 6, 'Oathbound': 6, 'Immortal': 6,
      'Warden': 7, 'Warlord': 7, 'Mystic': 7, 'Spy': 8, 'Sentry': 8, 'Exile': 8,
      'KingsHand': 8, 'Princess': 9, 'Queen': 9
    };
    return baseValues[cardName] || 0;
  }
}

// Export a default instance
export const cardAbilityManager = new CardAbilityManager();
