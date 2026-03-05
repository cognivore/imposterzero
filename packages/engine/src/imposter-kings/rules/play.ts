import { ok, err, type Result } from "@imposter-zero/types";

import { ikCardOps } from "../card.js";
import type { TransitionError } from "../errors.js";
import {
  nextPlayer,
  playerZones,
  throne,
  type IKState,
  type PendingResolution,
  type PendingEffectSource,
} from "../state.js";
import { throneValue } from "../selectors.js";
import {
  readZone,
  moveCard,
  setKingFace,
  disgraceInCourt,
} from "../zone-addr.js";
import type { EffectContext, EffectProgram, Resolution } from "../effects/program.js";
import { refreshModifiers } from "../effects/modifiers.js";
import {
  done,
  active,
  flipKing,
  disgrace as disgraceNode,
  forceLoser,
  triggerReaction,
} from "../effects/program.js";
import { resolve, replay } from "../effects/interpreter.js";
import { canPlayCard } from "./legal.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const advanceTurn = (state: IKState, originalState: IKState): IKState =>
  refreshModifiers({
    ...state,
    activePlayer: nextPlayer(originalState),
    turnCount: state.turnCount + 1,
    phase: "play",
    pendingResolution: null,
  });

const enterResolving = (
  resolution: Resolution & { tag: "needChoice" },
  stateBeforeEffect: IKState,
  source: PendingEffectSource,
  effectPlayer: number,
): IKState => {
  const pending: PendingResolution = {
    source,
    effectPlayer: effectPlayer,
    choicesMade: [],
    currentOptions: resolution.options,
    choosingPlayer: resolution.player,
    stateBeforeEffect,
  };
  return {
    ...resolution.state,
    phase: "resolving",
    activePlayer: resolution.player,
    pendingResolution: pending,
  };
};

// ---------------------------------------------------------------------------
// Effect program reconstruction for replay
// ---------------------------------------------------------------------------

const buildDisgraceEffect = (throneCardId: number): EffectProgram =>
  triggerReaction(
    "king_flip",
    flipKing(active, "down", disgraceNode({ kind: "id", cardId: throneCardId })),
    forceLoser(active),
  );

const getEffectProgram = (pending: PendingResolution): EffectProgram | null => {
  const { source } = pending;
  if (source.kind === "cardPlay") {
    const entry = pending.stateBeforeEffect.shared.court.find(
      (e) => e.card.id === source.cardId,
    );
    const onPlay = entry?.card.kind.props.effects.find(
      (e) => e.tag === "onPlay",
    );
    return onPlay?.effect ?? null;
  }
  return buildDisgraceEffect(source.throneCardId);
};

// ---------------------------------------------------------------------------
// Play a card
// ---------------------------------------------------------------------------

export const applyPlaySafe = (
  state: IKState,
  cardId: number,
): Result<TransitionError, IKState> => {
  const activePlayer = state.activePlayer;
  const hand = readZone(state, {
    scope: "player",
    player: activePlayer,
    slot: "hand",
  });
  const card = hand.find((c) => c.id === cardId);

  if (!card) return err({ kind: "card_not_in_hand", cardId });

  if (!canPlayCard(card, state, throneValue(state))) {
    return err({
      kind: "insufficient_value",
      cardValue: ikCardOps.value(card),
      threshold: throneValue(state),
    });
  }

  const moved = moveCard(
    state,
    cardId,
    { scope: "player", player: activePlayer, slot: "hand" },
    { scope: "shared", slot: "court" },
    { face: "up", playedBy: activePlayer },
  );
  if (!moved.ok) return err({ kind: "card_not_in_hand", cardId });

  const onPlayEffect = card.kind.props.effects.find(
    (e) => e.tag === "onPlay",
  );

  if (!onPlayEffect) {
    return ok(advanceTurn(moved.value, state));
  }

  const ctx: EffectContext = {
    playedCard: card,
    activePlayer,
    numPlayers: state.numPlayers,
  };
  const resolution = resolve(onPlayEffect.effect, moved.value, ctx);

  if (resolution.tag === "done") {
    return ok(advanceTurn(resolution.state, state));
  }

  return ok(
    enterResolving(resolution, moved.value, { kind: "cardPlay", cardId: card.id }, activePlayer),
  );
};

// ---------------------------------------------------------------------------
// Resolve an effect choice
// ---------------------------------------------------------------------------

export const applyEffectChoiceSafe = (
  state: IKState,
  choice: number,
): Result<TransitionError, IKState> => {
  const pending = state.pendingResolution;
  if (!pending) return err({ kind: "no_pending_resolution" });
  if (choice < 0 || choice >= pending.currentOptions.length) {
    return err({ kind: "invalid_effect_choice", choice });
  }

  const program = getEffectProgram(pending);
  if (!program) return err({ kind: "no_pending_resolution" });

  const contextCardId =
    pending.source.kind === "cardPlay"
      ? pending.source.cardId
      : pending.source.throneCardId;
  const contextEntry = pending.stateBeforeEffect.shared.court.find(
    (e) => e.card.id === contextCardId,
  );
  if (!contextEntry) return err({ kind: "no_pending_resolution" });

  const ctx: EffectContext = {
    playedCard: contextEntry.card,
    activePlayer: pending.effectPlayer,
    numPlayers: state.numPlayers,
  };

  const nextChoices = [...pending.choicesMade, choice];
  const resolution = replay(program, pending.stateBeforeEffect, ctx, nextChoices);

  if (resolution.tag === "done") {
    return ok(advanceTurn(resolution.state, pending.stateBeforeEffect));
  }

  const nextPending: PendingResolution = {
    ...pending,
    choicesMade: nextChoices,
    currentOptions: resolution.options,
    choosingPlayer: resolution.player,
  };
  return ok({
    ...resolution.state,
    phase: "resolving",
    activePlayer: resolution.player,
    pendingResolution: nextPending,
  });
};

// ---------------------------------------------------------------------------
// Disgrace (with Assassin reaction support)
// ---------------------------------------------------------------------------

export const applyDisgraceSafe = (
  state: IKState,
): Result<TransitionError, IKState> => {
  const activePlayer = state.activePlayer;
  const top = throne(state);

  if (!top) return err({ kind: "no_throne_for_disgrace" });
  if (playerZones(state, activePlayer).king.face === "down") {
    return err({ kind: "king_already_down" });
  }

  const effect = buildDisgraceEffect(top.card.id);
  const ctx: EffectContext = {
    playedCard: top.card,
    activePlayer,
    numPlayers: state.numPlayers,
  };

  const resolution = resolve(effect, state, ctx);

  if (resolution.tag === "done") {
    if (resolution.state.forcedLoser !== null) {
      return ok({
        ...resolution.state,
        phase: "play",
        pendingResolution: null,
      });
    }
    return ok(advanceTurn(resolution.state, state));
  }

  return ok(
    enterResolving(
      resolution,
      state,
      { kind: "disgrace", throneCardId: top.card.id },
      activePlayer,
    ),
  );
};
