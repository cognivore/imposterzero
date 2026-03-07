import type { PlayerId } from "@imposter-zero/types";

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
  playedBy?: PlayerId,
): boolean => {
  switch (query.tag) {
    case "self":
      return card.id === sourceCardId;
    case "byName": {
      const courtEntry = state.shared.court.find((e) => e.card.id === card.id);
      const name = courtEntry?.copiedName ?? card.kind.name;
      return name === query.name;
    }
    case "byKeyword":
      return card.kind.props.keywords.includes(query.keyword);
    case "byBaseValue":
      return card.kind.props.value === query.value;
    case "byMinBaseValue":
      return card.kind.props.value >= query.minValue;
    case "allInCourt":
      return state.shared.court.some((e) => e.card.id === card.id);
    case "allInCourtExceptSelf":
      return (
        card.id !== sourceCardId &&
        state.shared.court.some((e) => e.card.id === card.id)
      );
    case "byId":
      return card.id === query.cardId;
    case "ownedBySourceOwner": {
      if (playedBy === undefined) return false;
      const pz = state.players[playedBy];
      if (!pz) return false;
      return (
        pz.hand.some((c) => c.id === card.id) ||
        pz.antechamber.some((c) => c.id === card.id) ||
        state.shared.court.some(
          (e) => e.card.id === card.id && e.playedBy === playedBy,
        )
      );
    }
    case "and":
      return (
        matchesQuery(query.left, card, sourceCardId, state, playedBy) &&
        matchesQuery(query.right, card, sourceCardId, state, playedBy)
      );
    case "or":
      return (
        matchesQuery(query.left, card, sourceCardId, state, playedBy) ||
        matchesQuery(query.right, card, sourceCardId, state, playedBy)
      );
  }
};

// ---------------------------------------------------------------------------
// Effective value — applies modifier stack to a card's base value
// ---------------------------------------------------------------------------

const allModifiers = (state: IKState): ReadonlyArray<ActiveModifier> => {
  let result: ReadonlyArray<ActiveModifier> = state.modifiers;
  if (state.roundModifiers.length > 0)
    result = [...result, ...state.roundModifiers];
  if (state.crystallizedModifiers.length > 0)
    result = [...result, ...state.crystallizedModifiers];
  return result;
};

export const effectiveValue = (state: IKState, card: IKCard): number => {
  const isSteadfast = effectiveKeywords(state, card).includes("steadfast");
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
          matchesQuery(mod.spec.target, card, mod.sourceCardId, state, mod.playedBy) &&
          !(isSteadfast && mod.spec.delta < 0)
        ) {
          value += mod.spec.delta;
        }
        break;
      case "conditionalValueChange":
        if (
          matchesQuery(mod.spec.target, card, mod.sourceCardId, state, mod.playedBy) &&
          !(isSteadfast && mod.spec.delta < 0) &&
          evaluate(mod.spec.condition, state, dummyCtx)
        ) {
          value += mod.spec.delta;
        }
        break;
      case "mute":
        break;
      case "valueChangePerCount": {
        const vpcSpec = mod.spec as Extract<typeof mod.spec, { tag: "valueChangePerCount" }>;
        if (!matchesQuery(vpcSpec.target, card, mod.sourceCardId, state, mod.playedBy))
          break;
        const count = state.shared.court.filter(
          (e) =>
            e.face === "up" &&
            matchesQuery(vpcSpec.countQuery, e.card, mod.sourceCardId, state, mod.playedBy),
        ).length;
        const totalDelta = vpcSpec.deltaPerMatch * count;
        if (!(isSteadfast && totalDelta < 0)) {
          value += totalDelta;
        }
        break;
      }
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
        if (matchesQuery(mod.spec.target, card, mod.sourceCardId, state, mod.playedBy)) {
          kws.add(mod.spec.keyword);
        }
        break;
      case "revokeKeyword":
        if (
          !isSteadfast &&
          matchesQuery(mod.spec.target, card, mod.sourceCardId, state, mod.playedBy)
        ) {
          kws.delete(mod.spec.keyword);
        }
        break;
      case "mute":
        if (
          !isSteadfast &&
          matchesQuery(mod.spec.target, card, mod.sourceCardId, state, mod.playedBy)
        ) {
          for (const k of [...kws]) {
            if (k !== "steadfast") kws.delete(k);
          }
        }
        break;
      case "conditionalRevokeKeyword": {
        if (!matchesQuery(mod.spec.target, card, mod.sourceCardId, state, mod.playedBy))
          break;
        const modCtx = {
          playedCard: card,
          activePlayer: mod.playedBy ?? state.activePlayer,
          numPlayers: state.numPlayers,
          playedFrom: null as "hand" | "antechamber" | null,
        };
        if (evaluate(mod.spec.condition, state, modCtx)) {
          kws.delete(mod.spec.keyword);
        }
        break;
      }
      default:
        break;
    }
  }
  return [...kws];
};

// ---------------------------------------------------------------------------
// Crystallize sticky round modifiers for a card that just entered court
// ---------------------------------------------------------------------------

const specHasTarget = (
  spec: ModifierSpec,
): spec is Exclude<ModifierSpec, { tag: "selfCourtValue" }> =>
  "target" in spec;

export const crystallizeStickyModifiers = (
  state: IKState,
  cardId: number,
  cardPlayedBy: PlayerId,
): IKState => {
  const newCrystallized: ActiveModifier[] = [];
  for (const mod of state.roundModifiers) {
    if (!mod.sticky) continue;
    if (!specHasTarget(mod.spec)) continue;
    const card = state.shared.court.find((e) => e.card.id === cardId)?.card;
    if (!card) continue;
    if (matchesQuery(mod.spec.target, card, mod.sourceCardId, state, mod.playedBy)) {
      newCrystallized.push({
        sourceCardId: mod.sourceCardId,
        spec: { ...mod.spec, target: { tag: "byId", cardId } },
        playedBy: cardPlayedBy,
      });
    }
  }
  if (newCrystallized.length === 0) return state;
  return {
    ...state,
    crystallizedModifiers: [...state.crystallizedModifiers, ...newCrystallized],
  };
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
          playedBy: entry.playedBy,
        });
      }
    }
  }
  return { ...state, modifiers: mods };
};
