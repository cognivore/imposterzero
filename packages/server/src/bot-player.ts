import type { PlayerId } from "@imposter-zero/types";
import {
  type IKState,
  type IKAction,
  playerZones,
  throneValue,
  isKingFaceUp,
} from "@imposter-zero/engine";

// ---------------------------------------------------------------------------
// Bot registry
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
// Abstract actions (shared vocabulary — mirrors imposter_zero/abstraction.py)
// ---------------------------------------------------------------------------

const ABSTRACT_ACTIONS = ["L", "M", "H", "D", "LL", "LH", "HH", "K0", "K1", "K2"] as const;
type AbstractAction = (typeof ABSTRACT_ACTIONS)[number];

const ABS_TO_IDX: Readonly<Record<string, number>> = Object.fromEntries(
  ABSTRACT_ACTIONS.map((a, i) => [a, i]),
);

// ---------------------------------------------------------------------------
// Bucketed strategic abstraction — mirrors imposter_zero/abstraction.py
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
  const n = state.numPlayers;

  if (state.phase === "setup") {
    const low = handVals.filter((v) => v <= 4).length;
    const high = handVals.filter((v) => v >= 7).length;
    return `S${bucketHand(handSize)}${Math.min(low, 5)}${Math.min(high, 5)}`;
  }

  const threshold = throneValue(state);
  const nPlayable = handVals.filter((v) => v >= threshold).length;
  const canDisgrace = isKingFaceUp(state, player) && state.shared.court.length > 0;

  const oppHands = Array.from({ length: n - 1 }, (_, i) => {
    const opp = ((player + 1 + i) % n) as PlayerId;
    return playerZones(state, opp).hand.length;
  });
  const minOpp = bucketHand(Math.min(...oppHands));
  const courtSz = Math.min(state.shared.court.length, 7);

  return (
    `P${bucketPlayable(nPlayable)}` +
    `${bucketThreshold(threshold)}` +
    `${bucketHand(handSize)}` +
    `${minOpp}` +
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
    const third = Math.floor(n / 3);
    if (value <= playableVals[third]!) return "L";
    if (value >= playableVals[n - 1 - third]!) return "H";
    return "M";
  }

  const succ = state.players[player]!.hand.find((c) => c.id === action.successorId);
  const dung = state.players[player]!.hand.find((c) => c.id === action.dungeonId);
  const avg = ((succ?.kind.props.value ?? 0) + (dung?.kind.props.value ?? 0)) / 2;
  if (avg <= 4) return "LL";
  if (avg >= 6) return "HH";
  return "LH";
};

const groupLegalByAbstract = (
  state: IKState,
  legal: ReadonlyArray<IKAction>,
  player: PlayerId,
): Map<string, IKAction[]> => {
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
  return groups;
};

// ---------------------------------------------------------------------------
// Weighted sampling
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tabular strategy (2p MCCFR)
// ---------------------------------------------------------------------------

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

