import { expect } from "vitest";

import {
  REGULATION_2P_EXPANSION,
  createDeck,
  dealWithDeck,
  regulationDeck,
  buildPlayerArmies,
  exhaustArmyCardsPostRound,
  legalActions,
  apply,
  applySafe,
  isTerminal,
  roundScore,
  playerZones,
  findCardName,
  describeChoice,
  traceResolution,
  throneValue,
  type CardName,
  type IKCard,
  type IKCardKind,
  type IKState,
  type PlayerArmy,
  type ChoiceOption,
} from "../index.js";
import {
  addScores,
  type FlipKingStep,
  type GoldenRound,
  type KingChoice,
  type MusteringStep,
  type PlayStep,
  type PlayTranscriptStep,
  type PlayerIndex,
  type ReactionStep,
  type Score,
  type SetupTranscriptStep,
  type Stage4GoldenFixture,
  type StepOutcome,
} from "./stage4-transcript-parser.js";

interface CardEvent {
  readonly player: PlayerIndex;
  readonly card: CardName;
}

interface AccusedSwapEvent {
  readonly player: PlayerIndex;
  readonly accused: CardName;
  readonly hand: CardName;
}

type CardZoneName =
  | "hand"
  | "antechamber"
  | "parting"
  | "army"
  | "exhausted"
  | "successor"
  | "squire"
  | "dungeon"
  | "court"
  | "accused"
  | "forgotten"
  | "condemned"
  | "king";

interface CardLocation {
  readonly player: PlayerIndex | null;
  readonly zone: CardZoneName;
  readonly card: CardName;
}

interface CardChoiceMatcher {
  readonly chooser: PlayerIndex;
  readonly card: CardName;
  readonly zone?: CardZoneName;
}

interface ReplayStepContext {
  abilityWanted: boolean | null;
  abilityActivated: boolean;
  namedCard: CardName | null;
  namedValue: number | null;
  copiedCard: CardName | null;
  movedToAntechamber: CardEvent[];
  pickedFromCourt: CardEvent[];
  swapGive: CardEvent | null;
  swapTake: CardEvent | null;
  accusedSwap: AccusedSwapEvent | null;
  recalls: CardEvent[];
  rallies: CardEvent[];
  returnsToArmy: CardEvent[];
  disgraced: CardName[];
  takeSuccessor: CardEvent | null;
  takeSquire: CardEvent | null;
}

type NameMultiset = Map<CardName, number>;

interface AbstractRoundState {
  readonly hands: [NameMultiset, NameMultiset];
  readonly army: [NameMultiset, NameMultiset];
  readonly exhausted: [NameMultiset, NameMultiset];
  readonly antechamber: [NameMultiset, NameMultiset];
  readonly court: NameMultiset;
  readonly successor: [CardName | null, CardName | null];
  readonly dungeon: [CardName | null, CardName | null];
  readonly squire: [CardName | null, CardName | null];
  readonly requiredInitialHands: [NameMultiset, NameMultiset];
  accused: CardName | null;
  initialAccused: CardName | null;
}

interface RoundCandidate {
  readonly hands: readonly [
    ReadonlyArray<CardName>,
    ReadonlyArray<CardName>,
  ];
  readonly accused: CardName;
  readonly forgotten: CardName;
}

interface RoundReplayResult {
  readonly finalState: IKState;
  readonly candidate: RoundCandidate;
}

interface CommitPlan {
  readonly player: PlayerIndex;
  readonly dungeon: CardName;
  readonly successor: CardName;
  readonly squire?: CardName;
  readonly transcript: ReadonlyArray<string>;
}

export interface Stage4ReplayResult {
  readonly finalScore: Score;
  readonly roundStates: ReadonlyArray<IKState>;
  readonly solvedCandidates: ReadonlyArray<RoundCandidate>;
}

class ReplayProgressError extends Error {
  readonly progress: number;

