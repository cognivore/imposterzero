import type { PlayerId } from "@imposter-zero/types";

import type { CardKeyword, CardName, IKCard } from "../card.js";
import type { FaceState } from "../zones.js";
import type { IKPlayerZoneSlot, IKSharedZoneSlot } from "../zone-addr.js";
import type { StatePredicate } from "./predicates.js";

// ---------------------------------------------------------------------------
// Symbolic references — resolved at interpretation time
// ---------------------------------------------------------------------------

export type CardRef =
  | { readonly kind: "played" }
  | { readonly kind: "belowPlayed" }
  | { readonly kind: "id"; readonly cardId: number };

export type PlayerRef =
  | { readonly kind: "active" }
  | { readonly kind: "id"; readonly player: PlayerId };

export type ZoneRef =
  | {
      readonly kind: "playerZone";
      readonly player: PlayerRef;
      readonly slot: IKPlayerZoneSlot;
    }
  | { readonly kind: "sharedZone"; readonly slot: IKSharedZoneSlot };

// ---------------------------------------------------------------------------
// Card and zone filters
// ---------------------------------------------------------------------------

export type CardFilter =
  | { readonly tag: "notDisgraced" }
  | { readonly tag: "notRoyalty" }
  | { readonly tag: "notDisgracedOrRoyalty" }
  | { readonly tag: "hasKeyword"; readonly keyword: CardKeyword }
  | { readonly tag: "minValue"; readonly value: number }
  | { readonly tag: "hasBaseValue"; readonly value: number }
  | { readonly tag: "hasName"; readonly name: CardName };

// ---------------------------------------------------------------------------
// Trigger and modifier types (Phase 4/5 forward declarations)
// ---------------------------------------------------------------------------

export type TriggerKind = "king_flip" | "ability_activation" | "disgrace";

export type CardQuery =
  | { readonly tag: "self" }
  | { readonly tag: "byName"; readonly name: CardName }
  | { readonly tag: "byKeyword"; readonly keyword: CardKeyword }
  | { readonly tag: "byBaseValue"; readonly value: number }
  | { readonly tag: "byMinBaseValue"; readonly minValue: number }
  | { readonly tag: "allInCourt" }
  | { readonly tag: "allInCourtExceptSelf" }
  | { readonly tag: "byId"; readonly cardId: number }
  | { readonly tag: "ownedBySourceOwner" }
  | { readonly tag: "and"; readonly left: CardQuery; readonly right: CardQuery }
  | { readonly tag: "or"; readonly left: CardQuery; readonly right: CardQuery };

export type ModifierSpec =
  | { readonly tag: "valueChange"; readonly delta: number; readonly target: CardQuery }
  | { readonly tag: "conditionalValueChange"; readonly delta: number; readonly target: CardQuery; readonly condition: StatePredicate }
  | { readonly tag: "grantKeyword"; readonly keyword: CardKeyword; readonly target: CardQuery }
  | { readonly tag: "revokeKeyword"; readonly keyword: CardKeyword; readonly target: CardQuery }
  | { readonly tag: "mute"; readonly target: CardQuery }
  | { readonly tag: "selfCourtValue"; readonly value: number }
  | { readonly tag: "valueChangePerCount"; readonly deltaPerMatch: number; readonly target: CardQuery; readonly countQuery: CardQuery }
  | { readonly tag: "conditionalRevokeKeyword"; readonly keyword: CardKeyword; readonly target: CardQuery; readonly condition: StatePredicate };

// ---------------------------------------------------------------------------
// Play condition overrides (Elder, Zealot, Oathbound)
// ---------------------------------------------------------------------------

export type PlayCondition =
  | { readonly tag: "onAnyRoyalty" }
  | { readonly tag: "onAnyNonRoyaltyWhen"; readonly predicate: StatePredicate }
  | { readonly tag: "onHigherValue" }
  | { readonly tag: "onAnyCard" };

// ---------------------------------------------------------------------------
// Effect program ADT — continuation-passing style
// ---------------------------------------------------------------------------

