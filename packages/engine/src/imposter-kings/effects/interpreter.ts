import type { PlayerId } from "@imposter-zero/types";

import type { CardName } from "../card.js";
import type { IKState } from "../state.js";
import { nextPlayer } from "../state.js";
import {
  readZone,
  removeFromZone,
  insertIntoZone,
  moveCard as zoneMove,
  disgraceInCourt as zoneDis,
  setKingFace as zoneFlip,
  type IKZoneAddress,
} from "../zone-addr.js";
import type {
  EffectProgram,
  EffectContext,
  Resolution,
  CardRef,
  PlayerRef,
  ZoneRef,
  CardFilter,
  TriggerKind,
} from "./program.js";
import { evaluate } from "./predicates.js";

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

const resolveCard = (ref: CardRef, ctx: EffectContext): number =>
  ref.kind === "played" ? ctx.playedCard.id : ref.cardId;

const resolvePlayer = (ref: PlayerRef, ctx: EffectContext): PlayerId =>
  ref.kind === "active" ? ctx.activePlayer : ref.player;

const resolveZone = (ref: ZoneRef, ctx: EffectContext): IKZoneAddress =>
  ref.kind === "playerZone"
    ? { scope: "player", player: resolvePlayer(ref.player, ctx), slot: ref.slot }
    : { scope: "shared", slot: ref.slot };

// ---------------------------------------------------------------------------
// Card filtering for choice options
// ---------------------------------------------------------------------------

const matchesFilter = (
  card: { readonly id: number; readonly kind: { readonly props: { readonly keywords: readonly string[]; readonly value: number } } },
  filter: CardFilter,
  state: IKState,
): boolean => {
  switch (filter.tag) {
    case "notDisgraced": {
      const entry = state.shared.court.find((e) => e.card.id === card.id);
      return !entry || entry.face === "up";
    }
    case "notRoyalty":
      return !card.kind.props.keywords.includes("royalty");
    case "notDisgracedOrRoyalty": {
      const entry = state.shared.court.find((e) => e.card.id === card.id);
      const isDisgraced = entry && entry.face === "down";
      const isRoyalty = card.kind.props.keywords.includes("royalty");
      return !isDisgraced && !isRoyalty;
    }
    case "hasKeyword":
      return card.kind.props.keywords.includes(filter.keyword);
    case "minValue":
      return card.kind.props.value >= filter.value;
  }
};

// ---------------------------------------------------------------------------
// Interpreter — steps through effect program, yielding Resolution
// ---------------------------------------------------------------------------

export const resolve = (
  program: EffectProgram,
  state: IKState,
  ctx: EffectContext,
): Resolution => {
  switch (program.tag) {
    case "done":
      return { tag: "done", state };

    case "disgraceAllInCourt": {
      const exceptId = program.except
        ? resolveCard(program.except, ctx)
        : null;
      const nextCourt = state.shared.court.map((e) =>
        e.card.id === exceptId ? e : { ...e, face: "down" as const },
      );
      const s: IKState = {
        ...state,
        shared: { ...state.shared, court: nextCourt },
      };
      return resolve(program.then, s, ctx);
    }

    case "disgraceInCourt": {
      const cardId = resolveCard(program.target, ctx);
      const result = zoneDis(state, cardId);
      return resolve(program.then, result.ok ? result.value : state, ctx);
    }

    case "moveCard": {
      const cardId = resolveCard(program.card, ctx);
      const from = resolveZone(program.from, ctx);
      const to = resolveZone(program.to, ctx);
      const result = zoneMove(state, cardId, from, to);
      return resolve(program.then, result.ok ? result.value : state, ctx);
    }

    case "setKingFace": {
      const player = resolvePlayer(program.player, ctx);
      const s = zoneFlip(state, player, program.face);
      return resolve(program.then, s, ctx);
    }

    case "ifCond": {
      const cond = evaluate(program.predicate, state, ctx);
      return resolve(cond ? program.then_ : program.else_, state, ctx);
    }

    case "chooseCard": {
      const player = resolvePlayer(program.player, ctx);
      const zone = resolveZone(program.zone, ctx);
      const cards = readZone(state, zone);
      const filtered = program.filter
        ? cards.filter((c) => matchesFilter(c, program.filter!, state))
        : cards;
      if (filtered.length === 0) return { tag: "done", state };
      const options = filtered.map((c) => ({
        kind: "card" as const,
        cardId: c.id,
      }));
      return {
        tag: "needChoice",
        state,
        player,
        options,
        resume: (choice) =>
          resolve(program.andThen(options[choice]!.cardId), state, ctx),
      };
    }

    case "choosePlayer": {
      const options = Array.from(
        { length: ctx.numPlayers },
        (_, i) => i as PlayerId,
      )
        .filter((p) => p !== ctx.activePlayer)
        .map((p) => ({ kind: "player" as const, player: p }));
      if (options.length === 0) return { tag: "done", state };
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) =>
          resolve(program.andThen(options[choice]!.player), state, ctx),
      };
    }

    case "nameCard": {
      const allNames: CardName[] = [
        "Fool", "Assassin", "Elder", "Zealot", "Inquisitor", "Soldier",
        "Judge", "Oathbound", "Immortal", "Warlord", "Mystic", "Warden",
        "Sentry", "King's Hand", "Princess", "Queen", "Executioner", "Bard",
        "Herald", "Spy", "Arbiter",
      ];
      const options = allNames.map((n) => ({
        kind: "cardName" as const,
        name: n,
      }));
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) =>
          resolve(program.andThen(options[choice]!.name), state, ctx),
      };
    }

    case "nameValue": {
      const options = Array.from(
        { length: program.max - program.min + 1 },
        (_, i) => ({ kind: "value" as const, value: program.min + i }),
      );
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options,
        resume: (choice) =>
          resolve(program.andThen(options[choice]!.value), state, ctx),
      };
    }

    case "forEachOpponent": {
      const opponents: PlayerId[] = [];
      for (let i = 1; i < ctx.numPlayers; i++) {
        opponents.push(
          nextPlayer(state, ((ctx.activePlayer + i - 1) % ctx.numPlayers) as PlayerId),
        );
      }
      const chain = opponents.reduceRight<EffectProgram>(
        (acc, opp) => {
          const oppEffect = program.effect(opp);
          return spliceBeforeDone(oppEffect, acc);
        },
        program.then,
      );
      return resolve(chain, state, ctx);
    }

    case "optional": {
      return {
        tag: "needChoice",
        state,
        player: ctx.activePlayer,
        options: [
          { kind: "pass" },
          { kind: "pass" },
        ],
        resume: (choice) =>
          choice === 1
            ? resolve(program.effect, state, ctx)
            : resolve(program.otherwise, state, ctx),
      };
    }

    case "triggerReaction": {
      const reactors = findPotentialReactors(state, ctx, program.trigger);
      if (reactors.length === 0) {
        return resolve(program.continuation, state, ctx);
      }
      return resolveReactionChain(
        reactors,
        0,
        state,
        ctx,
        program.continuation,
        program.onReacted,
      );
    }

    case "forceLoser": {
      const player = resolvePlayer(program.player, ctx);
      return { tag: "done", state: { ...state, forcedLoser: player } };
    }
  }
};

