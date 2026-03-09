import type { PlayerId } from "@imposter-zero/types";

import type { CardName, IKCardKind, IKCard } from "./card.js";
import { KING_CARD_KIND } from "./card.js";
import type { GameConfig } from "./config.js";
import { REGULATION_2P_EXPANSION } from "./config.js";
import { createDeck, shuffle, type RandomSource } from "./deal.js";
import type { IKState } from "./state.js";
import type { IKPlayerZones, HiddenCard } from "./zones.js";
import { roundScore } from "./scoring.js";
import type { IKAction } from "./actions.js";
import { type ActionSelector } from "../runtime.js";
import { apply, legalActions, isTerminal, currentPlayer, returns } from "./rules/index.js";
import type { GameDef, ActivePlayer, GameType } from "@imposter-zero/types";
import { IMPOSTER_KINGS_GAME_TYPE } from "./game.js";

// ---------------------------------------------------------------------------
// Per-player Army state that persists between rounds
// ---------------------------------------------------------------------------

export interface PlayerArmy {
  readonly available: ReadonlyArray<IKCardKind>;
  readonly exhausted: ReadonlyArray<IKCardKind>;
}

// ---------------------------------------------------------------------------
// Draft state machine
// ---------------------------------------------------------------------------

export type DraftPhase =
  | { readonly tag: "selection" }
  | { readonly tag: "reveal"; readonly selections: ReadonlyArray<ReadonlyArray<CardName>> }
  | { readonly tag: "draft_order"; readonly draftPool: ReadonlyArray<CardName>; readonly faceUp: ReadonlyArray<CardName> }
  | { readonly tag: "drafting"; readonly pickerOrder: ReadonlyArray<PlayerId>; readonly picksRemaining: ReadonlyArray<number>; readonly currentPickerIdx: number; readonly faceUp: ReadonlyArray<CardName> }
  | { readonly tag: "complete"; readonly playerSignatures: ReadonlyArray<ReadonlyArray<CardName>> };

export interface DraftState {
  readonly config: GameConfig;
  readonly numPlayers: number;
  readonly trueKing: PlayerId;
  readonly phase: DraftPhase;
  readonly playerSelections: ReadonlyArray<ReadonlyArray<CardName>>;
}

export const createDraftState = (
  config: GameConfig = REGULATION_2P_EXPANSION,
  numPlayers: number = 2,
  trueKing: PlayerId = 0,
): DraftState => ({
  config,
  numPlayers,
  trueKing,
  phase: { tag: "selection" },
  playerSelections: Array.from({ length: numPlayers }, () => []),
});

export const selectSignature = (
  draft: DraftState,
  player: PlayerId,
  cards: ReadonlyArray<CardName>,
): DraftState => ({
  ...draft,
  playerSelections: draft.playerSelections.map((sel, i) =>
    i === player ? cards : sel,
  ),
});

export const revealSelections = (draft: DraftState): DraftState => {
  const allSelected = draft.playerSelections.flatMap((s) => s);
  const uniqueSelected = [...new Set(allSelected)];
  const remaining = draft.config.signaturePool
    .map((k) => k.name)
    .filter((n) => !uniqueSelected.includes(n));

  return {
    ...draft,
    phase: {
      tag: "reveal",
      selections: draft.playerSelections,
    },
    playerSelections: draft.playerSelections,
  };
};

// ---------------------------------------------------------------------------
// Tournament Mode drafting
// ---------------------------------------------------------------------------

export const startTournamentDraft = (
  draft: DraftState,
  rng: RandomSource = Math.random,
): DraftState => {
  const allSelected = draft.playerSelections.flatMap((s) => s);
  const uniqueSelected = [...new Set(allSelected)];
  const remaining = draft.config.signaturePool
    .map((k) => k.name)
    .filter((n) => !uniqueSelected.includes(n));

  const shuffled = shuffle(remaining, rng);
  const faceUp = shuffled.slice(0, 5);
  const nonTrueKing = ((draft.trueKing + 1) % draft.numPlayers) as PlayerId;

  return {
    ...draft,
    phase: {
      tag: "draft_order",
      draftPool: remaining,
      faceUp: [...faceUp],
    },
  };
};

export const chooseDraftOrder = (
  draft: DraftState,
  goFirst: boolean,
): DraftState => {
  if (draft.phase.tag !== "draft_order") return draft;
  const nonTrueKing = ((draft.trueKing + 1) % draft.numPlayers) as PlayerId;
  const firstPicker = goFirst ? nonTrueKing : draft.trueKing;
  const secondPicker = goFirst ? draft.trueKing : nonTrueKing;

  return {
    ...draft,
    phase: {
      tag: "drafting",
      pickerOrder: [firstPicker, secondPicker, firstPicker],
      picksRemaining: [1, 2, 1],
      currentPickerIdx: 0,
      faceUp: draft.phase.faceUp,
    },
  };
};