export type EffectProgram =
  // Terminal
  | { readonly tag: "done" }
  // Sequencing — processes steps left-to-right, threading state
  | { readonly tag: "sequence"; readonly steps: ReadonlyArray<EffectProgram> }
  // Non-interactive state mutations
  | { readonly tag: "disgraceAllInCourt"; readonly except: CardRef | null; readonly then: EffectProgram }
  | { readonly tag: "disgraceInCourt"; readonly target: CardRef; readonly then: EffectProgram }
  | { readonly tag: "moveCard"; readonly card: CardRef; readonly from: ZoneRef; readonly to: ZoneRef; readonly then: EffectProgram }
  | { readonly tag: "setKingFace"; readonly player: PlayerRef; readonly face: FaceState; readonly then: EffectProgram }
  | { readonly tag: "ifCond"; readonly predicate: StatePredicate; readonly then_: EffectProgram; readonly else_: EffectProgram }
  | { readonly tag: "checkZone"; readonly zone: ZoneRef; readonly filter: CardFilter | null; readonly then_: EffectProgram; readonly else_: EffectProgram }
  | { readonly tag: "anyOpponentHas"; readonly slot: IKPlayerZoneSlot; readonly filter: CardFilter; readonly then_: EffectProgram; readonly else_: EffectProgram }
  | { readonly tag: "addRoundModifier"; readonly source: CardRef; readonly spec: ModifierSpec; readonly sticky: boolean; readonly then: EffectProgram }
  | { readonly tag: "forcePlay"; readonly card: CardRef; readonly from: ZoneRef }
  | { readonly tag: "condemn"; readonly card: CardRef; readonly from: ZoneRef; readonly then: EffectProgram }
  | { readonly tag: "withFirstCardIn"; readonly zone: ZoneRef; readonly andThen: (cardId: number) => EffectProgram }
  // Interactive — yield NeedChoice
  | { readonly tag: "chooseCard"; readonly player: PlayerRef; readonly zone: ZoneRef; readonly filter: CardFilter | null; readonly andThen: (cardId: number) => EffectProgram }
  | { readonly tag: "choosePlayer"; readonly andThen: (player: PlayerId) => EffectProgram }
  | { readonly tag: "nameCard"; readonly andThen: (name: CardName) => EffectProgram }
  | { readonly tag: "nameValue"; readonly min: number; readonly max: number; readonly andThen: (value: number) => EffectProgram }
  | { readonly tag: "nameValueUpToCourtMax"; readonly min: number; readonly andThen: (value: number) => EffectProgram }
  | { readonly tag: "forEachOpponent"; readonly effect: (opponent: PlayerId) => EffectProgram; readonly then: EffectProgram }
  | { readonly tag: "forEachPlayer"; readonly effect: (player: PlayerId) => EffectProgram; readonly then: EffectProgram }
  | { readonly tag: "optional"; readonly effect: EffectProgram; readonly otherwise: EffectProgram }
  // Reaction checkpoint
  | { readonly tag: "triggerReaction"; readonly trigger: TriggerKind; readonly continuation: EffectProgram; readonly onReacted: EffectProgram }
  | { readonly tag: "forceLoser"; readonly player: PlayerRef }
  // Ability prevention (reaction body for King's Hand)
  | { readonly tag: "preventEffect" }
  // King's Hand reaction window — prompts all opponents in play order
  | { readonly tag: "khReactionWindow"; readonly continuation: EffectProgram }
  // Army interaction — Rally (army → hand with tracking) and Recall (exhausted → army)
  | { readonly tag: "rally"; readonly then: EffectProgram }
  | { readonly tag: "recall"; readonly then: EffectProgram }
  // Binary choice — yields yes/no to a specified player
  | { readonly tag: "binaryChoice"; readonly player: PlayerRef; readonly andThen: (chose: boolean) => EffectProgram }
  // Reveal zone contents (informational, logged)
  | { readonly tag: "revealZone"; readonly zone: ZoneRef; readonly then: EffectProgram }
  // Check if dungeon contains a named card
  | { readonly tag: "checkDungeon"; readonly player: PlayerRef; readonly andThen: (correct: boolean) => EffectProgram }
  // Remove a card from the round entirely
  | { readonly tag: "removeFromRound"; readonly card: CardRef; readonly then: EffectProgram }
  // Return one of the recently rallied cards back to army (Flagbearer)
  | { readonly tag: "returnOneRallied"; readonly then: EffectProgram }
  // Copy a Court card's onPlay effects and adopt its name (Stranger)
  | { readonly tag: "copyCardEffects"; readonly zone: ZoneRef; readonly filter: CardFilter | null; readonly andThen: (cardId: number) => EffectProgram };

// ---------------------------------------------------------------------------
// Card effect — attached to card definitions
// ---------------------------------------------------------------------------

