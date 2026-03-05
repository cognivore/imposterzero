import type { PlayerId } from "@imposter-zero/types";
import {
  type IKState,
  type IKAction,
  playerZones,
  throneValue,
  isKingFaceUp,
} from "@imposter-zero/engine";

// ---------------------------------------------------------------------------
// Bot registry (unchanged)
// ---------------------------------------------------------------------------

export interface BotRegistry {
  readonly bots: ReadonlySet<string>;
}

export const emptyBotRegistry: BotRegistry = { bots: new Set() };

export const addBot = (registry: BotRegistry, playerId: string): BotRegistry => ({
  bots: new Set([...registry.bots, playerId]),
});

export const isBot = (registry: BotRegistry, playerId: string): boolean =>
  registry.bots.has(playerId);

export type NonEmptyReadonlyArray<A> = readonly [A, ...A[]];

export const pickRandom = <A>(actions: NonEmptyReadonlyArray<A>): A =>
  actions[Math.floor(Math.random() * actions.length)];

// ---------------------------------------------------------------------------
// Bot strategy interface
// ---------------------------------------------------------------------------

export interface BotStrategy {
  selectAction(state: IKState, player: PlayerId, legal: ReadonlyArray<IKAction>): IKAction;
}

export const RandomStrategy: BotStrategy = {
  selectAction: (_state, _player, legal) =>
    legal[Math.floor(Math.random() * legal.length)]!,
};

// ---------------------------------------------------------------------------
// Bucketed strategic abstraction — mirrors training/train.py
// ---------------------------------------------------------------------------

const bucketThreshold = (tv: number): number => {
  if (tv <= 1) return 0;
  if (tv <= 3) return 1;
  if (tv <= 5) return 2;
  if (tv <= 7) return 3;
  return 4;
};

const bucketPlayable = (n: number): number => {
  if (n === 0) return 0;
  if (n <= 2) return 1;
  if (n <= 4) return 2;
  return 3;
};

const bucketHand = (n: number): number => {
  if (n <= 2) return 0;
  if (n <= 4) return 1;
  if (n <= 6) return 2;
  return 3;
};

const abstractState = (state: IKState, player: PlayerId): string => {
  if (state.phase === "crown") return "CR";

  const perspective = playerZones(state, player);
  const handVals = perspective.hand
    .map((c) => c.kind.props.value)
    .sort((a, b) => b - a);
  const handSize = handVals.length;

  if (state.phase === "setup") {
    const low = handVals.filter((v) => v <= 4).length;
    const high = handVals.filter((v) => v >= 7).length;
    return `S${bucketHand(handSize)}${Math.min(low, 5)}${Math.min(high, 5)}`;
  }

  const threshold = throneValue(state);
  const nPlayable = handVals.filter((v) => v >= threshold).length;
  const canDisgrace = isKingFaceUp(state, player) && state.shared.court.length > 0;
  const opp = ((player + 1) % state.numPlayers) as PlayerId;
  const oppHand = bucketHand(playerZones(state, opp).hand.length);
  const courtSz = Math.min(state.shared.court.length, 7);

  return (
    `P${bucketPlayable(nPlayable)}` +
    `${bucketThreshold(threshold)}` +
    `${bucketHand(handSize)}` +
    `${oppHand}` +
    `${canDisgrace ? "D" : "_"}` +
    `${courtSz}`
  );
};

const abstractAction = (
  state: IKState,
  action: IKAction,
  player: PlayerId,
): string => {
  if (action.kind === "disgrace") return "D";
  if (action.kind === "crown") return `K${action.firstPlayer}`;

  if (action.kind === "play") {
    const perspective = playerZones(state, player);
    const threshold = throneValue(state);
    const playableVals = perspective.hand
      .map((c) => c.kind.props.value)
      .filter((v) => v >= threshold)
      .sort((a, b) => a - b);

    const value = perspective.hand.find((c) => c.id === action.cardId)!.kind.props.value;
    const n = playableVals.length;
    if (n <= 1) return "L";
    const lowThird = playableVals[Math.floor(n / 3)]!;
    const highThird = playableVals[n - 1 - Math.floor(n / 3)]!;
    if (value <= lowThird) return "L";
    if (value >= highThird) return "H";
    return "M";
  }

  // commit
  const succ = state.players[player]!.hand.find((c) => c.id === action.successorId);
  const dung = state.players[player]!.hand.find((c) => c.id === action.dungeonId);
  const avg = ((succ?.kind.props.value ?? 0) + (dung?.kind.props.value ?? 0)) / 2;
  if (avg <= 4) return "LL";
  if (avg >= 6) return "HH";
  return "LH";
};

type PolicyEntry = Readonly<Record<string, number>>;
type PolicyTable = Readonly<Record<string, PolicyEntry>>;

export interface TabularPolicy {
  readonly metadata: {
    readonly algorithm: string;
    readonly iterations: number;
    readonly num_players: number;
    readonly info_states: number;
    readonly [key: string]: unknown;
  };
  readonly policy: PolicyTable;
}

const sampleWeighted = <T>(items: readonly T[], weights: readonly number[]): T => {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)]!;
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
};

export const createTabularStrategy = (policyJson: TabularPolicy): BotStrategy => {
  const table = policyJson.policy;

  return {
    selectAction(state: IKState, player: PlayerId, legal: ReadonlyArray<IKAction>): IKAction {
      const info = abstractState(state, player);
      const entry = table[info];

      if (!entry) {
        return legal[Math.floor(Math.random() * legal.length)]!;
      }

      const groups = new Map<string, IKAction[]>();
      for (const action of legal) {
        const key = abstractAction(state, action, player);
        const existing = groups.get(key);
        if (existing) {
          existing.push(action);
        } else {
          groups.set(key, [action]);
        }
      }

      const absActions = [...groups.keys()];
      const probs = absActions.map((a) => entry[a] ?? 0);
      const total = probs.reduce((a, b) => a + b, 0);

      if (total <= 0) {
        return legal[Math.floor(Math.random() * legal.length)]!;
      }

      const chosenAbs = sampleWeighted(absActions, probs);
      const concreteOptions = groups.get(chosenAbs)!;
      return concreteOptions[Math.floor(Math.random() * concreteOptions.length)]!;
    },
  };
};
