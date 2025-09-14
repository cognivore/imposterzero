import type { CardName } from '../../types/game.js';

export interface Player {
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

export interface GameState {
  players: [Player, Player];
  currentPlayerIdx: number;
  court: Array<{ card: CardName; playerIdx: number; disgraced: boolean }>;
  accused: CardName;
  condemned: CardName[];
}

export interface CardEffect {
  type: 'immediate' | 'ongoing' | 'reaction';
  description: string;
}

export interface CardAbility {
  name: string;
  description: string;
  canActivate(state: GameState, playerIdx: number): boolean;
  execute(state: GameState, playerIdx: number, opponentIdx: number, logger?: any): void;
}

export interface CardModule {
  name: CardName;
  baseValue: number;
  keywords: string[];
  abilities: CardAbility[];
  valueModifiers?: {
    inHand?: (state: GameState, playerIdx: number) => number;
    inCourt?: (state: GameState) => number;
    onThrone?: (state: GameState) => number;
  };

  // Triggered effects
  onPlay?: (state: GameState, playerIdx: number, opponentIdx: number, logger?: any) => void;
  onEnterCourt?: (state: GameState, playerIdx: number, logger?: any) => void;
  onLeaveCourt?: (state: GameState, playerIdx: number, logger?: any) => void;
  onKingFlip?: (state: GameState, playerIdx: number, logger?: any) => void;
}

export interface CardRegistry {
  getCard(name: CardName): CardModule | undefined;
  registerCard(card: CardModule): void;
  getAllCards(): CardModule[];
}
