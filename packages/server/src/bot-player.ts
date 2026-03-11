import type { PlayerId } from "@imposter-zero/types";
import {
  type IKState,
  type IKAction,
  type PendingResolution,
  type ChoiceOption,
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
// Deterministic bot naming — two-word model hash + ordinal prefix
// ---------------------------------------------------------------------------

const MODEL_ADJECTIVES = [
  "Swift", "Bold", "Calm", "Deft", "Fey", "Grim", "Hale", "Keen",
  "Lush", "Meek", "Odd", "Pale", "Rare", "Sly", "Tart", "Vast",
  "Warm", "Zany", "Dry", "True", "Fond", "Glad", "Mild", "Neat",
  "Pure", "Rich", "Sage", "Tall", "Wise", "Apt",
] as const;

const MODEL_NOUNS = [
  "Potato", "Falcon", "Badger", "Walrus", "Cobalt", "Candle",
  "Dagger", "Fennel", "Geyser", "Hermit", "Jackal", "Kettle",
  "Lantern", "Magnet", "Nectar", "Oyster", "Pebble", "Quartz",
  "Riddle", "Sphinx", "Timber", "Urchin", "Vortex", "Wraith",
  "Zenith", "Anchor", "Breeze", "Cipher", "Donkey", "Ember",
] as const;

const ORDINAL_PREFIXES = [
  "Keen", "Aspiring", "Diligent", "Earnest", "Fervent",
  "Gallant", "Humble", "Intrepid", "Jovial", "Luminous",
  "Noble", "Prudent", "Resolute", "Stalwart", "Tenacious",
  "Valiant",
] as const;

const djb2 = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
};

export const modelHashName = (policyLabel: string): string => {
  const h = djb2(policyLabel);
  const adj = MODEL_ADJECTIVES[h % MODEL_ADJECTIVES.length]!;
  const noun = MODEL_NOUNS[(h >>> 8) % MODEL_NOUNS.length]!;
  return `${adj} ${noun}`;
};

export const botDisplayName = (modelName: string, index: number): string => {
  const prefix = ORDINAL_PREFIXES[index % ORDINAL_PREFIXES.length]!;
  return `${prefix} ${modelName}`;
};

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
// Effect heuristic — handles resolving and end_of_turn phases
// ---------------------------------------------------------------------------

const findCardValue = (state: IKState, cardId: number): number => {
  for (const p of state.players) {
    for (const c of p.hand) if (c.id === cardId) return c.kind.props.value;
    for (const c of p.antechamber) if (c.id === cardId) return c.kind.props.value;
    for (const c of p.parting) if (c.id === cardId) return c.kind.props.value;
    for (const c of p.army) if (c.id === cardId) return c.kind.props.value;
    if (p.successor?.card.id === cardId) return p.successor.card.kind.props.value;
    if (p.dungeon?.card.id === cardId) return p.dungeon.card.kind.props.value;
    if (p.squire?.card.id === cardId) return p.squire.card.kind.props.value;
  }
  for (const e of state.shared.court) if (e.card.id === cardId) return e.card.kind.props.value;
  if (state.shared.accused?.id === cardId) return state.shared.accused.kind.props.value;
  for (const e of state.shared.condemned) if (e.card.id === cardId) return e.card.kind.props.value;
  return 0;
};

const selectReactionChoice = (
  _state: IKState,
  _player: PlayerId,
  pending: PendingResolution,
  legal: ReadonlyArray<IKAction>,
): IKAction => {
  const passIdx = pending.currentOptions.findIndex((o) => o.kind === "pass");
  if (passIdx >= 0 && legal.length > 1) {
    const reactAction = legal.find(
      (a) => a.kind === "effect_choice" && a.choice !== passIdx,
    );
    if (reactAction) return reactAction;
  }
  return legal[0]!;
};

const pickCardOption = (
  state: IKState,
  player: PlayerId,
  pending: PendingResolution,
  options: ReadonlyArray<ChoiceOption>,
  legal: ReadonlyArray<IKAction>,
): IKAction => {
  const isOwnEffect = pending.effectPlayer === player;
  let bestIdx = 0;
  let bestVal = isOwnEffect ? -1 : Infinity;
  for (let i = 0; i < options.length; i++) {
    const opt = options[i]!;
    if (opt.kind !== "card") continue;
    const val = findCardValue(state, opt.cardId);
    if (isOwnEffect ? val > bestVal : val < bestVal) {
      bestVal = val;
      bestIdx = i;
    }
  }
  return legal[bestIdx]!;
};

const pickPlayerOption = (
  state: IKState,
  options: ReadonlyArray<ChoiceOption>,
  legal: ReadonlyArray<IKAction>,
): IKAction => {
  let bestIdx = 0;
  let minHand = Infinity;
  for (let i = 0; i < options.length; i++) {
    const opt = options[i]!;
    if (opt.kind !== "player") continue;
    const handSize = playerZones(state, opt.player).hand.length;
    if (handSize < minHand) {
      minHand = handSize;
      bestIdx = i;
    }
  }
  return legal[bestIdx]!;
};