export type CardEffect =
  | { readonly tag: "onPlay"; readonly effect: EffectProgram; readonly isOptional: boolean }
  | { readonly tag: "reaction"; readonly trigger: TriggerKind; readonly effect: EffectProgram }
  | { readonly tag: "continuous"; readonly modifier: ModifierSpec }
  | { readonly tag: "playOverride"; readonly condition: PlayCondition };

// ---------------------------------------------------------------------------
// Resolution — result of stepping through an effect program
// ---------------------------------------------------------------------------

export type ChoiceOption =
  | { readonly kind: "card"; readonly cardId: number }
  | { readonly kind: "player"; readonly player: PlayerId }
  | { readonly kind: "cardName"; readonly name: CardName }
  | { readonly kind: "value"; readonly value: number }
  | { readonly kind: "pass" }
  | { readonly kind: "proceed" }
  | { readonly kind: "yesNo"; readonly value: boolean };

export type Resolution =
  | { readonly tag: "done"; readonly state: import("../state.js").IKState }
  | {
      readonly tag: "needChoice";
      readonly state: import("../state.js").IKState;
      readonly player: PlayerId;
      readonly options: ReadonlyArray<ChoiceOption>;
      readonly resume: (choice: number) => Resolution;
      readonly isReactionWindow?: boolean;
    };

// ---------------------------------------------------------------------------
// Effect context — provided when resolving an effect
// ---------------------------------------------------------------------------

export interface EffectContext {
  readonly playedCard: IKCard;
  readonly activePlayer: PlayerId;
  readonly numPlayers: number;
  readonly playedFrom: "hand" | "antechamber" | null;
  readonly copiedName?: CardName;
}

// ---------------------------------------------------------------------------
// Builder functions — readable effect construction
// ---------------------------------------------------------------------------

export const done: EffectProgram = { tag: "done" };

export const played: CardRef = { kind: "played" };
export const belowPlayed: CardRef = { kind: "belowPlayed" };
export const active: PlayerRef = { kind: "active" };
export const cardId = (id: number): CardRef => ({ kind: "id", cardId: id });
export const playerId = (p: PlayerId): PlayerRef => ({ kind: "id", player: p });

export const playerZone = (
  player: PlayerRef,
  slot: IKPlayerZoneSlot,
): ZoneRef => ({ kind: "playerZone", player, slot });

export const sharedZone = (slot: IKSharedZoneSlot): ZoneRef => ({
  kind: "sharedZone",
  slot,
});

export const activeHand: ZoneRef = playerZone(active, "hand");
export const court: ZoneRef = sharedZone("court");
export const accused: ZoneRef = sharedZone("accused");

export const disgraceAll = (
  except: CardRef | null,
  then: EffectProgram = done,
): EffectProgram => ({ tag: "disgraceAllInCourt", except, then });

export const disgrace = (
  target: CardRef,
  then: EffectProgram = done,
): EffectProgram => ({ tag: "disgraceInCourt", target, then });

export const move = (
  card: CardRef,
  from: ZoneRef,
  to: ZoneRef,
  then: EffectProgram = done,
): EffectProgram => ({ tag: "moveCard", card, from, to, then });

export const flipKing = (
  player: PlayerRef,
  face: FaceState,
  then: EffectProgram = done,
): EffectProgram => ({ tag: "setKingFace", player, face, then });

export const ifCond = (
  predicate: StatePredicate,
  then_: EffectProgram,
  else_: EffectProgram = done,
): EffectProgram => ({ tag: "ifCond", predicate, then_, else_ });

export const checkZone = (
  zone: ZoneRef,
  filter: CardFilter | null,
  then_: EffectProgram,
  else_: EffectProgram = done,
): EffectProgram => ({ tag: "checkZone", zone, filter, then_, else_ });

export const anyOpponentHas = (
  slot: IKPlayerZoneSlot,
  filter: CardFilter,
  then_: EffectProgram,
  else_: EffectProgram = done,
): EffectProgram => ({ tag: "anyOpponentHas", slot, filter, then_, else_ });

export const addRoundModifier = (
  source: CardRef,
  spec: ModifierSpec,
  then: EffectProgram = done,
  sticky = false,
): EffectProgram => ({ tag: "addRoundModifier", source, spec, sticky, then });

export const forcePlay = (
  card: CardRef,
  from: ZoneRef,
): EffectProgram => ({ tag: "forcePlay", card, from });

