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
  removeFromZone,
  insertIntoZone,
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
import { type TraceEntry } from "../effects/trace.js";
import { regulationDeck, type CardName } from "../card.js";
import { canPlayCard } from "./legal.js";

// ---------------------------------------------------------------------------
// Static effect lookup — card name -> onPlay EffectProgram.
// EffectProgram nodes contain closures that don't survive JSON serialization,
// so when replaying on the client we must use the live definitions.
// ---------------------------------------------------------------------------

const effectByCardName: ReadonlyMap<CardName, EffectProgram> = (() => {
  const map = new Map<CardName, EffectProgram>();
  for (const kind of regulationDeck(4)) {
    if (map.has(kind.name)) continue;
    const onPlay = kind.props.effects.find(
      (e): e is { readonly tag: "onPlay"; readonly effect: EffectProgram; readonly isOptional: boolean } =>
        e.tag === "onPlay",
    );
    if (onPlay) map.set(kind.name, onPlay.effect);
  }
  return map;
})();

// ---------------------------------------------------------------------------
// End-of-turn sequence: parting flush, then antechamber forced play
// ---------------------------------------------------------------------------

const finalAdvance = (state: IKState, originalState: IKState): IKState =>
  refreshModifiers({
    ...state,
    activePlayer: nextPlayer(originalState),
    turnCount: state.turnCount + 1,
    phase: "play",
    pendingResolution: null,
  });

const endOfTurn = (state: IKState, originalState: IKState): IKState => {
  const activePlayer = originalState.activePlayer;
  const zones = playerZones(state, activePlayer);

  if (zones.parting.length > 0) {
    if (zones.parting.length === 1) {
      const card = zones.parting[0]!;
      const removed = removeFromZone(
        state,
        { scope: "player", player: activePlayer, slot: "parting" },
        card.id,
      );
      if (removed.ok) {
        const inserted = insertIntoZone(
          removed.value.state,
          { scope: "shared", slot: "condemned" },
          removed.value.card,
          { face: "down" },
        );
        const afterParting = inserted.ok ? inserted.value : removed.value.state;
        return endOfTurnAfterParting(afterParting, originalState);
      }
    }
    return {
      ...state,
      phase: "end_of_turn",
      pendingResolution: null,
    };
  }

  return endOfTurnAfterParting(state, originalState);
};

const endOfTurnAfterParting = (state: IKState, originalState: IKState): IKState => {
  const activePlayer = originalState.activePlayer;
  const zones = playerZones(state, activePlayer);

  if (zones.antechamber.length > 0) {
    if (zones.antechamber.length === 1) {
      return applyAntechamberPlayDirect(state, zones.antechamber[0]!.id, originalState);
    }
    return {
      ...state,
      phase: "end_of_turn",
      pendingResolution: null,
    };
  }

  return finalAdvance(state, originalState);
};

const applyAntechamberPlayDirect = (
  state: IKState,
  cardId: number,
  originalState: IKState,
): IKState => {
  const activePlayer = originalState.activePlayer;
  const card = readZone(state, {
    scope: "player",
    player: activePlayer,
    slot: "antechamber",
  }).find((c) => c.id === cardId);
  if (!card) return finalAdvance(state, originalState);

  const moved = moveCard(
    state,
    cardId,
    { scope: "player", player: activePlayer, slot: "antechamber" },
    { scope: "shared", slot: "court" },
    { face: "up", playedBy: activePlayer },
  );
  if (!moved.ok) return finalAdvance(state, originalState);

  const onPlayEffect = card.kind.props.effects.find(
    (e) => e.tag === "onPlay",
  );

  const suppressEffect =
    onPlayEffect &&
    card.kind.props.fullText.includes("prevented if played from your Antechamber");

  if (!onPlayEffect || suppressEffect) {
    return finalAdvance(moved.value, originalState);
  }

  const ctx: EffectContext = {
    playedCard: card,
    activePlayer,
    numPlayers: state.numPlayers,
    playedFrom: "antechamber",
  };
  const resolution = resolve(onPlayEffect.effect, moved.value, ctx);

  if (resolution.tag === "done") {
    return finalAdvance(resolution.state, originalState);
  }

  return enterResolving(
    resolution,
    moved.value,
    { kind: "antechamberPlay", cardId: card.id },
    activePlayer,
  );
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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
    isReactionWindow: resolution.isReactionWindow ?? false,
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
  if (source.kind === "cardPlay" || source.kind === "antechamberPlay") {
    const entry = pending.stateBeforeEffect.shared.court.find(
      (e) => e.card.id === source.cardId,
    );
    if (!entry) return null;
    return effectByCardName.get(entry.card.kind.name as CardName) ?? null;
  }
  return buildDisgraceEffect(source.throneCardId);
};

