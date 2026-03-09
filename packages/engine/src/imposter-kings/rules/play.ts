import { ok, err, type Result, type PlayerId } from "@imposter-zero/types";

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
import { refreshModifiers, crystallizeStickyModifiers } from "../effects/modifiers.js";
import {
  done,
  active,
  activeHand,
  activeSuccessor,
  flipKing,
  disgrace as disgraceNode,
  move,
  withFirstCardIn,
  forceLoser,
  triggerReaction,
  recall,
  rally,
  charismaticRally,
  binaryChoice,
  seq,
  playerZone,
} from "../effects/program.js";
import type { KingFacet } from "../zones.js";
import { resolve, replay } from "../effects/interpreter.js";
import { type TraceEntry } from "../effects/trace.js";
import { regulationDeck, SIGNATURE_CARD_KINDS, type CardName } from "../card.js";
import { BASE_ARMY_NAMES } from "../config.js";
import { canPlayCard, legalActions as computeLegalActions } from "./legal.js";

// ---------------------------------------------------------------------------
// Static effect lookup — card name -> onPlay EffectProgram.
// EffectProgram nodes contain closures that don't survive JSON serialization,
// so when replaying on the client we must use the live definitions.
// ---------------------------------------------------------------------------

const effectByCardName: ReadonlyMap<CardName, EffectProgram> = (() => {
  const map = new Map<CardName, EffectProgram>();
  for (const kind of [...regulationDeck(4), ...SIGNATURE_CARD_KINDS]) {
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

const finalAdvance = (state: IKState, originalState: IKState): IKState => {
  let s = refreshModifiers({
    ...state,
    activePlayer: nextPlayer(originalState),
    turnCount: state.turnCount + 1,
    phase: "play",
    pendingResolution: null,
  });

  while (
    s.numPlayers - s.eliminatedPlayers.length > 2 &&
    computeLegalActions(s).length === 0
  ) {
    s = refreshModifiers({
      ...s,
      eliminatedPlayers: [...s.eliminatedPlayers, s.activePlayer],
      activePlayer: nextPlayer(s),
      turnCount: s.turnCount + 1,
    });
  }

  return s;
};

const endOfTurn = (state: IKState, originalState: IKState): IKState => {
  return endOfTurnAfterParting(state, originalState);
};

const endOfTurnAfterParting = (state: IKState, originalState: IKState): IKState => {
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

  let moved = moveCard(
    state,
    cardId,
    { scope: "player", player: activePlayer, slot: "antechamber" },
    { scope: "shared", slot: "court" },
    { face: "up", playedBy: activePlayer },
  );
  if (!moved.ok) return finalAdvance(state, originalState);
  moved = { ok: true, value: crystallizeStickyModifiers(moved.value, cardId, activePlayer) };

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
    playedOnValue: throneValue(state),
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
    ctx,
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
  effectContext: EffectContext,
): IKState => {
  const pending: PendingResolution = {
    source,
    effectPlayer: effectPlayer,
    effectContext: {
      playedFrom: effectContext.playedFrom,
      playedOnValue: effectContext.playedOnValue,
      copiedName: effectContext.copiedName,
    },
    choicesMade: [],
    currentOptions: resolution.options,
    choosingPlayer: resolution.player,
    stateBeforeEffect,
    isReactionWindow: resolution.isReactionWindow ?? false,
    reactionWindowKind: resolution.reactionWindowKind,
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

const activeSquire = playerZone(active, "squire");

const buildDefaultDisgrace = (throneCardId: number): EffectProgram =>
  flipKing(
    active,
    "down",
    disgraceNode(
      { kind: "id", cardId: throneCardId },
      withFirstCardIn(activeSuccessor, (cardId) =>
        move({ kind: "id", cardId }, activeSuccessor, activeHand),
      ),
    ),
  );

const buildTacticianDisgrace = (
  throneCardId: number,
  throneBaseValue: number,
  successorBaseValue: number,
): EffectProgram => {
  const takeSuccessor = (then: EffectProgram) =>
    withFirstCardIn(activeSuccessor, (sId) =>
      move({ kind: "id", cardId: sId }, activeSuccessor, activeHand, then),
    );
  const takeSquire = withFirstCardIn(activeSquire, (sqId) =>
    move({ kind: "id", cardId: sqId }, activeSquire, activeHand),
  );
  const removeSquireThenRally = withFirstCardIn(activeSquire, (sqId) =>
    seq(
      move({ kind: "id", cardId: sqId }, activeSquire, { kind: "sharedZone", slot: "condemned" }),
      rally(),
    ),
  );

  const matched = successorBaseValue === throneBaseValue;

  const baseArmyFilter = { tag: "nameInSet" as const, names: BASE_ARMY_NAMES };

  const body = matched
    ? takeSuccessor(
        recall(
          binaryChoice(active, (choseRally) =>
            choseRally ? removeSquireThenRally : takeSquire,
          ),
          baseArmyFilter,
        ),
      )
    : binaryChoice(active, (choseSuccessor) =>
        choseSuccessor
          ? withFirstCardIn(activeSuccessor, (sId) =>
              move({ kind: "id", cardId: sId }, activeSuccessor, activeHand),
            )
          : withFirstCardIn(activeSquire, (sqId) =>
              move({ kind: "id", cardId: sqId }, activeSquire, activeHand),
            ),
      );

  return flipKing(
    active,
    "down",
    disgraceNode({ kind: "id", cardId: throneCardId }, body),
  );
};

const buildCharismaticDisgrace = (
  throneCardId: number,
  successorBaseValue: number,
): EffectProgram =>
  flipKing(
    active,
    "down",
    disgraceNode(
      { kind: "id", cardId: throneCardId },
      binaryChoice(active, (choseRally) =>
        choseRally
          ? withFirstCardIn(activeSuccessor, (sId) =>
              seq(
                move({ kind: "id", cardId: sId }, activeSuccessor, { kind: "sharedZone", slot: "condemned" }),
                charismaticRally(successorBaseValue),
              ),
            )
          : withFirstCardIn(activeSuccessor, (sId) =>
              move({ kind: "id", cardId: sId }, activeSuccessor, activeHand),
            ),
      ),
    ),
  );

const buildDisgraceEffect = (
  throneCardId: number,
  facet: KingFacet,
  throneBaseValue: number,
  successorBaseValue: number,
): EffectProgram => {
  const body = (() => {
    switch (facet) {
      case "masterTactician":
        return buildTacticianDisgrace(throneCardId, throneBaseValue, successorBaseValue);
      case "charismatic":
        return buildCharismaticDisgrace(throneCardId, successorBaseValue);
      default:
        return buildDefaultDisgrace(throneCardId);
    }
  })();
  return triggerReaction("king_flip", body, forceLoser(active));
};

const getEffectProgram = (pending: PendingResolution): EffectProgram | null => {
  const { source } = pending;
  if (source.kind === "cardPlay" || source.kind === "antechamberPlay") {
    const entry = pending.stateBeforeEffect.shared.court.find(
      (e) => e.card.id === source.cardId,
    );
    if (!entry) return null;
    return effectByCardName.get(entry.card.kind.name as CardName) ?? null;
  }
  const st = pending.stateBeforeEffect;
  const activePlayer = pending.effectPlayer as import("@imposter-zero/types").PlayerId;
  const facet = playerZones(st, activePlayer).king.facet;
  const throneEntry = st.shared.court.find((e) => e.card.id === source.throneCardId);
  const throneBaseValue = throneEntry?.card.kind.props.value ?? 0;
  const successorBaseValue = playerZones(st, activePlayer).successor?.card.kind.props.value ?? 0;
  return buildDisgraceEffect(source.throneCardId, facet, throneBaseValue, successorBaseValue);
};

// ---------------------------------------------------------------------------
// Condemn a parting card (turn action)
// ---------------------------------------------------------------------------

const applyCondemnPartingSafe = (
  state: IKState,
  cardId: number,
): Result<TransitionError, IKState> => {
  const activePlayer = state.activePlayer;
  const removed = removeFromZone(
    state,
    { scope: "player", player: activePlayer, slot: "parting" },
    cardId,
  );
  if (!removed.ok) return err({ kind: "card_not_in_hand", cardId });
  const allPlayers = Array.from({ length: state.numPlayers }, (_, i) => i as import("@imposter-zero/types").PlayerId);
  const inserted = insertIntoZone(
    removed.value.state,
    { scope: "shared", slot: "condemned" },
    removed.value.card,
    { face: "down", knownBy: allPlayers },
  );
  const afterCondemn = inserted.ok ? inserted.value : removed.value.state;
  return ok(finalAdvance(afterCondemn, state));
};

const flushAllParting = (state: IKState): IKState => {
  const allPlayers: PlayerId[] = Array.from(
    { length: state.numPlayers },
    (_, i) => i as PlayerId,
  );
  let s = state;
  for (const p of allPlayers) {
    const parting = readZone(s, { scope: "player", player: p, slot: "parting" });
    for (const card of parting) {
      const removed = removeFromZone(s, { scope: "player", player: p, slot: "parting" }, card.id);
      if (!removed.ok) continue;
      const inserted = insertIntoZone(
        removed.value.state,
        { scope: "shared", slot: "condemned" },
        removed.value.card,
        { face: "down", knownBy: allPlayers },
      );
      s = inserted.ok ? inserted.value : removed.value.state;
    }
  }
  return s;
};

// ---------------------------------------------------------------------------
// Play a card (from hand or antechamber)
// ---------------------------------------------------------------------------

export const applyPlaySafe = (
  state: IKState,
  cardId: number,
): Result<TransitionError, IKState> => {
  const activePlayer = state.activePlayer;

  const parting = readZone(state, {
    scope: "player",
    player: activePlayer,
    slot: "parting",
  });
  const partingCard = parting.find((c) => c.id === cardId);
  if (partingCard) {
    return applyCondemnPartingSafe(state, cardId);
  }

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

  moved = { ok: true, value: crystallizeStickyModifiers(moved.value, cardId, activePlayer) };

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
    playedOnValue: throneValue(state),
  };
  const resolution = resolve(onPlayEffect.effect, moved.value, ctx);

  if (resolution.tag === "done") {
    if (resolution.state.khPrevented) {
      return ok(refreshModifiers(flushAllParting({
        ...resolution.state,
        phase: "play",
        activePlayer,
        pendingResolution: null,
        khPrevented: undefined,
      })));
    }
    return ok(endOfTurn(resolution.state, state));
  }

  return ok(
    enterResolving(
      resolution,
      moved.value,
      { kind: "cardPlay", cardId: card.id },
      activePlayer,
      ctx,
    ),
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
    playedFrom: pending.effectContext.playedFrom,
    playedOnValue: pending.effectContext.playedOnValue,
    copiedName: pending.effectContext.copiedName,
  };

  const nextChoices = [...pending.choicesMade, choice];
  const resolution = replay(program, pending.stateBeforeEffect, ctx, nextChoices);

  if (resolution.tag === "done") {
    if (resolution.state.khPrevented) {
      const flushed = refreshModifiers(flushAllParting({
        ...resolution.state,
        phase: "play",
        activePlayer: pending.effectPlayer,
        pendingResolution: null,
        khPrevented: undefined,
      }));
      if (pending.source.kind === "disgrace") {
        return ok(endOfTurn(flushed, pending.stateBeforeEffect));
      }
      return ok(flushed);
    }
    return ok(endOfTurn(resolution.state, pending.stateBeforeEffect));
  }

  const nextPending: PendingResolution = {
    ...pending,
    choicesMade: nextChoices,
    currentOptions: resolution.options,
    choosingPlayer: resolution.player,
    isReactionWindow: resolution.isReactionWindow ?? false,
    reactionWindowKind: resolution.reactionWindowKind,
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

  const facet = playerZones(state, activePlayer).king.facet;
  const throneBaseValue = top.card.kind.props.value;
  const successorBaseValue = playerZones(state, activePlayer).successor?.card.kind.props.value ?? 0;
  const effect = buildDisgraceEffect(top.card.id, facet, throneBaseValue, successorBaseValue);
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
      ctx,
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
