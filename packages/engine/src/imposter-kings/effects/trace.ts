import type { PlayerId } from "@imposter-zero/types";

import type { IKState } from "../state.js";
import type {
  EffectProgram,
  EffectContext,
  CardRef,
  PlayerRef,
  ZoneRef,
  CardFilter,
  CardQuery,
  ModifierSpec,
  ChoiceOption,
} from "./program.js";
import type { StatePredicate } from "./predicates.js";

// ---------------------------------------------------------------------------
// Trace types
// ---------------------------------------------------------------------------

export interface TraceEntry {
  readonly depth: number;
  readonly tag: EffectProgram["tag"] | "choice";
  readonly description: string;
}

export type TraceSink = (entry: TraceEntry) => void;

// ---------------------------------------------------------------------------
// Context-resolution helpers
// ---------------------------------------------------------------------------

export const findCardName = (state: IKState, cardId: number): string => {
  for (const e of state.shared.court) {
    if (e.card.id === cardId) return e.copiedName ?? e.card.kind.name;
  }
  for (const p of state.players) {
    for (const c of p.hand) {
      if (c.id === cardId) return c.kind.name;
    }
    if (p.king.card.id === cardId) return "King";
    if (p.successor?.card.id === cardId) return p.successor.card.kind.name;
    if (p.dungeon?.card.id === cardId) return p.dungeon.card.kind.name;
    for (const c of p.antechamber) {
      if (c.id === cardId) return c.kind.name;
    }
    for (const c of p.parting) {
      if (c.id === cardId) return c.kind.name;
    }
    for (const c of p.army) {
      if (c.id === cardId) return c.kind.name;
    }
    for (const c of p.exhausted) {
      if (c.id === cardId) return c.kind.name;
    }
    for (const c of p.recruitDiscard) {
      if (c.id === cardId) return c.kind.name;
    }
  }
  if (state.shared.accused?.id === cardId) return state.shared.accused.kind.name;
  if (state.shared.forgotten?.card.id === cardId)
    return state.shared.forgotten.card.kind.name;
  for (const e of state.shared.condemned) {
    if (e.card.id === cardId) return e.card.kind.name;
  }
  return `card #${cardId}`;
};

export const describeCardRef = (
  ref: CardRef,
  ctx: EffectContext,
  state: IKState,
): string => {
  switch (ref.kind) {
    case "played":
      return ctx.playedCard.kind.name;
    case "belowPlayed": {
      const court = state.shared.court;
      const idx = court.findIndex((e) => e.card.id === ctx.playedCard.id);
      if (idx > 0) return court[idx - 1]!.card.kind.name;
      return "card below (none)";
    }
    case "id":
      return findCardName(state, ref.cardId);
  }
};

export const describePlayerRef = (
  ref: PlayerRef,
  ctx: EffectContext,
): string =>
  ref.kind === "active" ? `Player ${ctx.activePlayer}` : `Player ${ref.player}`;

export const describeZoneRef = (ref: ZoneRef, ctx: EffectContext): string => {
  if (ref.kind === "sharedZone") {
    switch (ref.slot) {
      case "court":
        return "the court";
      case "accused":
        return "the accused pile";
      case "forgotten":
        return "the forgotten pile";
      case "condemned":
        return "the condemned pile";
    }
  }
  const player = describePlayerRef(ref.player, ctx);
  return `${player}'s ${ref.slot}`;
};

const describeFilter = (filter: CardFilter | null): string => {
  if (!filter) return "any card";
  switch (filter.tag) {
    case "notDisgraced":
      return "a non-disgraced card";
    case "notRoyalty":
      return "a non-royalty card";
    case "notDisgracedOrRoyalty":
      return "a non-disgraced, non-royalty card";
    case "hasKeyword":
      return `a card with keyword "${filter.keyword}"`;
    case "minValue":
      return `a card with value \u2265 ${filter.value}`;
    case "hasBaseValue":
      return `a card with base value ${filter.value}`;
    case "hasName":
      return `a card named "${filter.name}"`;
  }
};

const describeQuery = (query: CardQuery): string => {
  switch (query.tag) {
    case "self":
      return "self";
    case "byName":
      return `"${query.name}"`;
    case "byKeyword":
      return `cards with "${query.keyword}"`;
    case "byBaseValue":
      return `cards with base value ${query.value}`;
    case "allInCourt":
      return "all cards in court";
    case "byMinBaseValue":
      return `cards with base value \u2265 ${query.minValue}`;
    case "allInCourtExceptSelf":
      return "all other cards in court";
    case "byId":
      return `card #${query.cardId}`;
    case "ownedBySourceOwner":
      return "cards owned by source's player";
    case "and":
      return `(${describeQuery(query.left)} AND ${describeQuery(query.right)})`;
    case "or":
      return `(${describeQuery(query.left)} OR ${describeQuery(query.right)})`;
  }
};