  constructor(progress: number, message: string, cause?: unknown) {
    super(message);
    this.name = "ReplayProgressError";
    this.progress = progress;
    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.name}: ${this.message}\nCaused by: ${cause.stack}`;
    }
  }
}

const GOOSE = 0 as const;
const WILL = 1 as const;

const BASE_DECK_KINDS_2P = regulationDeck(2);
const RESERVED_SHARED_CARDS_2P = 2;
const DEALT_HAND_SIZE_2P = (BASE_DECK_KINDS_2P.length - RESERVED_SHARED_CARDS_2P) / 2;
const BASE_DECK_COUNTS = (() => {
  const counts = new Map<CardName, number>();
  for (const kind of BASE_DECK_KINDS_2P) {
    const name = kind.name as CardName;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
})();

const debugLog = (fixture: Stage4GoldenFixture, message: string): void => {
  console.info(`[stage4-replay] ${fixture.label}: ${message}`);
};

const formatCandidate = (candidate: RoundCandidate): string =>
  JSON.stringify(candidate);

const describeArmies = (armies: ReadonlyArray<PlayerArmy>): string =>
  armies
    .map(
      (army, player) =>
        `P${player} available=[${army.available.map((kind) => kind.name).join(", ")}] exhausted=[${army.exhausted.map((kind) => kind.name).join(", ")}]`,
    )
    .join(" | ");

const describeArmyZones = (state: IKState): string =>
  state.players
    .map(
      (player, idx) =>
        `P${idx} hand=[${player.hand.map((card) => `${card.kind.name}${card.armyOwner === undefined ? "" : `@${card.armyOwner}`}`).join(", ")}] army=[${player.army.map((card) => `${card.kind.name}${card.armyOwner === undefined ? "" : `@${card.armyOwner}`}`).join(", ")}] exhausted=[${player.exhausted.map((card) => `${card.kind.name}${card.armyOwner === undefined ? "" : `@${card.armyOwner}`}`).join(", ")}]`,
    )
    .join(" | ") + ` | court=[${state.shared.court.map((entry) => `${entry.card.kind.name}${entry.card.armyOwner === undefined ? "" : `@${entry.card.armyOwner}`}:${entry.face}`).join(", ")}] | condemned=[${state.shared.condemned.map((entry) => `${entry.card.kind.name}${entry.card.armyOwner === undefined ? "" : `@${entry.card.armyOwner}`}`).join(", ")}]`;

const fail = (message: string): never => {
  throw new Error(message);
};

const playerNameFromId = (
  fixture: Stage4GoldenFixture,
  player: PlayerIndex,
): string => fixture.players[player];

const otherPlayerId = (player: PlayerIndex): PlayerIndex =>
  player === GOOSE ? WILL : GOOSE;

const locateCard = (
  state: IKState,
  cardId: number,
): CardLocation | null => {
  for (const player of [GOOSE, WILL] as const) {
    const zones = playerZones(state, player);
    const fromZone = (
      zone: CardZoneName,
      cards: ReadonlyArray<IKCard>,
    ): CardLocation | null => {
      const card = cards.find((candidate) => candidate.id === cardId);
      return card
        ? {
            player,
            zone,
            card: card.kind.name as CardName,
          }
        : null;
    };

    const kingMatch = zones.king.card.id === cardId
      ? {
          player,
          zone: "king" as const,
          card: zones.king.card.kind.name as CardName,
        }
      : null;
    if (kingMatch) return kingMatch;

    const successorMatch = zones.successor?.card.id === cardId
      ? {
          player,
          zone: "successor" as const,
          card: zones.successor.card.kind.name as CardName,
        }
      : null;
    if (successorMatch) return successorMatch;

    const dungeonMatch = zones.dungeon?.card.id === cardId
      ? {
          player,
          zone: "dungeon" as const,
          card: zones.dungeon.card.kind.name as CardName,
        }
      : null;
    if (dungeonMatch) return dungeonMatch;

    const squireMatch = zones.squire?.card.id === cardId
      ? {
          player,
          zone: "squire" as const,
          card: zones.squire.card.kind.name as CardName,
        }
      : null;
    if (squireMatch) return squireMatch;

    for (const [zone, cards] of [
      ["hand", zones.hand],
      ["antechamber", zones.antechamber],
      ["parting", zones.parting],
      ["army", zones.army],
      ["exhausted", zones.exhausted],
    ] as const) {
      const match = fromZone(zone, cards);
      if (match) return match;
    }
  }

  const courtMatch = state.shared.court.find((entry) => entry.card.id === cardId);
  if (courtMatch) {
    return {
      player: null,
      zone: "court",
      card: courtMatch.card.kind.name as CardName,
    };
  }
  if (state.shared.accused?.id === cardId) {
    return {
      player: null,
      zone: "accused",
      card: state.shared.accused.kind.name as CardName,
    };
  }
  if (state.shared.forgotten?.card.id === cardId) {
    return {
      player: null,
      zone: "forgotten",
      card: state.shared.forgotten.card.kind.name as CardName,
    };
  }
  const condemnedMatch = state.shared.condemned.find((entry) => entry.card.id === cardId);
  if (condemnedMatch) {
    return {
      player: null,
      zone: "condemned",
      card: condemnedMatch.card.kind.name as CardName,
    };
  }
  return null;
};

const locateCardOption = (
  state: IKState,
  option: ChoiceOption,
): CardLocation | null =>
  option.kind === "card" ? locateCard(state, option.cardId) : null;

const findCardChoiceIndex = (
  state: IKState,
  options: ReadonlyArray<ChoiceOption>,
  matcher: CardChoiceMatcher,
): number => options.findIndex((option) => {
  const located = locateCardOption(state, option);
  if (!located) return false;
  if (located.card !== matcher.card) return false;
  if (matcher.zone !== undefined && located.zone !== matcher.zone) return false;
  return located.player === null || located.player === matcher.chooser;
});

const describeReplayContext = (
  context: ReplayStepContext,
): string =>
  JSON.stringify({
    abilityWanted: context.abilityWanted,
    abilityActivated: context.abilityActivated,
    namedCard: context.namedCard,
    namedValue: context.namedValue,
    copiedCard: context.copiedCard,
    movedToAntechamber: context.movedToAntechamber,
    pickedFromCourt: context.pickedFromCourt,
    swapGive: context.swapGive,
    swapTake: context.swapTake,
    accusedSwap: context.accusedSwap,
    recalls: context.recalls,
    rallies: context.rallies,
    returnsToArmy: context.returnsToArmy,
    disgraced: context.disgraced,
    takeSuccessor: context.takeSuccessor,
    takeSquire: context.takeSquire,
  });

const facetFromKingChoice = (
  choice: KingChoice,
): "charismatic" | "masterTactician" =>
  choice === "Charismatic Leader" ? "charismatic" : "masterTactician";

const toScore = (scores: ReadonlyArray<number>): Score =>
  [scores[GOOSE] ?? 0, scores[WILL] ?? 0];

const emptyMultiset = (): NameMultiset => new Map();

const cloneMultiset = (source: NameMultiset): NameMultiset =>
  new Map(source);

const multisetCount = (source: NameMultiset, name: CardName): number =>
  source.get(name) ?? 0;

const multisetHas = (source: NameMultiset, name: CardName): boolean =>
  multisetCount(source, name) > 0;

const addToMultiset = (
  source: NameMultiset,
  name: CardName,
  amount = 1,
): void => {
  source.set(name, multisetCount(source, name) + amount);
};

const removeFromMultiset = (
  source: NameMultiset,
  name: CardName,
  amount = 1,
  context = "multiset removal",
): void => {
  const current = multisetCount(source, name);
  if (current < amount) {
    fail(`${context}: missing ${name}`);
  }
  if (current === amount) {
    source.delete(name);
    return;
  }
  source.set(name, current - amount);
};

const multisetFromNames = (
  names: ReadonlyArray<CardName>,
): NameMultiset => {
  const result = emptyMultiset();
  for (const name of names) addToMultiset(result, name);
  return result;
};

const multisetFromKinds = (
  kinds: ReadonlyArray<IKCardKind>,
): NameMultiset => multisetFromNames(kinds.map((kind) => kind.name as CardName));

const multisetToNames = (
  source: NameMultiset,
): ReadonlyArray<CardName> =>
  [...source.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, count]) =>
      Array.from({ length: count }, () => name),
    );

const removeMatchingCardEvent = (
  events: ReadonlyArray<CardEvent>,
  player: PlayerIndex,
  card: CardName,
): CardEvent[] => {
  const idx = events.findIndex(
    (event) => event.player === player && event.card === card,
  );
  if (idx < 0) return [...events];
  return events.filter((_, eventIdx) => eventIdx !== idx);
};

const outcomesOfKind = <K extends StepOutcome["kind"]>(
  outcomes: ReadonlyArray<StepOutcome>,
  kind: K,
): ReadonlyArray<Extract<StepOutcome, { readonly kind: K }>> =>
  outcomes.filter(
    (outcome): outcome is Extract<StepOutcome, { readonly kind: K }> =>
      outcome.kind === kind,
  );

const hasLaterCardOutcome = (
  outcomes: ReadonlyArray<StepOutcome>,
  startIndex: number,
  kinds: ReadonlyArray<StepOutcome["kind"]>,
  player: PlayerIndex,
  card: CardName,
): boolean =>
  outcomes.slice(startIndex + 1).some((outcome) =>
    "player" in outcome &&
    "card" in outcome &&
    outcome.player === player &&
    outcome.card === card &&
    kinds.includes(outcome.kind),
  );

const extractMovedToAntechamber = (
  step: PlayStep,
): ReadonlyArray<CardEvent> =>
  outcomesOfKind(step.outcomes, "move_to_antechamber").map((outcome) => ({
    player: outcome.player,
    card: outcome.card,
  }));

const extractPickedFromCourt = (
  step: PlayStep,
): ReadonlyArray<CardEvent> =>
  outcomesOfKind(step.outcomes, "pick_from_court").map((outcome) => ({
    player: outcome.player,
    card: outcome.card,
  }));

const extractGenericSwap = (step: PlayStep): {
  readonly player: PlayerIndex;
  readonly give: CardName;
  readonly take: CardName;
} | null => {
  const swap = step.outcomes.find((outcome) => outcome.kind === "swap");
  return swap && swap.kind === "swap"
    ? {
        player: swap.player,
        give: swap.give,
        take: swap.take,
      }
    : null;
};

const extractAccusedSwap = (
  step: PlayStep,
): AccusedSwapEvent | null => {
  const swap = step.outcomes.find((outcome) => outcome.kind === "swap_accused");
  return swap && swap.kind === "swap_accused"
    ? {
        player: swap.player,
        accused: swap.accused,
        hand: swap.hand,
      }
    : null;
};

const extractDungeonTakes = (
  step: PlayStep,
): ReadonlyArray<CardEvent> =>
  outcomesOfKind(step.outcomes, "take_from_dungeon").map((outcome) => ({
    player: outcome.player,
    card: outcome.card,
  }));

const extractSuccessorTake = (
  step: FlipKingStep,
): CardEvent | null => {
  const outcome = step.outcomes.find((candidate) => candidate.kind === "take_successor");
  return outcome && outcome.kind === "take_successor"
    ? {
        player: outcome.player,
        card: outcome.card,
      }
    : null;
};

const extractSquireTake = (
  step: FlipKingStep,
): CardEvent | null => {
  const outcome = step.outcomes.find((candidate) => candidate.kind === "take_squire");
  return outcome && outcome.kind === "take_squire"
    ? {
        player: outcome.player,
        card: outcome.card,
      }
    : null;
};

const extractRecalls = (
  step: PlayStep | FlipKingStep,
): ReadonlyArray<CardEvent> =>
  outcomesOfKind(step.outcomes, "recall").map((outcome) => ({
    player: outcome.player,
    card: outcome.card,
  }));

const extractRallies = (
  step: PlayStep | FlipKingStep,
): ReadonlyArray<CardEvent> =>
  outcomesOfKind(step.outcomes, "rally").map((outcome) => ({
    player: outcome.player,
    card: outcome.card,
  }));

const extractReturnsToArmy = (
  step: PlayStep | FlipKingStep,
): ReadonlyArray<CardEvent> =>
  outcomesOfKind(step.outcomes, "return_to_army").map((outcome) => ({
    player: outcome.player,
    card: outcome.card,
  }));

const extractDisgracedCards = (
  step: PlayStep,
): ReadonlyArray<CardName> | null => {
  const outcome = step.outcomes.find((candidate) => candidate.kind === "disgrace");
  return outcome && outcome.kind === "disgrace" ? outcome.cards : null;
};

const inferAbilityUsage = (step: PlayStep): boolean | null => {
  if (step.ability !== null) return step.ability;
  if (step.namedCard !== undefined) return true;
  if (step.namedValue !== undefined) return true;
  if (step.copiedCard !== undefined) return true;
  if (step.outcomes.some((outcome) => outcome.kind !== "nothing_happened")) return true;
  return null;
};

const createAbstractRoundState = (
  armiesBeforeRound: ReadonlyArray<PlayerArmy>,
): AbstractRoundState => ({
  hands: [emptyMultiset(), emptyMultiset()],
  army: [
    multisetFromKinds(armiesBeforeRound[GOOSE]!.available),
    multisetFromKinds(armiesBeforeRound[WILL]!.available),
  ],
  exhausted: [
    multisetFromKinds(armiesBeforeRound[GOOSE]!.exhausted),
    multisetFromKinds(armiesBeforeRound[WILL]!.exhausted),
  ],
  antechamber: [emptyMultiset(), emptyMultiset()],
  court: emptyMultiset(),
  successor: [null, null],
  dungeon: [null, null],
  squire: [null, null],
  requiredInitialHands: [emptyMultiset(), emptyMultiset()],
  accused: null,
  initialAccused: null,
});

const materializeInitialHandCard = (
  state: AbstractRoundState,
  player: PlayerIndex,
  card: CardName,
): void => {
  if (multisetHas(state.hands[player], card)) return;
  addToMultiset(state.requiredInitialHands[player], card);
  addToMultiset(state.hands[player], card);
};

const consumeHandCard = (
  state: AbstractRoundState,
  player: PlayerIndex,
  card: CardName,
): void => {
  materializeInitialHandCard(state, player, card);
  removeFromMultiset(state.hands[player], card, 1, `hand:${player}:${card}`);
};

const addHandCard = (
  state: AbstractRoundState,
  player: PlayerIndex,
  card: CardName,
): void => {
  addToMultiset(state.hands[player], card);
};

const moveArmyToHand = (
  state: AbstractRoundState,
  player: PlayerIndex,
  card: CardName,
): void => {
  removeFromMultiset(state.army[player], card, 1, `army:${player}:${card}`);
  addHandCard(state, player, card);
};

const moveHandToArmy = (
  state: AbstractRoundState,
  player: PlayerIndex,
  card: CardName,
): void => {
  consumeHandCard(state, player, card);
  addToMultiset(state.army[player], card);
};

const moveExhaustedToArmy = (
  state: AbstractRoundState,
  player: PlayerIndex,
  card: CardName,
): void => {
  removeFromMultiset(
    state.exhausted[player],
    card,
    1,
    `exhausted:${player}:${card}`,
  );
  addToMultiset(state.army[player], card);
};

const playCardAbstractly = (
  state: AbstractRoundState,
  player: PlayerIndex,
  card: CardName,
): void => {
  if (multisetHas(state.antechamber[player], card)) {
    removeFromMultiset(
      state.antechamber[player],
      card,
      1,
      `antechamber:${player}:${card}`,
    );
  } else {
    consumeHandCard(state, player, card);
  }
  addToMultiset(state.court, card);
};

const applyAbstractOutcomeStep = (
  state: AbstractRoundState,
  outcomes: ReadonlyArray<StepOutcome>,
): void => {
  const movedToAntechamber = outcomesOfKind(outcomes, "move_to_antechamber");
  for (const moved of movedToAntechamber) {
    consumeHandCard(state, moved.player, moved.card);
    addToMultiset(state.antechamber[moved.player], moved.card);
  }

  const courtPicks = outcomesOfKind(outcomes, "pick_from_court");
  for (const picked of courtPicks) {
    removeFromMultiset(state.court, picked.card, 1, "court pick");
    addHandCard(state, picked.player, picked.card);
  }

  const accusedSwap = outcomes.find((outcome) => outcome.kind === "swap_accused");
  if (accusedSwap && accusedSwap.kind === "swap_accused") {
    if (state.accused === null) state.accused = accusedSwap.accused;
    if (state.initialAccused === null) state.initialAccused = accusedSwap.accused;
    if (state.accused !== accusedSwap.accused) {
      fail(`Accused mismatch: expected ${accusedSwap.accused}, got ${state.accused}`);
    }
    addHandCard(state, accusedSwap.player, accusedSwap.accused);
    consumeHandCard(state, accusedSwap.player, accusedSwap.hand);
    state.accused = accusedSwap.hand;
  }

  const swap = outcomes.find((outcome) => outcome.kind === "swap");
  if (swap && swap.kind === "swap" && !(accusedSwap && accusedSwap.kind === "swap_accused")) {
    const pickedByOwner = courtPicks.find(
      (event) => event.player === swap.player,
    );
    if (pickedByOwner) {
      consumeHandCard(state, swap.player, swap.give);
      addToMultiset(state.court, swap.give);
    } else {
      const other = otherPlayerId(swap.player);
      consumeHandCard(state, swap.player, swap.give);
      consumeHandCard(state, other, swap.take);
      addHandCard(state, swap.player, swap.take);
      addHandCard(state, other, swap.give);
    }
  }

  for (const taken of outcomesOfKind(outcomes, "take_from_dungeon")) {
    if (state.dungeon[taken.player] === null) state.dungeon[taken.player] = taken.card;
    if (state.dungeon[taken.player] !== taken.card) {
      fail(`Dungeon mismatch: expected ${taken.card}, got ${state.dungeon[taken.player]}`);
    }
    state.dungeon[taken.player] = null;
    addHandCard(state, taken.player, taken.card);
  }

  for (const taken of outcomesOfKind(outcomes, "take_successor")) {
    if (state.successor[taken.player] === null) state.successor[taken.player] = taken.card;
    state.successor[taken.player] = null;
    addHandCard(state, taken.player, taken.card);
  }

  for (const taken of outcomesOfKind(outcomes, "take_squire")) {
    if (state.squire[taken.player] === null) state.squire[taken.player] = taken.card;
    state.squire[taken.player] = null;
    addHandCard(state, taken.player, taken.card);
  }

  for (const recalled of outcomesOfKind(outcomes, "recall")) {
    moveExhaustedToArmy(state, recalled.player, recalled.card);
  }

  for (const rallied of outcomesOfKind(outcomes, "rally")) {
    moveArmyToHand(state, rallied.player, rallied.card);
  }

  for (const returned of outcomesOfKind(outcomes, "return_to_army")) {
    moveHandToArmy(state, returned.player, returned.card);
  }
};

const applyAbstractMusteringStep = (
  state: AbstractRoundState,
  step: MusteringStep,
): void => {
  switch (step.kind) {
    case "select_king":
    case "end_muster":
      return;
    case "recommission":
      removeFromMultiset(state.exhausted[step.player], step.recover, 1, "recover");
      addToMultiset(state.army[step.player], step.recover);
      for (const exhausted of step.exhaust) {
        removeFromMultiset(state.army[step.player], exhausted, 1, "recommission");
        addToMultiset(state.exhausted[step.player], exhausted);
      }
      return;
    case "recruit":
      if (step.exhaust) {
        removeFromMultiset(state.army[step.player], step.exhaust, 1, "begin recruit");
        addToMultiset(state.exhausted[step.player], step.exhaust);
      }
      consumeHandCard(state, step.player, step.discard);
      removeFromMultiset(state.army[step.player], step.recruit, 1, "recruit");
      addHandCard(state, step.player, step.recruit);
      return;
  }
};

const summarizeSetupCommits = (
  setup: ReadonlyArray<SetupTranscriptStep>,
): ReadonlyArray<CommitPlan> => {
  const byPlayer = new Map<PlayerIndex, {
    dungeon?: CardName;
    successor?: CardName;
    squire?: CardName;
    transcript: string[];
  }>();

  const ensurePlayer = (player: PlayerIndex) => {
    const existing = byPlayer.get(player);
    if (existing) return existing;
    const next = { transcript: [] as string[] };
    byPlayer.set(player, next);
    return next;
  };

  for (const step of setup) {
    const entry = ensurePlayer(step.player);
    entry.transcript.push(...step.transcript);
    switch (step.kind) {
      case "setup_discard":
        entry.dungeon = step.card;
        break;
      case "setup_successor":
        entry.successor = step.card;
        break;
      case "setup_squire":
        entry.squire = step.card;
        break;
    }
  }

  return [GOOSE, WILL].map((player) => {
    const entry = byPlayer.get(player);
    if (!entry?.dungeon || !entry.successor) {
      fail(`Incomplete setup commit for player ${player}`);
    }
    return {
      player,
      dungeon: entry.dungeon,
      successor: entry.successor,
      squire: entry.squire,
      transcript: entry.transcript,
    };
  });
};

const applyAbstractCommitStep = (
  state: AbstractRoundState,
  step: CommitPlan,
): void => {
  consumeHandCard(state, step.player, step.dungeon);
  consumeHandCard(state, step.player, step.successor);
  state.dungeon[step.player] = step.dungeon;
  state.successor[step.player] = step.successor;
  if (step.squire) {
    consumeHandCard(state, step.player, step.squire);
    state.squire[step.player] = step.squire;
  }
};

const applyAbstractPlayStep = (
  state: AbstractRoundState,
  step: PlayStep,
  deferOutcomes: boolean,
): void => {
  playCardAbstractly(state, step.player, step.card);

  if (step.copiedCard) {
    removeFromMultiset(state.court, step.copiedCard, 1, "stranger copy");
  }
  if (!deferOutcomes) {
    applyAbstractOutcomeStep(state, step.outcomes);
  }
};

const applyAbstractFlipStep = (
  state: AbstractRoundState,
  step: FlipKingStep,
): void => {
  applyAbstractOutcomeStep(state, step.outcomes);
};

const applyAbstractReactionStep = (
  state: AbstractRoundState,
  step: ReactionStep,
  previousStep: PlayTranscriptStep | null,
): void => {
  consumeHandCard(state, step.player, step.card);

  if (previousStep?.kind === "play") {
    removeFromMultiset(
      state.court,
      previousStep.card,
      1,
      "kings-hand prevented card",
    );
  }
};

const deriveRoundCandidates = (
  fixture: Stage4GoldenFixture,
  round: GoldenRound,
  armiesBeforeRound: ReadonlyArray<PlayerArmy>,
): ReadonlyArray<RoundCandidate> => {
  const abstractState = createAbstractRoundState(armiesBeforeRound);

  for (const step of round.mustering) {
    applyAbstractMusteringStep(abstractState, step);
  }

  for (const step of summarizeSetupCommits(round.setup)) {
    applyAbstractCommitStep(abstractState, step);
  }

  let previousPlayStep: PlayTranscriptStep | null = null;
  for (let i = 0; i < round.play.length; i += 1) {
    const step = round.play[i]!;
    const nextStep = round.play[i + 1] ?? null;
    if (step.kind === "play") {
      applyAbstractPlayStep(abstractState, step, nextStep?.kind === "reaction");
    }
    if (step.kind === "flip_king") applyAbstractFlipStep(abstractState, step);
    if (step.kind === "resolution") applyAbstractOutcomeStep(abstractState, step.outcomes);
    if (step.kind === "reaction") applyAbstractReactionStep(abstractState, step, previousPlayStep);
    previousPlayStep = step;
  }

  const gooseRequired = multisetToNames(abstractState.requiredInitialHands[GOOSE]);
  const willRequired = multisetToNames(abstractState.requiredInitialHands[WILL]);

  if (gooseRequired.length > DEALT_HAND_SIZE_2P || willRequired.length > DEALT_HAND_SIZE_2P) {
    fail(
      `Round ${round.round}: abstract constraints overfilled hands (${gooseRequired.length}, ${willRequired.length})`,
    );
  }

  const remainingCounts = cloneMultiset(BASE_DECK_COUNTS);
  for (const name of gooseRequired) removeFromMultiset(remainingCounts, name, 1, "left required");
  for (const name of willRequired) removeFromMultiset(remainingCounts, name, 1, "right required");

  const knownInitialAccused = abstractState.initialAccused ?? abstractState.accused;
  const accusedOptions = knownInitialAccused === null
    ? [...new Set(multisetToNames(remainingCounts))]
    : [knownInitialAccused];

  const buildNameCombinations = (
    source: ReadonlyArray<CardName>,
    count: number,
  ): ReadonlyArray<ReadonlyArray<CardName>> => {
    if (count === 0) return [[]];
    const results: CardName[][] = [];
    const seen = new Set<string>();
    const loop = (start: number, picked: CardName[]) => {
      if (picked.length === count) {
        const key = [...picked].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          results.push([...picked].sort());
        }
        return;
      }
      for (let i = start; i < source.length; i += 1) {
        picked.push(source[i]!);
        loop(i + 1, picked);
        picked.pop();
      }
    };
    loop(0, []);
    return results;
  };

  const removePickedNames = (
    source: ReadonlyArray<CardName>,
    picked: ReadonlyArray<CardName>,
  ): CardName[] => {
    const remaining = [...source];
    for (const name of picked) {
      const idx = remaining.findIndex((candidate) => candidate === name);
      if (idx < 0) fail(`Missing filler card ${name}`);
      remaining.splice(idx, 1);
    }
    return remaining;
  };

  const candidates: RoundCandidate[] = [];
  for (const accused of accusedOptions) {
    const afterAccused = [...multisetToNames(remainingCounts)];
    const idx = afterAccused.findIndex((name) => name === accused);
    if (idx < 0) continue;
    afterAccused.splice(idx, 1);

    const gooseNeeded = DEALT_HAND_SIZE_2P - gooseRequired.length;
    const willNeeded = DEALT_HAND_SIZE_2P - willRequired.length;
    const gooseFillers = buildNameCombinations(afterAccused, gooseNeeded);

    for (const gooseExtra of gooseFillers) {
      const afterGoose = removePickedNames(afterAccused, gooseExtra);
      const willFillers = buildNameCombinations(afterGoose, willNeeded);

      for (const willExtra of willFillers) {
        const afterWill = removePickedNames(afterGoose, willExtra);
        if (afterWill.length !== 1) continue;

        candidates.push({
          hands: [
            [...gooseRequired, ...gooseExtra].sort(),
            [...willRequired, ...willExtra].sort(),
          ],
          accused,
          forgotten: afterWill[0]!,
        });
      }
    }
  }

  const deduped = new Map<string, RoundCandidate>();
  for (const candidate of candidates) {
    const key = [
      candidate.hands[0].join(","),
      candidate.hands[1].join(","),
      candidate.accused,
      candidate.forgotten,
    ].join("||");
    deduped.set(key, candidate);
  }

  const resolved = [...deduped.values()];
  if (resolved.length === 0) {
    fail(
      [
        `No constrained candidates for round ${round.round}.`,
        `players=${fixture.players.join(" vs ")}`,
        `leftRequired=${gooseRequired.join(",")}`,
        `rightRequired=${willRequired.join(",")}`,
        `remaining=${multisetToNames(remainingCounts).join(",")}`,
        `initialAccused=${knownInitialAccused ?? "unknown"}`,
        `finalAccused=${abstractState.accused ?? "unknown"}`,
      ].join("\n"),
    );
  }
  return resolved;
};

const buildOrderedBaseDeck = (
  candidate: RoundCandidate,
): ReadonlyArray<IKCard> => {
  const pool = new Map<CardName, IKCardKind[]>();
  for (const kind of BASE_DECK_KINDS_2P) {
    const name = kind.name as CardName;
    const existing = pool.get(name);
    if (existing) existing.push(kind);
    else pool.set(name, [kind]);
  }

  const takeKind = (name: CardName): IKCardKind => {
    const kinds = pool.get(name);
    if (!kinds || kinds.length === 0) {
      throw new Error(`No remaining base-deck copy for ${name}`);
    }
    const kind = kinds.shift();
    if (!kind) {
      throw new Error(`Failed to pop base-deck copy for ${name}`);
    }
    return kind;
  };

  const orderedKinds: IKCardKind[] = [];
  for (let i = 0; i < DEALT_HAND_SIZE_2P; i += 1) {
    orderedKinds.push(takeKind(candidate.hands[0][i]!));
    orderedKinds.push(takeKind(candidate.hands[1][i]!));
  }
  orderedKinds.push(takeKind(candidate.accused));
  orderedKinds.push(takeKind(candidate.forgotten));
  return createDeck(orderedKinds);
};

const injectArmies = (
  state: IKState,
  armiesBeforeRound: ReadonlyArray<PlayerArmy>,
): IKState => {
  const maxExistingId = Math.max(
    ...state.players.flatMap((player) => [
      ...player.hand.map((card) => card.id),
      player.king.card.id,
    ]),
    state.shared.accused?.id ?? -1,
    state.shared.forgotten?.card.id ?? -1,
  );

  let nextId = maxExistingId + 1;
  const createArmyCards = (
    kinds: ReadonlyArray<IKCardKind>,
    owner: PlayerIndex,
  ): IKCard[] =>
    kinds.map((kind) => ({ id: nextId++, kind, armyOwner: owner }));

  return {
    ...state,
    players: state.players.map((player, idx) => ({
      ...player,
      army: createArmyCards(armiesBeforeRound[idx]!.available, idx as PlayerIndex),
      exhausted: createArmyCards(armiesBeforeRound[idx]!.exhausted, idx as PlayerIndex),
      recruitDiscard: [],
    })),
  };
};

const createRoundCandidateState = (
  round: GoldenRound,
  candidate: RoundCandidate,
  armiesBeforeRound: ReadonlyArray<PlayerArmy>,
): IKState => {
  const orderedDeck = buildOrderedBaseDeck(candidate);
  const dealt = dealWithDeck(orderedDeck, 2, round.crown.player);
  return injectArmies(dealt, armiesBeforeRound);
};

const currentOptionsOrThrow = (
  state: IKState,
  context: string,
): ReadonlyArray<ChoiceOption> => {
  if (state.phase !== "resolving" || state.pendingResolution === null) {
    throw new Error(`${context}: expected resolving state, found ${state.phase}`);
  }
  return state.pendingResolution.currentOptions;
};

const describePendingOptions = (state: IKState): string => {
  if (state.phase !== "resolving" || !state.pendingResolution) return "(not resolving)";
  return state.pendingResolution.currentOptions
    .map((option, idx) =>
      `${idx}:${describeChoice(option, state, state.pendingResolution!.choosingPlayer)}`,
    )
    .join(" | ");
};

const describePlayerInventory = (
  state: IKState,
  player: PlayerIndex,
): string => {
  const zones = playerZones(state, player);
  return [
    `hand=[${zones.hand.map((card) => card.kind.name).join(", ")}]`,
    `antechamber=[${zones.antechamber.map((card) => card.kind.name).join(", ")}]`,
    `parting=[${zones.parting.map((card) => card.kind.name).join(", ")}]`,
    `army=[${zones.army.map((card) => card.kind.name).join(", ")}]`,
    `exhausted=[${zones.exhausted.map((card) => card.kind.name).join(", ")}]`,
    `successor=${zones.successor?.card.kind.name ?? "none"}`,
    `squire=${zones.squire?.card.kind.name ?? "none"}`,
  ].join(" ");
};

const describeCourtState = (state: IKState): string =>
  `court=[${state.shared.court
    .map((entry) => `${entry.card.kind.name}:${entry.face}`)
    .join(", ")}]`;

const chooseEffectStrict = (
  state: IKState,
  choice: number,
  context: string,
): IKState => {
  const result = applySafe(state, { kind: "effect_choice", choice });
  if (result.ok) return result.value;
  return fail(`${context}: effect_choice(${choice}) failed: ${JSON.stringify(result.error)}`);
};

const preferredPlayZones = (
  state: IKState,
  player: PlayerIndex,
  name: CardName,
): ReadonlyArray<CardZoneName> => {
  const zones = playerZones(state, player);
  const preferred: CardZoneName[] = [];
  if (zones.antechamber.some((card) => card.kind.name === name)) preferred.push("antechamber");
  if (zones.parting.some((card) => card.kind.name === name)) preferred.push("parting");
  if (zones.hand.some((card) => card.kind.name === name)) preferred.push("hand");
  return preferred.length > 0 ? preferred : ["antechamber", "parting", "hand"];
};

const matchesPlayActionByName = (
  state: IKState,
  action: ChoiceOption | { readonly kind: "play"; readonly cardId: number },
  player: PlayerIndex,
  name: CardName,
  zones = preferredPlayZones(state, player, name),
): boolean => {
  if (action.kind !== "play") return false;
  const located = locateCard(state, action.cardId);
  return located !== null &&
    located.player === player &&
    located.card === name &&
    zones.includes(located.zone);
};

const hasLegalPlayByName = (
  state: IKState,
  player: PlayerIndex,
  name: CardName,
): boolean => legalActions(state).some((action) => matchesPlayActionByName(state, action, player, name));

const findLegalPlayActionByName = (
  state: IKState,
  player: PlayerIndex,
  name: CardName,
): { readonly kind: "play"; readonly cardId: number } => {
  const playActions = legalActions(state).filter(
    (candidate): candidate is { readonly kind: "play"; readonly cardId: number } =>
      candidate.kind === "play",
  );
  const action = playActions.find((candidate) =>
    matchesPlayActionByName(state, candidate, player, name),
  );
  if (action) return action;

  const legalDescriptions = playActions
    .map((candidate) => {
      const located = locateCard(state, candidate.cardId);
      return located
        ? `${located.card}@${located.zone}${located.player === null ? "" : `:P${located.player}`}`
        : `unknown#${candidate.cardId}`;
    })
    .join(", ");
  if (playActions.length === 0) {
    fail(
      `No legal play for ${name}; legal=${legalActions(state)
        .map((candidate) => candidate.kind)
        .join(", ")}`,
    );
  }
  fail(
    `No legal play for ${name}; legal plays=${legalDescriptions}; throneValue=${throneValue(state)}; ${describeCourtState(state)}; handValues=[${playerZones(state, player).hand.map((card) => `${card.kind.name}:${card.kind.props.value}`).join(", ")}]; ${describePlayerInventory(state, player)}`,
  );
};

