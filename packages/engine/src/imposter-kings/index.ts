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
  regulationDeck,
} from "./card.js";

export {
  type IKCrownAction,
  type IKSetupAction,
  type IKPlayCardAction,
  type IKDisgraceAction,
  type IKEffectChoiceAction,
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
} from "./deal.js";

export {
  legalActions,
  apply,
  applySafe,
  isTerminal,
  currentPlayer,
  returns,
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
  ImposterKingsGame,
  ImposterKingsObserver,
} from "./game.js";

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
  resolve,
  replay,
  evaluate,
  effectiveValue,
  effectiveKeywords,
  refreshModifiers,
} from "./effects/index.js";