// ---------------------------------------------------------------------------
// Play a card (from hand or antechamber)
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
  const antechamber = readZone(state, {
    scope: "player",
    player: activePlayer,
    slot: "antechamber",
  });
  const cardInHand = hand.find((c) => c.id === cardId);
  const cardInAntechamber = antechamber.find((c) => c.id === cardId);
  const card = cardInHand ?? cardInAntechamber;
  const sourceSlot: "hand" | "antechamber" = cardInHand ? "hand" : "antechamber";

  if (!card) return err({ kind: "card_not_in_hand", cardId });

  if (sourceSlot === "hand" && !canPlayCard(card, state, throneValue(state))) {
    return err({
      kind: "insufficient_value",
      cardValue: ikCardOps.value(card),
      threshold: throneValue(state),
    });
  }

  let moved = moveCard(
    state,
    cardId,
    { scope: "player", player: activePlayer, slot: sourceSlot },
    { scope: "shared", slot: "court" },
    { face: "up", playedBy: activePlayer },
  );
  if (!moved.ok) return err({ kind: "card_not_in_hand", cardId });

  if (card.kind.name === "King's Hand" && !moved.value.publiclyTrackedKH.includes(cardId)) {
    moved = { ok: true, value: { ...moved.value, publiclyTrackedKH: [...moved.value.publiclyTrackedKH, cardId] } };
  }

  const onPlayEffect = card.kind.props.effects.find(
    (e) => e.tag === "onPlay",
  );

  const suppressEffect =
    sourceSlot === "antechamber" &&
    onPlayEffect &&
    card.kind.props.fullText.includes("prevented if played from your Antechamber");

  if (!onPlayEffect || suppressEffect) {
    return ok(endOfTurn(moved.value, state));
  }

  const ctx: EffectContext = {
    playedCard: card,
    activePlayer,
    numPlayers: state.numPlayers,
    playedFrom: sourceSlot,
  };
  const resolution = resolve(onPlayEffect.effect, moved.value, ctx);

  if (resolution.tag === "done") {
    if (resolution.state.khPrevented) {
      return ok(refreshModifiers({
        ...resolution.state,
        phase: "play",
        activePlayer,
        pendingResolution: null,
        khPrevented: undefined,
      }));
    }
    return ok(endOfTurn(resolution.state, state));
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
    pending.source.kind === "disgrace"
      ? pending.source.throneCardId
      : pending.source.cardId;
  const contextEntry = pending.stateBeforeEffect.shared.court.find(
    (e) => e.card.id === contextCardId,
  );
  if (!contextEntry) return err({ kind: "no_pending_resolution" });

  const ctx: EffectContext = {
    playedCard: contextEntry.card,
    activePlayer: pending.effectPlayer,
    numPlayers: state.numPlayers,
    playedFrom: null,
  };

  const nextChoices = [...pending.choicesMade, choice];
  const resolution = replay(program, pending.stateBeforeEffect, ctx, nextChoices);

  if (resolution.tag === "done") {
    if (resolution.state.khPrevented) {
      return ok(refreshModifiers({
        ...resolution.state,
        phase: "play",
        activePlayer: pending.effectPlayer,
        pendingResolution: null,
        khPrevented: undefined,
      }));
    }
    return ok(endOfTurn(resolution.state, pending.stateBeforeEffect));
  }

  const nextPending: PendingResolution = {
    ...pending,
    choicesMade: nextChoices,
    currentOptions: resolution.options,
    choosingPlayer: resolution.player,
    isReactionWindow: resolution.isReactionWindow ?? false,
  };
  return ok({
    ...resolution.state,
    phase: "resolving",
    activePlayer: resolution.player,
    pendingResolution: nextPending,
  });
};