const isPassProceedOptions = (
  options: ReadonlyArray<ChoiceOption>,
): boolean =>
  options.length > 0 &&
  options.every((option) => option.kind === "pass" || option.kind === "proceed");

const findCardChoiceByMatchers = (
  state: IKState,
  options: ReadonlyArray<ChoiceOption>,
  matchers: ReadonlyArray<CardChoiceMatcher>,
): number => {
  for (const matcher of matchers) {
    const idx = findCardChoiceIndex(state, options, matcher);
    if (idx >= 0) return idx;
  }
  for (const matcher of matchers) {
    const idx = findCardChoiceIndex(state, options, {
      chooser: matcher.chooser,
      card: matcher.card,
    });
    if (idx >= 0) return idx;
  }
  return -1;
};

const hasRemainingTargets = (context: ReplayStepContext): boolean =>
  context.namedCard !== null ||
  context.namedValue !== null ||
  context.copiedCard !== null ||
  context.movedToAntechamber.length > 0 ||
  context.pickedFromCourt.length > 0 ||
  context.swapGive !== null ||
  context.swapTake !== null ||
  context.accusedSwap !== null ||
  context.recalls.length > 0 ||
  context.rallies.length > 0 ||
  context.returnsToArmy.length > 0 ||
  context.disgraced.length > 0 ||
  context.takeSuccessor !== null ||
  context.takeSquire !== null;