const describeModifier = (spec: ModifierSpec): string => {
  switch (spec.tag) {
    case "valueChange":
      return `${spec.delta > 0 ? "+" : ""}${spec.delta} value to ${describeQuery(spec.target)}`;
    case "conditionalValueChange":
      return `conditional ${spec.delta > 0 ? "+" : ""}${spec.delta} value to ${describeQuery(spec.target)}`;
    case "grantKeyword":
      return `grant "${spec.keyword}" to ${describeQuery(spec.target)}`;
    case "revokeKeyword":
      return `revoke "${spec.keyword}" from ${describeQuery(spec.target)}`;
    case "mute":
      return `mute ${describeQuery(spec.target)}`;
    case "selfCourtValue":
      return `set court value to ${spec.value}`;
    case "valueChangePerCount":
      return `${spec.deltaPerMatch > 0 ? "+" : ""}${spec.deltaPerMatch} per matching ${describeQuery(spec.countQuery)} to ${describeQuery(spec.target)}`;
    case "conditionalRevokeKeyword":
      return `conditionally revoke "${spec.keyword}" from ${describeQuery(spec.target)}`;
  }
};

export const describePredicate = (
  pred: StatePredicate,
  ctx: EffectContext,
): string => {
  switch (pred.tag) {
    case "always":
      return "always";
    case "never":
      return "never";
    case "and":
      return `(${describePredicate(pred.left, ctx)} AND ${describePredicate(pred.right, ctx)})`;
    case "or":
      return `(${describePredicate(pred.left, ctx)} OR ${describePredicate(pred.right, ctx)})`;
    case "not":
      return `NOT (${describePredicate(pred.inner, ctx)})`;
    case "kingIsFlipped":
      return `${describePlayerRef(pred.player, ctx)}'s King is flipped`;
    case "courtHasDisgraced":
      return "court has disgraced cards";
    case "courtHasFaceUpAtLeast":
      return `court has at least ${pred.count} face-up cards`;
    case "courtHasRoyalty":
      return "court has Royalty";
    case "throneIsRoyalty":
      return "throne card is Royalty";
    case "throneIsNotRoyalty":
      return "throne card is not Royalty";
    case "playedOnHigherValue":
      return "played on a higher-value card";
    case "cardIsOnThrone":
      return "card is on the throne";
    case "playerArmyHasCards":
      return `${describePlayerRef(pred.player, ctx)}'s army has cards`;
    case "playerHasExhausted":
      return `${describePlayerRef(pred.player, ctx)} has exhausted cards`;
    case "playedOnRoyalty":
      return "played on a Royalty card";
  }
};

export const describeChoice = (
  option: ChoiceOption,
  state: IKState,
  player: PlayerId,
): string => {
  const who = `Player ${player}`;
  switch (option.kind) {
    case "card":
      return `${who} chose ${findCardName(state, option.cardId)}.`;
    case "player":
      return `${who} chose Player ${option.player}.`;
    case "cardName":
      return `${who} named "${option.name}".`;
    case "value":
      return `${who} named value ${option.value}.`;
    case "pass":
      return `${who} passed.`;
    case "proceed":
      return `${who} proceeded.`;
    case "yesNo":
      return `${who} chose ${option.value ? "Yes" : "No"}.`;
  }
};

// ---------------------------------------------------------------------------
// The type class — one description function per EffectProgram tag
// ---------------------------------------------------------------------------

export type DescribeStep = {
  readonly [K in EffectProgram["tag"]]: (
    node: Extract<EffectProgram, { tag: K }>,
    ctx: EffectContext,
    state: IKState,
  ) => string;
};