const findPotentialReactors = (
  state: IKState,
  ctx: EffectContext,
  trigger: TriggerKind,
): ReadonlyArray<{ readonly player: PlayerId; readonly cardId: number }> => {
  const result: Array<{ player: PlayerId; cardId: number }> = [];
  for (let i = 1; i < ctx.numPlayers; i++) {
    const player = ((ctx.activePlayer + i) % ctx.numPlayers) as PlayerId;
    const hand = readZone(state, {
      scope: "player",
      player,
      slot: "hand",
    });
    for (const card of hand) {
      const hasReaction = card.kind.props.effects.some(
        (e) => e.tag === "reaction" && e.trigger === trigger,
      );
      if (hasReaction) {
        result.push({ player, cardId: card.id });
      }
    }
  }
  return result;
};

const resolveReactionChain = (
  reactors: ReadonlyArray<{ readonly player: PlayerId; readonly cardId: number }>,
  idx: number,
  state: IKState,
  ctx: EffectContext,
  continuation: EffectProgram,
  onReacted: EffectProgram,
): Resolution => {
  if (idx >= reactors.length) {
    return resolve(continuation, state, ctx);
  }
  const reactor = reactors[idx]!;
  return {
    tag: "needChoice",
    state,
    player: reactor.player,
    options: [{ kind: "pass" }, { kind: "pass" }],
    resume: (choice) => {
      if (choice === 1) {
        const removed = removeFromZone(
          state,
          { scope: "player", player: reactor.player, slot: "hand" },
          reactor.cardId,
        );
        let s = removed.ok ? removed.value.state : state;
        if (removed.ok) {
          const condemned = insertIntoZone(
            s,
            { scope: "shared", slot: "army" },
            removed.value.card,
          );
          if (condemned.ok) s = condemned.value;
        }
        return resolve(onReacted, s, ctx);
      }
      return resolveReactionChain(
        reactors,
        idx + 1,
        state,
        ctx,
        continuation,
        onReacted,
      );
    },
  };
};

/**
 * Replays an effect program, feeding in previously-made choices.
 * Returns the Resolution at the current decision point (or Done).
 */
export const replay = (
  program: EffectProgram,
  state: IKState,
  ctx: EffectContext,
  choices: ReadonlyArray<number>,
): Resolution => {
  let resolution = resolve(program, state, ctx);
  for (const choice of choices) {
    if (resolution.tag !== "needChoice") break;
    resolution = resolution.resume(choice);
  }
  return resolution;
};

/**
 * Replaces the terminal `done` of `program` with `continuation`,
 * effectively sequencing two effect programs.
 */
const spliceBeforeDone = (
  program: EffectProgram,
  continuation: EffectProgram,
): EffectProgram => {
  switch (program.tag) {
    case "done":
      return continuation;
    case "disgraceAllInCourt":
      return { ...program, then: spliceBeforeDone(program.then, continuation) };
    case "disgraceInCourt":
      return { ...program, then: spliceBeforeDone(program.then, continuation) };
    case "moveCard":
      return { ...program, then: spliceBeforeDone(program.then, continuation) };
    case "setKingFace":
      return { ...program, then: spliceBeforeDone(program.then, continuation) };
    case "ifCond":
      return {
        ...program,
        then_: spliceBeforeDone(program.then_, continuation),
        else_: spliceBeforeDone(program.else_, continuation),
      };
    case "forEachOpponent":
      return { ...program, then: spliceBeforeDone(program.then, continuation) };
    case "optional":
      return {
        ...program,
        effect: spliceBeforeDone(program.effect, continuation),
        otherwise: spliceBeforeDone(program.otherwise, continuation),
      };
    case "triggerReaction":
      return {
        ...program,
        continuation: spliceBeforeDone(program.continuation, continuation),
      };
    case "forceLoser":
      return program;
    default:
      return program;
  }
};