const wantsYesNoChoice = (
  state: IKState,
  step: PlayTranscriptStep,
  context: ReplayStepContext,
): boolean => {
  const chooser = state.pendingResolution?.choosingPlayer as PlayerIndex | undefined;
  if (chooser === undefined) return context.rallies.length > 0;
  const facet = playerZones(state, chooser).king.facet;
  const recalls = step.kind === "flip_king" || step.kind === "resolution" ? extractRecalls(step) : [];
  const rallies = step.kind === "flip_king" || step.kind === "resolution" ? extractRallies(step) : [];
  const takeSuccessor =
    step.kind === "flip_king" || step.kind === "resolution" ? extractSuccessorTake(step) : null;
  const takeSquire =
    step.kind === "flip_king" || step.kind === "resolution" ? extractSquireTake(step) : null;
  if (facet === "charismatic") return rallies.length > 0;
  if (facet === "masterTactician") {
    if (recalls.length > 0) return rallies.length > 0;
    return takeSuccessor !== null && takeSquire === null;
  }
  return context.rallies.length > 0;
};

const createReplayStepContext = (
  step: PlayTranscriptStep,
): ReplayStepContext => {
  if (step.kind === "reaction") {
    return {
      abilityWanted: null,
      abilityActivated: false,
      namedCard: null,
      namedValue: null,
      copiedCard: null,
      movedToAntechamber: [],
      pickedFromCourt: [],
      swapGive: null,
      swapTake: null,
      accusedSwap: null,
      recalls: [],
      rallies: [],
      returnsToArmy: [],
      disgraced: [],
      takeSuccessor: null,
      takeSquire: null,
    };
  }

  if (step.kind === "flip_king") {
    return {
      abilityWanted: null,
      abilityActivated: false,
      namedCard: null,
      namedValue: null,
      copiedCard: null,
      movedToAntechamber: [],
      pickedFromCourt: [],
      swapGive: null,
      swapTake: null,
      accusedSwap: null,
      recalls: [...extractRecalls(step)],
      rallies: [...extractRallies(step)],
      returnsToArmy: [...extractReturnsToArmy(step)],
      disgraced: [],
      takeSuccessor: extractSuccessorTake(step),
      takeSquire: extractSquireTake(step),
    };
  }

  if (step.kind === "resolution") {
    const pickedFromCourt = outcomesOfKind(step.outcomes, "pick_from_court").map((outcome) => ({
      player: outcome.player,
      card: outcome.card,
    }));
    const genericSwap = step.outcomes.find((outcome) => outcome.kind === "swap");
    const accusedSwap = step.outcomes.find((outcome) => outcome.kind === "swap_accused");
    const disgrace = step.outcomes.find((outcome) => outcome.kind === "disgrace");
    const takeSuccessor = step.outcomes.find((outcome) => outcome.kind === "take_successor");
    const takeSquire = step.outcomes.find((outcome) => outcome.kind === "take_squire");
    return {
      abilityWanted: null,
      abilityActivated: false,
      namedCard: null,
      namedValue: null,
      copiedCard: null,
      movedToAntechamber: outcomesOfKind(step.outcomes, "move_to_antechamber").map((outcome) => ({
        player: outcome.player,
        card: outcome.card,
      })),
      pickedFromCourt,
      swapGive:
        genericSwap && genericSwap.kind === "swap"
          ? {
              player: genericSwap.player,
              card: genericSwap.give,
            }
          : null,
      swapTake:
        genericSwap && genericSwap.kind === "swap" && pickedFromCourt.length === 0
          ? {
              player: otherPlayerId(genericSwap.player),
              card: genericSwap.take,
            }
          : null,
      accusedSwap:
        accusedSwap && accusedSwap.kind === "swap_accused"
          ? {
              player: accusedSwap.player,
              accused: accusedSwap.accused,
              hand: accusedSwap.hand,
            }
          : null,
      recalls: outcomesOfKind(step.outcomes, "recall").map((outcome) => ({
        player: outcome.player,
        card: outcome.card,
      })),
      rallies: outcomesOfKind(step.outcomes, "rally").map((outcome) => ({
        player: outcome.player,
        card: outcome.card,
      })),
      returnsToArmy: outcomesOfKind(step.outcomes, "return_to_army").map((outcome) => ({
        player: outcome.player,
        card: outcome.card,
      })),
      disgraced: disgrace && disgrace.kind === "disgrace" ? disgrace.cards : [],
      takeSuccessor:
        takeSuccessor && takeSuccessor.kind === "take_successor"
          ? {
              player: takeSuccessor.player,
              card: takeSuccessor.card,
            }
          : null,
      takeSquire:
        takeSquire && takeSquire.kind === "take_squire"
          ? {
              player: takeSquire.player,
              card: takeSquire.card,
            }
          : null,
    };
  }

  const pickedFromCourt = [...extractPickedFromCourt(step)];
  const genericSwap = extractGenericSwap(step);

  return {
    abilityWanted: inferAbilityUsage(step),
    abilityActivated: false,
    namedCard: step.namedCard ?? null,
    namedValue: step.namedValue ?? null,
    copiedCard: step.copiedCard ?? null,
    movedToAntechamber: [...extractMovedToAntechamber(step)],
    pickedFromCourt,
    swapGive: genericSwap
      ? {
          player: genericSwap.player,
          card: genericSwap.give,
        }
      : null,
    swapTake:
      genericSwap && pickedFromCourt.length === 0
        ? {
            player: otherPlayerId(genericSwap.player),
            card: genericSwap.take,
          }
        : null,
    accusedSwap: extractAccusedSwap(step),
    recalls: [...extractRecalls(step)],
    rallies: [...extractRallies(step)],
    returnsToArmy: [...extractReturnsToArmy(step)],
    disgraced: [...(extractDisgracedCards(step) ?? [])],
    takeSuccessor: null,
    takeSquire: null,
  };
};