export const createTabularStrategy = (policyJson: TabularPolicy): BotStrategy => {
  const table = policyJson.policy;

  return {
    selectAction(state: IKState, player: PlayerId, legal: ReadonlyArray<IKAction>): IKAction {
      const info = abstractState(state, player);
      const entry = table[info];

      if (!entry) {
        return legal[Math.floor(Math.random() * legal.length)]!;
      }

      const groups = groupLegalByAbstract(state, legal, player);
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

// ---------------------------------------------------------------------------
// Enriched observation tensor — mirrors imposter_zero/abstraction.py
// ---------------------------------------------------------------------------

const enrichedObservation = (state: IKState, player: PlayerId): number[] => {
  const n = state.numPlayers;
  const perspective = playerZones(state, player);

  const activeOh = [0, 0, 0];
  if (state.activePlayer < 3) activeOh[state.activePlayer] = 1;

  const phaseOh = [
    state.phase === "crown" ? 1 : 0,
    state.phase === "setup" ? 1 : 0,
    state.phase === "play" ? 1 : 0,
  ];

  const hist = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const card of perspective.hand) {
    const v = card.kind.props.value;
    if (v >= 1 && v <= 9) hist[v - 1]++;
  }

  const myKing = perspective.king.face === "up" ? 1 : 0;
  const succ = perspective.successor !== null ? 1 : 0;
  const dung = perspective.dungeon !== null ? 1 : 0;
  const throne = throneValue(state) / 9;
  const court = state.shared.court.length / 15;
  const accused = state.shared.accused !== null ? state.shared.accused.kind.props.value / 9 : 0;
  const forgotten = state.shared.forgotten !== null ? 1 : 0;

  const fpOh = [0, 0, 0];
  if (state.firstPlayer < 3) fpOh[state.firstPlayer] = 1;

  const oppFeatures: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const opp = ((player + 1 + i) % n) as PlayerId;
    const oppZones = playerZones(state, opp);
    oppFeatures.push(oppZones.hand.length / 9);
    oppFeatures.push(oppZones.king.face === "up" ? 1 : 0);
  }
  while (oppFeatures.length < 4) oppFeatures.push(0);

  return [
    ...activeOh, ...phaseOh, ...hist,
    myKing, succ, dung, throne, court, accused, forgotten,
    ...fpOh, ...oppFeatures, 0,
  ];
};

// ---------------------------------------------------------------------------
// Neural strategy (3p REINFORCE — pure-TS MLP forward pass)
// ---------------------------------------------------------------------------

type Matrix = readonly (readonly number[])[];

export interface NeuralPolicy {
  readonly metadata: {
    readonly algorithm: string;
    readonly num_players: number;
    readonly input_size: number;
    readonly hidden_size: number;
    readonly output_size: number;
    readonly abstract_actions: readonly string[];
    readonly [key: string]: unknown;
  };
  readonly weights: Readonly<Record<string, Matrix | readonly number[]>>;
}

interface LayerParams {
  readonly w: Matrix;
  readonly b: readonly number[];
}

const parseLayerParams = (weights: NeuralPolicy["weights"]): readonly LayerParams[] => {
  if (weights.w1) {
    const layers: LayerParams[] = [];
    for (let i = 1; ; i++) {
      const w = weights[`w${i}`] as Matrix | undefined;
      const b = weights[`b${i}`] as readonly number[] | undefined;
      if (!w || !b) break;
      layers.push({ w, b });
    }
    return layers;
  }

  const maxB = Math.max(...Object.keys(weights).filter((k) => k.startsWith("b")).map((k) => parseInt(k.slice(1), 10)));
  const layers: LayerParams[] = [];
  for (let i = 0; i < maxB; i++) {
    const w = weights[`w${i + 2}`] as Matrix | undefined;
    const b = weights[`b${i + 1}`] as readonly number[] | undefined;
    if (w && b) layers.push({ w, b });
  }
  return layers;
};

const mlpForward = (input: readonly number[], layers: readonly LayerParams[]): number[] => {
  let x: number[] = [...input];

  for (let l = 0; l < layers.length; l++) {
    const { w, b } = layers[l]!;
    const isLast = l === layers.length - 1;
    const out = new Array<number>(w.length);
    for (let i = 0; i < w.length; i++) {
      let sum = b[i]!;
      const row = w[i]!;
      for (let j = 0; j < row.length; j++) {
        sum += row[j]! * x[j]!;
      }
      out[i] = isLast ? sum : (sum > 0 ? sum : 0);
    }
    x = out;
  }

  return x;
};

const softmax = (logits: readonly number[]): number[] => {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
};

export const createNeuralStrategy = (policyJson: NeuralPolicy): BotStrategy => {
  const layers = parseLayerParams(policyJson.weights);
  const absActions = policyJson.metadata.abstract_actions;

  return {
    selectAction(state: IKState, player: PlayerId, legal: ReadonlyArray<IKAction>): IKAction {
      const obs = enrichedObservation(state, player);
      const logits = mlpForward(obs, layers);

      const groups = groupLegalByAbstract(state, legal, player);
      const available = [...groups.keys()];

      const maskedLogits = absActions.map((a) =>
        available.includes(a) ? logits[absActions.indexOf(a)]! : -Infinity,
      );

      const probs = softmax(maskedLogits);
      const availableProbs = available.map((a) => probs[absActions.indexOf(a)]!);

      const chosenAbs = sampleWeighted(available, availableProbs);
      const concreteOptions = groups.get(chosenAbs)!;
      return concreteOptions[Math.floor(Math.random() * concreteOptions.length)]!;
    },
  };
};

// ---------------------------------------------------------------------------
// Composite strategy (dispatches by player count)
// ---------------------------------------------------------------------------

export const createCompositeStrategy = (
  strategies: ReadonlyMap<number, BotStrategy>,
): BotStrategy => ({
  selectAction(state: IKState, player: PlayerId, legal: ReadonlyArray<IKAction>): IKAction {
    const strategy = strategies.get(state.numPlayers) ?? RandomStrategy;
    return strategy.selectAction(state, player, legal);
  },
});