export const condemn = (
  card: CardRef,
  from: ZoneRef,
  then: EffectProgram = done,
): EffectProgram => ({ tag: "condemn", card, from, then });

export const withFirstCardIn = (
  zone: ZoneRef,
  andThen: (cardId: number) => EffectProgram,
): EffectProgram => ({ tag: "withFirstCardIn", zone, andThen });

export const chooseCard = (
  player: PlayerRef,
  zone: ZoneRef,
  filter: CardFilter | null,
  andThen: (id: number) => EffectProgram,
): EffectProgram => ({ tag: "chooseCard", player, zone, filter, andThen });

export const choosePlayer = (
  andThen: (p: PlayerId) => EffectProgram,
): EffectProgram => ({ tag: "choosePlayer", andThen });

export const nameCard = (
  andThen: (n: CardName) => EffectProgram,
): EffectProgram => ({ tag: "nameCard", andThen });

export const nameValue = (
  min: number,
  max: number,
  andThen: (v: number) => EffectProgram,
): EffectProgram => ({ tag: "nameValue", min, max, andThen });

export const nameValueUpToCourtMax = (
  min: number,
  andThen: (v: number) => EffectProgram,
): EffectProgram => ({ tag: "nameValueUpToCourtMax", min, andThen });

export const forEachOpponent = (
  effect: (opp: PlayerId) => EffectProgram,
  then: EffectProgram = done,
): EffectProgram => ({ tag: "forEachOpponent", effect, then });

export const forEachPlayer = (
  effect: (player: PlayerId) => EffectProgram,
  then: EffectProgram = done,
): EffectProgram => ({ tag: "forEachPlayer", effect, then });

export const optional = (
  effect: EffectProgram,
  otherwise: EffectProgram = done,
): EffectProgram => ({ tag: "optional", effect, otherwise });

export const onPlay = (
  effect: EffectProgram,
  isOptional = true,
): CardEffect => ({
  tag: "onPlay",
  effect,
  isOptional,
});

export const playOverride = (condition: PlayCondition): CardEffect => ({
  tag: "playOverride",
  condition,
});

export const reaction = (
  trigger: TriggerKind,
  effect: EffectProgram,
): CardEffect => ({ tag: "reaction", trigger, effect });

export const continuous = (modifier: ModifierSpec): CardEffect => ({
  tag: "continuous",
  modifier,
});

export const forceLoser = (player: PlayerRef): EffectProgram => ({
  tag: "forceLoser",
  player,
});

export const triggerReaction = (
  trigger: TriggerKind,
  continuation: EffectProgram,
  onReacted: EffectProgram,
): EffectProgram => ({ tag: "triggerReaction", trigger, continuation, onReacted });

export const seq = (...steps: ReadonlyArray<EffectProgram>): EffectProgram =>
  steps.length === 0
    ? done
    : steps.length === 1
      ? steps[0]!
      : { tag: "sequence", steps };

export const preventEffect: EffectProgram = { tag: "preventEffect" };

export const khWindow = (
  continuation: EffectProgram,
): EffectProgram => ({ tag: "khReactionWindow", continuation });

export const rally = (then: EffectProgram = done): EffectProgram => ({
  tag: "rally",
  then,
});

export const recall = (then: EffectProgram = done): EffectProgram => ({
  tag: "recall",
  then,
});

export const binaryChoice = (
  player: PlayerRef,
  andThen: (chose: boolean) => EffectProgram,
): EffectProgram => ({ tag: "binaryChoice", player, andThen });

export const revealZone = (
  zone: ZoneRef,
  then: EffectProgram = done,
): EffectProgram => ({ tag: "revealZone", zone, then });

export const checkDungeon = (
  player: PlayerRef,
  andThen: (correct: boolean) => EffectProgram,
): EffectProgram => ({ tag: "checkDungeon", player, andThen });

export const removeFromRound = (
  card: CardRef,
  then: EffectProgram = done,
): EffectProgram => ({ tag: "removeFromRound", card, then });

export const returnOneRallied = (then: EffectProgram = done): EffectProgram => ({
  tag: "returnOneRallied",
  then,
});

export const copyCardEffects = (
  player: PlayerRef,
  zone: ZoneRef,
  filter: CardFilter | null,
  andThen: (cardId: number) => EffectProgram,
): EffectProgram => ({ tag: "copyCardEffects", zone, filter, andThen });

export const activeArmy: ZoneRef = playerZone(active, "army");
export const activeExhausted: ZoneRef = playerZone(active, "exhausted");