const selectEffectChoice = (
  state: IKState,
  player: PlayerId,
  pending: PendingResolution,
  legal: ReadonlyArray<IKAction>,
): IKAction => {
  const options = pending.currentOptions;
  const isOwnEffect = pending.effectPlayer === player;
  const first = options[0]!;

  switch (first.kind) {
    case "pass": {
      if (isOwnEffect && options.length > 1) {
        const activateIdx = options.findIndex((o) => o.kind !== "pass");
        if (activateIdx >= 0) return legal[activateIdx]!;
      }
      return legal[0]!;
    }

    case "proceed":
      return legal[0]!;

    case "yesNo": {
      const prefer = isOwnEffect;
      const idx = options.findIndex(
        (o) => o.kind === "yesNo" && o.value === prefer,
      );
      return idx >= 0 ? legal[idx]! : legal[0]!;
    }

    case "card": {
      if (isOwnEffect) {
        const passIdx = options.findIndex((o) => o.kind === "pass");
        if (passIdx >= 0) {
          return pickCardOption(state, player, pending, options.filter((o) => o.kind !== "pass"), legal);
        }
      }
      return pickCardOption(state, player, pending, options, legal);
    }

    case "player":
      return pickPlayerOption(state, options, legal);

    case "value": {
      const mid = Math.floor(options.length / 2);
      return legal[mid]!;
    }

    case "cardName":
      return legal[Math.floor(Math.random() * legal.length)]!;

    default:
      return legal[Math.floor(Math.random() * legal.length)]!;
  }
};

const selectBestPlayAction = (
  state: IKState,
  player: PlayerId,
  legal: ReadonlyArray<IKAction>,
): IKAction => {
  const zones = playerZones(state, player);
  const pool = [...zones.hand, ...zones.antechamber, ...zones.parting];
  let bestIdx = 0;
  let bestVal = -1;
  for (let i = 0; i < legal.length; i++) {
    const action = legal[i]!;
    if (action.kind !== "play") continue;
    const card = pool.find((c) => c.id === action.cardId);
    const val = card?.kind.props.value ?? 0;
    if (val > bestVal) {
      bestVal = val;
      bestIdx = i;
    }
  }
  return legal[bestIdx]!;
};

export const EffectHeuristic: BotStrategy = {
  selectAction(
    state: IKState,
    player: PlayerId,
    legal: ReadonlyArray<IKAction>,
  ): IKAction {
    if (legal.length <= 1) return legal[0]!;

    if (state.phase === "end_of_turn") {
      return selectBestPlayAction(state, player, legal);
    }

    const pending = state.pendingResolution;
    if (!pending) return legal[Math.floor(Math.random() * legal.length)]!;

    if (pending.isReactionWindow) {
      return selectReactionChoice(state, player, pending, legal);
    }

    return selectEffectChoice(state, player, pending, legal);
  },
};

// ---------------------------------------------------------------------------
// Effects-aware strategy — dispatches to value policy or effect heuristic
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Draft heuristic — rank signature cards by strategic value
// ---------------------------------------------------------------------------

const SIGNATURE_RANK: Readonly<Record<string, number>> = {
  "Exile":        9,
  "Conspiracist": 8,
  "Aegis":        7,
  "Lockshift":    6,
  "Informant":    5,
  "Ancestor":     5,
  "Nakturn":      4,
  "Stranger":     3,
  "Flagbearer":   2,
};

export const rankSignatureCard = (name: string): number =>
  SIGNATURE_RANK[name] ?? 0;

// ---------------------------------------------------------------------------
// Mustering heuristic — recruit high-value cards, prefer Master Tactician
// ---------------------------------------------------------------------------

const selectMusteringAction = (
  state: IKState,
  player: PlayerId,
  legal: ReadonlyArray<IKAction>,
): IKAction => {
  if (legal.length <= 1) return legal[0]!;

  const perspective = playerZones(state, player);
  const hasKingFacet = perspective.king.facet !== "default";

  const endAction = legal.find((a) => a.kind === "end_mustering");
  const selectKingActions = legal.filter((a) => a.kind === "select_king");
  const beginActions = legal.filter((a) => a.kind === "begin_recruit");
  const recruitActions = legal.filter((a) => a.kind === "recruit");

  if (!hasKingFacet && selectKingActions.length > 0) {
    const tactician = selectKingActions.find(
      (a) => a.kind === "select_king" && a.facet === "masterTactician",
    );
    return tactician ?? selectKingActions[0]!;
  }

  if (recruitActions.length > 0) {
    let bestAction = recruitActions[0]!;
    let bestScore = -Infinity;
    for (const a of recruitActions) {
      if (a.kind !== "recruit") continue;
      const takeVal = findCardValue(state, a.takeFromArmyId);
      const discardVal = findCardValue(state, a.discardFromHandId);
      const score = takeVal - discardVal;
      if (score > bestScore) {
        bestScore = score;
        bestAction = a;
      }
    }
    if (bestScore > 0) return bestAction;
    if (endAction) return endAction;
    return bestAction;
  }

  if (beginActions.length > 0 && perspective.hand.length > 0) {
    let worstAction = beginActions[0]!;
    let worstVal = Infinity;
    for (const a of beginActions) {
      if (a.kind !== "begin_recruit") continue;
      const val = findCardValue(state, a.exhaustCardId);
      if (val < worstVal) {
        worstVal = val;
        worstAction = a;
      }
    }
    return worstAction;
  }

  if (endAction) return endAction;
  return legal[0]!;
};

