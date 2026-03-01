/**
 * Abstract game protocol — mirrors OpenSpiel's Game/State interface.
 * This is the semantic bridge between TypeScript and the Python training side.
 */

export type PlayerId = number;

export const CHANCE = -1 as const;
export const TERMINAL = -4 as const;
export const SIMULTANEOUS = -2 as const;

export type ActivePlayer =
  | PlayerId
  | typeof CHANCE
  | typeof TERMINAL
  | typeof SIMULTANEOUS;

export type Dynamics = "sequential" | "simultaneous";

export type ChanceMode =
  | "deterministic"
  | "explicit_stochastic"
  | "sampled_stochastic";

export type Information = "perfect" | "imperfect";

export interface GameType {
  readonly name: string;
  readonly dynamics: Dynamics;
  readonly chanceMode: ChanceMode;
  readonly information: Information;
  readonly minPlayers: number;
  readonly maxPlayers: number;
}

/**
 * A game definition is a recipe for creating and stepping through game states.
 * Parametric over the concrete State and Action representations.
 *
 * Every method is pure: (State, ...) -> value. No mutation.
 */
export interface GameDef<S, A> {
  readonly gameType: GameType;
  readonly create: (numPlayers: number) => S;
  readonly currentPlayer: (s: S) => ActivePlayer;
  readonly legalActions: (s: S) => ReadonlyArray<A>;
  readonly apply: (s: S, a: A) => S;
  readonly isTerminal: (s: S) => boolean;
  readonly returns: (s: S) => ReadonlyArray<number>;
}

/**
 * Optional observation interface for imperfect-information games.
 * Produces a player-perspective view of the state for policy input.
 */
export interface Observer<S> {
  readonly observationTensor: (s: S, player: PlayerId) => ReadonlyArray<number>;
  readonly informationStateString: (s: S, player: PlayerId) => string;
}
