import type { PlayerId } from "@imposter-zero/types";

import type { IKState } from "../state.js";
import { playerZones, throne } from "../state.js";
import type { EffectContext, PlayerRef } from "./program.js";

// ---------------------------------------------------------------------------
// State predicates — composable boolean queries over game state
// ---------------------------------------------------------------------------

export type StatePredicate =
  | { readonly tag: "always" }
  | { readonly tag: "never" }
  | { readonly tag: "and"; readonly left: StatePredicate; readonly right: StatePredicate }
  | { readonly tag: "or"; readonly left: StatePredicate; readonly right: StatePredicate }
  | { readonly tag: "not"; readonly inner: StatePredicate }
  | { readonly tag: "kingIsFlipped"; readonly player: PlayerRef }
  | { readonly tag: "courtHasDisgraced" }
  | { readonly tag: "courtHasFaceUpAtLeast"; readonly count: number }
  | { readonly tag: "courtHasRoyalty" }
  | { readonly tag: "throneIsRoyalty" }
  | { readonly tag: "throneIsNotRoyalty" }
  | { readonly tag: "playedOnHigherValue" }
  | { readonly tag: "cardIsOnThrone" }
  | { readonly tag: "playerArmyHasCards"; readonly player: PlayerRef }
  | { readonly tag: "playerHasExhausted"; readonly player: PlayerRef }
  | { readonly tag: "playedOnRoyalty" };

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

const resolvePlayer = (ref: PlayerRef, ctx: EffectContext): PlayerId =>
  ref.kind === "active" ? ctx.activePlayer : ref.player;

export const evaluate = (
  pred: StatePredicate,
  state: IKState,
  ctx: EffectContext,
): boolean => {
  switch (pred.tag) {
    case "always":
      return true;
    case "never":
      return false;
    case "and":
      return evaluate(pred.left, state, ctx) && evaluate(pred.right, state, ctx);
    case "or":
      return evaluate(pred.left, state, ctx) || evaluate(pred.right, state, ctx);
    case "not":
      return !evaluate(pred.inner, state, ctx);
    case "kingIsFlipped":
      return playerZones(state, resolvePlayer(pred.player, ctx)).king.face === "down";
    case "courtHasDisgraced":
      return state.shared.court.some((e) => e.face === "down");
    case "courtHasFaceUpAtLeast":
      return state.shared.court.filter((e) => e.face === "up").length >= pred.count;
    case "courtHasRoyalty":
      return state.shared.court.some((e) =>
        e.face === "up" && e.card.kind.props.keywords.includes("royalty"),
      );
    case "throneIsRoyalty": {
      const top = throne(state);
      return top !== null && top.face === "up" && top.card.kind.props.keywords.includes("royalty");
    }
    case "throneIsNotRoyalty": {
      const top = throne(state);
      return top !== null && (top.face !== "up" || !top.card.kind.props.keywords.includes("royalty"));
    }
    case "playedOnHigherValue": {
      const court = state.shared.court;
      const idx = court.findIndex((e) => e.card.id === ctx.playedCard.id);
      if (idx <= 0) return false;
      const below = court[idx - 1]!;
      return below.face === "up" && below.card.kind.props.value > ctx.playedCard.kind.props.value;
    }
    case "cardIsOnThrone": {
      const top = throne(state);
      return top !== null && top.card.id === ctx.playedCard.id;
    }
    case "playerArmyHasCards":
      return playerZones(state, resolvePlayer(pred.player, ctx)).army.length > 0;
    case "playerHasExhausted":
      return playerZones(state, resolvePlayer(pred.player, ctx)).exhausted.length > 0;
    case "playedOnRoyalty": {
      const court = state.shared.court;
      const idx = court.findIndex((e) => e.card.id === ctx.playedCard.id);
      if (idx <= 0) return false;
      const below = court[idx - 1]!;
      return below.face === "up" && below.card.kind.props.keywords.includes("royalty");
    }
  }
};

// ---------------------------------------------------------------------------
// Builder functions
// ---------------------------------------------------------------------------

export const always: StatePredicate = { tag: "always" };
export const never: StatePredicate = { tag: "never" };

export const and = (
  left: StatePredicate,
  right: StatePredicate,
): StatePredicate => ({ tag: "and", left, right });

export const or = (
  left: StatePredicate,
  right: StatePredicate,
): StatePredicate => ({ tag: "or", left, right });

export const not = (inner: StatePredicate): StatePredicate => ({
  tag: "not",
  inner,
});

export const kingIsFlipped = (player: PlayerRef): StatePredicate => ({
  tag: "kingIsFlipped",
  player,
});

export const courtHasDisgraced: StatePredicate = { tag: "courtHasDisgraced" };

export const courtHasFaceUpAtLeast = (count: number): StatePredicate => ({
  tag: "courtHasFaceUpAtLeast",
  count,
});

export const courtHasRoyalty: StatePredicate = { tag: "courtHasRoyalty" };
export const throneIsRoyalty: StatePredicate = { tag: "throneIsRoyalty" };
export const throneIsNotRoyalty: StatePredicate = { tag: "throneIsNotRoyalty" };
export const playedOnHigherValue: StatePredicate = { tag: "playedOnHigherValue" };
export const cardIsOnThrone: StatePredicate = { tag: "cardIsOnThrone" };
export const playerArmyHasCards = (player: PlayerRef): StatePredicate => ({
  tag: "playerArmyHasCards",
  player,
});
export const playerHasExhausted = (player: PlayerRef): StatePredicate => ({
  tag: "playerHasExhausted",
  player,
});
export const playedOnRoyalty: StatePredicate = { tag: "playedOnRoyalty" };