export const describeStep: DescribeStep = {
  done: () => "Resolution complete.",

  preventEffect: () => "Effect prevented.",

  sequence: (node) => `Begin sequence (${node.steps.length} steps).`,

  disgraceAllInCourt: (node, ctx, state) =>
    node.except
      ? `Disgrace all cards in court except ${describeCardRef(node.except, ctx, state)}.`
      : "Disgrace all cards in court.",

  disgraceInCourt: (node, ctx, state) =>
    `Disgrace ${describeCardRef(node.target, ctx, state)} in court.`,

  moveCard: (node, ctx, state) =>
    `Move ${describeCardRef(node.card, ctx, state)} from ${describeZoneRef(node.from, ctx)} to ${describeZoneRef(node.to, ctx)}.`,

  setKingFace: (node, ctx) =>
    `Set ${describePlayerRef(node.player, ctx)}'s King face-${node.face}.`,

  ifCond: (node, ctx) =>
    `Check condition: ${describePredicate(node.predicate, ctx)}.`,

  checkZone: (node, ctx) =>
    `Check ${describeZoneRef(node.zone, ctx)} for ${describeFilter(node.filter)}.`,

  anyOpponentHas: (node) =>
    `Check if any opponent has ${describeFilter(node.filter)} in their ${node.slot}.`,

  addRoundModifier: (node, ctx, state) =>
    `Add round modifier: ${describeModifier(node.spec)} (source: ${describeCardRef(node.source, ctx, state)}).`,

  forcePlay: (node, ctx, state) =>
    `Force play ${describeCardRef(node.card, ctx, state)} from ${describeZoneRef(node.from, ctx)} to court.`,

  condemn: (node, ctx, state) =>
    `Condemn ${describeCardRef(node.card, ctx, state)} from ${describeZoneRef(node.from, ctx)}.`,

  withFirstCardIn: (node, ctx) =>
    `Take the first card in ${describeZoneRef(node.zone, ctx)}.`,

  chooseCard: (node, ctx) =>
    `${describePlayerRef(node.player, ctx)} chooses ${describeFilter(node.filter)} from ${describeZoneRef(node.zone, ctx)}.`,

  choosePlayer: (_node, ctx) =>
    `Player ${ctx.activePlayer} chooses an opponent.`,

  nameCard: (_node, ctx) => `Player ${ctx.activePlayer} names a card.`,

  nameValue: (node, ctx) =>
    `Player ${ctx.activePlayer} names a value (${node.min}\u2013${node.max}).`,

  nameValueUpToCourtMax: (node, ctx) =>
    `Player ${ctx.activePlayer} names a value (${node.min} up to court max).`,

  forEachOpponent: (_node, ctx) =>
    `For each opponent of Player ${ctx.activePlayer}:`,

  forEachPlayer: (_node, ctx) =>
    `For each player:`,

  optional: (_node, ctx) => `Player ${ctx.activePlayer} may use or pass.`,

  triggerReaction: (node) => `Check for ${node.trigger} reactions.`,

  forceLoser: (node, ctx) =>
    `Force ${describePlayerRef(node.player, ctx)} to lose.`,

  khReactionWindow: (_node, ctx) =>
    `King's Hand reaction window for ${ctx.playedCard.kind.name}.`,

  rally: (_node, ctx) =>
    `Player ${ctx.activePlayer} rallies a card from their army.`,

  recall: (_node, ctx) =>
    `Player ${ctx.activePlayer} recalls an exhausted card to their army.`,

  binaryChoice: (node, ctx) =>
    `${describePlayerRef(node.player, ctx)} makes a yes/no choice.`,

  revealZone: (node, ctx) =>
    `Reveal ${describeZoneRef(node.zone, ctx)}.`,

  checkDungeon: (node, ctx) =>
    `Check ${describePlayerRef(node.player, ctx)}'s dungeon.`,

  removeFromRound: (node, ctx, state) =>
    `Remove ${describeCardRef(node.card, ctx, state)} from the round.`,

  returnOneRallied: (_node, ctx) =>
    `Player ${ctx.activePlayer} reveals rallied cards and returns one to army.`,

  copyCardEffects: (node, ctx) =>
    `Player ${ctx.activePlayer} copies a card's effects from ${describeZoneRef(node.zone, ctx)}.`,

  assassinate3p: (node, ctx) =>
    `Player ${describePlayerRef(node.assassin, ctx)} assassinates Player ${describePlayerRef(node.victim, ctx)}.`,
};

// ---------------------------------------------------------------------------
// Dispatch helper — applies the correct describeStep entry for a program node
// ---------------------------------------------------------------------------

export const describeProgram = (
  program: EffectProgram,
  ctx: EffectContext,
  state: IKState,
): string => {
  type Fn = (
    node: EffectProgram,
    ctx: EffectContext,
    state: IKState,
  ) => string;
  return (describeStep[program.tag] as Fn)(program, ctx, state);
};
