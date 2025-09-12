import type { CardName, KingFacet } from '../types/game.js';

// Stage 4 - Full Fragments of Nersetti Rules
export const GAME_CONFIG = {
  // Stage 1: Base deck with Immortal and Warden
  BASE_DECK: [
    'Queen', 'Princess', 'Fool',
    'Sentry', 'Warlord', 'Mystic',
    'Oathbound', 'Oathbound', // x2
    'Soldier', 'Soldier', // x2
    'Inquisitor', 'Inquisitor', // x2
    'Elder', 'Elder', // x2
    'Immortal', 'Warden' // Stage 1 additions
  ] as CardName[],

  // Stage 2: Base Army cards
  BASE_ARMY: [
    'Elder', 'Inquisitor', 'Soldier', 'Judge', 'Oathbound'
  ] as CardName[],

  // Stage 3: Available Signature Cards
  SIGNATURE_CARDS: [
    'FlagBearer', 'Stranger', 'Aegis', 'Nakturn',
    'Ancestor', 'Informant', 'Lockshift', 'Conspiracist', 'Exile'
  ] as CardName[],

  // Stage 4: King Facets
  KING_FACETS: [
    'Regular', 'CharismaticLeader', 'MasterTactician'
  ] as KingFacet[],

  // Game constants
  HAND_SIZE: 9, // Stage 1: increased from 8 to 9
  SIGNATURE_CARD_COUNT: 3,
  POINTS_TO_WIN: 7,
  MAX_PLAYERS: 2,
} as const;

export interface GameRules {
  // Stage 1: Immortal effects
  hasImmortal(): boolean;
  isImmortalActive(): boolean;

  // Stage 2: Army mechanics
  canRecruit(): boolean;
  canRecommission(): boolean;
  canRally(): boolean;
  canRecall(): boolean;

  // Stage 3: Signature card effects
  getSignatureCards(playerIdx: number): CardName[];

  // Stage 4: King facet effects
  getKingFacet(playerIdx: number): KingFacet;
  hasSquire(playerIdx: number): boolean; // Master Tactician
  isSuccessorRevealed(playerIdx: number): boolean; // Charismatic Leader
}

export class FragmentsOfNersettiRules implements GameRules {
  private court: any[] = [];
  private armies: [CardName[], CardName[]] = [[], []];
  private exhaustedCards: [CardName[], CardName[]] = [[], []];
  private signatureCards: [CardName[], CardName[]] = [[], []];
  private kingFacets: [KingFacet, KingFacet] = ['Regular', 'Regular'];
  private squires: [any | null, any | null] = [null, null];
  private successorsRevealed: [boolean, boolean] = [false, false];

  constructor() {
    // Initialize armies with base cards
    this.armies[0] = [...GAME_CONFIG.BASE_ARMY];
    this.armies[1] = [...GAME_CONFIG.BASE_ARMY];
  }

  // Stage 1: Immortal effects
  hasImmortal(): boolean {
    return this.court.some(card => card.card.card === 'Immortal');
  }

  isImmortalActive(): boolean {
    const immortal = this.court.find(card => card.card.card === 'Immortal');
    return immortal && !immortal.disgraced;
  }

  // Stage 2: Army mechanics
  canRecruit(): boolean {
    return true; // Can always recruit if you have army cards
  }

  canRecommission(): boolean {
    return true; // Can always recommission if you have exhausted cards
  }

  canRally(): boolean {
    return true; // Rally is triggered by card abilities
  }

  canRecall(): boolean {
    return true; // Recall is triggered by card abilities
  }

  // Stage 3: Signature card management
  getSignatureCards(playerIdx: number): CardName[] {
    return [...this.signatureCards[playerIdx]];
  }

  setSignatureCards(playerIdx: number, cards: CardName[]): void {
    this.signatureCards[playerIdx] = [...cards];
    // Add signature cards to army
    this.armies[playerIdx].push(...cards);
  }

  // Stage 4: King facet management
  getKingFacet(playerIdx: number): KingFacet {
    return this.kingFacets[playerIdx];
  }

  setKingFacet(playerIdx: number, facet: KingFacet): void {
    this.kingFacets[playerIdx] = facet;

    // Handle facet-specific setup
    if (facet === 'CharismaticLeader') {
      this.successorsRevealed[playerIdx] = true;
    } else if (facet === 'MasterTactician') {
      // Master Tactician requires a Squire
      // This will be set during game setup
    }
  }

  hasSquire(playerIdx: number): boolean {
    return this.squires[playerIdx] !== null;
  }

  setSquire(playerIdx: number, squire: any): void {
    this.squires[playerIdx] = squire;
  }

  isSuccessorRevealed(playerIdx: number): boolean {
    return this.successorsRevealed[playerIdx];
  }

  // Card value calculations with Immortal effects
  getCardValue(card: CardName, context: 'hand' | 'court' = 'hand'): number {
    const baseValues: Record<CardName, number> = {
      'Fool': 1,
      'FlagBearer': 1,
      'Assassin': 2,
      'Stranger': 2,
      'Elder': 3,
      'Zealot': 3,
      'Aegis': 3,
      'Inquisitor': 4,
      'Ancestor': 4,
      'Informant': 4,
      'Nakturn': 4,
      'Soldier': 5,
      'Judge': 5,
      'Lockshift': 5,
      'Immortal': 6,
      'Oathbound': 6,
      'Conspiracist': 6,
      'Mystic': 7,
      'Warlord': 7,
      'Warden': 7,
      'Sentry': 8,
      'KingsHand': 8,
      'Exile': 8,
      'Princess': 9,
      'Queen': 9,
    };

    let value = baseValues[card] || 0;

    // Apply Immortal effects
    if (this.isImmortalActive()) {
      // Warlord gets +1 value
      if (card === 'Warlord') {
        value += 1;
      }
      // Princess/Queen get -1 value
      if (card === 'Princess' || card === 'Queen') {
        value -= 1;
      }
      // Elder gets -1 value
      if (card === 'Elder') {
        value -= 1;
      }
    }

    return Math.max(1, value); // Minimum value of 1
  }

  // Check if a card has Steadfast keyword
  hasSteadfast(card: CardName): boolean {
    return card === 'Immortal';
  }

  // Check if a card has Royalty keyword
  hasRoyalty(card: CardName): boolean {
    return card === 'Princess' || card === 'Queen';
  }

  // Get card display name
  getCardDisplayName(card: CardName): string {
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

    return nameMap[card] || card;
  }

  // Get king facet display name
  getKingFacetDisplayName(facet: KingFacet): string {
    const nameMap: Record<KingFacet, string> = {
      'Regular': 'Regular',
      'CharismaticLeader': 'Charismatic Leader',
      'MasterTactician': 'Master Tactician',
    };

    return nameMap[facet] || facet;
  }
}