// ---------------------------------------------------------------------------
// End-of-turn actions (parting flush, antechamber play)
// ---------------------------------------------------------------------------

export const applyEndOfTurnSafe = (
  state: IKState,
  cardId: number,
): Result<TransitionError, IKState> => {
  const activePlayer = state.activePlayer;
  const zones = playerZones(state, activePlayer);

  if (zones.parting.length > 0) {
    const card = zones.parting.find((c) => c.id === cardId);
    if (!card) return err({ kind: "card_not_in_hand", cardId });
    const removed = removeFromZone(
      state,
      { scope: "player", player: activePlayer, slot: "parting" },
      cardId,
    );
    if (!removed.ok) return err({ kind: "card_not_in_hand", cardId });
    const inserted = insertIntoZone(
      removed.value.state,
      { scope: "shared", slot: "condemned" },
      removed.value.card,
      { face: "down" },
    );
    const afterParting = inserted.ok ? inserted.value : removed.value.state;
    return ok(endOfTurnAfterParting(afterParting, state));
  }

  if (zones.antechamber.length > 0) {
    const card = zones.antechamber.find((c) => c.id === cardId);
    if (!card) return err({ kind: "card_not_in_hand", cardId });
    return ok(applyAntechamberPlayDirect(state, cardId, state));
  }

  return err({ kind: "no_pending_resolution" });
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
    playedFrom: null,
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
    return ok(endOfTurn(resolution.state, state));
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

// ---------------------------------------------------------------------------
// Resolution tracing — replays the current pending resolution with a trace
// sink to produce a full English-language record of every interpreter step.
//
// When `tryComplete` is true, the function additionally tries appending each
// possible next choice to find the one that completed the resolution, so the
// returned trace includes the final choice and all steps that followed.
// ---------------------------------------------------------------------------

const buildTraceCtx = (
  pending: PendingResolution,
  numPlayers: number,
): EffectContext | null => {
  const contextCardId =
    pending.source.kind === "disgrace"
      ? pending.source.throneCardId
      : pending.source.cardId;
  const contextEntry = pending.stateBeforeEffect.shared.court.find(
    (e) => e.card.id === contextCardId,
  );
  if (!contextEntry) return null;
  return {
    playedCard: contextEntry.card,
    activePlayer: pending.effectPlayer,
    numPlayers,
    playedFrom: null,
  };
};

export const traceResolution = (
  state: IKState,
  tryComplete = false,
): ReadonlyArray<TraceEntry> => {
  const pending = state.pendingResolution;
  if (!pending) return [];

  const program = getEffectProgram(pending);
  if (!program) return [];

  const ctx = buildTraceCtx(pending, state.numPlayers);
  if (!ctx) return [];

  if (tryComplete) {
    for (let i = 0; i < pending.currentOptions.length; i++) {
      const fullChoices = [...pending.choicesMade, i];
      const entries: TraceEntry[] = [];
      const resolution = replay(
        program, pending.stateBeforeEffect, ctx, fullChoices,
        (e) => entries.push(e),
      );
      if (resolution.tag === "done") return entries;
    }
  }

  const entries: TraceEntry[] = [];
  replay(
    program, pending.stateBeforeEffect, ctx, pending.choicesMade,
    (e) => entries.push(e),
  );
  return entries;
};