const updateReplayContext = (
  state: IKState,
  step: PlayTranscriptStep,
  context: ReplayStepContext,
  choice: ChoiceOption,
): void => {
  if (step.kind === "reaction") return;

  if (step.kind === "play" && choice.kind !== "pass") {
    context.abilityActivated = true;
  }

  if (choice.kind === "proceed" && step.kind === "play") {
    return;
  }

  if (choice.kind === "cardName" && context.namedCard === choice.name) {
    context.namedCard = null;
    return;
  }

  if (choice.kind === "value" && context.namedValue === choice.value) {
    context.namedValue = null;
    return;
  }

  if (choice.kind !== "card" || state.phase !== "resolving" || !state.pendingResolution) {
    return;
  }

  const chooser = state.pendingResolution.choosingPlayer as PlayerIndex;
  const chosenName = findCardName(state, choice.cardId) as CardName;
  const chosenLocation = locateCard(state, choice.cardId);

  if (context.copiedCard === chosenName && chosenLocation?.zone === "court") {
    context.copiedCard = null;
    return;
  }

  switch (chosenLocation?.zone) {
    case "hand":
      context.movedToAntechamber = removeMatchingCardEvent(
        context.movedToAntechamber,
        chooser,
        chosenName,
      );
      if (
        context.accusedSwap &&
        context.accusedSwap.player === chooser &&
        context.accusedSwap.hand === chosenName
      ) {
        context.accusedSwap = null;
        return;
      }
      if (
        context.swapGive &&
        context.swapGive.player === chooser &&
        context.swapGive.card === chosenName
      ) {
        context.swapGive = null;
        return;
      }
      if (
        context.swapTake &&
        context.swapTake.player === chooser &&
        context.swapTake.card === chosenName
      ) {
        context.swapTake = null;
        return;
      }
      context.returnsToArmy = removeMatchingCardEvent(
        context.returnsToArmy,
        chooser,
        chosenName,
      );
      return;
    case "court": {
      const remainingPickCount = context.pickedFromCourt.length;
      context.pickedFromCourt = removeMatchingCardEvent(
        context.pickedFromCourt,
        chooser,
        chosenName,
      );
      if (remainingPickCount !== context.pickedFromCourt.length) return;

      const disgraceIdx = context.disgraced.findIndex((card) => card === chosenName);
      if (disgraceIdx >= 0) {
        context.disgraced = context.disgraced.filter((_, idx) => idx !== disgraceIdx);
      }
      return;
    }
    case "exhausted":
      context.recalls = removeMatchingCardEvent(context.recalls, chooser, chosenName);
      return;
    case "army":
      context.rallies = removeMatchingCardEvent(context.rallies, chooser, chosenName);
      return;
    case "successor":
      if (
        context.takeSuccessor &&
        context.takeSuccessor.player === chooser &&
        context.takeSuccessor.card === chosenName
      ) {
        context.takeSuccessor = null;
      }
      return;
    case "squire":
      if (
        context.takeSquire &&
        context.takeSquire.player === chooser &&
        context.takeSquire.card === chosenName
      ) {
        context.takeSquire = null;
      }
      return;
  }
};