// ---------------------------------------------------------------------------
// Effects-aware strategy — dispatches to value policy or heuristic
// ---------------------------------------------------------------------------

export const createEffectsAwareStrategy = (
  valuePolicy: BotStrategy,
): BotStrategy => ({
  selectAction(
    state: IKState,
    player: PlayerId,
    legal: ReadonlyArray<IKAction>,
  ): IKAction {
    if (state.phase === "resolving" || state.phase === "end_of_turn")
      return EffectHeuristic.selectAction(state, player, legal);
    return valuePolicy.selectAction(state, player, legal);
  },
});

// ---------------------------------------------------------------------------
// Abstract actions (shared vocabulary — mirrors imposter_zero/abstraction.py)
// ---------------------------------------------------------------------------

const ABSTRACT_ACTIONS = [
  "L", "M", "H", "D",
  "LL", "LH", "HH",
  "K0", "K1", "K2",
  "SK_C", "SK_T", "EM",
  "BR", "RC_P", "RC_N",
  "DS0", "DS1", "DS2", "DS3", "DS4", "DS5", "DS6", "DS7", "DS8",
  "DO_F", "DO_S",
  "DP0", "DP1", "DP2", "DP3", "DP4", "DP5", "DP6", "DP7", "DP8",
] as const;
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

const bucketScore = (s: number): number => {
  if (s <= 2) return 0;
  if (s <= 4) return 1;
  return 2;
};

const abstractState = (state: IKState, player: PlayerId): string => {
  const n = state.numPlayers;
  const opp = ((player + 1) % n) as PlayerId;

  if (state.phase === "crown") return "CR";

  const perspective = playerZones(state, player);
  const handVals = perspective.hand
    .map((c) => c.kind.props.value)
    .sort((a, b) => b - a);
  const handSize = handVals.length;

  if (state.phase === "mustering") {
    const armyN = perspective.army.length;
    const facetChar = perspective.king.facet === "default" ? "d" : perspective.king.facet[0];
    return `MUS${bucketHand(handSize)}${armyN}${facetChar}`;
  }

  if (state.phase === "setup") {
    const low = handVals.filter((v) => v <= 4).length;
    const high = handVals.filter((v) => v >= 7).length;
    return `S${bucketHand(handSize)}${Math.min(low, 5)}${Math.min(high, 5)}`;
  }

  if (perspective.parting.length > 0) return "FP";
  if (perspective.antechamber.length > 0) return "FA";

  const threshold = throneValue(state);
  const nPlayable = handVals.filter((v) => v >= threshold).length;
  const canDisgrace = isKingFaceUp(state, player) && state.shared.court.length > 0;

  const oppHands = Array.from({ length: n - 1 }, (_, i) => {
    const o = ((player + 1 + i) % n) as PlayerId;
    return playerZones(state, o).hand.length;
  });
  const minOpp = bucketHand(Math.min(...oppHands));
  const courtSz = Math.min(state.shared.court.length, 7);
  const disgraced = Math.min(
    state.shared.court.filter((e) => e.face === "down").length,
    3,
  );

  return (
    `P${bucketPlayable(nPlayable)}` +
    `${bucketThreshold(threshold)}` +
    `${bucketHand(handSize)}` +
    `${minOpp}` +
    `${canDisgrace ? "D" : "_"}` +
    `${courtSz}` +
    `${disgraced}`
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

    const isForced =
      perspective.parting.some((c) => c.id === action.cardId) ||
      perspective.antechamber.some((c) => c.id === action.cardId);
    if (isForced) return "L";

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

  if (action.kind === "effect_choice") return `E${action.choice}`;
  if (action.kind === "select_king") return action.facet === "charismatic" ? "SK_C" : "SK_T";
  if (action.kind === "end_mustering") return "EM";
  if (action.kind === "begin_recruit") return "BR";
  if (action.kind === "recruit") {
    const takeVal = playerZones(state, player).army.find((c) => c.id === action.takeFromArmyId)?.kind.props.value ?? 0;
    const discVal = playerZones(state, player).hand.find((c) => c.id === action.discardFromHandId)?.kind.props.value ?? 0;
    return takeVal > discVal ? "RC_P" : "RC_N";
  }
  if (action.kind === "recommission") return "RC_N";

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

  const anteCount = perspective.antechamber.length / 5;
  const condemnedCount = state.shared.condemned.length / 10;
  const disgracedCount = state.shared.court.filter((e) => e.face === "down").length / 7;
  const partingCount = perspective.parting.length / 3;

  return [
    ...activeOh, ...phaseOh, ...hist,
    myKing, succ, dung, throne, court, accused, forgotten,
    ...fpOh, ...oppFeatures,
    anteCount, condemnedCount, disgracedCount, partingCount,
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