export const draftPick = (
  draft: DraftState,
  card: CardName,
): DraftState => {
  if (draft.phase.tag !== "drafting") return draft;
  const { pickerOrder, picksRemaining, currentPickerIdx, faceUp } = draft.phase;
  const picker = pickerOrder[currentPickerIdx]!;

  const nextSelections = draft.playerSelections.map((sel, i) =>
    i === picker ? [...sel, card] : sel,
  );
  const nextFaceUp = faceUp.filter((n) => n !== card);
  const nextPicksRemaining = picksRemaining.map((r, i) =>
    i === currentPickerIdx ? r - 1 : r,
  );

  const currentDone = nextPicksRemaining[currentPickerIdx]! <= 0;
  let nextPickerIdx = currentPickerIdx;
  if (currentDone) {
    nextPickerIdx = currentPickerIdx + 1;
  }

  if (nextPickerIdx >= pickerOrder.length) {
    return {
      ...draft,
      playerSelections: nextSelections,
      phase: {
        tag: "complete",
        playerSignatures: nextSelections,
      },
    };
  }

  return {
    ...draft,
    playerSelections: nextSelections,
    phase: {
      ...draft.phase,
      picksRemaining: nextPicksRemaining,
      currentPickerIdx: nextPickerIdx,
      faceUp: nextFaceUp,
    },
  };
};

// ---------------------------------------------------------------------------
// Standard selection (non-tournament)
// ---------------------------------------------------------------------------

export const completeStandardSelection = (draft: DraftState): DraftState => ({
  ...draft,
  phase: {
    tag: "complete",
    playerSignatures: draft.playerSelections,
  },
});

// ---------------------------------------------------------------------------
// Build player armies from selection results
// ---------------------------------------------------------------------------

export const buildPlayerArmies = (
  config: GameConfig,
  playerSignatures: ReadonlyArray<ReadonlyArray<CardName>>,
): ReadonlyArray<PlayerArmy> =>
  playerSignatures.map((sigs) => {
    const sigKinds = sigs
      .map((name) => config.signaturePool.find((k) => k.name === name))
      .filter((k): k is IKCardKind => k !== undefined);
    return {
      available: [...config.baseArmy, ...sigKinds],
      exhausted: [],
    };
  });

// ---------------------------------------------------------------------------
// Create expansion round with Army zones
// ---------------------------------------------------------------------------

const hidden = (card: IKCard): HiddenCard => ({ card, face: "down" });

export const createExpansionRound = (
  config: GameConfig,
  playerArmies: ReadonlyArray<PlayerArmy>,
  trueKing: PlayerId,
  rng: RandomSource = Math.random,
): IKState => {
  const deck = shuffle(createDeck(config.deck), rng);
  const numPlayers = playerArmies.length;
  const reserved = numPlayers === 2 ? 2 : 1;

  const accused = deck[deck.length - reserved]!;
  const forgottenCard = reserved === 2 ? deck[deck.length - 1]! : null;
  const playableDeck = deck.slice(0, deck.length - reserved);

  const hands = Array.from({ length: numPlayers }, () => [] as IKCard[]);
  playableDeck.forEach((card, index) => {
    hands[index % numPlayers]!.push(card);
  });

  let nextId = deck.length;
  const createArmyCards = (
    kinds: ReadonlyArray<IKCardKind>,
    owner: PlayerId,
  ): IKCard[] =>
    kinds.map((kind) => ({ id: nextId++, kind, armyOwner: owner }));

  const kingIdBase = nextId;
  nextId += numPlayers;

  const players: ReadonlyArray<IKPlayerZones> = hands.map((hand, player) => {
    const army = playerArmies[player]!;
    return {
      hand,
      king: {
        card: { id: kingIdBase + player, kind: KING_CARD_KIND },
        face: "up" as const,
        facet: "default" as const,
      },
      successor: null,
      dungeon: null,
      squire: null,
      antechamber: [],
      parting: [],
      army: createArmyCards(army.available, player as PlayerId),
      exhausted: createArmyCards(army.exhausted, player as PlayerId),
      recruitDiscard: [],
    };
  });

  return {
    players,
    shared: {
      court: [],
      accused,
      forgotten: forgottenCard === null ? null : hidden(forgottenCard),
      condemned: [],
    },
    activePlayer: trueKing,
    phase: "crown",
    numPlayers,
    turnCount: 0,
    firstPlayer: trueKing,
    pendingResolution: null,
    forcedLoser: null,
    modifiers: [],
    roundModifiers: [],
    crystallizedModifiers: [],
    publiclyTrackedKH: [],
    armyRecruitedIds: [],
    charismaticRallyIds: [],
    revealedSuccessors: [],
    hasExhaustedThisMustering: false,
    musteringPlayersDone: 0,
    eliminatedPlayers: [],
  };
};

// ---------------------------------------------------------------------------
// End-of-round Army exhaustion: recruited/rallied cards return to exhausted
// ---------------------------------------------------------------------------