const pendingMatchesUpcomingStep = (
  state: IKState,
  upcoming: PlayTranscriptStep | null,
): boolean => {
  if (!upcoming) return false;

  if (state.phase === "end_of_turn" && upcoming.kind === "play") {
    return (
      state.activePlayer === upcoming.player &&
      hasLegalPlayByName(state, state.activePlayer as PlayerIndex, upcoming.card)
    );
  }

  if (state.phase !== "resolving" || !state.pendingResolution) return false;

  const chooser = state.pendingResolution.choosingPlayer as PlayerIndex;
  const options = state.pendingResolution.currentOptions;

  if (upcoming.kind === "reaction") {
    return chooser === upcoming.player && isPassProceedOptions(options);
  }

  if (upcoming.kind === "play") {
    return (
      chooser === upcoming.player &&
      options.some((option) => {
        const located = locateCardOption(state, option);
        return located !== null &&
          located.player === upcoming.player &&
          located.card === upcoming.card;
      })
    );
  }

  if (upcoming.kind === "resolution") {
    return inferChoiceForStep(
      state,
      upcoming,
      createReplayStepContext(upcoming),
    ) !== null;
  }

  return false;
};

const inferChoiceForStep = (
  state: IKState,
  step: PlayTranscriptStep,
  context: ReplayStepContext,
): number | null => {
  const options = currentOptionsOrThrow(state, "inferChoiceForStep");

  const passIdx = options.findIndex((option) => option.kind === "pass");
  const proceedIdx = options.findIndex((option) => option.kind === "proceed");
  const isReactionWindow = state.pendingResolution?.isReactionWindow ?? false;

  if (step.kind === "reaction") {
    return proceedIdx >= 0 ? proceedIdx : null;
  }

  if (isReactionWindow && isPassProceedOptions(options)) {
    return passIdx >= 0 ? passIdx : null;
  }

  if (step.kind === "play" || step.kind === "resolution") {
    if (isPassProceedOptions(options)) {
      if (step.kind === "play") {
        if (context.abilityWanted === false) return passIdx;
        if (context.abilityWanted === true && !context.abilityActivated) {
          return proceedIdx;
        }
      }
      return hasRemainingTargets(context) ? proceedIdx : passIdx;
    }

    if (step.kind === "play" && context.namedCard !== null) {
      const idx = options.findIndex(
        (option) => option.kind === "cardName" && option.name === context.namedCard,
      );
      if (idx >= 0) return idx;
    }

    if (step.kind === "play" && context.namedValue !== null) {
      const idx = options.findIndex(
        (option) => option.kind === "value" && option.value === context.namedValue,
      );
      if (idx >= 0) return idx;
    }

    if (options.every((option) => option.kind === "player")) {
      if (step.kind !== "play") return null;
      return options.findIndex(
        (option) => option.kind === "player" && option.player === otherPlayerId(step.player),
      );
    }

    if (options.every((option) => option.kind === "card")) {
      const chooser = state.pendingResolution!.choosingPlayer as PlayerIndex;
      const priorities: CardChoiceMatcher[] = [];

      if (context.copiedCard) {
        priorities.push({ chooser, card: context.copiedCard, zone: "court" });
      }
      priorities.push(
        ...context.movedToAntechamber
          .filter((event) => event.player === chooser)
          .map((event) => ({ chooser, card: event.card, zone: "hand" as const })),
      );
      priorities.push(
        ...context.pickedFromCourt
          .filter((event) => event.player === chooser)
          .map((event) => ({ chooser, card: event.card, zone: "court" as const })),
      );
      if (context.accusedSwap?.player === chooser) {
        priorities.push({ chooser, card: context.accusedSwap.hand, zone: "hand" });
      }
      if (context.swapGive?.player === chooser) {
        priorities.push({ chooser, card: context.swapGive.card, zone: "hand" });
      }
      if (context.swapTake?.player === chooser) {
        priorities.push({ chooser, card: context.swapTake.card, zone: "hand" });
      }
      priorities.push(
        ...context.recalls
          .filter((event) => event.player === chooser)
          .map((event) => ({ chooser, card: event.card, zone: "exhausted" as const })),
      );
      priorities.push(
        ...context.rallies
          .filter((event) => event.player === chooser)
          .map((event) => ({ chooser, card: event.card, zone: "army" as const })),
      );
      priorities.push(
        ...context.returnsToArmy
          .filter((event) => event.player === chooser)
          .map((event) => ({ chooser, card: event.card, zone: "hand" as const })),
      );
      priorities.push(
        ...context.disgraced.map((card) => ({ chooser, card, zone: "court" as const })),
      );

      const idx = findCardChoiceByMatchers(state, options, priorities);
      if (idx >= 0) return idx;
    }
  }

  if (step.kind === "flip_king" || step.kind === "resolution") {
    if (isPassProceedOptions(options)) return passIdx;

    const yesNoIdx = options.findIndex(
      (option) =>
        option.kind === "yesNo" &&
        option.value === wantsYesNoChoice(state, step, context),
    );
    if (yesNoIdx >= 0) return yesNoIdx;

    if (options.every((option) => option.kind === "card")) {
      const chooser = state.pendingResolution!.choosingPlayer as PlayerIndex;
      const priorities: CardChoiceMatcher[] = [
        ...context.recalls
          .filter((event) => event.player === chooser)
          .map((event) => ({ chooser, card: event.card, zone: "exhausted" as const })),
        ...context.rallies
          .filter((event) => event.player === chooser)
          .map((event) => ({ chooser, card: event.card, zone: "army" as const })),
        ...context.returnsToArmy
          .filter((event) => event.player === chooser)
          .map((event) => ({ chooser, card: event.card, zone: "hand" as const })),
        ...(context.takeSuccessor?.player === chooser
          ? [{ chooser, card: context.takeSuccessor.card, zone: "successor" as const }]
          : []),
        ...(context.takeSquire?.player === chooser
          ? [{ chooser, card: context.takeSquire.card, zone: "squire" as const }]
          : []),
      ];
      const idx = findCardChoiceByMatchers(state, options, priorities);
      if (idx >= 0) return idx;
    }
  }

  if (options.length === 1) return 0;
  return null;
};

const applyMusteringStep = (
  fixture: Stage4GoldenFixture,
  state: IKState,
  step: MusteringStep,
): IKState => {
  if (state.activePlayer !== step.player) {
    fail(`Mustering order mismatch: expected ${playerNameFromId(fixture, step.player)}, got ${playerNameFromId(fixture, state.activePlayer as PlayerIndex)}`);
  }

  switch (step.kind) {
    case "select_king":
      return apply(state, {
        kind: "select_king",
        facet: facetFromKingChoice(step.king),
      });
    case "end_muster":
      return apply(state, { kind: "end_mustering" });
    case "recommission": {
      const zones = playerZones(state, step.player);
      const exhaust1 = zones.army.find((card) => card.kind.name === step.exhaust[0])?.id;
      const exhaust2 = zones.army.find(
        (card) =>
          card.kind.name === step.exhaust[1] &&
          card.id !== exhaust1,
      )?.id;
      const recover = zones.exhausted.find((card) => card.kind.name === step.recover)?.id;
      if (exhaust1 === undefined || exhaust2 === undefined || recover === undefined) {
        fail(`Recommission resolution failed for ${playerNameFromId(fixture, step.player)}`);
      }
      return apply(state, {
        kind: "recommission",
        exhaust1Id: exhaust1!,
        exhaust2Id: exhaust2!,
        recoverFromExhaustId: recover!,
      });
    }
    case "recruit": {
      const afterBegin = (() => {
        if (step.exhaust === undefined) return state;
        const zones = playerZones(state, step.player);
        const exhaustCard = zones.army.find((card) => card.kind.name === step.exhaust)?.id;
        if (exhaustCard === undefined) {
          fail(`Missing exhaust target ${step.exhaust} for ${playerNameFromId(fixture, step.player)}`);
        }
        return apply(state, {
          kind: "begin_recruit",
          exhaustCardId: exhaustCard!,
        });
      })();
      const nextZones = playerZones(afterBegin, step.player);
      const discard = nextZones.hand.find((card) => card.kind.name === step.discard)?.id;
      const recruit = nextZones.army.find((card) => card.kind.name === step.recruit)?.id;
      if (discard === undefined || recruit === undefined) {
        fail(`Recruit resolution failed for ${playerNameFromId(fixture, step.player)}`);
      }
      return apply(afterBegin, {
        kind: "recruit",
        discardFromHandId: discard!,
        takeFromArmyId: recruit!,
      });
    }
  }
};

