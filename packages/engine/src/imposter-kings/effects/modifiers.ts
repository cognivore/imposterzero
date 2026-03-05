import type { IKCard, CardKeyword } from "../card.js";
import type { IKState, ActiveModifier } from "../state.js";
import type { CardQuery, ModifierSpec } from "./program.js";
import { evaluate } from "./predicates.js";

// ---------------------------------------------------------------------------
// Card query matching
// ---------------------------------------------------------------------------

const matchesQuery = (
  query: CardQuery,
  card: IKCard,
  sourceCardId: number,
  state: IKState,
): boolean => {
  switch (query.tag) {
    case "self":
      return card.id === sourceCardId;
    case "byName":
      return card.kind.name === query.name;
    case "byKeyword":
      return card.kind.props.keywords.includes(query.keyword);
    case "allInCourt":
      return state.shared.court.some((e) => e.card.id === card.id);
    case "allInCourtExceptSelf":
      return (
        card.id !== sourceCardId &&
        state.shared.court.some((e) => e.card.id === card.id)
      );
    case "and":
      return (
        matchesQuery(query.left, card, sourceCardId, state) &&
        matchesQuery(query.right, card, sourceCardId, state)
      );
    case "or":
      return (
        matchesQuery(query.left, card, sourceCardId, state) ||
        matchesQuery(query.right, card, sourceCardId, state)
      );
  }
};

// ---------------------------------------------------------------------------
// Effective value — applies modifier stack to a card's base value
// ---------------------------------------------------------------------------

const allModifiers = (state: IKState): ReadonlyArray<ActiveModifier> =>
  state.roundModifiers.length === 0
    ? state.modifiers
    : [...state.modifiers, ...state.roundModifiers];

export const effectiveValue = (state: IKState, card: IKCard): number => {
  const isSteadfast = card.kind.props.keywords.includes("steadfast");
  let value = card.kind.props.value;

  const dummyCtx = {
    playedCard: card,
    activePlayer: state.activePlayer,
    numPlayers: state.numPlayers,
    playedFrom: null,
  };

  for (const mod of allModifiers(state)) {
    switch (mod.spec.tag) {
      case "selfCourtValue":
        if (card.id === mod.sourceCardId) {
          value = mod.spec.value;
        }
        break;
      case "valueChange":
        if (
          matchesQuery(mod.spec.target, card, mod.sourceCardId, state) &&
          !(isSteadfast && mod.spec.delta < 0)
        ) {
          value += mod.spec.delta;
        }
        break;
      case "conditionalValueChange":
        if (
          matchesQuery(mod.spec.target, card, mod.sourceCardId, state) &&
          !(isSteadfast && mod.spec.delta < 0) &&
          evaluate(mod.spec.condition, state, dummyCtx)
        ) {
          value += mod.spec.delta;
        }
        break;
      case "mute":
        if (
          !isSteadfast &&
          matchesQuery(mod.spec.target, card, mod.sourceCardId, state)
        ) {
          value = 3;
        }
        break;
      default:
        break;
    }
  }
  return Math.max(0, value);
};

// ---------------------------------------------------------------------------
// Effective keywords — applies keyword grants/revokes/mutes
// ---------------------------------------------------------------------------

export const effectiveKeywords = (
  state: IKState,
  card: IKCard,
): ReadonlyArray<CardKeyword> => {
  const isSteadfast = card.kind.props.keywords.includes("steadfast");
  const kws = new Set<CardKeyword>(card.kind.props.keywords);

  for (const mod of allModifiers(state)) {
    switch (mod.spec.tag) {
      case "grantKeyword":
        if (matchesQuery(mod.spec.target, card, mod.sourceCardId, state)) {
          kws.add(mod.spec.keyword);
        }
        break;
      case "revokeKeyword":
        if (
          !isSteadfast &&
          matchesQuery(mod.spec.target, card, mod.sourceCardId, state)
        ) {
          kws.delete(mod.spec.keyword);
        }
        break;
      case "mute":
        if (
          !isSteadfast &&
          matchesQuery(mod.spec.target, card, mod.sourceCardId, state)
        ) {
          for (const k of [...kws]) {
            if (k !== "steadfast") kws.delete(k);
          }
        }
        break;
      default:
        break;
    }
  }
  return [...kws];
};

// ---------------------------------------------------------------------------
// Refresh — recalculate active modifiers from court state
// ---------------------------------------------------------------------------

export const refreshModifiers = (state: IKState): IKState => {
  const mods: ActiveModifier[] = [];
  for (const entry of state.shared.court) {
    if (entry.face !== "up") continue;
    for (const effect of entry.card.kind.props.effects) {
      if (effect.tag === "continuous") {
        mods.push({
          sourceCardId: entry.card.id,
          spec: effect.modifier,
        });
      }
    }
  }
  return { ...state, modifiers: mods };
};