const collectArmyOwnerKinds = (
  state: IKState,
  owner: PlayerId,
): { readonly available: IKCardKind[]; readonly exhausted: IKCardKind[] } => {
  const available: IKCardKind[] = [];
  const exhausted: IKCardKind[] = [];
  const record = (card: IKCard, isAvailable: boolean): void => {
    if (card.armyOwner !== owner) return;
    (isAvailable ? available : exhausted).push(card.kind);
  };

  for (const [player, p] of state.players.entries()) {
    const isOwnerArmyZone = (player as PlayerId) === owner;
    for (const card of p.hand) record(card, false);
    record(p.king.card, false);
    if (p.successor) record(p.successor.card, false);
    if (p.dungeon) record(p.dungeon.card, false);
    if (p.squire) record(p.squire.card, false);
    for (const card of p.antechamber) record(card, false);
    for (const card of p.parting) record(card, false);
    for (const card of p.army) record(card, isOwnerArmyZone);
    for (const card of p.exhausted) record(card, false);
    for (const card of p.recruitDiscard) record(card, false);
  }

  for (const entry of state.shared.court) record(entry.card, false);
  if (state.shared.accused) record(state.shared.accused, false);
  if (state.shared.forgotten) record(state.shared.forgotten.card, false);
  for (const entry of state.shared.condemned) record(entry.card, false);

  return { available, exhausted };
};

export const exhaustArmyCardsPostRound = (
  finalState: IKState,
  prevArmies: ReadonlyArray<PlayerArmy>,
): ReadonlyArray<PlayerArmy> =>
  prevArmies.map((army, player) => {
    const next = collectArmyOwnerKinds(finalState, player as PlayerId);
    const expectedCount = army.available.length + army.exhausted.length;
    const actualCount = next.available.length + next.exhausted.length;
    if (actualCount !== expectedCount) {
      return army;
    }
    return next;
  });

// ---------------------------------------------------------------------------
// Expanded match: draft + rounds + army persistence
// ---------------------------------------------------------------------------

export interface ExpandedMatchState {
  readonly config: GameConfig;
  readonly scores: ReadonlyArray<number>;
  readonly roundsPlayed: number;
  readonly targetScore: number;
  readonly numPlayers: number;
  readonly playerArmies: ReadonlyArray<PlayerArmy>;
  readonly trueKing: PlayerId;
}

export const createExpandedMatch = (
  config: GameConfig,
  playerArmies: ReadonlyArray<PlayerArmy>,
  trueKing: PlayerId,
  targetScore: number = 7,
): ExpandedMatchState => ({
  config,
  scores: Array.from({ length: playerArmies.length }, () => 0),
  roundsPlayed: 0,
  targetScore,
  numPlayers: playerArmies.length,
  playerArmies,
  trueKing,
});

export const isExpandedMatchOver = (match: ExpandedMatchState): boolean =>
  match.scores.some((s) => s >= match.targetScore);

export interface ExpandedMatchResult {
  readonly match: ExpandedMatchState;
  readonly roundResults: ReadonlyArray<ReadonlyArray<number>>;
}

export const playExpandedMatch = (
  config: GameConfig,
  playerArmies: ReadonlyArray<PlayerArmy>,
  select: ActionSelector<IKState, IKAction>,
  trueKing: PlayerId = 0,
  targetScore: number = 7,
  maxRounds: number = 200,
  rng: RandomSource = Math.random,
): ExpandedMatchResult => {
  let match = createExpandedMatch(config, playerArmies, trueKing, targetScore);
  const roundResults: Array<ReadonlyArray<number>> = [];

  const game: GameDef<IKState, IKAction> = {
    gameType: IMPOSTER_KINGS_GAME_TYPE,
    create: () => createExpansionRound(config, match.playerArmies, match.trueKing, rng),
    currentPlayer: (s: IKState): ActivePlayer => currentPlayer(s),
    legalActions: (s: IKState): ReadonlyArray<IKAction> => legalActions(s),
    apply: (s: IKState, a: IKAction): IKState => apply(s, a),
    isTerminal: (s: IKState): boolean => isTerminal(s),
    returns: (s: IKState): ReadonlyArray<number> => returns(s),
  };

  while (!isExpandedMatchOver(match) && match.roundsPlayed < maxRounds) {
    const state = game.create(match.numPlayers);

    let s = state;
    while (!game.isTerminal(s)) {
      const player = game.currentPlayer(s);
      const legal = game.legalActions(s);
      const action = select(s, legal, player);
      s = game.apply(s, action);
    }

    const scores = roundScore(s);
    roundResults.push(scores);

    const updatedArmies = exhaustArmyCardsPostRound(s, match.playerArmies);
    const loser = s.forcedLoser ?? s.activePlayer;

    match = {
      ...match,
      scores: match.scores.map((sc, i) => sc + scores[i]!),
      roundsPlayed: match.roundsPlayed + 1,
      playerArmies: updatedArmies,
      trueKing: loser,
    };
  }

  return { match, roundResults };
};