const applyCommitStep = (
  fixture: Stage4GoldenFixture,
  state: IKState,
  step: CommitPlan,
): IKState => {
  if (state.activePlayer !== step.player) {
    fail(`Setup order mismatch: expected ${playerNameFromId(fixture, step.player)}, got ${playerNameFromId(fixture, state.activePlayer as PlayerIndex)}`);
  }
  const zones = playerZones(state, step.player);
  const pickDistinct = (
    name: CardName,
    excluded: ReadonlyArray<number> = [],
  ): number | undefined =>
    zones.hand.find(
      (card) =>
        card.kind.name === name &&
        !excluded.includes(card.id),
    )?.id;

  const successor = pickDistinct(step.successor);
  const dungeon = pickDistinct(step.dungeon, successor === undefined ? [] : [successor]);
  const squire =
    step.squire !== undefined
      ? pickDistinct(
          step.squire,
          [successor, dungeon].filter((id): id is number => id !== undefined),
        )
      : undefined;
  if (dungeon === undefined || successor === undefined || (step.squire && squire === undefined)) {
    fail(
      `Commit resolution failed for ${playerNameFromId(fixture, step.player)}: ` +
      `successor=${step.successor}(${successor}), dungeon=${step.dungeon}(${dungeon}), squire=${step.squire ?? "none"}(${squire}). ` +
      `Hand: [${zones.hand.map((card) => `${card.kind.name}#${card.id}`).join(", ")}]`,
    );
  }
  const committed = applySafe(state, {
    kind: "commit",
    dungeonId: dungeon!,
    successorId: successor!,
    squireId: squire,
  });
  if (!committed.ok) {
    fail(
      `Engine commit rejected for ${playerNameFromId(fixture, step.player)}: ` +
      `successor=${step.successor}#${successor}, dungeon=${step.dungeon}#${dungeon}, squire=${step.squire ?? "none"}#${squire}. ` +
      `phase=${state.phase}, activePlayer=${state.activePlayer}. ` +
      `Hand: [${zones.hand.map((card) => `${card.kind.name}#${card.id}`).join(", ")}]. ` +
      `Engine hand: [${playerZones(state, state.activePlayer).hand.map((card) => `${card.kind.name}#${card.id}`).join(", ")}]`,
    );
  }
  return committed.value;
};

const enterObservedStep = (
  state: IKState,
  step: PlayTranscriptStep,
): IKState => {
  if (step.kind === "reaction") {
    if (state.phase !== "resolving" || !state.pendingResolution) {
      fail(`Expected reaction window, found ${state.phase}`);
    }
    const idx = currentOptionsOrThrow(state, "reaction entry").findIndex(
      (option) => option.kind === "proceed",
    );
    if (idx < 0) fail(`No reaction proceed option`);
    return chooseEffectStrict(state, idx, `reaction:${step.card}`);
  }

  if (step.kind === "flip_king") {
    if (state.phase !== "play") {
      fail(`Expected play phase for king flip, found ${state.phase}`);
    }
    if (state.activePlayer !== step.player) {
      fail(`King flip player mismatch`);
    }
    return apply(state, { kind: "disgrace" });
  }

  if (step.kind === "resolution") {
    return state;
  }

  if (state.phase === "resolving") {
    const options = currentOptionsOrThrow(state, `forced play ${step.card}`);
    const idx = findCardChoiceByMatchers(
      state,
      options,
      preferredPlayZones(state, step.player, step.card).map((zone) => ({
        chooser: step.player,
        card: step.card,
        zone,
      })),
    );
    if (idx < 0) {
      if (options.length === 1) {
        return chooseEffectStrict(state, 0, `forced-play:${step.card}:single-option`);
      }
      fail(
        `Could not match resolving card choice for ${step.card}; options=${describePendingOptions(state)}`,
      );
    }
    return chooseEffectStrict(state, idx, `forced-play:${step.card}`);
  }

  const action = findLegalPlayActionByName(state, step.player, step.card);
  return apply(state, action);
};

const assertOutcomeSet = (
  state: IKState,
  outcomes: ReadonlyArray<StepOutcome>,
  transcript: ReadonlyArray<string>,
): void => {
  for (const moved of outcomesOfKind(outcomes, "move_to_antechamber")) {
    const antechamber = playerZones(state, moved.player).antechamber.map((card) => card.kind.name);
    if (!antechamber.includes(moved.card)) {
      fail(
        `Expected player ${moved.player} to have ${moved.card} in antechamber after "${transcript.join(" ")}"; found ${antechamber.join(", ")}`,
      );
    }
  }

  for (const picked of outcomesOfKind(outcomes, "pick_from_court")) {
    expect(
      playerZones(state, picked.player).hand.some(
        (card) => card.kind.name === picked.card,
      ),
    ).toBe(true);
  }

  const swap = outcomes.find((outcome) => outcome.kind === "swap");
  const accusedSwap = outcomes.find((outcome) => outcome.kind === "swap_accused");
  const courtPicks = outcomesOfKind(outcomes, "pick_from_court");
  if (swap && swap.kind === "swap" && !(accusedSwap && accusedSwap.kind === "swap_accused") && courtPicks.length === 0) {
    const other = otherPlayerId(swap.player);
    expect(
      playerZones(state, swap.player).hand.some((card) => card.kind.name === swap.take),
    ).toBe(true);
    expect(
      playerZones(state, other).hand.some((card) => card.kind.name === swap.give),
    ).toBe(true);
  }

  if (accusedSwap && accusedSwap.kind === "swap_accused") {
    expect(state.shared.accused?.kind.name).toBe(accusedSwap.hand);
    expect(
      playerZones(state, accusedSwap.player).hand.some(
        (card) => card.kind.name === accusedSwap.accused,
      ),
    ).toBe(true);
  }

  for (const taken of outcomesOfKind(outcomes, "take_from_dungeon")) {
    if (!playerZones(state, taken.player).hand.some((card) => card.kind.name === taken.card)) {
      fail(
        `Expected ${taken.card} from dungeon in player ${taken.player} hand after "${transcript.join(" ")}"; ${describePlayerInventory(state, taken.player)}`,
      );
    }
  }

  for (const taken of outcomesOfKind(outcomes, "take_successor")) {
    if (!playerZones(state, taken.player).hand.some((card) => card.kind.name === taken.card)) {
      fail(
        `Expected successor ${taken.card} in player ${taken.player} hand after "${transcript.join(" ")}"; ${describePlayerInventory(state, taken.player)}`,
      );
    }
  }

  for (const taken of outcomesOfKind(outcomes, "take_squire")) {
    if (!playerZones(state, taken.player).hand.some((card) => card.kind.name === taken.card)) {
      fail(
        `Expected squire ${taken.card} in player ${taken.player} hand after "${transcript.join(" ")}"; ${describePlayerInventory(state, taken.player)}`,
      );
    }
  }

  for (const [index, recalled] of outcomes.entries()) {
    if (recalled.kind !== "recall") continue;
    if (hasLaterCardOutcome(outcomes, index, ["rally"], recalled.player, recalled.card)) {
      continue;
    }
    if (!playerZones(state, recalled.player).army.some((card) => card.kind.name === recalled.card)) {
      fail(
        `Expected recalled ${recalled.card} in player ${recalled.player} army after "${transcript.join(" ")}"; ${describePlayerInventory(state, recalled.player)}`,
      );
    }
  }

  for (const [index, rallied] of outcomes.entries()) {
    if (rallied.kind !== "rally") continue;
    if (hasLaterCardOutcome(outcomes, index, ["return_to_army"], rallied.player, rallied.card)) {
      continue;
    }
    if (!playerZones(state, rallied.player).hand.some((card) => card.kind.name === rallied.card)) {
      fail(
        `Expected rallied ${rallied.card} in player ${rallied.player} hand after "${transcript.join(" ")}"; ${describePlayerInventory(state, rallied.player)}`,
      );
    }
  }

  for (const returned of outcomesOfKind(outcomes, "return_to_army")) {
    if (!playerZones(state, returned.player).army.some((card) => card.kind.name === returned.card)) {
      fail(
        `Expected returned ${returned.card} in player ${returned.player} army after "${transcript.join(" ")}"; ${describePlayerInventory(state, returned.player)}`,
      );
    }
  }
};

