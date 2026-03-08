import type { PlayerId } from "@imposter-zero/types";

import { ikCardOps, type IKCard } from "../card.js";
import { effectiveValue } from "../effects/modifiers.js";
import type { IKAction } from "../actions.js";
import { playerZones, throne, type IKState } from "../state.js";
import { throneValue, isKingFaceUp } from "../selectors.js";
import { commitActionsForHand } from "./setup.js";
import { legalMusteringActions } from "./mustering.js";
import type { PlayCondition } from "../effects/program.js";
import { evaluate } from "../effects/predicates.js";
import type { EffectContext } from "../effects/program.js";

export const canPlayCard = (
  card: IKCard,
  state: IKState,
  threshold: number,
): boolean => {
  if (effectiveValue(state, card) >= threshold) return true;

  const overrides = card.kind.props.effects.filter(
    (e): e is { readonly tag: "playOverride"; readonly condition: PlayCondition } =>
      e.tag === "playOverride",
  );

  if (overrides.length === 0) return false;

  const ctx: EffectContext = {
    playedCard: card,
    activePlayer: state.activePlayer,
    numPlayers: state.numPlayers,
    playedFrom: null,
  };

  return overrides.some((o) => {
    switch (o.condition.tag) {
      case "onAnyRoyalty": {
        const top = throne(state);
        return (
          top !== null &&
          top.face === "up" &&
          top.card.kind.props.keywords.includes("royalty")
        );
      }
      case "onAnyNonRoyaltyWhen": {
        const top = throne(state);
        const throneIsNonRoyalty =
          top !== null &&
          (top.face !== "up" || !top.card.kind.props.keywords.includes("royalty"));
        return throneIsNonRoyalty && evaluate(o.condition.predicate, state, ctx);
      }
      case "onHigherValue": {
        const top = throne(state);
        const hand = playerZones(state, state.activePlayer).hand;
        return (
          top !== null &&
          top.face === "up" &&
          top.card.kind.props.value > ikCardOps.value(card) &&
          hand.length >= 2
        );
      }
      case "onAnyCard":
        return throne(state) !== null;
    }
  });
};

export const legalActions = (state: IKState): ReadonlyArray<IKAction> => {
  if (state.phase === "end_of_turn") {
    const active = playerZones(state, state.activePlayer);
    if (active.antechamber.length > 0) {
      return active.antechamber.map((card) => ({
        kind: "play" as const,
        cardId: card.id,
      }));
    }
    return [];
  }

  if (state.phase === "resolving") {
    const pending = state.pendingResolution;
    if (!pending) return [];

    if (pending.isReactionWindow) {
      const chooser = pending.choosingPlayer;
      const hand = playerZones(state, chooser).hand;
      const hasKH = hand.some((c) => c.kind.name === "King's Hand");
      const courtTop = state.shared.court.length > 0
        ? state.shared.court[state.shared.court.length - 1]!
        : null;
      const courtHasKH = state.shared.court.some(
        (e) =>
          e.face === "up" &&
          e.card.kind.name === "King's Hand" &&
          e.card.id !== courtTop?.card.id,
      );
      const strangerCanReact =
        courtHasKH && hand.some((c) => c.kind.name === "Stranger");
      if (!hasKH && !strangerCanReact) {
        return [{ kind: "effect_choice" as const, choice: 0 }];
      }
    }

    return pending.currentOptions.map((_, i) => ({
      kind: "effect_choice" as const,
      choice: i,
    }));
  }

  if (state.phase === "crown") {
    return Array.from(
      { length: state.numPlayers },
      (_, i) => ({ kind: "crown" as const, firstPlayer: i as PlayerId }),
    );
  }

  if (state.phase === "mustering") {
    return legalMusteringActions(state);
  }

  const active = playerZones(state, state.activePlayer);

  if (state.phase === "setup") {
    if (active.successor !== null || active.dungeon !== null) {
      return [];
    }
    return commitActionsForHand(active.hand, active.king.facet);
  }

  if (active.parting.length > 0) {
    return active.parting.map((card) => ({
      kind: "play" as const,
      cardId: card.id,
    }));
  }

  if (active.antechamber.length > 0) {
    return active.antechamber.map((card) => ({
      kind: "play" as const,
      cardId: card.id,
    }));
  }

  const threshold = throneValue(state);
  const playable = active.hand
    .filter((card) => canPlayCard(card, state, threshold))
    .map((card) => ({ kind: "play" as const, cardId: card.id }));

  const canDisgrace = isKingFaceUp(state, state.activePlayer) && throne(state) !== null;
  return canDisgrace ? [...playable, { kind: "disgrace" }] : playable;
};
