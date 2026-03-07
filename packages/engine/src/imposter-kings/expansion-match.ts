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
  const reserved = numPlayers === 4 ? 1 : 2;

  const accused =
    numPlayers === 4 ? deck[deck.length - 1]! : deck[deck.length - 2]!;
  const forgottenCard = numPlayers === 4 ? null : deck[deck.length - 1]!;
  const playableDeck = deck.slice(0, deck.length - reserved);

  const hands = Array.from({ length: numPlayers }, () => [] as IKCard[]);
  playableDeck.forEach((card, index) => {
    hands[index % numPlayers]!.push(card);
  });

  let nextId = deck.length;
  const createArmyCards = (kinds: ReadonlyArray<IKCardKind>): IKCard[] =>
    kinds.map((kind) => ({ id: nextId++, kind }));

  const kingIdBase = nextId;
  nextId += numPlayers;

  const players: ReadonlyArray<IKPlayerZones> = hands.map((hand, player) => {
    const army = playerArmies[player]!;
    return {
      hand,
      king: {
        card: { id: kingIdBase + player, kind: KING_CARD_KIND },
        face: "up" as const,
      },
      successor: null,
      dungeon: null,
      antechamber: [],
      parting: [],
      army: createArmyCards(army.available),
      exhausted: createArmyCards(army.exhausted),
      recruitDiscard: [],
    };
  });

  return {
    players,
    shared: {
      court: [],
      accused,
      forgotten: forgottenCard === null ? null : hidden(forgottenCard),
      army: [],
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
    publiclyTrackedKH: [],
    armyRecruitedIds: [],
    hasExhaustedThisMustering: false,
    musteringPlayersDone: 0,
  };
};

// ---------------------------------------------------------------------------
// End-of-round Army exhaustion: recruited/rallied cards return to exhausted
// ---------------------------------------------------------------------------

export const exhaustArmyCardsPostRound = (
  finalState: IKState,
  prevArmies: ReadonlyArray<PlayerArmy>,
): ReadonlyArray<PlayerArmy> =>
  prevArmies.map((army, player) => {
    const pz = finalState.players[player]!;
    const allKinds = [...army.available, ...army.exhausted];

    const roundExhaustedNames = new Set(pz.exhausted.map((c) => c.kind.name));
    const recruitedIds = new Set(finalState.armyRecruitedIds);
    for (const c of pz.hand) {
      if (recruitedIds.has(c.id)) roundExhaustedNames.add(c.kind.name);
    }

    for (const k of army.exhausted) {
      roundExhaustedNames.add(k.name);
    }

    const findKind = (name: CardName): IKCardKind | undefined =>
      allKinds.find((k) => k.name === name);

    const available: IKCardKind[] = [];
    const exhausted: IKCardKind[] = [];
    const usedNames = new Set<string>();

    for (const kind of allKinds) {
      const key = `${kind.name}-${usedNames.has(kind.name) ? "dup" : "first"}`;
      if (usedNames.has(kind.name)) continue;
      usedNames.add(kind.name);
      if (roundExhaustedNames.has(kind.name)) {
        exhausted.push(kind);
      } else {
        available.push(kind);
      }
    }

    return { available, exhausted };
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