const assertObservedOutcome = (
  state: IKState,
  step: PlayTranscriptStep,
  previousStep: PlayTranscriptStep | null,
  nextStep: PlayTranscriptStep | null,
): void => {
  if (step.kind === "play") {
    if (!state.shared.court.some((entry) => entry.card.kind.name === step.card)) {
      fail(
        [
          `Expected played ${step.card} to remain on the court after "${step.transcript.join(" ")}"`,
          describeCourtState(state),
          `player ${step.player}: ${describePlayerInventory(state, step.player)}`,
        ].join("; "),
      );
    }
    if (nextStep?.kind !== "reaction") {
      assertOutcomeSet(state, step.outcomes, step.transcript);
    }
  }

  if (step.kind === "flip_king") {
    if (step.transcript.length > 1) {
      expect(playerZones(state, step.player).king.face).toBe("down");
    }
    if (nextStep?.kind !== "reaction") {
      assertOutcomeSet(state, step.outcomes, step.transcript);
    }
  }

  if (step.kind === "resolution") {
    assertOutcomeSet(state, step.outcomes, step.transcript);
  }

  if (step.kind === "reaction" && previousStep?.kind === "play") {
    expect(
      state.shared.court.some((entry) => entry.card.kind.name === previousStep.card),
    ).toBe(false);
  }
};

const replayObservedStep = (
  state: IKState,
  step: PlayTranscriptStep,
  nextStep: PlayTranscriptStep | null,
  previousStep: PlayTranscriptStep | null,
): IKState => {
  let current = step.kind === "resolution" ? state : enterObservedStep(state, step);
  const context = createReplayStepContext(step);
  let safety = 0;

  while ((current.phase === "resolving" || current.phase === "end_of_turn") && safety++ < 200) {
    const upcomingIsReaction = nextStep?.kind === "reaction";
    if (pendingMatchesUpcomingStep(current, nextStep) && (upcomingIsReaction || !hasRemainingTargets(context))) break;

    if (current.phase === "end_of_turn") {
      const legal = legalActions(current);
      if (legal.length === 1) {
        current = apply(current, legal[0]!);
        continue;
      }
      break;
    }

    const inferred = inferChoiceForStep(current, step, context);
    if (inferred !== null) {
      const options = currentOptionsOrThrow(current, "apply inferred choice");
      updateReplayContext(current, step, context, options[inferred]!);
      current = chooseEffectStrict(current, inferred, `${step.kind}:${describePendingOptions(current)}`);
      continue;
    }

    const options = currentOptionsOrThrow(current, "unresolved transcript choice");
    if (isPassProceedOptions(options)) {
      const passIdx = options.findIndex((option) => option.kind === "pass");
      if (passIdx >= 0) {
        current = chooseEffectStrict(current, passIdx, "auto-pass trailing choice");
        continue;
      }
    }

    fail(
      [
        `Could not resolve transcript step: ${step.transcript.join(" ")}`,
        `phase=${current.phase}`,
        `options=${describePendingOptions(current)}`,
        `trace=${traceResolution(current).map((entry) => entry.description).join(" -> ")}`,
      ].join("\n"),
    );
  }

  assertObservedOutcome(current, step, previousStep, nextStep);
  return current;
};

const finishRound = (state: IKState): IKState => {
  let current = state;
  let safety = 0;
  while (!isTerminal(current) && safety++ < 200) {
    if (current.phase === "resolving" && current.pendingResolution) {
      const options = current.pendingResolution.currentOptions;
      if (options.length === 1) {
        current = chooseEffectStrict(current, 0, "finish-round single choice");
        continue;
      }
      const passIdx = options.findIndex((option) => option.kind === "pass");
      if (passIdx >= 0) {
        current = chooseEffectStrict(current, passIdx, "finish-round pass");
        continue;
      }
      fail(`Round did not terminate; unresolved options=${describePendingOptions(current)}`);
    }

    if (current.phase === "end_of_turn") {
      const legal = legalActions(current);
      if (legal.length === 1) {
        current = apply(current, legal[0]!);
        continue;
      }
      fail("Round did not terminate; unresolved end_of_turn choices remain");
    }

    break;
  }

  if (!isTerminal(current)) {
    fail(`Expected terminal round state, found phase=${current.phase}`);
  }
  return current;
};

const replayRoundWithCandidate = (
  fixture: Stage4GoldenFixture,
  round: GoldenRound,
  candidate: RoundCandidate,
  armiesBeforeRound: ReadonlyArray<PlayerArmy>,
): RoundReplayResult => {
  let state = createRoundCandidateState(round, candidate, armiesBeforeRound);
  expect(state.activePlayer).toBe(round.crown.player);

  state = apply(state, {
    kind: "crown",
    firstPlayer: round.crown.firstPlayer,
  });

  for (let i = 0; i < round.mustering.length; i += 1) {
    const step = round.mustering[i]!;
    try {
      state = applyMusteringStep(fixture, state, step);
    } catch (error) {
      throw new ReplayProgressError(
        i,
        `Mustering replay failed for "${step.transcript.join(" ")}"`,
        error,
      );
    }
  }

  expect(state.phase).toBe("setup");
  const setupCommits = summarizeSetupCommits(round.setup);
  const pendingSetup = [...setupCommits];
  while (pendingSetup.length > 0) {
    const idx = pendingSetup.findIndex((step) => step.player === state.activePlayer);
    if (idx < 0) {
      fail(`No setup commitment remained for active player ${state.activePlayer}`);
    }
    const [step] = pendingSetup.splice(idx, 1);
    if (!step) {
      fail(`Missing setup step for active player ${state.activePlayer}`);
    }
    try {
      state = applyCommitStep(fixture, state, step);
    } catch (error) {
      throw new ReplayProgressError(
        100 + setupCommits.length - pendingSetup.length,
        `Setup replay failed for "${step.transcript.join(" ")}"`,
        error,
      );
    }
  }

  expect(state.phase).toBe("play");
  let previousStep: PlayTranscriptStep | null = null;
  for (let i = 0; i < round.play.length; i += 1) {
    const step = round.play[i]!;
    const nextStep = round.play[i + 1] ?? null;
    try {
      state = replayObservedStep(state, step, nextStep, previousStep);
    } catch (error) {
      throw new ReplayProgressError(
        200 + i,
        `Play replay failed for "${step.transcript.join(" ")}"`,
        error,
      );
    }
    previousStep = step;
  }

  const finalState = finishRound(state);
  expect(toScore(roundScore(finalState))).toEqual(round.roundScore);
  return { finalState, candidate };
};

const solveRound = (
  fixture: Stage4GoldenFixture,
  round: GoldenRound,
  armiesBeforeRound: ReadonlyArray<PlayerArmy>,
): RoundReplayResult => {
  const candidates = deriveRoundCandidates(fixture, round, armiesBeforeRound);
  debugLog(fixture, `round ${round.round}: ${candidates.length} candidate deck states`);

  let bestError: ReplayProgressError | Error | null = null;
  let bestCandidate: RoundCandidate | null = null;

  for (const candidate of candidates) {
    try {
      return replayRoundWithCandidate(fixture, round, candidate, armiesBeforeRound);
    } catch (error) {
      if (error instanceof ReplayProgressError) {
        if (!(bestError instanceof ReplayProgressError) || error.progress >= bestError.progress) {
          bestError = error;
          bestCandidate = candidate;
        }
        continue;
      }
      bestError = error instanceof Error ? error : new Error(String(error));
      bestCandidate = candidate;
    }
  }

  debugLog(
    fixture,
    `round ${round.round}: best candidate ${
      bestCandidate ? JSON.stringify(bestCandidate) : "none"
    }`,
  );

  return fail(
    [
      `No round candidate satisfied round ${round.round}.`,
      `candidates=${candidates.length}`,
      `bestCandidate=${bestCandidate ? JSON.stringify(bestCandidate) : "none"}`,
      `${bestError instanceof Error ? bestError.stack ?? bestError.message : String(bestError)}`,
    ].join("\n"),
  );
};

export const replayStage4Transcript = (
  fixture: Stage4GoldenFixture,
): Stage4ReplayResult => {
  const playerSelections = [GOOSE, WILL].map((player) =>
    fixture.selections.find((selection) => selection.player === player)?.cards ?? [],
  ) as ReadonlyArray<ReadonlyArray<CardName>>;

  let armies = buildPlayerArmies(REGULATION_2P_EXPANSION, playerSelections);
  let running = [0, 0] as Score;
  const roundStates: IKState[] = [];
  const solvedCandidates: RoundCandidate[] = [];

  for (const round of fixture.rounds) {
    debugLog(fixture, `round ${round.round}: replay start`);
    debugLog(fixture, `round ${round.round}: armies ${describeArmies(armies)}`);
    const replayed = solveRound(fixture, round, armies);
    const roundResult = toScore(roundScore(replayed.finalState));
    running = addScores(running, roundResult);

    expect(roundResult).toEqual(round.roundScore);
    expect(running).toEqual(round.matchScoreAfterRound);

    debugLog(fixture, `round ${round.round}: final army zones ${describeArmyZones(replayed.finalState)}`);
    armies = exhaustArmyCardsPostRound(replayed.finalState, armies);
    roundStates.push(replayed.finalState);
    solvedCandidates.push(replayed.candidate);
  }

  expect(running).toEqual(fixture.finalScore);
  debugLog(
    fixture,
    `replay complete: cumulative ${running[0]}:${running[1]}, transcript reported ${fixture.reportedFinalScore[0]}:${fixture.reportedFinalScore[1]}`,
  );
  return { finalScore: running, roundStates, solvedCandidates };
};
