export {
  type CardOps,
  type CardKeyword,
  type CardName,
  type IKCardProps,
  type IKCardKind,
  type IKCard,
  ikCardOps,
  KING_CARD_KIND,
  BASE_DECK,
  THREE_PLAYER_EXTRAS,
  FOUR_PLAYER_EXTRAS,
  SIGNATURE_CARD_KINDS,
  BASE_ARMY_KINDS,
  regulationDeck,
} from "./card.js";

export {
  type IKCrownAction,
  type IKSetupAction,
  type IKPlayCardAction,
  type IKDisgraceAction,
  type IKEffectChoiceAction,
  type IKBeginRecruitAction,
  type IKRecruitAction,
  type IKRecommissionAction,
  type IKEndMusteringAction,
  type IKMusteringAction,
  isMusteringAction,
  type IKPlayAction,
  type IKAction,
  type ActionCodecConfig,
  type EncodeError,
  type DecodeError,
  encodeAction,
  decodeAction,
  encodeActionSafe,
  decodeActionSafe,
} from "./actions.js";

export {
  type FaceState,
  type HiddenCard,
  type CourtEntry,
  type CondemnedEntry,
  type KingZone,
  type IKPlayerZones,
  type IKSharedZones,
} from "./zones.js";

export {
  type IKPhase,
  type IKState,
  type PendingResolution,
  type PendingEffectSource,
  type ActiveModifier,
  throne,
  playerZones,
  playerHand,
  nextPlayer,
  revealedState,
} from "./state.js";

export {
  throneValue,
  isKingFaceUp,
  hasCommittedSetup,
  allPlayersCommittedSetup,
} from "./selectors.js";

export {
  type RandomSource,
  createDeck,
  shuffle,
  deal,
  dealWithDeck,
} from "./deal.js";

export {
  legalActions,
  apply,
  applySafe,
  isTerminal,
  currentPlayer,
  returns,
  traceResolution,
} from "./rules.js";

export {
  type TransitionError,
  transitionErrorMessage,
} from "./errors.js";

export { validateState } from "./invariants.js";

export { roundScore } from "./scoring.js";

export {
  type MatchState,
  type MatchResult,
  createMatch,
  applyRoundResult,
  matchWinners,
  isMatchOver,
  playMatch,
} from "./match.js";

export {
  IMPOSTER_KINGS_GAME_TYPE,
  createImposterKingsGame,
  createExpansionGame,
  ImposterKingsGame,
  ImposterKingsObserver,
} from "./game.js";

export {
  type GameConfig,
  SIGNATURE_CARD_NAMES,
  BASE_ARMY_NAMES,
  REGULATION_2P_BASE,
  REGULATION_2P_EXPANSION,
} from "./config.js";

export {
  type PlayerArmy,
  type DraftPhase,
  type DraftState,
  type ExpandedMatchState,
  type ExpandedMatchResult,
  createDraftState,
  selectSignature,
  revealSelections,
  startTournamentDraft,
  chooseDraftOrder,
  draftPick,
  completeStandardSelection,
  buildPlayerArmies,
  createExpansionRound,
  exhaustArmyCardsPostRound,
  createExpandedMatch,
  isExpandedMatchOver,
  playExpandedMatch,
} from "./expansion-match.js";

export {
  type IKPlayerZoneSlot,
  type IKSharedZoneSlot,
  type IKZoneAddress,
  type ZoneError,
  type ZoneRemoval,
  type InsertOptions,
  readZone,
  zoneContains,
  removeFromZone,
  insertIntoZone,
  moveCard,
  disgraceInCourt,
  setKingFace,
} from "./zone-addr.js";

export {
  type CardRef,
  type PlayerRef,
  type ZoneRef,
  type CardFilter,
  type TriggerKind,
  type CardQuery,
  type ModifierSpec,
  type PlayCondition,
  type EffectProgram,
  type CardEffect,
  type ChoiceOption,
  type Resolution,
  type EffectContext,
  type StatePredicate,
  type TraceEntry,
  type TraceSink,
  type DescribeStep,
  resolve,
  replay,
  evaluate,
  describeStep,
  describeProgram,
  describeChoice,
  describeCardRef,
  describePlayerRef,
  describeZoneRef,
  describePredicate,
  findCardName,
  effectiveValue,
  effectiveKeywords,
  refreshModifiers,
} from "./effects/index.js";
