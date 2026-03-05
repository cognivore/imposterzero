import type { PlayerId } from "@imposter-zero/types";

import { ikCardOps, type IKCard } from "../card.js";
import { effectiveValue } from "../effects/modifiers.js";
import type { IKAction } from "../actions.js";
import { playerZones, throne, type IKState } from "../state.js";
import { throneValue, isKingFaceUp } from "../selectors.js";
import { commitActionsForHand } from "./setup.js";
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
        return (
          top !== null &&
          top.face === "up" &&
          top.card.kind.props.value > ikCardOps.value(card)
        );
      }
    }
  });
};

export const legalActions = (state: IKState): ReadonlyArray<IKAction> => {
  if (state.phase === "resolving") {
    const pending = state.pendingResolution;
    if (!pending) return [];
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

  const active = playerZones(state, state.activePlayer);

  if (state.phase === "setup") {
    if (active.successor !== null || active.dungeon !== null) {
      return [];
    }
    return commitActionsForHand(active.hand);
  }

  const threshold = throneValue(state);
  const playable = active.hand
    .filter((card) => canPlayCard(card, state, threshold))
    .map((card) => ({ kind: "play" as const, cardId: card.id }));

  const canDisgrace = isKingFaceUp(state, state.activePlayer) && throne(state) !== null;
  return canDisgrace ? [...playable, { kind: "disgrace" }] : playable;
};
